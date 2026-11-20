import { describe, expect, it } from 'vitest';
import { deletableSelection, filterSessions, type SearchableSession } from './sessionSearch';

const s = (id: string, name: string, extra: Partial<SearchableSession> = {}): SearchableSession => ({
    id, name, path: '/home/demo/projects/x', machineName: 'workstation', flavor: 'claude',
    archived: true, deletable: true, lastActivityAt: 0, ...extra,
});

describe('filterSessions', () => {
    const sessions = [
        s('a', 'Fix the relay push', { lastActivityAt: 3, path: '/home/demo/projects/happy' }),
        s('b', 'Stock review', { lastActivityAt: 2, machineName: 'mini', flavor: 'codex', archived: false, deletable: false }),
        s('c', 'New chat', { lastActivityAt: 1 }),
    ];

    it('matches every word in title, path, computer or agent, any case, newest first', () => {
        expect(filterSessions(sessions, 'RELAY happy', 'all').map((x) => x.id)).toEqual(['a']);
        expect(filterSessions(sessions, 'mini codex', 'all').map((x) => x.id)).toEqual(['b']);
        expect(filterSessions(sessions, '', 'all').map((x) => x.id)).toEqual(['a', 'b', 'c']);
        expect(filterSessions(sessions, 'nothing-like-this', 'all')).toEqual([]);
    });

    it('archived only', () => {
        expect(filterSessions(sessions, '', 'archived').map((x) => x.id)).toEqual(['a', 'c']);
    });
});

describe('deletableSelection', () => {
    it('keeps only deletable sessions that are still shown', () => {
        const shown = [s('a', 'x'), s('b', 'y', { deletable: false })];
        expect(deletableSelection(new Set(['a', 'b', 'gone']), shown)).toEqual(['a']);
    });
});
