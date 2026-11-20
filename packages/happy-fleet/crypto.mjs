// Account and session cryptography for the fleet hub (adapted from
// happy-agent 0.1.0, MIT, slopus/happy).
//
// The hub holds the account secret (happy-agent's agent.key, one QR scan),
// so it can open every session's data key. A session encrypts its requests
// with its own key; the hub opening them proves which session sent them.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

export const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
export const toB64 = (u8) => Buffer.from(u8).toString('base64');
const hmac512 = (key, data) => new Uint8Array(createHmac('sha512', key).update(data).digest());

export function deriveKey(master, usage, path) {
  let I = hmac512(new TextEncoder().encode(usage + ' Master Seed'), master);
  let st = { key: I.slice(0, 32), chainCode: I.slice(32) };
  for (const index of path) {
    I = hmac512(st.chainCode, new Uint8Array([0, ...new TextEncoder().encode(index)]));
    st = { key: I.slice(0, 32), chainCode: I.slice(32) };
  }
  return st.key;
}

/** happy-agent's agent.key: the account token and secret. */
export function readCredentials(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf-8'));
  const secret = b64(parsed.secret);
  const seed = deriveKey(secret, 'Happy EnCoder', ['content']);
  const boxSecret = new Uint8Array(createHash('sha512').update(seed).digest()).slice(0, 32);
  return { token: parsed.token, secret, contentSecretKey: nacl.box.keyPair.fromSecretKey(boxSecret).secretKey };
}

/** The key a session's messages and metadata are encrypted with. */
export function sessionEncryption(raw, creds) {
  if (raw.dataEncryptionKey) {
    const bundle = b64(raw.dataEncryptionKey).slice(1);
    const key = nacl.box.open(bundle.slice(56), bundle.slice(32, 56), bundle.slice(0, 32), creds.contentSecretKey);
    if (!key) throw new Error(`cannot open the data key of session ${raw.id}`);
    return { key: new Uint8Array(key), variant: 'dataKey' };
  }
  return { key: creds.secret, variant: 'legacy' };
}

export function encrypt(enc, data) {
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  if (enc.variant === 'legacy') {
    const nonce = randomBytes(nacl.secretbox.nonceLength);
    const box = nacl.secretbox(new Uint8Array(plain), new Uint8Array(nonce), enc.key);
    return Buffer.concat([nonce, Buffer.from(box)]);
  }
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', enc.key, nonce);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([0]), nonce, body, c.getAuthTag()]);
}

/** null when the data was not encrypted with this key (authenticated encryption). */
export function decrypt(enc, data) {
  try {
    if (enc.variant === 'legacy') {
      const n = nacl.secretbox.nonceLength;
      const out = nacl.secretbox.open(data.slice(n), data.slice(0, n), enc.key);
      return out ? JSON.parse(new TextDecoder().decode(out)) : null;
    }
    if (data.length < 29 || data[0] !== 0) return null;
    const d = createDecipheriv('aes-256-gcm', enc.key, data.slice(1, 13));
    d.setAuthTag(data.slice(data.length - 16));
    return JSON.parse(Buffer.concat([d.update(data.slice(13, data.length - 16)), d.final()]).toString('utf-8'));
  } catch { return null; }
}

/** The key the hub encrypts its own records with (scheduled tasks in the relay's KV). */
export function hubStoreEncryption(creds) {
  return { key: deriveKey(creds.secret, 'Original Happy Fleet', ['tasks']), variant: 'dataKey' };
}
