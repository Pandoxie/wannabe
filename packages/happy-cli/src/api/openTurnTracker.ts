/**
 * Original Happy: close what a killed process left open.
 *
 * A session restarted in place (happy update, restart-sessions) is killed
 * mid-turn: the apps already have a turn-start and tool-call-starts whose
 * turn-end / tool-call-end never comes, so a tool spins and its clock counts
 * forever (web and upstream iOS alike). On reconnect the CLI reads the
 * session's past messages anyway (to skip them); this tracker remembers what
 * they leave open, and the CLI closes it — tool calls first, then the turn,
 * as cancelled — before the session goes on.
 */
import { createEnvelope, type SessionEnvelope } from '@slopus/happy-wire';

type Open = { turn: string; subagent?: string };

export class OpenTurnTracker {
    private readonly turns = new Set<string>();
    private readonly calls = new Map<string, Open>();

    /** A decrypted message record of this session. */
    observe(record: unknown): void {
        const r = record as { role?: unknown; content?: unknown };
        if (r?.role !== 'session' || !r.content || typeof r.content !== 'object') return;
        const env = r.content as { role?: unknown; turn?: unknown; subagent?: unknown; ev?: { t?: unknown; call?: unknown } };
        if (env.role !== 'agent' || !env.ev) return;
        const turn = typeof env.turn === 'string' ? env.turn : null;
        const subagent = typeof env.subagent === 'string' ? env.subagent : undefined;
        switch (env.ev.t) {
            case 'turn-start':
                if (turn) this.turns.add(turn);
                break;
            case 'turn-end':
                if (turn) {
                    this.turns.delete(turn);
                    for (const [call, open] of this.calls) if (open.turn === turn) this.calls.delete(call);
                }
                break;
            case 'tool-call-start':
                if (turn && typeof env.ev.call === 'string') this.calls.set(env.ev.call, { turn, subagent });
                break;
            case 'tool-call-end':
                if (typeof env.ev.call === 'string') this.calls.delete(env.ev.call);
                break;
        }
    }

    /** Envelopes that close everything still open: tool calls, then turns (cancelled). */
    closing(): SessionEnvelope[] {
        const out: SessionEnvelope[] = [];
        for (const [call, open] of this.calls) {
            out.push(createEnvelope('agent', { t: 'tool-call-end', call }, { turn: open.turn, ...(open.subagent ? { subagent: open.subagent } : {}) }));
        }
        const turns = new Set([...this.turns, ...[...this.calls.values()].map((o) => o.turn)]);
        for (const turn of turns) out.push(createEnvelope('agent', { t: 'turn-end', status: 'cancelled' }, { turn }));
        this.turns.clear();
        this.calls.clear();
        return out;
    }
}
