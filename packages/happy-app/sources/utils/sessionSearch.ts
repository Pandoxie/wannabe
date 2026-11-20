/**
 * Original Happy: the "All sessions" page — find a session by what you remember of it, and
 * pick archived ones to delete. Pure, so the page and its dev preview share it.
 */

export interface SearchableSession {
    id: string;
    /** The title the list shows (summary, or "New chat"). */
    name: string;
    path: string;
    machineName: string;
    flavor: string;
    archived: boolean;
    /** Running sessions are never offered for deletion here (stop them first). */
    deletable: boolean;
    lastActivityAt: number;
}

export type SessionFilter = 'all' | 'archived';

/** Every word of the query must appear in the title, path, computer or agent (any case). */
export function filterSessions<T extends SearchableSession>(sessions: readonly T[], query: string, filter: SessionFilter): T[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return sessions
        .filter((session) => filter === 'all' || session.archived)
        .filter((session) => {
            if (words.length === 0) return true;
            const haystack = `${session.name}\n${session.path}\n${session.machineName}\n${session.flavor}`.toLowerCase();
            return words.every((word) => haystack.includes(word));
        })
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** The selection, kept to what is still deletable and still on screen. */
export function deletableSelection(selected: ReadonlySet<string>, shown: readonly SearchableSession[]): string[] {
    return shown.filter((session) => session.deletable && selected.has(session.id)).map((session) => session.id);
}
