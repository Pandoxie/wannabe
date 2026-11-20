import { describe, it, expect } from 'vitest';
import { AttentionReminder, attentionExcerpt } from './attentionReminder';

function harness(initialPushed?: (tool: string) => boolean) {
    let t = 0;
    let id = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    const sent: string[] = [];
    const r = new AttentionReminder({
        send: (kind, excerpt) => sent.push(`${kind}:${excerpt}`),
        initialPushed,
        setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
        clearTimer: (h) => { timers.delete(h as number); },
    });
    const advance = (ms: number) => {
        const end = t + ms;
        for (;;) {
            const next = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            t = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        t = end;
    };
    return { r, sent, advance };
}

const bash = { tool: 'Bash', arguments: { command: 'git push origin main' } };

describe('reminders for pending approvals and questions', () => {
    it('pushes at once, again every 5 minutes, three times in all', () => {
        const { r, sent, advance } = harness();
        r.sync({ a: bash });
        expect(sent).toEqual(['permission:Bash: git push origin main']);
        advance(4 * 60_000 + 59_000);
        expect(sent).toHaveLength(1);
        advance(1_000);
        expect(sent).toHaveLength(2);
        advance(60 * 60_000);
        expect(sent).toHaveLength(3);
    });

    it('stops as soon as the request is answered', () => {
        const { r, sent, advance } = harness();
        r.sync({ a: bash });
        advance(6 * 60_000);
        r.sync({});
        advance(60 * 60_000);
        expect(sent).toHaveLength(2);
    });

    it('a state update that keeps the request does not restart it; each request counts on its own', () => {
        const { r, sent, advance } = harness();
        r.sync({ a: bash });
        advance(2 * 60_000);
        r.sync({ a: bash, b: { tool: 'Edit', arguments: { file_path: '/x/y.ts' } } });
        expect(sent).toEqual(['permission:Bash: git push origin main', 'permission:Edit: /x/y.ts']);
        advance(3 * 60_000);
        expect(sent).toHaveLength(3); // a's second push
    });

    it('questions: the first push may come from elsewhere; then only the two repeats', () => {
        const { r, sent, advance } = harness((tool) => tool === 'AskUserQuestion');
        r.sync({ q: { tool: 'AskUserQuestion', arguments: { questions: [{ question: '用哪个方案？' }] } } });
        expect(sent).toEqual([]);
        advance(60 * 60_000);
        expect(sent).toEqual(['question:用哪个方案？', 'question:用哪个方案？']);
    });

    it('says what is asked', () => {
        expect(attentionExcerpt('CodexBash', { command: 'rm -rf build' })).toBe('CodexBash: rm -rf build');
        expect(attentionExcerpt('mcp__x__y', {})).toBe('mcp__x__y');
    });
});
