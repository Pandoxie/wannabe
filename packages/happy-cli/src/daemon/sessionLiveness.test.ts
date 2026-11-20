import { describe, expect, it, vi } from 'vitest';
import type { PersistedSession } from '@/persistence';
import { hasPersistedProcessConflict, isPidAlive, machineBootTimeMs, procInfo, startTicks, type ProcReader } from './sessionLiveness';

const noProc = () => null;

describe('session liveness (PR #1715), without /proc', () => {
    it.each([undefined, 0, -1, 1.5, NaN, Infinity])('does not probe invalid PID %s', (pid) => {
        const kill = vi.fn();
        expect(isPidAlive(pid, kill, noProc)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });

    it('only treats ESRCH as proof of death', () => {
        expect(isPidAlive(123, () => {}, noProc)).toBe(true);
        for (const code of ['ESRCH', 'EPERM', 'EACCES', undefined]) {
            expect(isPidAlive(123, () => { throw Object.assign(new Error('probe'), { code }); }, noProc)).toBe(code !== 'ESRCH');
        }
    });

    it('subtracts uptime from now', () => {
        expect(machineBootTimeMs(60, 1_000_000)).toBe(940_000);
    });

    it('rejects a live same-boot persisted PID without granting ownership or signalling it', () => {
        const kill = vi.fn();
        const persisted = { metadata: { hostPid: 123 }, savedAt: 200 } as PersistedSession;
        expect(hasPersistedProcessConflict(persisted, 100, noProc, kill)).toBe(true);
        expect(kill.mock.calls).toEqual([[123, 0]]);
        kill.mockClear();
        expect(hasPersistedProcessConflict(persisted, 300, noProc, kill)).toBe(false);
        expect(hasPersistedProcessConflict(undefined, 100, noProc, kill)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });
});

// Original Happy: the container restart of 2026-11-18 (hostPid 611 became a thread of another session).
describe('session liveness with /proc', () => {
    const bootSec = 1_790_000_000;
    const selfStartedAtMs = (bootSec + 1000) * 1000;           // this process: 1000 s after boot
    const stat = (pid: number, ticksAfterBoot: number) => `${pid} (node (x) y) S ${'1 '.repeat(18)}${ticksAfterBoot} 0 0`;
    const fakeProc = (entries: Record<number, { tgid: number; startSec: number }>): ProcReader => (path) => {
        if (path === '/proc/stat') return `cpu 1 2 3\nbtime ${bootSec}\n`;
        if (path === '/proc/self/stat') return stat(9999, 1000 * 100);
        const m = /^\/proc\/(\d+)\/(status|stat)$/.exec(path);
        const e = m && entries[Number(m[1])];
        if (!e) return '';
        return m![2] === 'status' ? `Name:\tnode\nTgid:\t${e.tgid}\nPid:\t${m![1]}\n` : stat(Number(m![1]), e.startSec * 100);
    };
    const reader = fakeProc({
        609: { tgid: 609, startSec: 900 },   // a process started 900 s after boot
        611: { tgid: 609, startSec: 900 },   // a thread of 609
        700: { tgid: 700, startSec: 100 },   // the session's own old process
    });
    const proc = (pid: number) => procInfo(pid, reader, selfStartedAtMs);
    const saved = (hostPid: number, savedSec: number) => ({ metadata: { hostPid }, savedAt: (bootSec + savedSec) * 1000 } as PersistedSession);
    const kill = vi.fn();

    it('reads the start time after a comm with spaces and parentheses', () => {
        expect(startTicks(stat(1, 4242))).toBe(4242);
    });

    it('a thread ID is not a process', () => {
        expect(proc(611)).toEqual({ kind: 'thread' });
        expect(isPidAlive(611, kill, proc)).toBe(false);
        expect(hasPersistedProcessConflict(saved(611, 200), 0, proc, kill)).toBe(false);
    });

    it('a process that started after the record was saved reused the ID', () => {
        expect(isPidAlive(609, kill, proc)).toBe(true);
        expect(hasPersistedProcessConflict(saved(609, 200), 0, proc, kill)).toBe(false);
    });

    it('the real old process is still a conflict, whatever os.uptime says', () => {
        expect(proc(700)).toEqual({ kind: 'process', startedAtMs: (bootSec + 100) * 1000 });
        expect(hasPersistedProcessConflict(saved(700, 200), Number.MAX_SAFE_INTEGER, proc, kill)).toBe(true);
    });

    it('an ID with no process is dead', () => {
        expect(isPidAlive(12345, kill, proc)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });

    it('works against the real /proc for this process', () => {
        const real = procInfo(process.pid);
        if (real === null) return; // no /proc here (macOS)
        expect(real.kind).toBe('process');
        if (real.kind === 'process' && real.startedAtMs !== null) {
            expect(Math.abs(real.startedAtMs - (Date.now() - process.uptime() * 1000))).toBeLessThan(3000);
        }
    });

    it('a real thread of this process is a thread, not a process', async () => {
        const { readdirSync } = await import('node:fs');
        let tids: number[] = [];
        try { tids = readdirSync(`/proc/${process.pid}/task`).map(Number).filter((t) => t !== process.pid); } catch { return; }
        if (tids.length === 0) return;
        expect(procInfo(tids[0])).toEqual({ kind: 'thread' });
        expect(isPidAlive(tids[0])).toBe(false);
    });
});
