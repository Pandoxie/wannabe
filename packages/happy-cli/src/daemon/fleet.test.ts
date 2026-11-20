import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fleetPaths, setFleetEnabled, startFleetSupervisor, type FleetSupervisor } from './fleet';

const wait = async (cond: () => boolean, ms = 5_000) => {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 50));
    }
};

// A stand-in happy-fleet package: the hub records its environment and then
// either runs until killed or exits with FAKE_EXIT.
function fakePackage(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fake-fleet-'));
    writeFileSync(join(dir, 'hub.mjs'), `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.FLEET_HOME, 'seen.json'), JSON.stringify({ home: process.env.HAPPY_HOME_DIR, fleet: process.env.FLEET_HOME, server: process.env.HAPPY_SERVER_URL, parent: process.env.FLEET_PARENT_PID }));
console.error('hub up');
const code = Number(process.env.FAKE_EXIT ?? -1);
if (code >= 0) process.exit(code);
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
    return dir;
}

function home(): string {
    const dir = mkdtempSync(join(tmpdir(), 'happy-home-'));
    writeFileSync(join(dir, 'agent.key'), '{}');
    return dir;
}

let supervisor: FleetSupervisor | null = null;
afterEach(async () => { await supervisor?.stop(); supervisor = null; });

describe('fleet supervisor (happy fleet on/off, run by the daemon)', () => {
    it('does nothing while switched off', () => {
        const h = home();
        supervisor = startFleetSupervisor({ happyHomeDir: h, serverUrl: 'https://relay', env: { ...process.env, HAPPY_FLEET_DIR: fakePackage() } });
        expect(supervisor.sync()).toMatchObject({ enabled: false, running: false });
        expect(existsSync(join(h, 'fleet'))).toBe(false);
    });

    it('runs the watcher with the runtime in HAPPY_HOME_DIR/fleet and stops it when switched off', async () => {
        const h = home();
        const paths = fleetPaths(h);
        setFleetEnabled(paths, true);
        supervisor = startFleetSupervisor({ happyHomeDir: h, serverUrl: 'https://relay', env: { ...process.env, HAPPY_FLEET_DIR: fakePackage() } });
        const s = supervisor.sync();
        expect(s.running).toBe(true);
        await wait(() => existsSync(join(paths.dir, 'seen.json')));
        expect(JSON.parse(readFileSync(join(paths.dir, 'seen.json'), 'utf8'))).toEqual({ home: h, fleet: paths.dir, server: 'https://relay', parent: String(process.pid) });
        expect(readFileSync(paths.pid, 'utf8').trim()).toBe(String(s.pid));
        await wait(() => readFileSync(paths.log, 'utf8').includes('hub up'));

        setFleetEnabled(paths, false);
        supervisor.sync();
        await wait(() => !existsSync(paths.pid));
        expect(supervisor.status().running).toBe(false);
    });

    it('does not restart a watcher that exits for a configuration problem until switched on again', async () => {
        const h = home();
        const paths = fleetPaths(h);
        setFleetEnabled(paths, true);
        const env = { ...process.env, HAPPY_FLEET_DIR: fakePackage(), FAKE_EXIT: '78' };
        supervisor = startFleetSupervisor({ happyHomeDir: h, serverUrl: 'https://relay', env });
        supervisor.sync();
        await wait(() => supervisor!.status().stoppedReason?.includes('configuration') === true);
        expect(supervisor.sync().running).toBe(false);
        await new Promise((r) => setTimeout(r, 10));
        setFleetEnabled(paths, true); // `happy fleet on` again
        expect(supervisor.sync().running).toBe(true);
    });

    it('waits for the QR login before starting', () => {
        const h = mkdtempSync(join(tmpdir(), 'happy-home-'));
        const paths = fleetPaths(h);
        setFleetEnabled(paths, true);
        supervisor = startFleetSupervisor({ happyHomeDir: h, serverUrl: 'https://relay', env: { ...process.env, HAPPY_FLEET_DIR: fakePackage() } });
        expect(supervisor.sync()).toMatchObject({ running: false, loggedIn: false });
        expect(supervisor.status().stoppedReason).toMatch(/not logged in/);
    });
});

