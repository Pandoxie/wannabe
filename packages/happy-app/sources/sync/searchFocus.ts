/**
 * Original Happy: "take me to that message" — a search result asks for it,
 * the chat list of that session answers it once (finds the message, loading
 * older pages if needed, scrolls to it, highlights it) and clears it.
 * Kept outside the route: on the web every session shares one route.
 */
import { create } from 'zustand';

export type FocusRequest = {
    sessionId: string;
    /** The message's creation time (ms): the same on the relay and in the chat. */
    createdAt: number;
    /** What was searched, to tell apart messages created in the same millisecond. */
    query: string;
    /** Its sequence number on the relay, when known: older pages load straight to it. */
    seq?: number;
    nonce: number;
};

type SearchFocusState = {
    request: FocusRequest | null;
    focus: (sessionId: string, createdAt: number, query: string, seq?: number) => void;
    clear: (nonce: number) => void;
};

export const useSearchFocus = create<SearchFocusState>((set, get) => ({
    request: null,
    focus: (sessionId, createdAt, query, seq) => set({ request: { sessionId, createdAt, query, seq, nonce: Date.now() } }),
    clear: (nonce) => { if (get().request?.nonce === nonce) set({ request: null }); },
}));
