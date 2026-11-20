import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, planCleanup } from './cleanup';

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;
const ago = (days: number) => now - days * DAY;

describe('planCleanup', () => {
    it('deletes computers offline past the limit only', () => {
        const plan = planCleanup([
            { id: 'old', active: false, activeAt: ago(6), metadata: { host: 'old-box' } },
            { id: 'recent', active: false, activeAt: ago(4), metadata: { host: 'b' } },
            { id: 'online', active: true, activeAt: ago(30), metadata: { host: 'c' } },
        ], [], DEFAULT_RULES, now);
        expect(plan.machines.map((m) => [m.id, m.name, m.idleDays])).toEqual([['old', 'old-box', 6]]);
    });

    it('short finished sessions go after 5 days, long ones after 50; running, bots and side chats stay', () => {
        const plan = planCleanup([], [
            { id: 'empty-6d', seq: 0, active: false, activeAt: ago(6), metadata: { lifecycleState: 'archived' } },
            { id: 'short-4d', seq: 12, active: false, activeAt: ago(4), metadata: {} },
            { id: 'long-49d', seq: 400, active: false, activeAt: ago(49), metadata: { summary: { text: 'Big work' } } },
            { id: 'long-51d', seq: 400, active: false, activeAt: ago(51), metadata: { summary: { text: 'Big work' }, host: 'ws' } },
            { id: 'running', seq: 3, active: true, activeAt: ago(0), metadata: { lifecycleState: 'running' } },
            { id: 'bot', seq: 1, active: false, activeAt: ago(100), metadata: { bot: { name: 'b' } } },
            { id: 'side', seq: 1, active: false, activeAt: ago(100), metadata: { isSideChat: true } },
        ], DEFAULT_RULES, now);
        expect(plan.sessions.map((s) => [s.id, s.reason])).toEqual([['long-51d', 'long'], ['empty-6d', 'short']]);
        expect(plan.sessions[0]).toMatchObject({ name: 'Big work', host: 'ws', messages: 400, idleDays: 51 });
        expect(plan.kept).toEqual({ running: 1, recent: 2, bots: 1 });
    });

    it('takes other numbers', () => {
        const plan = planCleanup([], [
            { id: 'a', seq: 50, active: false, activeAt: ago(10), metadata: {} },
        ], { ...DEFAULT_RULES, shortMessages: 100, shortDays: 7 }, now);
        expect(plan.sessions.map((s) => s.id)).toEqual(['a']);
    });
});
