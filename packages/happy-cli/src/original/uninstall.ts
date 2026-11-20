/**
 * Original Happy: `happy uninstall` — removes what release/install.sh put on
 * this machine, for this user. Lists first; `--yes` does it; `--purge` also
 * deletes the happy homes (logins, session keys). Keep the list in step with
 * the installer:
 *   - daemons (every happy home of this user) and the sessions they left;
 *   - the nightly `happy update` (a crontab line, or the launchd agent on macOS);
 *   - ~/.happy-dist (installer, its login, logs, the previous version, the
 *     completion scripts) and the completion line in ~/.bashrc / ~/.zshrc;
 *   - the npm global packages happy, happy-agent, happy-fleet.
 * happy-sandbox has its own installer and is only mentioned (`happy cage uninstall`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import { cageBin, distHome } from './commands';
import { RC_MARK, uninstallCompletion } from './completion';

export const NIGHTLY_LABEL = 'com.happy-dist.nightly-update';

export type UninstallStep = { what: string; detail: string; purgeOnly?: boolean };

export type MachineState = {
    home: string;
    platform: NodeJS.Platform;
    /** Directories in the home that are happy homes (`.happy`, `.happy-x`, `.happy_x`). */
    happyHomes: string[];
    distHome: string | null;
    crontabHasNightly: boolean;
    launchdPlist: string | null;
    sandboxInstalled: boolean;
    /** rc files with the completion line (`happy completion install`). */
    completionRc: string[];
    /** Upstream's macOS system daemon (`sudo happy daemon install`): needs sudo to remove. */
    systemDaemon: boolean;
};

/** A happy home: `.happy*` with a settings file or a login, not the installer's or the sandbox's. */
export function findHappyHomes(home: string, list: (dir: string) => string[] = (d) => readdirSync(d), exists: (path: string) => boolean = existsSync): string[] {
    const extra = process.env.HAPPY_HOME_DIR;
    const names = (() => { try { return list(home); } catch { return []; } })();
    const homes = names
        .filter((n) => n.startsWith('.happy') && n !== '.happy-dist' && n !== '.happy-sandbox')
        .map((n) => join(home, n))
        .filter((dir) => exists(join(dir, 'settings.json')) || exists(join(dir, 'access.key')));
    if (extra && !homes.includes(extra) && exists(extra)) homes.push(extra);
    return homes.sort();
}

export function planUninstall(state: MachineState): UninstallStep[] {
    const steps: UninstallStep[] = [];
    for (const dir of state.happyHomes) {
        steps.push({ what: 'stop daemon and its sessions', detail: dir });
    }
    if (state.crontabHasNightly) steps.push({ what: 'remove the nightly update', detail: 'crontab line (nightly-update.sh)' });
    if (state.launchdPlist) steps.push({ what: 'remove the nightly update', detail: state.launchdPlist });
    if (state.completionRc.length) steps.push({ what: 'remove the tab completion line', detail: state.completionRc.join(', ') });
    if (state.distHome) steps.push({ what: 'delete the installer directory', detail: state.distHome });
    steps.push({ what: 'npm uninstall -g', detail: 'happy happy-agent happy-fleet' });
    for (const dir of state.happyHomes) {
        steps.push({ what: 'delete the happy home (logins, session keys)', detail: dir, purgeOnly: true });
    }
    return steps;
}

export function formatUninstallPlan(steps: UninstallStep[], state: MachineState, purge: boolean): string {
    const lines = ['happy uninstall will:'];
    for (const step of steps) {
        if (step.purgeOnly && !purge) continue;
        lines.push(`  - ${step.what}: ${step.detail}`);
    }
    const kept = steps.filter((s) => s.purgeOnly && !purge);
    if (kept.length) lines.push(`Kept (add --purge to delete): ${kept.map((s) => s.detail).join(', ')}`);
    if (state.sandboxInstalled) lines.push('happy-sandbox stays (its own installer): happy cage uninstall');
    if (state.systemDaemon) lines.push('The system daemon (sudo happy daemon install) stays: sudo happy daemon uninstall, first');
    return lines.join('\n');
}

function readState(): MachineState {
    const home = homedir();
    const cron = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    const plist = join(home, 'Library', 'LaunchAgents', `${NIGHTLY_LABEL}.plist`);
    return {
        home,
        platform: process.platform,
        happyHomes: findHappyHomes(home),
        distHome: existsSync(distHome()) ? distHome() : null,
        crontabHasNightly: cron.status === 0 && /nightly-update\.sh/.test(cron.stdout ?? ''),
        launchdPlist: existsSync(plist) ? plist : null,
        sandboxInstalled: existsSync(join(cageBin(), 'happy-sandbox')),
        completionRc: ['.bashrc', '.zshrc'].map((f) => join(home, f))
            .filter((f) => { try { return readFileSync(f, 'utf8').includes(RC_MARK); } catch { return false; } }),
        systemDaemon: existsSync('/Library/LaunchDaemons/com.happy-cli.daemon.plist'),
    };
}

function happy(args: string[], happyHome: string): void {
    spawnSync(process.execPath, [join(projectPath(), 'bin', 'happy.mjs'), ...args], {
        stdio: 'inherit', env: { ...process.env, HAPPY_HOME_DIR: happyHome },
    });
}

export async function handleUninstallCommand(args: string[]): Promise<void> {
    const yes = args.includes('--yes');
    const purge = args.includes('--purge');
    const state = readState();
    const steps = planUninstall(state);
    console.log(formatUninstallPlan(steps, state, purge));
    if (!yes) {
        console.log('\nNothing changed. Run again with --yes' + (purge ? ' --purge' : '') + ' to do it.');
        return;
    }
    for (const dir of state.happyHomes) {
        happy(['daemon', 'stop'], dir);
        happy(['daemon', 'clean'], dir);
    }
    if (state.crontabHasNightly) {
        const cron = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
        const kept = (cron.stdout ?? '').split('\n')
            .filter((line) => !/nightly-update\.sh/.test(line) && !line.includes('# happy-dist nightly update'))
            .join('\n').replace(/\n+$/, '');
        spawnSync('crontab', ['-'], { input: kept ? `${kept}\n` : '', encoding: 'utf8' });
    }
    if (state.launchdPlist) {
        spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/${NIGHTLY_LABEL}`]);
        rmSync(state.launchdPlist, { force: true });
    }
    if (state.completionRc.length) uninstallCompletion(true);
    if (state.distHome) rmSync(state.distHome, { recursive: true, force: true });
    if (purge) {
        for (const dir of state.happyHomes) rmSync(dir, { recursive: true, force: true });
    }
    // Last: this very command runs from the happy package.
    const npm = spawnSync('npm', ['uninstall', '-g', 'happy', 'happy-agent', 'happy-fleet'], { stdio: 'inherit' });
    console.log(npm.status === 0 ? '\nhappy is uninstalled.' : '\nnpm uninstall failed: run npm uninstall -g happy happy-agent happy-fleet');
}
