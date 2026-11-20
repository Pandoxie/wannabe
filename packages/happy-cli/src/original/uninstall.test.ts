import { describe, expect, it } from 'vitest';
import { findHappyHomes, formatUninstallPlan, planUninstall, type MachineState } from './uninstall';

const state = (over: Partial<MachineState> = {}): MachineState => ({
    home: '/home/u', platform: 'linux', happyHomes: ['/home/u/.happy', '/home/u/.happy-x'],
    distHome: '/home/u/.happy-dist', crontabHasNightly: true, launchdPlist: null,
    sandboxInstalled: false, systemDaemon: false, completionRc: ['/home/u/.bashrc'], ...over,
});

describe('happy uninstall', () => {
    it('finds the happy homes, not the installer or the sandbox', () => {
        const files = new Set(['/h/.happy/settings.json', '/h/.happy-x/access.key', '/h/.happy-dist/settings.json', '/h/.happy-sandbox/access.key']);
        const homes = findHappyHomes('/h', () => ['.happy', '.happy-x', '.happy-dist', '.happy-sandbox', '.happyless', '.bashrc'], (p) => files.has(p));
        expect(homes).toEqual(['/h/.happy', '/h/.happy-x']);
    });

    it('lists what the installer put there; the homes only with --purge', () => {
        const s = state();
        const steps = planUninstall(s);
        expect(steps.map((x) => x.what)).toEqual([
            'stop daemon and its sessions', 'stop daemon and its sessions',
            'remove the nightly update', 'remove the tab completion line', 'delete the installer directory', 'npm uninstall -g',
            'delete the happy home (logins, session keys)', 'delete the happy home (logins, session keys)',
        ]);
        const plain = formatUninstallPlan(steps, s, false);
        expect(plain).not.toContain('- delete the happy home');
        expect(plain).toContain('Kept (add --purge to delete): /home/u/.happy, /home/u/.happy-x');
        expect(formatUninstallPlan(steps, s, true)).toContain('- delete the happy home (logins, session keys): /home/u/.happy');
    });

    it('macOS launchd agent instead of cron; the sandbox and the system daemon are only mentioned', () => {
        const s = state({ platform: 'darwin', crontabHasNightly: false, launchdPlist: '/Users/u/Library/LaunchAgents/com.happy-dist.nightly-update.plist', sandboxInstalled: true, systemDaemon: true });
        const text = formatUninstallPlan(planUninstall(s), s, false);
        expect(text).toContain('LaunchAgents/com.happy-dist.nightly-update.plist');
        expect(text).toContain('happy cage uninstall');
        expect(text).toContain('sudo happy daemon uninstall');
    });
});
