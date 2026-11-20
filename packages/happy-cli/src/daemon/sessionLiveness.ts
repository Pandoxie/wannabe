import { readFileSync } from 'node:fs';
import type { PersistedSession } from '@/persistence';

// Adapted from chphch's PR #1715. Only ESRCH proves absence: permission errors
// must not permit a second owner, and a saved PID is never authority to kill.
//
// Original Happy (2026-11-18): a saved PID is checked against /proc where
// there is one. In a container that restarted, PIDs start over: a session's
// old hostPid 611 came back as a *thread* of another session (kill(611, 0)
// succeeds for thread IDs, /proc/611 exists, `ps` hides it), and the daemon
// refused to resume a dead session. And os.uptime() is the host's uptime
// inside a container, so "saved before this boot" never caught it. Now:
// - an ID whose Tgid is not itself is a thread, not a process: not alive;
// - a process that started after the record was saved reused the ID: not ours.
// Without /proc (macOS) the previous checks stay.

/** What /proc says about an ID. */
export type ProcInfo = { kind: 'none' } | { kind: 'thread' } | { kind: 'process'; startedAtMs: number | null };

/** File contents; '' when the file does not exist; null when it cannot be read. */
export type ProcReader = (path: string) => string | null;

const fsProc: ProcReader = (path) => {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'ENOENT' || code === 'ESRCH' ? '' : null;
    }
};

let readProc: ProcReader = fsProc;

/** Tests whose PIDs are made up (process.kill mocked) run as if there were no /proc. */
export function setProcReaderForTests(reader: ProcReader | null): void {
    readProc = reader ?? fsProc;
}

/** Field 22 of /proc/<pid>/stat: start time in clock ticks after boot. */
export function startTicks(stat: string): number | null {
    // comm (field 2) may hold spaces and parentheses: count from after the last ')'.
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const ticks = Number(stat.slice(close + 2).split(' ')[19]);
    return Number.isFinite(ticks) ? ticks : null;
}

/** Boot time from /proc/stat, and ticks per second calibrated on this process. */
function clock(read: ProcReader, selfStat: string, selfStartedAtMs: number): { bootMs: number; hz: number } | null {
    const btime = /^btime (\d+)$/m.exec(read('/proc/stat') ?? '')?.[1];
    const selfTicks = startTicks(selfStat);
    if (!btime || selfTicks === null) return null;
    const bootMs = Number(btime) * 1000;
    const seconds = (selfStartedAtMs - bootMs) / 1000;
    // USER_HZ is 100 on every mainstream kernel; calibrate anyway and snap.
    const measured = seconds > 1 ? selfTicks / seconds : 100;
    const hz = [100, 250, 300, 1000].reduce((best, h) => (Math.abs(h - measured) < Math.abs(best - measured) ? h : best), 100);
    return { bootMs, hz };
}

/** null when there is no usable /proc (macOS) or the ID's status cannot be read. */
export function procInfo(
    pid: number,
    read: ProcReader = (path) => readProc(path),
    selfStartedAtMs: number = Date.now() - process.uptime() * 1000,
): ProcInfo | null {
    const selfStat = read('/proc/self/stat');
    if (!selfStat) return null;
    const status = read(`/proc/${pid}/status`);
    if (status === null) return null;
    if (status === '') return { kind: 'none' };
    const tgid = Number(/^Tgid:\s*(\d+)$/m.exec(status)?.[1]);
    if (Number.isFinite(tgid) && tgid !== pid) return { kind: 'thread' };
    const c = clock(read, selfStat, selfStartedAtMs);
    const ticks = startTicks(read(`/proc/${pid}/stat`) ?? '');
    return { kind: 'process', startedAtMs: c && ticks !== null ? c.bootMs + (ticks / c.hz) * 1000 : null };
}

export function isPidAlive(
    pid: number | undefined,
    kill: (pid: number, signal: 0) => void = process.kill,
    proc: (pid: number) => ProcInfo | null = procInfo,
): boolean {
    if (!Number.isSafeInteger(pid) || pid! <= 0) return false;
    const info = proc(pid!);
    if (info) return info.kind === 'process';
    try {
        kill(pid!, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

export function machineBootTimeMs(uptimeSeconds: number, nowMs: number): number {
    return nowMs - uptimeSeconds * 1000;
}

/** Ticks are 10 ms and the record is written right after the spawn: allow a little. */
const START_SLACK_MS = 2000;

/**
 * The saved PID still names the process the record was written for. With
 * /proc: a process (not a thread) that started before the record was saved.
 * Without: saved since this boot (`bootTimeMs`) and answering kill 0.
 */
export function isPersistedProcessAlive(
    session: PersistedSession | undefined,
    bootTimeMs: number,
    proc: (pid: number) => ProcInfo | null = procInfo,
    kill: (pid: number, signal: 0) => void = process.kill,
): boolean {
    if (!session) return false;
    const pid = session.metadata?.hostPid;
    if (!Number.isSafeInteger(pid) || pid! <= 0) return false;
    const info = proc(pid!);
    if (info) {
        if (info.kind !== 'process') return false;
        return info.startedAtMs === null || info.startedAtMs <= session.savedAt + START_SLACK_MS;
    }
    if (session.savedAt < bootTimeMs) return false;
    return isPidAlive(pid, kill, () => null);
}

/** A live saved PID is a possible conflict, not verified session ownership. */
export function hasPersistedProcessConflict(
    session: PersistedSession | undefined,
    bootTimeMs: number,
    proc: (pid: number) => ProcInfo | null = procInfo,
    kill: (pid: number, signal: 0) => void = process.kill,
): boolean {
    return isPersistedProcessAlive(session, bootTimeMs, proc, kill);
}
