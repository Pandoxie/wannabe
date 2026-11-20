/**
 * Original Happy: `happy fleet` — the fleet hub for this HAPPY_HOME_DIR, which
 * lets the account's agents find and message each other (happy MCP tools
 * list_agents / send_to_agent). The daemon runs it (daemon/fleet.ts).
 *
 *   happy fleet on       log in happy-agent if needed (QR code), switch on;
 *                        starts the daemon if it is not running
 *   happy fleet off      switch off (the daemon stops the hub)
 *   happy fleet off --delete   also delete $HAPPY_HOME_DIR/fleet
 *   happy fleet status   on/off, running, the last log lines
 *   happy fleet logs [-f]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { configuration } from '@/configuration';
import { checkIfDaemonRunningAndCleanupStaleState, syncDaemonFleet } from '@/daemon/controlClient';
import { deleteFleetRuntime, fleetPaths, resolveFleetPackage, setFleetEnabled, siblingPackage, type FleetStatus } from '@/daemon/fleet';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';
import { sanitizeSessionEnvironment } from '@/daemon/sessionEnvironment';

const paths = () => fleetPaths(configuration.happyHomeDir);

function agentEnv(): NodeJS.ProcessEnv {
    return { ...process.env, HAPPY_HOME_DIR: configuration.happyHomeDir, HAPPY_SERVER_URL: configuration.serverUrl };
}

function lastLines(file: string, n: number): string[] {
    try { return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).slice(-n); } catch { return []; }
}

async function startDaemon(): Promise<boolean> {
    const child = spawnHappyCLI(['daemon', 'start-sync'], { detached: true, stdio: 'ignore', env: sanitizeSessionEnvironment(process.env) });
    child.unref();
    for (let i = 0; i < 50; i++) {
        if (await checkIfDaemonRunningAndCleanupStaleState()) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return false;
}

function printStatus(s: FleetStatus | null) {
    const p = paths();
    const on = existsSync(p.enabled);
    console.log(`Fleet hub: ${on ? chalk.green('on') : 'off'}  (${configuration.happyHomeDir})`);
    if (s) {
        console.log(`  hub:       ${s.running ? chalk.green(`running, pid ${s.pid}`) + (s.since ? ` since ${new Date(s.since).toLocaleString()}` : '') : (s.stoppedReason ?? 'not running')}`);
        if (s.restarts) console.log(`  restarts:  ${s.restarts}`);
    } else if (on) {
        console.log(`  hub:       ${chalk.yellow('no daemon running')} — start it: happy daemon start`);
    }
    console.log(`  logged in: ${existsSync(p.agentKey) ? 'yes' : chalk.yellow('no — run happy fleet on')}`);
    const lines = lastLines(p.log, 5);
    if (lines.length) {
        console.log('  log:');
        for (const line of lines) console.log(`    ${line}`);
    }
}

export async function handleFleetCommand(args: string[]): Promise<void> {
    const sub = args[0] ?? 'status';
    const p = paths();

    if (sub === 'on') {
        if (!resolveFleetPackage()) {
            console.error('happy-fleet is not installed next to happy. Update: happy update');
            process.exit(1);
        }
        if (!existsSync(p.agentKey)) {
            console.log('The fleet hub opens every session of your account, so it needs the account key:');
            console.log('scan this QR code with the Happy app (Settings → Account → Link new device).\n');
            const agentBin = join(siblingPackage('happy-agent'), 'bin', 'happy-agent.mjs');
            if (!existsSync(agentBin)) {
                console.error('happy-agent is not installed next to happy. Update: happy update');
                process.exit(1);
            }
            const login = spawnSync(process.execPath, [agentBin, 'auth', 'login'], { stdio: 'inherit', env: agentEnv() });
            if (login.status !== 0 || !existsSync(p.agentKey)) {
                console.error('\nNot logged in; the fleet stays off. Run happy fleet on again to retry.');
                process.exit(1);
            }
        }
        setFleetEnabled(p, true);
        let status = await syncDaemonFleet();
        if ('error' in status) {
            console.log('Starting the happy daemon (it runs the fleet hub)…');
            if (!(await startDaemon())) {
                console.error('Could not start the daemon: happy daemon start');
                process.exit(1);
            }
            status = await syncDaemonFleet();
        }
        console.log();
        printStatus('error' in status ? null : status);
        console.log('\nEvery session of this account (Claude and Codex, on any machine with happy 1.2.6+orig.34 or newer)');
        console.log('can now find the others (list_agents) and message them (send_to_agent). One hub per account:');
        console.log('another one switched on elsewhere waits.');
        return;
    }

    if (sub === 'off') {
        setFleetEnabled(p, false);
        const status = await syncDaemonFleet();
        if (args.includes('--delete')) {
            deleteFleetRuntime(p);
            console.log(`Fleet hub off; deleted ${p.dir}`);
        } else {
            console.log(`Fleet hub off${'error' in status ? '' : ' (stopped)'}. Agents cannot reach each other until it is on again.`);
        }
        return;
    }

    if (sub === 'status') {
        const status = await syncDaemonFleet();
        printStatus('error' in status ? null : status);
        return;
    }

    if (sub === 'logs') {
        if (!existsSync(p.log)) { console.log(`No log yet (${p.log})`); return; }
        if (args.includes('-f')) {
            const tail = spawn('tail', ['-n', '50', '-f', p.log], { stdio: 'inherit' });
            await new Promise((r) => tail.on('exit', r));
            return;
        }
        console.log(lastLines(p.log, 100).join('\n'));
        return;
    }

    console.log(`${chalk.bold('happy fleet')} — the fleet hub: lets the agents of your account find and message each other

  happy fleet on              Switch on for ${configuration.happyHomeDir} (HAPPY_HOME_DIR).
                              Asks for a QR scan if there is no agent.key there;
                              the daemon of that directory runs it
  happy fleet off [--delete]  Switch off (--delete: also remove ${p.dir})
  happy fleet status          On/off, hub, last log lines
  happy fleet logs [-f]       The hub's log

Agents use the happy tools list_agents and send_to_agent. Switch it on on one
machine per account; a second one waits.`);
}
