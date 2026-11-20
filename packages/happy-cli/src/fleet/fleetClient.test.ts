import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '@/api/encryption';
import { fleetRequest, formatAgents, FLEET_RPC_METHOD } from './fleetClient';

// What ApiSessionClient.callSealedRpc does, against a fake hub holding the same session key.
function sealedSession(key: Uint8Array, hub: (body: any) => any) {
    return {
        async callSealedRpc(method: string, body: unknown) {
            expect(method).toBe(FLEET_RPC_METHOD);
            const params = JSON.stringify({ v: 1, sid: 's1', box: encodeBase64(encrypt(key, 'dataKey', body)) });
            const req = JSON.parse(params);
            const opened = decrypt(key, 'dataKey', decodeBase64(req.box));
            const answer = hub(opened);
            if (answer === 'down') return { ok: false as const, error: 'RPC method not available' };
            const sealed = encodeBase64(encrypt(key, 'dataKey', answer));
            return { ok: true as const, result: decrypt(key, 'dataKey', decodeBase64(sealed)) };
        },
    };
}

describe('fleet client (list_agents / send_to_agent)', () => {
    const key = new Uint8Array(randomBytes(32));

    it('seals the request with a timestamp and a fresh nonce', async () => {
        const seen: any[] = [];
        const s = sealedSession(key, (b) => { seen.push(b); return { ok: true, agents: [] }; });
        await fleetRequest(s, { op: 'list' });
        await fleetRequest(s, { op: 'send', to: 'x', text: 'hi' });
        expect(seen[0].op).toBe('list');
        expect(Math.abs(seen[0].ts - Date.now())).toBeLessThan(5000);
        expect(seen[0].nonce).toMatch(/^[0-9a-f]{24}$/);
        expect(seen[1]).toMatchObject({ op: 'send', to: 'x', text: 'hi' });
        expect(seen[1].nonce).not.toBe(seen[0].nonce);
    });

    it('says how to switch the hub on when it is not running; passes refusals through', async () => {
        expect(await fleetRequest(sealedSession(key, () => 'down'), { op: 'list' })).toEqual({ ok: false, error: expect.stringMatching(/happy fleet on/) });
        expect(await fleetRequest(sealedSession(key, () => ({ ok: false, error: 'That is you.' })), { op: 'send', to: 'me', text: 'x' }))
            .toEqual({ ok: false, error: 'That is you.' });
    });

    it('formats the roster for the agent', () => {
        const text = formatAgents({
            you: { name: 'a-bot', session: 's1' },
            agents: [{ name: 'codex bot', session: 's2', agent: 'codex', host: 'ws', path: '~/p', state: 'busy' },
                { name: null, session: 's3', agent: 'claude', host: null, path: null, state: 'idle', duplicateName: false }],
        });
        expect(text).toContain('You are "a-bot" (session s1)');
        expect(text).toContain('- "codex bot" — codex, ws:~/p, busy, session s2');
        expect(text).toContain('- (untitled) — claude, , idle, session s3');
        expect(formatAgents({ agents: [] })).toBe('No other agents are online.');
    });
});
