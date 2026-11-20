import { describe, it, expect } from 'vitest';
import { DoneNotifier } from './doneNotifier';

function harness() {
    let t = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let id = 0;
    const sent: Array<string | null> = [];
    const n = new DoneNotifier({
        send: (text) => sent.push(text),
        idleMs: 60_000,
        minIntervalMs: 60_000,
        now: () => t,
        setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
        clearTimer: (h) => { timers.delete(h as number); },
    });
    const advance = (ms: number) => {
        t += ms;
        for (const [k, v] of [...timers]) if (v.at <= t) { timers.delete(k); v.fn(); }
    };
    return { n, sent, advance };
}

describe('done notifications (notify_owner and the idle fallback)', () => {
    it('the agent notifies: sent at once, no fallback for that round', () => {
        const { n, sent, advance } = harness();
        n.roundStarted();
        expect(n.notifyOwner('复盘完成：今日持仓整体 +1.2%')).toEqual({ ok: true });
        n.turnEnded();
        advance(10 * 60_000);
        expect(sent).toEqual(['复盘完成：今日持仓整体 +1.2%']);
    });

    it('a turn that ends while subagents still work: no push until 1 minute of silence', () => {
        const { n, sent, advance } = harness();
        n.roundStarted();
        n.turnEnded();
        for (let i = 0; i < 10; i++) { advance(50_000); n.activity(); } // subagent output keeps coming
        expect(sent).toEqual([]);
        advance(59_000);
        expect(sent).toEqual([]);
        advance(1_000);
        expect(sent).toEqual([null]); // fallback: the usual excerpt
        advance(10 * 60_000);
        expect(sent).toEqual([null]); // once
    });

    it('the agent notifies after its background work, inside the window: no fallback', () => {
        const { n, sent, advance } = harness();
        n.roundStarted();
        n.turnEnded();
        advance(40_000);
        n.roundStarted(); // background task finished; Claude starts a new turn
        n.notifyOwner('全部完成');
        n.turnEnded();
        advance(10 * 60_000);
        expect(sent).toEqual(['全部完成']);
    });

    it('a new message cancels a pending fallback', () => {
        const { n, sent, advance } = harness();
        n.turnEnded();
        advance(30_000);
        n.roundStarted();
        advance(10 * 60_000);
        expect(sent).toEqual([]);
    });

    it('one notification per minute; empty text refused', () => {
        const { n, sent, advance } = harness();
        expect(n.notifyOwner('a')).toEqual({ ok: true });
        expect(n.notifyOwner('b')).toMatchObject({ ok: false, error: expect.stringMatching(/one notification per minute/) });
        advance(60_000);
        expect(n.notifyOwner('c')).toEqual({ ok: true });
        expect(n.notifyOwner('  ')).toMatchObject({ ok: false });
        expect(sent).toEqual(['a', 'c']);
    });
});
