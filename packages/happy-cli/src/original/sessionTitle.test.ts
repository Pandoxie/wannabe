import { describe, expect, it } from 'vitest';
import type { Metadata } from '@/api/types';
import { titleOwner, withTitle } from './sessionTitle';

const base = { path: '/p', host: 'h' } as Metadata;

describe('session title', () => {
    it('tells an untitled session, the agent\'s title and the user\'s', () => {
        expect(titleOwner(base)).toBe('none');
        expect(titleOwner({ ...base, summary: { text: ' ', updatedAt: 1 } })).toBe('none');
        expect(titleOwner({ ...base, summary: { text: 'Fix login', updatedAt: 1 }, agentTitle: 'Fix login' })).toBe('agent');
        // Renamed elsewhere, or titled before agentTitle existed.
        expect(titleOwner({ ...base, summary: { text: 'main coder', updatedAt: 1 }, agentTitle: 'Fix login' })).toBe('user');
        expect(titleOwner({ ...base, summary: { text: 'main coder', updatedAt: 1 } })).toBe('user');
    });

    it('lets the agent name and rename its own titles', () => {
        const named = withTitle(base, 'Fix login', false, 5);
        expect(named.summary).toEqual({ text: 'Fix login', updatedAt: 5 });
        expect(titleOwner(named)).toBe('agent');
        expect(withTitle(named, 'iOS check', false).summary?.text).toBe('iOS check');
    });

    it('keeps the user\'s title from the agent, and takes the user\'s next one', () => {
        const mine = withTitle(withTitle(base, 'Fix login', false), 'main coder', true);
        expect(titleOwner(mine)).toBe('user');
        expect(mine.agentTitle).toBeUndefined();
        expect(withTitle(mine, 'iOS check', false)).toBe(mine);
        expect(withTitle(mine, 'second coder', true).summary?.text).toBe('second coder');
    });
});
