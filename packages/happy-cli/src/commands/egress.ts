/**
 * Original Happy: `happy egress` — lock this machine's exit to the LLM
 * providers to given IPs and / or countries (egress/egressGuard.ts). Per
 * HAPPY_HOME_DIR; the daemon of that directory checks it.
 *
 *   happy egress lock 203.0.113.7[,…] [--country US]
 *   happy egress lock --country US
 *   happy egress unlock
 *   happy egress status
 */
import chalk from 'chalk';
import { configuration } from '@/configuration';
import { askDaemonEgress } from '@/daemon/controlClient';
import { parseIps, readEgressLock, writeEgressLock } from '@/egress/egressConfig';
import { describeFault } from '@/egress/egressGuard';
import { EGRESS_ENDPOINTS, probeEndpoint } from '@/egress/egressProbe';

function value(args: string[], flag: string): string | undefined {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
}

async function printStatus() {
    const lock = readEgressLock(configuration.happyHomeDir);
    console.log(`Egress lock: ${lock ? chalk.green([lock.ips.join(', '), lock.countries.join(', ')].filter(Boolean).join(' / ')) : 'off'}  (${configuration.happyHomeDir})`);
    const s = await askDaemonEgress({ passive: true }, 5_000);
    if (s?.error) { console.log(`  daemon:    ${chalk.yellow('not running')} — happy daemon start`); return; }
    if (!lock) return;
    const state = s.state === 'error' ? chalk.red('error') : chalk.green(s.state);
    console.log(`  state:     ${state}${s.fault ? ` — ${describeFault(s.fault, s.lock)}` : ''}`);
    console.log(`  exit:      ${s.ip ?? '?'}${s.country ? ` (${s.country})` : ''}${s.checkedAt ? `, checked ${new Date(s.checkedAt).toLocaleTimeString()}` : ''}`);
    if (s.nextCheckAt) console.log(`  next:      ${new Date(s.nextCheckAt).toLocaleTimeString()}`);
}

export async function handleEgressCommand(args: string[]): Promise<void> {
    const sub = args[0] ?? 'status';
    if (sub === 'lock') {
        const first = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
        const ips = first ? parseIps(first) : [];
        const countries = (value(args, '--country') ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
        if (!ips.length && !countries.length) {
            console.error('Give the exit IP(s) and / or --country, e.g.: happy egress lock 203.0.113.7 --country US');
            process.exit(1);
        }
        // Say what the providers see now, so a typo does not stop every session.
        const now = await probeEndpoint(EGRESS_ENDPOINTS[0]);
        writeEgressLock(configuration.happyHomeDir, { ips, countries });
        console.log(`Locked: ${[ips.join(', '), countries.join(', ')].filter(Boolean).join(' / ')}`);
        if (now.ok) {
            const ok = (!ips.length || ips.includes(now.ip)) && (!countries.length || (now.country !== null && countries.includes(now.country)));
            console.log(`The providers see this machine as ${now.ip}${now.country ? ` (${now.country})` : ''}: ${ok ? chalk.green('matches') : chalk.red('does NOT match — sessions here will refuse to send until it does')}`);
        } else {
            console.log(chalk.yellow(`Could not check the exit now (${now.error}).`));
        }
        console.log('The daemon checks every 5 minutes while idle and every 15 s while a session works; a fault stops the sessions and notifies you.');
        return;
    }
    if (sub === 'unlock') {
        writeEgressLock(configuration.happyHomeDir, null);
        console.log('Egress lock off: sessions send without checking.');
        return;
    }
    if (sub === 'status') {
        await printStatus();
        return;
    }
    console.log(`${chalk.bold('happy egress')} — send to the LLM providers only through the expected exit

  happy egress lock IP[,IP] [--country US]   lock (this HAPPY_HOME_DIR's daemon checks it)
  happy egress lock --country US             lock to a country only
  happy egress unlock
  happy egress status`);
}
