/**
 * Original Happy: search inside messages, entirely in the browser.
 *
 * What is searched is what one looks for later: what you wrote, and what the
 * agent answered at the end of each turn. The steps in between — its running
 * commentary, tool calls, code it wrote, thinking, tool output — are left out:
 * they made most of the text and buried the answers.
 *
 * Each session's messages are fetched and decrypted exactly as when the
 * session is opened (`sync.fetchMessagesForSearch`) and kept in memory only:
 * nothing is written to the browser's storage, nothing new is asked of the
 * relay. The index is read once, when the search is first used, and again
 * only on Refresh (or after a reload of the page).
 */
import type { NormalizedMessage } from './typesRaw';

export type SearchDoc = {
    messageId: string;
    role: 'user' | 'agent';
    text: string;
    createdAt: number;
    /** The message's sequence number on the relay: the chat loads straight to it. */
    seq: number;
};

export type ContentHit = {
    sessionId: string;
    count: number;
    lastAt: number;
    snippets: { text: string; role: 'user' | 'agent'; createdAt: number; seq: number }[];
};

/** One page of a session's messages, in relay order, each with its sequence number. */
export type SeqMessage = { seq: number; message: NormalizedMessage };
type Page = { items: SeqMessage[]; lastSeq: number; hasMore: boolean };
export type PageFetcher = (sessionId: string, afterSeq: number) => Promise<Page>;

function agentText(message: NormalizedMessage): string {
    if (message.role !== 'agent') return '';
    return message.content
        .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();
}

/**
 * The words worth finding: each message you wrote, and the agent's last text of
 * each turn (its answer). A turn ends at your next message, or where the agent's
 * turn id changes. Subagents' messages (sidechain) are left out.
 */
export function docsFromMessages(items: readonly SeqMessage[]): SearchDoc[] {
    const docs: SearchDoc[] = [];
    let answer: SearchDoc | null = null;
    let answerTurn: string | undefined;
    const closeTurn = () => {
        if (answer) docs.push(answer);
        answer = null;
        answerTurn = undefined;
    };
    for (const { seq, message: m } of items) {
        if (m.isSidechain) continue;
        if (m.role === 'user') {
            closeTurn();
            const text = m.content.text.trim();
            if (text) docs.push({ messageId: m.id, role: 'user', text, createdAt: m.createdAt, seq });
        } else if (m.role === 'agent') {
            if (answer && m.turn && answerTurn && m.turn !== answerTurn) closeTurn();
            const text = agentText(m);
            if (text) {
                answer = { messageId: m.id, role: 'agent', text, createdAt: m.createdAt, seq };
                answerTurn = m.turn;
            }
        }
    }
    closeTurn();
    return docs;
}

export function queryWords(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Around the first word found, on one line. */
export function snippet(text: string, words: readonly string[], radius = 60): string {
    const flat = text.replace(/\s+/g, ' ');
    const lower = flat.toLowerCase();
    const at = Math.max(0, Math.min(...words.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; })));
    const start = Math.max(0, (Number.isFinite(at) ? at : 0) - radius);
    const end = Math.min(flat.length, (Number.isFinite(at) ? at : 0) + radius * 2);
    return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

export class ContentSearchIndex {
    private sessions = new Map<string, SearchDoc[]>();
    /** One read per session at a time: a second caller waits for the first. */
    private inflight = new Map<string, Promise<void>>();
    /** When the whole index was last read (0: never). */
    private builtAt = 0;

    constructor(private fetchPage: PageFetcher) {}

    /** Reads one session from its first message. */
    update(sessionId: string): Promise<void> {
        const running = this.inflight.get(sessionId);
        if (running) return running;
        const read = this.read(sessionId).finally(() => this.inflight.delete(sessionId));
        this.inflight.set(sessionId, read);
        return read;
    }

    private async read(sessionId: string): Promise<void> {
        const items: SeqMessage[] = [];
        let afterSeq = 0;
        for (let page = 0; page < 10_000; page++) {
            const { items: pageItems, lastSeq, hasMore } = await this.fetchPage(sessionId, afterSeq);
            items.push(...pageItems);
            if (lastSeq <= afterSeq) break;
            afterSeq = lastSeq;
            if (!hasMore) break;
        }
        // Whole sessions only: a turn's answer can sit on the next page.
        this.sessions.set(sessionId, docsFromMessages(items));
    }

    /**
     * Reads the given sessions from scratch, a few at a time, replacing what was
     * there; sessions not given leave the index. Reports progress; returns the
     * ones that failed.
     */
    async rebuild(sessionIds: readonly string[], onProgress: (done: number, total: number) => void, concurrency = 4, signal?: AbortSignal): Promise<string[]> {
        const keep = new Set(sessionIds);
        for (const id of [...this.sessions.keys()]) if (!keep.has(id)) this.sessions.delete(id);
        const failed: string[] = [];
        let next = 0, done = 0;
        onProgress(0, sessionIds.length);
        const worker = async () => {
            while (next < sessionIds.length && !signal?.aborted) {
                const id = sessionIds[next++];
                try { await this.update(id); } catch { failed.push(id); }
                onProgress(++done, sessionIds.length);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, sessionIds.length) }, worker));
        this.builtAt = Date.now();
        return failed;
    }

    /** Whether the index was read at least once (in this page's life). */
    isBuilt(): boolean {
        return this.builtAt > 0;
    }

    /** When it was last read (0: never). */
    get lastBuiltAt(): number {
        return this.builtAt;
    }

    /** Dev pages only: put text in without the relay. */
    seedForDev(sessionId: string, docs: SearchDoc[]): void {
        this.sessions.set(sessionId, docs);
        this.builtAt = this.builtAt || Date.now();
    }

    has(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    /** Sessions whose messages hold every word, most recent hit first. */
    search(query: string, maxSnippets = 3): ContentHit[] {
        const words = queryWords(query);
        if (words.length === 0) return [];
        const hits: ContentHit[] = [];
        for (const [sessionId, docs] of this.sessions) {
            const matching = docs.filter((d) => { const t = d.text.toLowerCase(); return words.every((w) => t.includes(w)); });
            if (matching.length === 0) continue;
            matching.sort((a, b) => b.createdAt - a.createdAt);
            hits.push({
                sessionId, count: matching.length, lastAt: matching[0].createdAt,
                snippets: matching.slice(0, maxSnippets).map((d) => ({ text: snippet(d.text, words), role: d.role, createdAt: d.createdAt, seq: d.seq })),
            });
        }
        return hits.sort((a, b) => b.lastAt - a.lastAt);
    }
}
