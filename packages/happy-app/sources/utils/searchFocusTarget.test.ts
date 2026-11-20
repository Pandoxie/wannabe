import { describe, expect, it } from 'vitest';
import { findFocusTarget } from './searchFocusTarget';

const msg = (id: string, createdAt: number, kind: string, text?: string) => ({ id, createdAt, kind, localId: null, ...(text !== undefined ? { text } : {}) }) as any;

describe('findFocusTarget', () => {
    const messages = [ // newest first
        msg('n', 500, 'agent-text', 'latest'),
        msg('t', 300, 'tool-call'),
        msg('a', 300, 'agent-text', 'The relay drops pushes'),
        msg('u', 200, 'user-text', 'why does the relay drop them'),
    ];

    it('finds the message created then, the one with the words among several', () => {
        expect(findFocusTarget(messages, 300, 'relay drops').message?.id).toBe('a');
        expect(findFocusTarget(messages, 200, 'relay').message?.id).toBe('u');
    });

    it('asks for older pages when the time is before everything loaded', () => {
        expect(findFocusTarget(messages, 100, 'x')).toEqual({ message: null, olderNeeded: true });
        expect(findFocusTarget([], 100, 'x')).toEqual({ message: null, olderNeeded: true });
    });

    it('lands on the closest message when the exact one is not there', () => {
        expect(findFocusTarget(messages, 480, 'x').message?.id).toBe('n');
    });
});

describe('findFocusTarget with seq (Original Happy, 2026-11-18)', () => {
    // A permission request made from the agent state carries its own, older time.
    const permission = msg('p', 100, 'tool-call');
    const loaded = [msg('n', 900, 'agent-text', 'latest'), msg('t', 650, 'tool-call'), msg('a', 600, 'agent-text', 'later answer'), permission];

    it('asks for older pages by seq even when an agent-state row is older than the hit', () => {
        expect(findFocusTarget(loaded, 640, 'fail2ban', { target: 259, oldestLoaded: 700 })).toEqual({ message: null, olderNeeded: true });
        expect(findFocusTarget(loaded, 640, 'fail2ban', { target: 259, oldestLoaded: undefined }).olderNeeded).toBe(true);
    });

    it('falls back to the closest text, never a tool call or permission request', () => {
        expect(findFocusTarget(loaded, 640, 'fail2ban', { target: 259, oldestLoaded: 200 }).message?.id).toBe('a');
        expect(findFocusTarget(loaded, 650.5, 'x').message?.id).toBe('a');
    });
});
