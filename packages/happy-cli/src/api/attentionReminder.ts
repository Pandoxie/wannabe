/**
 * Original Happy: the owner is reminded of a pending approval or question.
 *
 * Every approval the agent waits for — and Claude's AskUserQuestion, which
 * is answered through the same path — sits in the session's agent state
 * (`requests`) until it is answered or cancelled. While it does, the owner
 * is pushed again every `intervalMs`, at most `maxPushes` times in all for
 * that request (the first push included). Nothing is guessed: a request is
 * pending exactly as long as it is in `requests`.
 *
 * `initialPushed(tool)`: whether someone else already sent the first push
 * for this kind of request (Claude's question push from the launcher); then
 * this only sends the repeats.
 */
export type PendingRequests = Record<string, { tool: string; arguments?: unknown; createdAt?: number }> | undefined;

export type AttentionReminderOptions = {
    send: (kind: 'permission' | 'question', excerpt: string, requestId: string) => void;
    intervalMs?: number;
    maxPushes?: number;
    initialPushed?: (tool: string) => boolean;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
};

const QUESTION_TOOLS = new Set(['AskUserQuestion']);

/** What the push says: the question, or the tool and its command / path. */
export function attentionExcerpt(tool: string, args: unknown): string {
    const a = (args ?? {}) as Record<string, unknown>;
    if (QUESTION_TOOLS.has(tool)) {
        const q = (a.questions as Array<{ question?: unknown }> | undefined)?.[0]?.question;
        if (typeof q === 'string' && q.trim()) return q;
    }
    const detail = [a.command, a.cmd, a.file_path, a.path, a.url, a.description].find((v) => typeof v === 'string' && v.trim());
    return detail ? `${tool}: ${detail}` : tool;
}

export class AttentionReminder {
    private readonly intervalMs: number;
    private readonly maxPushes: number;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;
    private readonly tracked = new Map<string, { timer: unknown; pushes: number }>();

    constructor(private readonly opts: AttentionReminderOptions) {
        this.intervalMs = opts.intervalMs ?? 5 * 60_000;
        this.maxPushes = opts.maxPushes ?? 3;
        this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
        this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    }

    /** Call with the agent state's `requests` whenever it changes. */
    sync(requests: PendingRequests): void {
        const pending = requests ?? {};
        for (const [id, entry] of this.tracked) {
            if (!(id in pending)) {
                if (entry.timer !== null) this.clearTimer(entry.timer);
                this.tracked.delete(id);
            }
        }
        for (const [id, request] of Object.entries(pending)) {
            if (this.tracked.has(id)) continue;
            const kind = QUESTION_TOOLS.has(request.tool) ? 'question' : 'permission';
            const excerpt = attentionExcerpt(request.tool, request.arguments);
            const entry = { timer: null as unknown, pushes: 0 };
            this.tracked.set(id, entry);
            if (this.opts.initialPushed?.(request.tool)) entry.pushes = 1;
            else this.push(id, kind, excerpt, entry);
            this.schedule(id, kind, excerpt, entry);
        }
    }

    dispose(): void {
        for (const entry of this.tracked.values()) if (entry.timer !== null) this.clearTimer(entry.timer);
        this.tracked.clear();
    }

    private push(id: string, kind: 'permission' | 'question', excerpt: string, entry: { pushes: number }) {
        entry.pushes += 1;
        this.opts.send(kind, excerpt, id);
    }

    private schedule(id: string, kind: 'permission' | 'question', excerpt: string, entry: { timer: unknown; pushes: number }) {
        if (entry.pushes >= this.maxPushes) { entry.timer = null; return; }
        entry.timer = this.setTimer(() => {
            if (this.tracked.get(id) !== entry) return;
            this.push(id, kind, excerpt, entry);
            this.schedule(id, kind, excerpt, entry);
        }, this.intervalMs);
    }
}
