import { describe, it, expect } from 'vitest';
import { EgressGuard, ERROR_MAX_INTERVAL_MS, lockMatches, type EgressLock } from './egressGuard';
import { parseTrace, type ProbeResult } from './egressProbe';

function harness(lock: EgressLock | null = { ips: ['203.0.113.7'], countries: [] }) {
    let t = 0;
    let id = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let answer: (endpoint: string) => ProbeResult = (e) => ({ ok: true, ip: '203.0.113.7', country: 'US', endpoint: e });
    const probes: string[] = [];
    const events: string[] = [];
    const g = new EgressGuard({
        readLock: () => lock,
        probe: async (e) => { probes.push(e); return answer(e); },
        onFault: (f) => events.push(`fault:${f.kind}`),
        onRecover: () => events.push('recover'),
        now: () => t,
        setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
        clearTimer: (h) => { timers.delete(h as number); },
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const advance = async (ms: number) => {
        const end = t + ms;
        for (;;) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            t = next[1].at; timers.delete(next[0]); next[1].fn();
            for (let i = 0; i < 5; i++) await flush();
        }
        t = end;
    };
    return { g, probes, events, advance, set: (fn: typeof answer) => { answer = fn; }, interval: () => (g.status().nextCheckAt ?? 0) - t };
}

const wrong = (e: string): ProbeResult => ({ ok: true, ip: '1.2.3.4', country: 'HK', endpoint: e });
const down = (e: string): ProbeResult => ({ ok: false, error: 'timed out', endpoint: e });

describe('egress guard (daemon)', () => {
    it('reads the trace and matches the lock by IP and / or country', () => {
        expect(parseTrace('fl=1\nh=x\nip=203.0.113.7\nloc=US\n')).toEqual({ ip: '203.0.113.7', country: 'US' });
        expect(parseTrace('<html>')).toBeNull();
        expect(lockMatches({ ips: ['1.1.1.1'], countries: [] }, '1.1.1.1', 'CN')).toBe(true);
        expect(lockMatches({ ips: [], countries: ['US'] }, '9.9.9.9', 'us')).toBe(true);
        expect(lockMatches({ ips: ['1.1.1.1'], countries: ['US'] }, '1.1.1.1', 'HK')).toBe(false);
    });

    it('off without a lock: no probes', async () => {
        const h = harness(null);
        h.g.start();
        await h.advance(60 * 60_000);
        expect((await h.g.check({ firstMessage: true })).state).toBe('off');
        expect(h.probes).toEqual([]);
    });

    it('idle every 5 minutes; the first message checks first; busy every 15 s, rotating endpoints', async () => {
        const h = harness();
        h.g.start();
        await h.advance(0);
        expect(h.probes).toHaveLength(1);
        expect(h.interval()).toBe(5 * 60_000);
        const s = await h.g.check({ firstMessage: true });
        expect(s.state).toBe('busy');
        expect(h.probes).toHaveLength(1); // the startup result is fresh
        await h.advance(60_000); // the session finished; the result grows stale while idle
        expect(h.probes).toHaveLength(3); // busy-rate checks at 15 s and 30 s, then idle (busy holds 20 s)
        expect(h.interval()).toBeGreaterThan(60_000);
        await h.g.check({ firstMessage: true }); // first message after idle: checks before sending
        expect(h.probes).toHaveLength(4);
        for (let i = 0; i < 4; i++) { await h.g.check(); await h.advance(15_000); }
        expect(new Set(h.probes).size).toBe(4); // all four endpoints in turn
        await h.advance(60_000); // nobody asks any more: back to idle
        expect(h.g.status().state).toBe('idle');
        expect(h.interval()).toBeGreaterThan(4 * 60_000); // the next check is at the 5-minute idle rate
    });

    it('one wrong exit is a fault at once, then everything stops', async () => {
        const h = harness();
        h.g.start();
        await h.advance(0);
        h.set(wrong);
        const before = h.probes.length;
        await h.g.check();
        await h.advance(15_000);
        expect(h.events).toEqual(['fault:changed']);
        expect(h.probes.length).toBe(before + 1); // no second opinion
        expect(h.g.status()).toMatchObject({ state: 'error', ip: '1.2.3.4', country: 'HK' });
    });

    it('two good results in a row recover a wrong exit; one is not enough', async () => {
        const h = harness();
        h.g.start();
        await h.advance(0);
        h.set(wrong);
        await h.g.check();
        await h.advance(15_000);
        let n = 0;
        h.set((e) => (n++ === 0 ? { ok: true, ip: '203.0.113.7', country: 'US', endpoint: e } : wrong(e)));
        await h.advance(h.interval());
        await h.advance(h.interval());
        expect(h.events).toEqual(['fault:changed']);
        h.set((e) => ({ ok: true, ip: '203.0.113.7', country: 'US', endpoint: e }));
        await h.advance(h.interval());
        await h.advance(h.interval());
        expect(h.events).toEqual(['fault:changed', 'recover']);
    });

    it('unreachable once failures reach three (each check tries two endpoints); backs off to 10 minutes; two good results recover', async () => {
        const h = harness();
        h.g.start();
        await h.advance(0);
        h.set(down);
        for (let i = 0; i < 4 && !h.events.length; i++) { await h.g.check(); await h.advance(15_000); }
        expect(h.events).toEqual(['fault:unreachable']);
        expect(new Set(h.probes.slice(1)).size).toBe(4); // every endpoint failed before the verdict
        const waits: number[] = [];
        for (let i = 0; i < 8; i++) { waits.push(h.interval()); await h.advance(h.interval()); }
        expect(waits.slice(0, 4)).toEqual([15_000, 30_000, 60_000, 120_000]);
        expect(Math.max(...waits)).toBe(ERROR_MAX_INTERVAL_MS);
        h.set((e) => ({ ok: true, ip: '203.0.113.7', country: 'US', endpoint: e }));
        await h.advance(h.interval());
        expect(h.events).toEqual(['fault:unreachable']); // one good result is not enough
        await h.advance(15_000);
        expect(h.events).toEqual(['fault:unreachable', 'recover']);
        expect(h.g.status().state).not.toBe('error');
    });

    it('a new lock is judged at once, not against the last result', async () => {
        let lock: EgressLock = { ips: ['203.0.113.7'], countries: [] };
        const probes: string[] = [];
        const g = new EgressGuard({
            readLock: () => lock,
            probe: async (e) => { probes.push(e); return { ok: true, ip: '203.0.113.7', country: 'US', endpoint: e }; },
            onFault: () => {}, onRecover: () => {},
            setTimer: () => 0, clearTimer: () => {},
        });
        expect((await g.check({ firstMessage: true })).state).toBe('busy');
        lock = { ips: ['9.9.9.9'], countries: [] };
        expect((await g.check()).state).toBe('error');
        expect(probes.length).toBeGreaterThan(1);
    });

    it('in error, a message is refused without waiting for a probe', async () => {
        const h = harness();
        h.g.start();
        await h.advance(0);
        h.set(wrong);
        await h.g.check({ firstMessage: true });
        await h.advance(16_000);
        const before = h.probes.length;
        const s = await h.g.check({ firstMessage: true });
        expect(s.state).toBe('error');
        expect(h.probes.length).toBe(before);
    });
});
