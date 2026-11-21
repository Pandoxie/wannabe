import { describe, expect, it, vi } from 'vitest';
import { isDaemonStartedHappyProcess, restartTargets, type RestartTarget } from './restartSessions';

const target = (sessionId: string, pid: number, tracked = false): RestartTarget => ({ sessionId, pid, tracked, flavor: 'claude', path: '/w' });

function deps(opts: { exitsAfterStop?: Set<number>; exitsAfterKill?: Set<number>; resumeFails?: Set<string> } = {}) {
    const alive = new Set<number>([1, 2, 3]);
    const calls: string[] = [];
    return {
        calls,
        deps: {
            stop: vi.fn((t: RestartTarget) => { calls.push(`stop ${t.sessionId}`); if (opts.exitsAfterStop?.has(t.pid) ?? true) alive.delete(t.pid); }),
            forceKill: vi.fn((t: RestartTarget) => { calls.push(`kill ${t.sessionId}`); if (opts.exitsAfterKill?.has(t.pid) ?? true) alive.delete(t.pid); }),
            isGone: (t: RestartTarget) => !alive.has(t.pid),
            resume: vi.fn(async (id: string) => {
                calls.push(`resume ${id}`);
                return opts.resumeFails?.has(id)
                    ? { type: 'error' as const, errorMessage: 'no metadata' }
                    : { type: 'success' as const, sessionId: id };
            }),
            sleep: async () => {},
        },
    };
}

describe('restartTargets', () => {
    it('stops each session, waits for it to exit, then resumes it — one at a time', async () => {
        const { deps: d, calls } = deps();
        const out = await restartTargets([target('a', 1, true), target('b', 2)], d);
        expect(calls).toEqual(['stop a', 'resume a', 'stop b', 'resume b']);
        expect(out.map((o) => o.result)).toEqual(['restarted', 'restarted']);
    });

    it('force-kills a session that ignores SIGTERM', async () => {
        const { deps: d, calls } = deps({ exitsAfterStop: new Set() });
        const out = await restartTargets([target('a', 1)], d, { exitTimeoutMs: 1000, pollMs: 100 });
        expect(calls).toEqual(['stop a', 'kill a', 'resume a']);
        expect(out[0].result).toBe('restarted');
    });

    it('does not resume a session whose process will not die', async () => {
        const { deps: d } = deps({ exitsAfterStop: new Set(), exitsAfterKill: new Set() });
        const out = await restartTargets([target('a', 1)], d, { exitTimeoutMs: 200, pollMs: 100 });
        expect(out[0]).toMatchObject({ result: 'failed', error: 'process 1 did not exit' });
        expect(d.resume).not.toHaveBeenCalled();
    });

    it('reports a failed resume and carries on with the next session', async () => {
        const { deps: d } = deps({ resumeFails: new Set(['a']) });
        const out = await restartTargets([target('a', 1), target('b', 2)], d);
        expect(out).toMatchObject([
            { sessionId: 'a', result: 'failed', error: 'no metadata' },
            { sessionId: 'b', result: 'restarted' },
        ]);
    });

    it('leaves a session running when it could not be resumed, and carries on', async () => {
        const { deps: d, calls } = deps();
        const check = vi.fn(async (t: RestartTarget) => t.sessionId === 'a' ? 'Happy session a is missing its Claude session ID.' : undefined);
        const out = await restartTargets([target('a', 1), target('b', 2)], { ...d, check });
        expect(calls).toEqual(['stop b', 'resume b']);
        expect(out).toMatchObject([
            { sessionId: 'a', result: 'kept', error: 'Happy session a is missing its Claude session ID.' },
            { sessionId: 'b', result: 'restarted' },
        ]);
    });
});

describe('isDaemonStartedHappyProcess', () => {
    it('accepts a daemon-started happy session', () => {
        expect(isDaemonStartedHappyProcess('/usr/bin/node --no-warnings /home/u/.nvm/lib/node_modules/happy/dist/index.mjs claude --happy-starting-mode remote --started-by daemon')).toBe(true);
    });

    it('rejects anything else (PID reuse, terminal sessions, unknown)', () => {
        expect(isDaemonStartedHappyProcess(null)).toBe(false);
        expect(isDaemonStartedHappyProcess('/usr/bin/python3 server.py')).toBe(false);
        expect(isDaemonStartedHappyProcess('node /lib/node_modules/happy/dist/index.mjs --started-by terminal')).toBe(false);
    });
});
