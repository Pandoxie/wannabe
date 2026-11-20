import { describe, it, expect } from 'vitest';
import { OpenTurnTracker } from './openTurnTracker';

const env = (ev: Record<string, unknown>, turn?: string, extra: Record<string, unknown> = {}) =>
    ({ role: 'session', content: { role: 'agent', id: 'x', time: 1, ...(turn ? { turn } : {}), ...extra, ev } });

describe('closing what a killed session left open', () => {
    it('ends open tool calls and the open turn as cancelled', () => {
        const t = new OpenTurnTracker();
        t.observe(env({ t: 'turn-start' }, 'T1'));
        t.observe(env({ t: 'tool-call-start', call: 'a', name: 'Bash', title: '', description: '', args: {} }, 'T1'));
        t.observe(env({ t: 'tool-call-end', call: 'a' }, 'T1'));
        t.observe(env({ t: 'tool-call-start', call: 'b', name: 'Bash', title: '', description: '', args: {} }, 'T1'));
        t.observe(env({ t: 'tool-call-start', call: 'c', name: 'Read', title: '', description: '', args: {} }, 'T1', { subagent: 'ckopqwooh000001la8mbi2im9' }));
        const out = t.closing();
        expect(out.map((e) => [e.ev.t, (e.ev as any).call ?? (e.ev as any).status, e.turn, e.subagent])).toEqual([
            ['tool-call-end', 'b', 'T1', undefined],
            ['tool-call-end', 'c', 'T1', 'ckopqwooh000001la8mbi2im9'],
            ['turn-end', 'cancelled', 'T1', undefined],
        ]);
        expect(t.closing()).toEqual([]);
    });

    it('leaves finished turns alone and ignores user messages and other records', () => {
        const t = new OpenTurnTracker();
        t.observe(env({ t: 'turn-start' }, 'T1'));
        t.observe(env({ t: 'tool-call-start', call: 'a', name: 'Bash', title: '', description: '', args: {} }, 'T1'));
        t.observe(env({ t: 'turn-end', status: 'completed' }, 'T1'));
        t.observe({ role: 'user', content: { type: 'text', text: 'hi' } });
        t.observe({ role: 'session', content: { role: 'user', ev: { t: 'turn-start' }, turn: 'T2' } });
        t.observe(null);
        expect(t.closing()).toEqual([]);
    });
});
