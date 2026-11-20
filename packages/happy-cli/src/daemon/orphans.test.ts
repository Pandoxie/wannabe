import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { findOrphanSessions, cleanOrphanSessions } from './orphans';

// The real process table is never used here: `sessions` and `managed` are
// injected. (Running the real scan once killed the test runner itself: it is
// a session process with no daemon under the test's temporary HOME.)
const dirs: string[] = [];
const kids: ChildProcess[] = [];
const saved = { HOME: process.env.HOME, HAPPY_HOME_DIR: process.env.HAPPY_HOME_DIR };

afterEach(() => {
    for (const k of kids.splice(0)) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
    for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
    if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
    if (saved.HAPPY_HOME_DIR === undefined) delete process.env.HAPPY_HOME_DIR; else process.env.HAPPY_HOME_DIR = saved.HAPPY_HOME_DIR;
});

/** A temp HOME with one home dir (`.happy`) whose logs/ name `pid` as a session. */
function setup(logForPids: number[]) {
    const base = mkdtempSync(join(tmpdir(), 'happy-home-'));
    dirs.push(base);
    const home = join(base, '.happy');
    mkdirSync(join(home, 'logs'), { recursive: true });
    process.env.HOME = base;
    delete process.env.HAPPY_HOME_DIR;
    for (const pid of logForPids) {
        writeFileSync(join(home, 'logs', `2026-11-16-13-00-00-pid-${pid}.log`), '');
    }
    return home;
}

/** A live process: node <tmp>/index.mjs claude … (looks like a session to the OS). */
function fakeSession(extra: string[] = ['--started-by', 'daemon'], code = 'setTimeout(() => {}, 60000);\n'): ChildProcess {
    const d = mkdtempSync(join(tmpdir(), 'happy-fake-'));
    dirs.push(d);
    const entry = join(d, 'index.mjs');
    writeFileSync(entry, code);
    const child = spawn(process.execPath, [entry, 'claude', ...extra], { stdio: 'ignore' });
    kids.push(child);
    return child;
}

/** Gone, or a zombie this test process has not reaped yet. */
const gone = (pid: number) => {
    try { process.kill(pid, 0); } catch { return true; }
    try { const st = readFileSync(`/proc/${pid}/stat`, 'utf8'); return st[st.lastIndexOf(')') + 2] === 'Z'; } catch { return false; }
};

const noDaemon = async () => ({ pids: new Set<number>(), daemons: 0 });

describe('sessions without a daemon', () => {
    it('finds a session no daemon lists and stops it', async () => {
        const child = fakeSession();
        const home = setup([child.pid!]);
        const { orphans, daemons } = await findOrphanSessions({
            sessions: [{ pid: child.pid!, args: 'claude --started-by daemon' }],
            managed: noDaemon,
        });
        expect(daemons).toBe(0);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].home).toBe(home); // found through the home's logs
        const r = await cleanOrphanSessions(orphans, 5_000);
        expect(r.signalled).toEqual([child.pid]);
        expect(gone(child.pid!)).toBe(true);
    });

    it('leaves alone what a running daemon lists', async () => {
        const child = fakeSession();
        setup([child.pid!]);
        const { orphans, daemons } = await findOrphanSessions({
            sessions: [{ pid: child.pid!, args: 'claude' }],
            managed: async () => ({ pids: new Set([child.pid!]), daemons: 1 }),
        });
        expect(daemons).toBe(1);
        expect(orphans).toHaveLength(0);
        expect(gone(child.pid!)).toBe(false);
    });

    it('skips dead pids and this process itself', async () => {
        const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
        kids.push(dead);
        await new Promise((r) => setTimeout(r, 300));
        setup([]);
        const { orphans } = await findOrphanSessions({
            sessions: [{ pid: dead.pid!, args: 'claude' }, { pid: process.pid, args: 'claude' }],
            managed: noDaemon,
        });
        expect(orphans).toHaveLength(0);
    });

    it('never stops the command it runs in (its ancestors)', async () => {
        setup([]);
        // The test runner's own parent chain is what a real run would meet.
        const { orphans } = await findOrphanSessions({
            sessions: [{ pid: process.pid, args: 'claude' }, { pid: process.ppid, args: 'claude' }],
            managed: noDaemon,
        });
        expect(orphans.map((o) => o.pid)).not.toContain(process.pid);
        expect(orphans.map((o) => o.pid)).not.toContain(process.ppid);
    });

    it('kills one that ignores SIGTERM', async () => {
        const child = fakeSession(['--started-by', 'daemon'], 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 60000);\n');
        setup([child.pid!]);
        await new Promise((r) => setTimeout(r, 300)); // let it install the handler
        const { orphans } = await findOrphanSessions({
            sessions: [{ pid: child.pid!, args: 'codex --started-by daemon' }],
            managed: noDaemon,
        });
        const r = await cleanOrphanSessions(orphans, 600);
        expect(r.killed).toContain(child.pid);
        expect(gone(child.pid!)).toBe(true);
    });
});
