import { describe, it, expect } from 'vitest';
import { EgressSessionGuard, NO_ANSWER, type EgressAnswer } from './egressSession';

const ok: EgressAnswer = { state: 'busy', fault: null, lock: { ips: ['203.0.113.7'], countries: [] }, ip: '203.0.113.7', country: 'US' };
const bad: EgressAnswer = { state: 'error', fault: { kind: 'changed', ip: '1.2.3.4', country: 'HK' }, lock: { ips: ['203.0.113.7'], countries: [] }, ip: '1.2.3.4', country: 'HK' };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function harness(opts: { locked?: boolean } = {}) {
    let t = 0;
    let answer = ok;
    let locked = opts.locked ?? true;
    const asks: Array<Record<string, unknown>> = [];
    const notices: string[] = [];
    let aborts = 0;
    const g = new EgressSessionGuard({
        ask: async (o) => { asks.push(o); return answer; },
        locked: () => locked,
        notice: (text) => notices.push(text),
        abort: async () => { aborts += 1; },
        host: 'workstation',
        now: () => t,
    });
    return { g, asks, notices, aborts: () => aborts, set: (a: EgressAnswer) => { answer = a; }, at: (ms: number) => { t = ms; }, lock: (v: boolean) => { locked = v; } };
}

describe('egress guard in a session', () => {
    it('without a lock, messages pass at once and nothing is asked', () => {
        const h = harness({ locked: false });
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        expect(got).toEqual([1]);
        expect(h.asks).toEqual([]);
    });

    it('with a lock, a message waits for the daemon; order is kept', async () => {
        const h = harness();
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        h.g.gate(() => got.push(2));
        expect(got).toEqual([]);
        await flush();
        expect(got).toEqual([1, 2]);
        expect(h.asks[0]).toEqual({ firstMessage: true });
    });

    it('in error, a message is refused with a notice like a provider error', async () => {
        const h = harness();
        h.set(bad);
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        await flush();
        expect(got).toEqual([]);
        expect(h.notices[0]).toMatch(/^⚠️ 网络出口异常，这条消息没有发给 AI。/);
        expect(h.notices[0]).toContain('workstation：出口 IP 变成了 1.2.3.4（HK），应为 203.0.113.7');
    });

    it('a refused message does not hide the later turn-stopped notice', async () => {
        const h = harness();
        h.set(bad);
        h.g.gate(() => {});
        await flush();
        h.at(10_000); h.g.tick(true); await flush();
        expect(h.notices.map((n) => n.split('\n')[0])).toEqual(['⚠️ 网络出口异常，这条消息没有发给 AI。', '⚠️ 网络出口异常，已中断当前任务。']);
    });

    it('while working: asks every 5 s; on error stops the turn once and says so; recovery is announced', async () => {
        const h = harness();
        h.g.tick(true); await flush();
        h.at(2_000); h.g.tick(true); await flush();
        expect(h.asks).toEqual([{ passive: false }]);
        h.set(bad);
        h.at(5_000); h.g.tick(true); await flush();
        expect(h.aborts()).toBe(1);
        expect(h.notices).toHaveLength(1);
        expect(h.notices[0]).toMatch(/已中断当前任务/);
        h.at(10_000); h.g.tick(true); await flush(); // still marked working: stopped again, no second notice
        expect(h.notices).toHaveLength(1);
        h.at(12_000); h.g.tick(false); await flush(); // idle now: waits 15 s between passive asks
        expect(h.asks).toHaveLength(3);
        h.set(ok);
        h.at(25_000); h.g.tick(false); await flush();
        expect(h.asks.at(-1)).toEqual({ passive: true });
        expect(h.notices.at(-1)).toBe('✅ 网络出口已恢复（203.0.113.7，US），可以继续了。');
        h.at(60_000); h.g.tick(false); await flush();
        expect(h.asks).toHaveLength(4); // nothing more to watch
    });

    // The daemon was stopped on a locked machine (seen in use): the
    // session said "recovered" and let messages through. It must fail closed.
    it('locked and no daemon: a message is refused, never let through', async () => {
        const h = harness();
        h.set(NO_ANSWER);
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        await flush();
        expect(got).toEqual([]);
        expect(h.notices[0]).toMatch(/^⚠️ 网络出口异常，这条消息没有发给 AI。/);
        expect(h.notices[0]).toContain('happy daemon');
    });

    it('locked, a fault, then the daemon goes away: no recovery is announced', async () => {
        const h = harness();
        h.set(bad);
        h.g.gate(() => {});
        await flush();
        h.set(NO_ANSWER); // daemon stopped
        h.at(20_000); h.g.tick(false); await flush();
        h.at(40_000); h.g.tick(false); await flush();
        expect(h.notices.some((n) => n.startsWith('✅'))).toBe(false);
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        await flush();
        expect(got).toEqual([]);
        h.set(ok); // daemon back and the exit is right: recovered
        h.at(60_000); h.g.tick(false); await flush();
        expect(h.notices.at(-1)).toBe('✅ 网络出口已恢复（203.0.113.7，US），可以继续了。');
    });

    it('locked, working, the daemon goes away: the turn is stopped', async () => {
        const h = harness();
        h.set(NO_ANSWER);
        h.g.tick(true); await flush();
        expect(h.aborts()).toBe(1);
        expect(h.notices[0]).toMatch(/已中断当前任务/);
    });

    it('lock removed while a notice is up: messages pass and that is what is said', async () => {
        const h = harness();
        h.set(NO_ANSWER);
        h.g.gate(() => {});
        await flush();
        expect(h.g.watching()).toBe(true);
        h.lock(false); // happy egress unlock
        h.at(20_000); h.g.tick(false); await flush();
        expect(h.notices.at(-1)).toBe('✅ 已解除网络出口锁定，可以继续了。');
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        expect(got).toEqual([1]);
    });

    it('the daemon answering off while the session still sees a lock is not trusted', async () => {
        const h = harness();
        h.set({ ...NO_ANSWER, state: 'off' });
        const got: number[] = [];
        h.g.gate(() => got.push(1));
        await flush();
        expect(got).toEqual([]);
    });
});
