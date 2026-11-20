/**
 * Original Happy: the egress lock of a HAPPY_HOME_DIR (`happy egress lock`),
 * in egress.json. Read on every check, so lock / unlock apply at once.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EgressLock } from './egressGuard';

export const egressFile = (happyHomeDir: string) => join(happyHomeDir, 'egress.json');

export function readEgressLock(happyHomeDir: string): EgressLock | null {
    try {
        const raw = JSON.parse(readFileSync(egressFile(happyHomeDir), 'utf8'));
        const ips = Array.isArray(raw?.ips) ? raw.ips.filter((v: unknown) => typeof v === 'string' && v.trim()).map((v: string) => v.trim()) : [];
        const countries = Array.isArray(raw?.countries) ? raw.countries.filter((v: unknown) => typeof v === 'string' && v.trim()).map((v: string) => v.trim().toUpperCase()) : [];
        return ips.length || countries.length ? { ips, countries } : null;
    } catch {
        return null;
    }
}

export function writeEgressLock(happyHomeDir: string, lock: EgressLock | null): void {
    const file = egressFile(happyHomeDir);
    if (!lock || (!lock.ips.length && !lock.countries.length)) {
        if (existsSync(file)) unlinkSync(file);
        return;
    }
    writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
}

/** "203.0.113.7,1.2.3.4" → list; rejects anything that is not an IPv4 / IPv6 address. */
export function parseIps(text: string): string[] {
    const ips = text.split(',').map((s) => s.trim()).filter(Boolean);
    for (const ip of ips) {
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[0-9a-f:]+$/i.test(ip)) throw new Error(`Not an IP address: ${ip}`);
    }
    return ips;
}
