/**
 * Original Happy: when to tell the owner that a session is done.
 *
 * The agent decides: it calls the happy tool notify_owner with one sentence
 * when everything the owner asked for is finished (subagents and background
 * work included). A turn ending is not a signal by itself — the main agent
 * often goes idle while subagents still work.
 *
 * Fallback, for an agent that forgets: after a turn ends without a
 * notify_owner, once the session has had no activity at all (no output, no
 * thinking, subagent output included) for `idleMs`, the owner gets the
 * usual push with the start of the last reply.
 *
 * Approval requests and questions are pushed elsewhere, at once, as before.
 */
export type DoneNotifierOptions = {
    /** Sends the "done" push; `text` is the agent's sentence, or null for the fallback. */
    send: (text: string | null) => void;
    idleMs?: number;
    minIntervalMs?: number;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
};

export class DoneNotifier {
    private readonly idleMs: number;
    private readonly minIntervalMs: number;
    private readonly now: () => number;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;
    private notifiedThisTurn = false;
    private armed = false;
    private timer: unknown = null;
    private lastSentAt = -Infinity;

    constructor(private readonly opts: DoneNotifierOptions) {
        this.idleMs = opts.idleMs ?? 60_000;
        this.minIntervalMs = opts.minIntervalMs ?? 60_000;
        this.now = opts.now ?? Date.now;
        this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
        this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    }

    /** The notify_owner tool. */
    notifyOwner(text: string): { ok: true } | { ok: false; error: string } {
        const sentence = text.trim();
        if (!sentence) return { ok: false, error: 'Write one sentence: the result, or what you need from the user.' };
        const wait = this.lastSentAt + this.minIntervalMs - this.now();
        if (wait > 0) {
            return { ok: false, error: `Not sent: one notification per minute per session. The user was notified ${Math.round((this.now() - this.lastSentAt) / 1000)} s ago; put everything into one notification when you are done.` };
        }
        this.lastSentAt = this.now();
        this.notifiedThisTurn = true;
        this.disarm();
        this.opts.send(sentence);
        return { ok: true };
    }

    /** A new message for the agent (owner, another agent, a scheduled task): a new round. */
    roundStarted(): void {
        this.notifiedThisTurn = false;
        this.disarm();
    }

    /** The main agent's turn ended; arm the fallback unless it already notified. */
    turnEnded(): void {
        if (this.notifiedThisTurn) return;
        this.armed = true;
        this.restart();
    }

    /** Any output or thinking (subagents included): the session is still working. */
    activity(): void {
        if (this.armed) this.restart();
    }

    dispose(): void {
        this.disarm();
    }

    private restart(): void {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => {
            this.timer = null;
            if (!this.armed) return;
            this.armed = false;
            this.lastSentAt = this.now();
            this.opts.send(null);
        }, this.idleMs);
    }

    private disarm(): void {
        this.armed = false;
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
    }
}
