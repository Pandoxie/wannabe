// Fleet hub configuration (Original Happy).
//
// The happy daemon runs the hub (`happy fleet on`, happy-cli
// src/daemon/fleet.ts). Nothing needs configuring: the relay is ours, the
// account key is happy-agent's agent.key in HAPPY_HOME_DIR, the runtime
// directory is $HAPPY_HOME_DIR/fleet (only the log and an optional .env).
// Limits can be overridden there for the rare case.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_LIMITS } from './protocol.mjs';

export const ORIGINAL_HAPPY_RELAY_URL = 'https://api.cluster-fluster.com';

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}
export function happyHome(env = process.env) {
  return resolve(expandHome(env.HAPPY_HOME_DIR?.trim() || '~/.happy'));
}
export function fleetHome(env = process.env) {
  return env.FLEET_HOME?.trim() ? resolve(expandHome(env.FLEET_HOME.trim())) : join(happyHome(env), 'fleet');
}
export function loadEnvironment(env = process.env) {
  const file = join(fleetHome(env), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function readConfig(env = process.env, args = []) {
  for (const arg of args) if (arg !== '--check-config') throw new Error(`Unknown option: ${arg}`);
  const server = env.HAPPY_SERVER_URL === undefined ? ORIGINAL_HAPPY_RELAY_URL : env.HAPPY_SERVER_URL.trim();
  let endpoint;
  try { endpoint = new URL(server); } catch { throw new Error('HAPPY_SERVER_URL must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('HAPPY_SERVER_URL must be an HTTP(S) URL without credentials, query or fragment');
  }
  const integer = (name, fallback) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 2147483647) throw new Error(`${name} must be a positive integer`);
    return Number(raw);
  };
  const config = {
    serverUrl: server.replace(/\/+$/, ''),
    happyHome: happyHome(env),
    home: fleetHome(env),
    check: args.includes('--check-config'),
    limits: {
      windowMs: integer('FLEET_WINDOW_MS', DEFAULT_LIMITS.windowMs),
      pairMax: integer('FLEET_PAIR_MAX', DEFAULT_LIMITS.pairMax),
      senderMax: integer('FLEET_SENDER_MAX', DEFAULT_LIMITS.senderMax),
      accountMax: integer('FLEET_ACCOUNT_MAX', DEFAULT_LIMITS.accountMax),
    },
    // A session without a heartbeat for this long counts as offline.
    offlineAfterMs: integer('FLEET_OFFLINE_AFTER_MS', 120_000),
    // One hub per account: the lease on the relay (lease.mjs).
    leaseTtlMs: integer('FLEET_LEASE_TTL_MS', 180_000),
    leaseRenewMs: integer('FLEET_LEASE_RENEW_MS', 60_000),
  };
  if (config.leaseRenewMs * 2 > config.leaseTtlMs) throw new Error('FLEET_LEASE_TTL_MS must be at least twice FLEET_LEASE_RENEW_MS');
  return config;
}
