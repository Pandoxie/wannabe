#!/usr/bin/env node
// The fleet hub (Original Happy): lets the agents of one Happy account find
// and message each other. One per account; the happy daemon runs it
// (`happy fleet on`). Design: README.md.
//
//   - Directory: every session of the account (titles, agent, machine,
//     path, online / busy), from the relay's session list and its live
//     updates. It never reads messages.
//   - Requests: sessions call it over the relay's per-account RPC
//     (FLEET_RPC_METHOD) from the happy MCP tools list_agents and
//     send_to_agent. A request is encrypted with the caller session's key;
//     opening it proves the sender. Answers go back encrypted the same way.
//   - Delivery: straight into the target session as a user message, framed
//     by the hub (sender, "not the user"). A busy target gets it at its
//     next step (happy-cli puts plain text into the running turn).
//   - Storm isolation: one target per send, sliding-window limits per pair,
//     sender and account.
//   - Scheduled tasks (happy tools schedule_task / list_tasks / delete_task):
//     kept encrypted in the relay's key-value store; at their time the hub
//     delivers the task's prompt to the session that created it (once when
//     it is back, if it was offline).
//
// Nothing is kept on disk but the log.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvironment, readConfig } from './config.mjs';
import { createLease, describeLease } from './lease.mjs';
import { b64, toB64, decrypt, encrypt, hubStoreEncryption, readCredentials, sessionEncryption } from './crypto.mjs';
import { describeTask, dueRun, makeTask, taskEnvelope } from './tasks.mjs';
import {
  FLEET_RPC_METHOD, MAX_TEXT, PROTOCOL_VERSION, checkTimestamp, createLimiter, createNonceCache,
  describeSession, envelope, limitMessage, resolveTarget,
} from './protocol.mjs';

loadEnvironment();
// Tests only: a second hub beside the real one (its own RPC name, lease and task store).
const RPC_METHOD = process.env.FLEET_RPC_METHOD_OVERRIDE?.trim() || FLEET_RPC_METHOD;
const config = readConfig(process.env, process.argv.slice(2));
const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const axios = require('axios').create({ timeout: 30_000 });
if (config.check) {
  console.log('Configuration and runtime dependencies OK (credentials and network not checked).');
  process.exit(0);
}

const log = (...a) => console.error(new Date().toISOString(), ...a);
// Never print raw error objects: axios errors carry request headers, including the bearer token.
const errMsg = (e) => `${e?.response?.status ?? ''} ${e?.message ?? String(e)}`.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { log('fatal:', errMsg(e)); process.exit(1); });
process.on('uncaughtException', (e) => { log('fatal:', errMsg(e)); process.exit(1); });

// Run by the happy daemon: stop when it is gone.
const parentPid = Number(process.env.FLEET_PARENT_PID);
if (parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); } catch { log('happy daemon gone; exiting'); process.kill(process.pid, 'SIGTERM'); }
  }, 10_000).unref();
}

const keyFile = join(config.happyHome, 'agent.key');
if (!existsSync(keyFile)) {
  log(`not logged in: no ${keyFile}. Run: happy fleet on (it shows the QR code to scan with the Happy app).`);
  process.exit(78); // the daemon does not restart on this
}
const creds = readCredentials(keyFile);
const auth = { headers: { Authorization: `Bearer ${creds.token}` } };
const api = config.serverUrl;

// ---------- one hub per account ----------

// FLEET_LEASE_KEY: tests only (a second hub beside the real one).
const lease = createLease({ http: axios, serverUrl: api, token: creds.token, ttlMs: config.leaseTtlMs, ...(process.env.FLEET_LEASE_KEY ? { key: process.env.FLEET_LEASE_KEY } : {}) });
{
  let waitingFor = null;
  for (;;) {
    let r = null;
    try { r = await lease.acquire(); } catch (e) { log('lease: relay error, retrying:', errMsg(e)); }
    if (r?.ok) break;
    if (r) {
      const who = describeLease(r.stored);
      if (who !== waitingFor) log(`the hub already runs elsewhere: ${who}; waiting`);
      waitingFor = who;
    }
    await sleep(config.leaseRenewMs);
  }
}
log(`lease taken (${lease.holder})`);
setInterval(async () => {
  try {
    if (!(await lease.renew())) { log('lease lost to another hub; exiting'); process.exit(75); }
  } catch (e) { log('lease renew failed (relay unreachable?):', errMsg(e)); }
}, config.leaseRenewMs);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    try { socket.emit('rpc-unregister', { method: RPC_METHOD }); } catch {}
    await lease.release();
    process.exit(0);
  });
}

// ---------- directory ----------

const sessions = new Map(); // id -> { enc, info: describeSession(), active, thinking, lastSeen }

function upsert(raw) {
  let s = sessions.get(raw.id);
  if (!s) {
    let enc;
    try { enc = sessionEncryption(raw, creds); } catch (e) { log(errMsg(e)); return; }
    s = { enc, info: { id: raw.id, title: null, archived: false }, active: false, thinking: false, lastSeen: 0 };
    sessions.set(raw.id, s);
  }
  s.active = !!raw.active;
  if (raw.active) s.lastSeen = Date.now();
  if (raw.metadata) applyMetadata(s, raw.id, raw.metadata);
}
function applyMetadata(s, id, encrypted) {
  const meta = decrypt(s.enc, b64(encrypted));
  if (meta) s.info = describeSession(id, meta);
}

let refreshing = null;
function refresh() {
  refreshing ??= (async () => {
    try {
      const r = await axios.get(`${api}/v1/sessions`, auth);
      for (const raw of r.data.sessions) upsert(raw);
    } catch (e) { log('session list failed:', errMsg(e)); }
    finally { setTimeout(() => { refreshing = null; }, 2_000); }
  })();
  return refreshing;
}

const online = (s) => s.active && Date.now() - s.lastSeen < config.offlineAfterMs;
const reachable = () => [...sessions.values()].map((s) => ({ ...s.info, online: online(s), busy: s.thinking }));

// ---------- requests ----------

const nonces = createNonceCache();
const limiter = createLimiter(config.limits);
const plain = (error) => JSON.stringify({ ok: false, error });

async function handle(params) {
  let req;
  try { req = JSON.parse(params); } catch { return plain('Bad request.'); }
  if (req?.v !== PROTOCOL_VERSION || typeof req.sid !== 'string' || typeof req.box !== 'string') {
    return plain(`Unsupported request (this hub speaks version ${PROTOCOL_VERSION}; update happy on both machines).`);
  }
  if (!sessions.has(req.sid)) await refresh();
  const caller = sessions.get(req.sid);
  if (!caller) return plain('Unknown session.');
  const body = decrypt(caller.enc, b64(req.box));
  if (!body) return plain('Request not encrypted by this session; refused.');
  const reply = (obj) => toB64(encrypt(caller.enc, obj));
  if (!checkTimestamp(body.ts) || !nonces.fresh(body.nonce)) return reply({ ok: false, error: 'Stale or repeated request; refused.' });
  // A message from the caller means it is alive, whatever the last heartbeat said.
  caller.active = true; caller.lastSeen = Date.now();
  const me = caller.info.title ?? req.sid;

  if (body.op === 'list') {
    const agents = reachable()
      .filter((s) => s.id !== req.sid && !s.archived && s.online)
      .map((s) => ({ name: s.title, session: s.id, agent: s.agent, host: s.host, path: s.path, state: s.busy ? 'busy' : 'idle' }));
    const counts = new Map();
    for (const a of agents) if (a.name) counts.set(a.name.toLowerCase(), (counts.get(a.name.toLowerCase()) ?? 0) + 1);
    for (const a of agents) if (a.name && counts.get(a.name.toLowerCase()) > 1) a.duplicateName = true;
    return reply({ ok: true, you: { name: caller.info.title, session: req.sid }, agents });
  }

  if (body.op === 'send') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return reply({ ok: false, error: 'Empty message.' });
    if (text.length > MAX_TEXT) return reply({ ok: false, error: `Message too long (${text.length} characters, at most ${MAX_TEXT}). Shorten it or point to a file.` });
    const found = resolveTarget(reachable(), String(body.to ?? ''), req.sid);
    if (found.error) return reply({ ok: false, error: found.error });
    const target = found.target;
    const limited = limiter.take(req.sid, target.id);
    if (limited) {
      log(`refused ${me} -> ${target.title ?? target.id}: ${limited.scope} limit`);
      return reply({ ok: false, error: limitMessage(limited, config.limits.windowMs) });
    }
    try {
      await deliver(target.id, envelope(caller.info, text), `[from ${me}] ${text}`, `fleet-${body.nonce}`);
    } catch (e) {
      log(`delivery ${me} -> ${target.title ?? target.id} failed: ${errMsg(e)}`);
      return reply({ ok: false, error: 'The relay did not take the message; try again shortly.' });
    }
    log(`delivered ${me} -> ${target.title ?? target.id} (${text.length} chars${target.busy ? ', busy' : ''})`);
    return reply({
      ok: true,
      delivered: { name: target.title, session: target.id },
      note: target.busy
        ? 'Delivered. It is busy and will see it at its next step.'
        : 'Delivered. Any answer arrives in this conversation as a message from it.',
    });
  }

  if (body.op === 'task.create') {
    await tasksLoaded;
    const r = makeTask(body, { id: `task-${randomUUID().slice(0, 8)}`, sessionId: req.sid, now: Date.now(), defaultTz: DEFAULT_TZ, existing: tasks });
    if (r.error) return reply({ ok: false, error: r.error });
    tasks.push(r.task);
    if (!(await saveTasks())) { tasks.pop(); return reply({ ok: false, error: 'Could not store the task on the relay; try again shortly.' }); }
    log(`task ${r.task.id} "${r.task.name}" created by ${me}: ${r.task.cron ? `cron ${r.task.cron}` : 'once'} ${r.task.timezone}`);
    return reply({ ok: true, task: describeTask(r.task, Date.now(), 'active') });
  }

  if (body.op === 'task.list') {
    await tasksLoaded;
    const now = Date.now();
    return reply({ ok: true, tasks: tasks.filter((t) => t.sessionId === req.sid).map((t) => describeTask(t, now, taskState(t))) });
  }

  if (body.op === 'task.delete') {
    await tasksLoaded;
    const i = tasks.findIndex((t) => t.id === body.id && t.sessionId === req.sid);
    if (i < 0) return reply({ ok: false, error: `This session has no task "${body.id}". Call list_tasks for the ids.` });
    const [removed] = tasks.splice(i, 1);
    if (!(await saveTasks())) { tasks.splice(i, 0, removed); return reply({ ok: false, error: 'Could not update the relay; try again shortly.' }); }
    log(`task ${removed.id} "${removed.name}" deleted by ${me}`);
    return reply({ ok: true, deleted: { id: removed.id, name: removed.name } });
  }

  return reply({ ok: false, error: `Unknown operation "${body.op}".` });
}

// ---------- delivery ----------

/** A user message into a session; the hub's text, and what the apps show. */
async function deliver(sessionId, text, displayText, localId) {
  const s = sessions.get(sessionId);
  const record = { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'happy-fleet', displayText } };
  await axios.post(`${api}/v3/sessions/${encodeURIComponent(sessionId)}/messages`,
    { messages: [{ localId, content: toB64(encrypt(s.enc, record)) }] }, auth);
}

// ---------- scheduled tasks ----------

const TASKS_KEY = process.env.FLEET_TASKS_KEY?.trim() || 'original-happy.fleet.tasks'; // override: tests only
const DEFAULT_TZ = process.env.FLEET_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const store = hubStoreEncryption(creds);
let tasks = [];
let tasksVersion = -1;

async function loadTasks() {
  try {
    const r = await axios.get(`${api}/v1/kv/${encodeURIComponent(TASKS_KEY)}`, auth);
    tasksVersion = r.data.version;
    const opened = decrypt(store, b64(r.data.value));
    if (!opened) throw new Error('stored tasks cannot be opened with this account key');
    tasks = Array.isArray(opened.tasks) ? opened.tasks : [];
  } catch (e) {
    if (e?.response?.status === 404) { tasks = []; return; }
    throw e;
  }
}

async function saveTasks() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await axios.post(`${api}/v1/kv`, { mutations: [{ key: TASKS_KEY, value: toB64(encrypt(store, { tasks })), version: tasksVersion }] }, auth);
      tasksVersion = r.data?.results?.[0]?.version ?? tasksVersion;
      return true;
    } catch (e) {
      const conflict = e?.response?.status === 409 ? e.response.data?.errors?.[0] : null;
      if (!conflict) { log('saving tasks failed:', errMsg(e)); return false; }
      tasksVersion = conflict.version; // only this hub writes; take the version and write ours
    }
  }
  return false;
}

function taskState(t) {
  const s = sessions.get(t.sessionId);
  if (!s) return 'session not found';
  if (s.info.archived) return 'paused: session archived';
  if (t.pendingSince) return 'due: waiting for the session to come online';
  return 'active';
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    let changed = false;
    for (const t of [...tasks]) {
      const run = dueRun(t, now);
      if (run === null) continue;
      const s = sessions.get(t.sessionId);
      if (!s || s.info.archived) continue;
      if (!online(s)) {
        if (!t.pendingSince) { t.pendingSince = run; changed = true; log(`task ${t.id} "${t.name}" due; ${s.info.title ?? t.sessionId} is offline, delivering when it is back`); }
        continue;
      }
      try {
        await deliver(t.sessionId, taskEnvelope(t, run, !!t.pendingSince), `[定时任务 ${t.name}] ${t.prompt}`, `fleet-task-${t.id}-${run}`);
      } catch (e) { log(`task ${t.id} delivery failed (retrying): ${errMsg(e)}`); continue; }
      log(`task ${t.id} "${t.name}" delivered to ${s.info.title ?? t.sessionId}${t.pendingSince ? ' (late)' : ''}`);
      t.lastRunAt = run; t.pendingSince = null; changed = true;
      if (t.at !== undefined) tasks.splice(tasks.indexOf(t), 1); // one-time: done
    }
    if (changed) await saveTasks();
  } finally { ticking = false; }
}

const tasksLoaded = loadTasks().then(
  () => log(`${tasks.length} scheduled tasks (default time zone ${DEFAULT_TZ})`),
  (e) => { log('loading scheduled tasks failed:', errMsg(e)); process.exit(1); },
);
await tasksLoaded;
setInterval(() => { tick().catch((e) => log('task tick failed:', errMsg(e))); }, 20_000);

// ---------- socket ----------

const socket = io(api, {
  auth: { token: creds.token, clientType: 'user-scoped' },
  path: '/v1/updates',
  reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
  transports: ['websocket'],
});
socket.on('connect', async () => {
  await refresh();
  socket.emit('rpc-register', { method: RPC_METHOD });
  const n = reachable().filter((s) => !s.archived && s.online).length;
  log(`connected to ${api}; ${n} agents online`);
});
socket.on('rpc-registered', (d) => { if (d?.method === RPC_METHOD) log('serving'); });
socket.on('rpc-error', (d) => log('rpc error:', JSON.stringify(d)));
socket.on('disconnect', (r) => log(`disconnected (${r})`));
socket.on('connect_error', (e) => log(`connect error: ${e.message}`));
socket.on('rpc-request', async (data, callback) => {
  if (data?.method !== RPC_METHOD) { callback(plain('Unknown method.')); return; }
  try { callback(await handle(String(data.params ?? ''))); }
  catch (e) { log('request failed:', errMsg(e)); callback(plain('Hub error.')); }
});
socket.on('ephemeral', (b) => {
  if (b?.type !== 'activity' || !b.id) return;
  const s = sessions.get(b.id);
  if (!s) { refresh(); return; }
  s.active = !!b.active; s.thinking = !!b.thinking;
  if (b.active) s.lastSeen = Date.now();
});
socket.on('update', (data) => {
  const b = data?.body;
  if (b?.t === 'new-session') { refresh(); return; }
  if (b?.t === 'update-session' && b.id && b.metadata?.value) {
    const s = sessions.get(b.id);
    if (s) applyMetadata(s, b.id, b.metadata.value); else refresh();
  }
});

log(`hub ${randomUUID().slice(0, 8)} starting for ${config.happyHome}`);
