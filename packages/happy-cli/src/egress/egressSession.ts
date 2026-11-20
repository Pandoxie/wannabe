/**
 * Original Happy: the egress guard as one session sees it.
 *
 * - Before a message goes to the agent: ask the daemon (it checks first when
 *   its last result is stale). In error the message is refused with a notice
 *   in the chat, like a provider error.
 * - While the agent works: ask every few seconds (localhost; the daemon does
 *   the probing at 15 s). On error, stop the turn as the stop button does,
 *   and say why.
 * - After a notice: watch (passively) until the daemon recovers, then say so.
 *
 * Fails closed: on a locked machine, no answer from the daemon (stopped,
 * crashed, not started) is not "off" but a fault of its own, `nochecker`:
 * messages are refused and a working turn is stopped. Only an answer that the
 * daemon checked the exit (`idle` / `busy`) lets messages through again and
 * counts as recovered. Machines without a lock never ask.
 */
import { describeFault, type EgressStatus } from './egressGuard';

export type EgressAnswer = Pick<EgressStatus, 'state' | 'fault' | 'lock' | 'ip' | 'country'>;

/** What the session uses when the daemon gave no (usable) answer. */
export const NO_ANSWER: EgressAnswer = { state: 'off', fault: null, lock: null, ip: null, country: null };

export type EgressSessionOptions = {
    /** The daemon's answer, or NO_ANSWER when there is none. */
    ask: (opts: { firstMessage?: boolean; passive?: boolean }) => Promise<EgressAnswer>;
    /** Whether this machine is locked (egress.json), read by the session itself. */
    locked: () => boolean;
    notice: (text: string) => void;
    abort: () => Promise<void>;
    host: string;
    now?: () => number;
};

const WORKING_POLL_MS = 5_000;
const RECOVERY_POLL_MS = 15_000;

export function faultText(a: EgressAnswer): string {
    return a.fault ? describeFault(a.fault, a.lock) : '网络出口异常';
}

const NO_CHECKER_TEXT = '出口检查（happy daemon）没有在运行，无法确认网络出口。启动它：happy daemon start';

/** The answer as the session acts on it: blocked (with why) or allowed. */
type Verdict = { allowed: true; answer: EgressAnswer } | { allowed: false; why: string };

export class EgressSessionGuard {
    private readonly now: () => number;
    private lastAsk = -Infinity;
    private asking = false;
    private faultShown = false; // a notice is up: watch for recovery
    private stoppedThisFault = false; // the turn-stopped notice was given
    private chain: Promise<unknown> = Promise.resolve();
    private pending = 0;

    constructor(private readonly opts: EgressSessionOptions) {
        this.now = opts.now ?? Date.now;
    }

    /**
     * Runs `deliver` if the egress allows it; messages keep their order. With
     * no lock (`locked` false) and nothing waiting, at once.
     */
    gate(deliver: () => void): void {
        if (!this.opts.locked() && this.pending === 0 && !this.faultShown) { deliver(); return; }
        this.pending += 1;
        this.chain = this.chain.then(async () => {
            const v = await this.judge({ firstMessage: true });
            this.lastAsk = this.now();
            if (!v.allowed) {
                this.faultShown = true;
                this.opts.notice(`⚠️ 网络出口异常，这条消息没有发给 AI。\n\n${this.opts.host}：${v.why}。\n网络恢复后会通知你，到时重新发送即可。`);
                return;
            }
            deliver();
        }).finally(() => { this.pending -= 1; });
    }

    /**
     * Asks the daemon and judges its answer. Locked: only a checked exit
     * (idle / busy) allows; an error, or no answer at all, blocks. Not locked
     * (the lock was removed): allowed.
     */
    private async judge(opts: { firstMessage?: boolean; passive?: boolean }): Promise<Verdict> {
        let a: EgressAnswer;
        try { a = await this.opts.ask(opts); } catch { a = NO_ANSWER; }
        if (a.state === 'error') return { allowed: false, why: faultText(a) };
        if (a.state === 'idle' || a.state === 'busy') return { allowed: true, answer: a };
        // 'off': the daemon has no lock, or there is no daemon.
        if (this.opts.locked()) return { allowed: false, why: NO_CHECKER_TEXT };
        return { allowed: true, answer: a };
    }

    /** A fault notice is up: the session keeps asking (for recovery). */
    watching(): boolean { return this.faultShown; }

    /** Called every couple of seconds with whether the agent is working. */
    tick(thinking: boolean): void {
        if (this.asking) return;
        const due = thinking ? WORKING_POLL_MS : this.faultShown ? RECOVERY_POLL_MS : Infinity;
        if (this.now() - this.lastAsk < due) return;
        this.asking = true;
        this.lastAsk = this.now();
        void this.judge({ passive: !thinking })
            .then(async (v) => {
                if (!v.allowed) {
                    if (thinking) {
                        await this.opts.abort();
                        if (!this.stoppedThisFault) this.opts.notice(`⚠️ 网络出口异常，已中断当前任务。\n\n${this.opts.host}：${v.why}。\n网络恢复后会通知你，到时让我继续即可。`);
                        this.faultShown = true;
                        this.stoppedThisFault = true;
                    }
                } else if (this.faultShown && !thinking) {
                    // Recovered only on the daemon's word that the exit is right
                    // (or the lock was removed).
                    const a = v.answer;
                    this.faultShown = false;
                    this.stoppedThisFault = false;
                    this.opts.notice(a.state === 'off'
                        ? '✅ 已解除网络出口锁定，可以继续了。'
                        : `✅ 网络出口已恢复${a.ip ? `（${a.ip}${a.country ? `，${a.country}` : ''}）` : ''}，可以继续了。`);
                }
            })
            .catch(() => {})
            .finally(() => { this.asking = false; });
    }
}
