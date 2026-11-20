/**
 * Original Happy: the session search in the right panel ("Search", next to
 * Changes / All files / Side chat) — one query, one set of results that stay
 * while you jump from session to session, and one in-memory index of what was
 * read (nothing stored, nothing sent).
 */
import * as React from 'react';
import { create } from 'zustand';
import { ContentSearchIndex, type ContentHit } from '@/sync/contentSearch';
import { sync } from '@/sync/sync';
import { useAllMachines, useAllSessions } from '@/sync/storage';
import { getMachineName } from '@/sync/machineChoices';
import { isRigMetadata } from '@/sync/rig';
import { getSessionName } from '@/utils/sessionUtils';
import { getSessionActivityAt } from '@/utils/sessionActivity';
import type { SearchableSession, SessionFilter } from '@/utils/sessionSearch';

export type SearchScope = 'titles' | 'messages';

/** What was read lives here, for the tab's life: a reload starts over. */
export const contentIndex = new ContentSearchIndex((sessionId, afterSeq) => sync.fetchMessagesForSearch(sessionId, afterSeq));

type SearchStore = {
    query: string;
    scope: SearchScope;
    filter: SessionFilter;
    /** While reading: done / total. null when not reading. */
    progress: { done: number; total: number } | null;
    failed: number;
    revision: number;
    /** Bumped to ask the search field to take the keyboard (the header's Search button). */
    focusInput: number;
    set: (patch: Partial<Omit<SearchStore, 'set'>>) => void;
};

export const useSearchStore = create<SearchStore>((set) => ({
    query: '', scope: 'titles', filter: 'all', progress: null, failed: 0, revision: 0, focusInput: 0,
    set: (patch) => set(patch),
}));

/** Every session of the account as the search sees it (bots left out). */
export function useSearchableSessions(): SearchableSession[] {
    const sessions = useAllSessions();
    const machines = useAllMachines({ includeOffline: true });
    return React.useMemo(() => {
        const machineNames = new Map(machines.map((machine) => [machine.id, getMachineName(machine)]));
        return sessions
            .filter((session) => !session.metadata?.bot)
            .map((session) => {
                // The same rule as the session list's archive (storage.ts isSessionArchived).
                const archived = session.metadata?.lifecycleState === 'archived' || (!isRigMetadata(session.metadata) && !session.active);
                return {
                    id: session.id,
                    name: getSessionName(session),
                    path: session.metadata?.path ?? '',
                    machineName: (session.metadata?.machineId && machineNames.get(session.metadata.machineId)) || session.metadata?.host || '',
                    flavor: session.metadata?.flavor ?? 'claude',
                    archived,
                    deletable: archived,
                    lastActivityAt: getSessionActivityAt(session),
                };
            });
    }, [sessions, machines]);
}

let reading: Promise<void> | null = null;

/**
 * Reads every session's messages into the index, replacing what was there.
 * One read at a time: a second call while one runs waits for it.
 */
export function readAllMessages(sessionIds: readonly string[]): Promise<void> {
    if (reading) return reading;
    const store = useSearchStore.getState();
    store.set({ progress: { done: 0, total: sessionIds.length }, failed: 0 });
    reading = contentIndex.rebuild(sessionIds, (done, total) => useSearchStore.getState().set({ progress: { done, total } }))
        .then((bad) => {
            const s = useSearchStore.getState();
            s.set({ progress: null, failed: bad.length, revision: s.revision + 1 });
        })
        .finally(() => { reading = null; });
    return reading;
}

/**
 * Message search reads the messages once, the first time it is used, and
 * otherwise only when Refresh is pressed: nothing reads in the background.
 */
export function useContentReader(rows: readonly SearchableSession[], on: boolean): void {
    const rowsRef = React.useRef(rows);
    rowsRef.current = rows;
    React.useEffect(() => {
        if (!on || contentIndex.isBuilt() || reading) return;
        void readAllMessages(rowsRef.current.map((row) => row.id));
    }, [on]);
}

/** Message hits for the current query (debounced), growing while sessions are read. */
export function useContentHits(): ContentHit[] {
    const query = useSearchStore((s) => s.query);
    const scope = useSearchStore((s) => s.scope);
    const progress = useSearchStore((s) => s.progress);
    const revision = useSearchStore((s) => s.revision);
    const [debounced, setDebounced] = React.useState(query);
    React.useEffect(() => {
        const timer = setTimeout(() => setDebounced(query), 200);
        return () => clearTimeout(timer);
    }, [query]);
    return React.useMemo(
        () => (scope === 'messages' && debounced.trim() ? contentIndex.search(debounced, 20) : []),
        [scope, debounced, progress, revision],
    );
}
