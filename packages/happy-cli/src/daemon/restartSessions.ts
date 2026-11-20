/**
 * Restart running sessions onto the installed happy-cli and the machine's
 * current Claude Code / Codex (Original Happy).
 *
 * A session is a long-lived process: after an upgrade (or `claude update`) it
 * keeps running the old happy-cli and the old agent binary until it is
 * restarted, and the daemon restart on install does not touch it. This stops
 * each session the daemon started and resumes it in place — same Happy session
 * id, same Claude / Codex conversation — so it comes back on the new binaries.
 * A turn in progress is interrupted; the conversation itself is kept.
 *
 * Sessions started from a terminal (`happy` typed by a person) are left alone:
 * killing one would take the person's terminal UI away. They are reported.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

export type RestartTarget = {
    sessionId: string;
    pid: number;
    /** A child of this daemon (its exit event is observed). */
    tracked: boolean;
    flavor?: string;
    path?: string;
};

export type RestartOutcome = {
    sessionId: string;
    flavor?: string;
    path?: string;
    result: 'restarted' | 'failed';
    error?: string;
};

export type RestartDeps = {
    stop: (target: RestartTarget) => void;
    forceKill: (target: RestartTarget) => void;
    /** True once the process is gone (and, for a tracked child, its exit was handled). */
    isGone: (target: RestartTarget) => boolean;
    resume: (sessionId: string) => Promise<SpawnSessionResult>;
    sleep: (ms: number) => Promise<void>;
};

export async function restartTargets(
    targets: RestartTarget[],
    deps: RestartDeps,
    opts: { exitTimeoutMs?: number; pollMs?: number } = {},
): Promise<RestartOutcome[]> {
    const exitTimeoutMs = opts.exitTimeoutMs ?? 15_000;
    const pollMs = opts.pollMs ?? 200;
    const outcomes: RestartOutcome[] = [];
    // One at a time: each resume reconnects to the relay and starts an agent.
    for (const target of targets) {
        const base = { sessionId: target.sessionId, flavor: target.flavor, path: target.path };
        try {
            deps.stop(target);
            let waited = 0;
            while (!deps.isGone(target) && waited < exitTimeoutMs) {
                await deps.sleep(pollMs);
                waited += pollMs;
            }
            if (!deps.isGone(target)) {
                deps.forceKill(target);
                let killWait = 0;
                while (!deps.isGone(target) && killWait < 5_000) {
                    await deps.sleep(pollMs);
                    killWait += pollMs;
                }
                if (!deps.isGone(target)) {
                    outcomes.push({ ...base, result: 'failed', error: `process ${target.pid} did not exit` });
                    continue;
                }
            }
            const resumed = await deps.resume(target.sessionId);
            outcomes.push(resumed.type === 'success'
                ? { ...base, result: 'restarted' }
                : { ...base, result: 'failed', error: resumed.type === 'error' ? resumed.errorMessage : resumed.type });
        } catch (error) {
            outcomes.push({ ...base, result: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
    }
    return outcomes;
}

/**
 * The command line of a process, or null. Used to make sure a PID read from
 * sessions.json still belongs to a daemon-started happy session before it is
 * signalled (PIDs get reused).
 */
export function readProcessCommand(pid: number): string | null {
    try {
        if (process.platform === 'linux') {
            return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim() || null;
        }
        return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch {
        return null;
    }
}

export function isDaemonStartedHappyProcess(command: string | null): boolean {
    return !!command && /happy/i.test(command) && /--started-by\s+daemon/.test(command);
}

/** Signal a session's process group (the daemon spawns each session as a group leader). */
export function signalSessionGroup(pid: number, signal: NodeJS.Signals): void {
    if (process.platform !== 'win32') {
        try {
            process.kill(-pid, signal);
            return;
        } catch {
            // Not a group leader (or already gone): fall back to the process.
        }
    }
    try {
        process.kill(pid, signal);
    } catch {
        // Already gone.
    }
}

/**
 * Signal what is left of a session's process group after its leader exited
 * (the agent child). Group only: the leader's PID may already be reused.
 */
export function signalLeftoverGroup(pid: number, signal: NodeJS.Signals): void {
    if (process.platform === 'win32') return;
    try {
        process.kill(-pid, signal);
    } catch {
        // No such group: nothing left.
    }
}
