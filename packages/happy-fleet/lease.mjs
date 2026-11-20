// One fleet hub per Happy account (Original Happy).
//
// Two hubs on one account would each serve requests and limit separately. The watcher
// holds a lease in the relay's per-account key-value store (/v1/kv; the apps
// ignore keys they do not know) and renews it while it runs. Another
// watcher, on this or any other machine, waits until the lease has expired —
// its holder stopped, or lost the relay for longer than the TTL — and then
// takes over.
//
// The store's rules (happy-server kvMutate / kvGet): values are base64 bytes;
// every write names the version it expects (-1 creates) and a mismatch is a
// 409 carrying the current version and value; a delete keeps the record with
// a null value and a new version, which a GET reports as 404.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export const LEASE_KEY = 'original-happy.fleet.lease';

const encode = (text) => Buffer.from(text, 'utf8').toString('base64');
const decode = (b64) => (typeof b64 === 'string' ? Buffer.from(b64, 'base64').toString('utf8') : null);

/** Parses a stored lease (JSON text); null when absent or unreadable. */
export function parseLease(text) {
  if (typeof text !== 'string') return null;
  try {
    const lease = JSON.parse(text);
    return typeof lease?.holder === 'string' && Number.isFinite(lease?.until) ? lease : null;
  } catch { return null; }
}

/** May `holder` write the lease now? Free, expired, unreadable or its own. */
export function mayTake(text, holder, now) {
  const lease = parseLease(text);
  return !lease || lease.holder === holder || lease.until <= now;
}

export function describeLease(text) {
  const lease = parseLease(text);
  if (!lease) return 'unknown holder';
  return `${lease.host ?? '?'} (pid ${lease.pid ?? '?'}, until ${new Date(lease.until).toISOString()})`;
}

/**
 * http: an axios instance. Returns { acquire, renew, release, holder }.
 * acquire() → { ok: true } or { ok: false, stored } (the holder's lease
 * text); renew() → true, or false when the lease is no longer ours.
 */
export function createLease({ http, serverUrl, token, ttlMs, now = Date.now, key = LEASE_KEY }) {
  const holder = `${hostname()}:${process.pid}:${randomUUID()}`;
  const headers = { Authorization: `Bearer ${token}` };
  let version = null; // our write's version, while we hold the lease

  const read = async () => {
    try {
      const r = await http.get(`${serverUrl}/v1/kv/${encodeURIComponent(key)}`, { headers });
      return r.data ? { text: decode(r.data.value), version: r.data.version } : null;
    } catch (e) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  };
  // → { version } on success, { conflict: { version, text } } on a 409.
  const write = async (text, expected) => {
    try {
      const r = await http.post(`${serverUrl}/v1/kv`,
        { mutations: [{ key, value: text === null ? null : encode(text), version: expected }] }, { headers });
      return { version: r.data?.results?.[0]?.version };
    } catch (e) {
      const error = e?.response?.status === 409 ? e.response.data?.errors?.[0] : null;
      if (error) return { conflict: { version: error.version, text: decode(error.value) } };
      throw e;
    }
  };
  const lease = () => JSON.stringify({ holder, host: hostname(), pid: process.pid, until: now() + ttlMs });

  return {
    holder,
    async acquire() {
      const current = await read();
      if (current && !mayTake(current.text, holder, now())) return { ok: false, stored: current.text };
      // Absent may still be a deleted record with a version: the 409 says which.
      let r = await write(lease(), current ? current.version : -1);
      if (r.conflict && mayTake(r.conflict.text, holder, now())) r = await write(lease(), r.conflict.version);
      if (r.conflict) return { ok: false, stored: r.conflict.text };
      version = r.version;
      return { ok: true };
    },
    async renew() {
      if (version === null) return false;
      const r = await write(lease(), version);
      if (r.conflict) { version = null; return false; }
      version = r.version;
      return true;
    },
    async release() {
      if (version === null) return;
      try { await write(null, version); } catch {}
      version = null;
    },
  };
}
