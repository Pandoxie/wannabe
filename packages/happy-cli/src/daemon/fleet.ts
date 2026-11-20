/**
 * Original Happy: the fleet hub, run by the daemon (`happy fleet on`).
 *
 * The hub (packages/happy-fleet, hub.mjs) lets the agents of one account find
 * and message each other (happy MCP tools list_agents / send_to_agent). The
 * daemon of a HAPPY_HOME_DIR whose fleet is switched on runs it as a child
 * process, restarts it when it exits, stops it with the daemon and starts the
 * new code after an upgrade. One hub per account: the hub holds a lease on
 * the relay, so another one switched on elsewhere waits.
 *
 * $HAPPY_HOME_DIR/fleet holds only `enabled` (the switch), `hub.pid`,
 * `fleet.log` (rotated at 5 MB) and an optional `.env`. The account key is
 * happy-agent's agent.key in $HAPPY_HOME_DIR (one QR scan).
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';

/** Exit code of a hub that cannot run as configured (not logged in): not restarted. */
export const FLEET_EXIT_CONFIG = 78;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export type FleetPaths = {
    dir: string;
    enabled: string;
    pid: string;
    log: string;
    agentKey: string;
};

export function fleetPaths(happyHomeDir: string): FleetPaths {
    const dir = join(happyHomeDir, 'fleet');
    return {
        dir,
        enabled: join(dir, 'enabled'),
        pid: join(dir, 'hub.pid'),
        log: join(dir, 'fleet.log'),
        agentKey: join(happyHomeDir, 'agent.key'),
    };
}

/** Installed next to happy (global node_modules, or packages/ in this repo). */
export function siblingPackage(name: string): string {
    return join(dirname(projectPath()), name);
}

/** The happy-fleet package directory, or null when it is not installed. */
export function resolveFleetPackage(env: NodeJS.ProcessEnv = process.env): string | null {
    const candidates = [env.HAPPY_FLEET_DIR, siblingPackage('happy-fleet')].filter((d): d is string => !!d);
    return candidates.find((dir) => existsSync(join(dir, 'hub.mjs'))) ?? null;
}

export function isFleetEnabled(paths: FleetPaths): boolean {
    return existsSync(paths.enabled);
}

export function setFleetEnabled(paths: FleetPaths, on: boolean): void {
    if (on) {
        mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
        // A new timestamp each time: a hub stopped for a config problem starts again.
        writeFileSync(paths.enabled, `${new Date().toISOString()}\n`);
    } else if (existsSync(paths.enabled)) {
        unlinkSync(paths.enabled);
    }
}

function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Is pid a fleet hub (a leftover from a daemon that was killed)? */
function isWatcherProcess(pid: number): boolean {
    try {
        return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes('hub.mjs');
    } catch { return false; }
}

export type FleetStatus = {
    enabled: boolean;
    installed: boolean;
    loggedIn: boolean;
    running: boolean;
    pid: number | null;
    since: number | null;
    restarts: number;
    stoppedReason: string | null;
    dir: string;
    log: string;
};

export type FleetSupervisor = {
    /** Starts or stops the hub to match the switch (daemon start, heartbeat, `happy fleet on/off`). */
    sync(): FleetStatus;
    /** Stops the hub (daemon shutdown or hand-off). */
    stop(): Promise<void>;
    status(): FleetStatus;
};

export function startFleetSupervisor(opts: {
    happyHomeDir: string;
    serverUrl: string;
    env?: NodeJS.ProcessEnv;
    nodePath?: string;
}): FleetSupervisor {
    const paths = fleetPaths(opts.happyHomeDir);
    const baseEnv = opts.env ?? process.env;
    let child: ChildProcess | null = null;
    let since: number | null = null;
    let restarts = 0;
    let stopping = false;
    let restartTimer: NodeJS.Timeout | null = null;
    let backoffMs = 5_000;
    // A hub that exited for a config problem stays stopped until the switch is touched again.
    let blockedFor: string | null = null;
    let stoppedReason: string | null = null;

    // A hub left behind by a daemon that did not shut down cleanly.
    try {
        const old = parseInt(readFileSync(paths.pid, 'utf8'), 10);
        if (old && old !== process.pid && isAlive(old) && isWatcherProcess(old)) {
            logger.debug(`[FLEET] Stopping leftover hub pid ${old}`);
            process.kill(old, 'SIGTERM');
        }
    } catch {}

    const enabledStamp = () => { try { return readFileSync(paths.enabled, 'utf8'); } catch { return null; } };

    const status = (): FleetStatus => ({
        enabled: isFleetEnabled(paths),
        installed: resolveFleetPackage(baseEnv) !== null,
        loggedIn: existsSync(paths.agentKey),
        running: child !== null,
        pid: child?.pid ?? null,
        since,
        restarts,
        stoppedReason,
        dir: paths.dir,
        log: paths.log,
    });

    const launch = () => {
        const pkg = resolveFleetPackage(baseEnv);
        if (!pkg) { stoppedReason = 'happy-fleet is not installed (happy update)'; return; }
        if (!existsSync(paths.agentKey)) { stoppedReason = 'not logged in: run happy fleet on'; return; }
        try {
            mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
            if (existsSync(paths.log) && statSync(paths.log).size > LOG_ROTATE_BYTES) renameSync(paths.log, `${paths.log}.1`);
        } catch (e) { logger.debug('[FLEET] Preparing the runtime directory failed', e); }
        const fd = openSync(paths.log, 'a', 0o600);
        const proc = spawn(opts.nodePath ?? process.execPath, [join(pkg, 'hub.mjs')], {
            cwd: paths.dir,
            env: {
                ...baseEnv,
                HAPPY_HOME_DIR: opts.happyHomeDir,
                HAPPY_SERVER_URL: opts.serverUrl,
                FLEET_HOME: paths.dir,
                FLEET_PARENT_PID: String(process.pid),
            },
            stdio: ['ignore', fd, fd],
        });
        closeSync(fd);
        child = proc;
        since = Date.now();
        stoppedReason = null;
        try { writeFileSync(paths.pid, `${proc.pid}\n`); } catch {}
        logger.debug(`[FLEET] Hub started, pid ${proc.pid}`);
        proc.on('exit', (code, signal) => {
            const ranMs = Date.now() - (since ?? Date.now());
            if (child === proc) { child = null; since = null; }
            try { if (readFileSync(paths.pid, 'utf8').trim() === String(proc.pid)) unlinkSync(paths.pid); } catch {}
            logger.debug(`[FLEET] Hub exited (code ${code}, signal ${signal})`);
            if (stopping || !isFleetEnabled(paths)) return;
            if (code === FLEET_EXIT_CONFIG) {
                blockedFor = enabledStamp();
                stoppedReason = `stopped: configuration problem (see ${paths.log}); run happy fleet on again after fixing it`;
                return;
            }
            backoffMs = ranMs > 5 * 60_000 ? 5_000 : Math.min(backoffMs * 2, 60_000);
            stoppedReason = `exited (code ${code ?? signal}); restarting in ${Math.round(backoffMs / 1000)} s`;
            restarts += 1;
            restartTimer = setTimeout(() => { restartTimer = null; sync(); }, backoffMs);
        });
    };

    const kill = async () => {
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        const proc = child;
        if (!proc) return;
        child = null;
        since = null;
        const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
        proc.kill('SIGTERM'); // the hub releases its lease on SIGTERM
        const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5_000));
        if (await Promise.race([exited, timeout]) === 'timeout') proc.kill('SIGKILL');
    };

    const sync = (): FleetStatus => {
        if (stopping) return status();
        if (!isFleetEnabled(paths)) {
            blockedFor = null;
            stoppedReason = null;
            if (child) void kill();
            return status();
        }
        if (child || restartTimer) return status();
        if (blockedFor !== null && blockedFor === enabledStamp()) return status();
        blockedFor = null;
        launch();
        return status();
    };

    return {
        sync,
        status,
        async stop() {
            stopping = true;
            await kill();
        },
    };
}

/** `happy fleet off --delete`: the runtime directory, nothing else. */
export function deleteFleetRuntime(paths: FleetPaths): void {
    rmSync(paths.dir, { recursive: true, force: true });
}
