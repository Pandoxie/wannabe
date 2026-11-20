/**
 * Original Happy: the folder list under the new-session path field.
 *
 * What is typed splits at its last "/": the part before is the folder to
 * list, the part after filters it. "~/code/hap" lists ~/code and keeps names
 * starting with "hap"; "~/code/" lists all of ~/code. Hidden folders show
 * only when the filter starts with ".". An empty field lists the home folder.
 */
export type FolderQuery = {
    /** The folder to list, as typed (may start with ~), ending in "/". */
    base: string;
    /** Names must start with this (case-insensitive). */
    prefix: string;
};

export function folderQuery(value: string): FolderQuery {
    const typed = value.trim();
    if (!typed || typed === '~') return { base: '~/', prefix: '' };
    const cut = typed.lastIndexOf('/');
    if (cut < 0) return { base: '~/', prefix: typed };
    return { base: typed.slice(0, cut + 1), prefix: typed.slice(cut + 1) };
}

/** The listed names to offer for a query, sorted, at most `limit`. */
export function filterFolders(names: string[], prefix: string, limit = 50): string[] {
    const p = prefix.toLowerCase();
    return names
        .filter((name) => (p.startsWith('.') || !name.startsWith('.')) && name.toLowerCase().startsWith(p))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, limit);
}
