import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLease, mayTake, LEASE_KEY } from '../lease.mjs';

// The relay's /v1/kv semantics (happy-server kvGet / kvMutate): values are
// base64; GET is 404 when absent or deleted; writes carry the expected
// version (-1 creates) and fail with 409 { errors: [{ version, value }] };
// a null value deletes but keeps the record with a new version.
function fakeRelay() {
  const store = new Map();
  const err = (status, data) => Object.assign(new Error(String(status)), { response: { status, data } });
  return {
    store,
    async get(url) {
      const key = decodeURIComponent(url.split('/v1/kv/')[1]);
      const row = store.get(key);
      if (!row || row.value === null) throw err(404);
      return { data: { key, ...row } };
    },
    async post(_url, body) {
      const results = [];
      for (const m of body.mutations) {
        if (m.value !== null && Buffer.from(m.value, 'base64').toString('base64') !== m.value) throw err(500);
        const row = store.get(m.key);
        const current = row?.version ?? -1;
        if (current !== m.version) throw err(409, { success: false, errors: [{ key: m.key, error: 'version-mismatch', version: current, value: row?.value ?? null }] });
        const version = m.version + 1;
        store.set(m.key, { value: m.value, version });
        results.push({ key: m.key, version });
      }
      return { data: { success: true, results } };
    },
  };
}

test('mayTake: free, expired, unreadable or own lease only', () => {
  const lease = (holder, until) => JSON.stringify({ holder, until });
  assert.equal(mayTake(undefined, 'a', 10), true);
  assert.equal(mayTake('not json', 'a', 10), true);
  assert.equal(mayTake(lease('a', 100), 'a', 10), true);
  assert.equal(mayTake(lease('b', 100), 'a', 10), false);
  assert.equal(mayTake(lease('b', 100), 'a', 100), true);
});

test('one watcher holds the lease; the second waits until it expires, and the first then loses it', async () => {
  const http = fakeRelay();
  let now = 1_000;
  const clock = () => now;
  const a = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000, now: clock });
  const b = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000, now: clock });
  assert.equal((await a.acquire()).ok, true);
  const refused = await b.acquire();
  assert.equal(refused.ok, false);
  assert.match(refused.stored, /"holder"/);
  now += 60_000;
  assert.equal(await a.renew(), true);
  assert.equal((await b.acquire()).ok, false);
  // a stops renewing (machine gone); after the TTL b takes over and a's next renew fails.
  now += 181_000;
  assert.equal((await b.acquire()).ok, true);
  assert.equal(await a.renew(), false);
  assert.equal(await b.renew(), true);
});

test('release frees the lease at once', async () => {
  const http = fakeRelay();
  const a = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000 });
  const b = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000 });
  assert.equal((await a.acquire()).ok, true);
  await a.release();
  assert.equal(http.store.get(LEASE_KEY).value, null);
  assert.equal((await b.acquire()).ok, true);
  await b.release();
  assert.equal((await a.acquire()).ok, true);
});

test('a race on a free lease lets exactly one in', async () => {
  const http = fakeRelay();
  const a = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000 });
  const b = createLease({ http, serverUrl: 'https://relay', token: 't', ttlMs: 180_000 });
  const results = await Promise.all([a.acquire(), b.acquire()]);
  assert.equal(results.filter((r) => r.ok).length, 1);
});
