import type { Message } from '@/sync/typesMessage';

/**
 * Original Happy: which chat message a search hit means. The chat's own ids
 * are made up locally, so the hit is matched by its creation time (the same
 * on the relay and here), and among messages created in the same millisecond
 * (one agent message becomes several rows) by the searched words.
 * `messages` is newest first, as the store keeps it.
 */
export function findFocusTarget(
    messages: readonly Message[],
    createdAt: number,
    query: string,
    /** With the hit's seq: the oldest seq loaded, which says whether its page is in. */
    seq?: { target: number; oldestLoaded: number | undefined },
): { message: Message | null; olderNeeded: boolean } {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const textOf = (m: Message) => ('text' in m && typeof m.text === 'string' ? m.text : '').toLowerCase();
    const same = messages.filter((m) => m.createdAt === createdAt);
    if (same.length > 0) {
        const withWords = same.find((m) => words.length > 0 && words.every((w) => textOf(m).includes(w)));
        return { message: withWords ?? same.find((m) => m.kind === 'user-text' || m.kind === 'agent-text') ?? same[0], olderNeeded: false };
    }
    // Is its page loaded? By seq when known: rows made from the agent state
    // (permission requests) carry the request's own time, often far older
    // than the loaded messages, so the oldest row's time cannot say (a hit
    // in a Codex session then landed on a permission request).
    if (seq) {
        if (seq.oldestLoaded === undefined || seq.oldestLoaded > seq.target) return { message: null, olderNeeded: true };
    } else {
        const oldest = messages[messages.length - 1];
        if (!oldest || oldest.createdAt > createdAt) return { message: null, olderNeeded: true };
    }
    // Loaded but not there as such: the closest of what the search indexes —
    // a user or agent text, never a tool call or a permission request.
    let best: Message | null = null;
    for (const m of messages) {
        if (m.kind !== 'user-text' && m.kind !== 'agent-text') continue;
        if (!best || Math.abs(m.createdAt - createdAt) < Math.abs(best.createdAt - createdAt)) best = m;
    }
    return { message: best, olderNeeded: false };
}
