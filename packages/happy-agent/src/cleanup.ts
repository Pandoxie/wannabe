/**
 * Original Happy: `happy-agent cleanup` — what the relay keeps forever unless deleted:
 * computers that stopped coming online, and finished sessions. Uses the relay's own delete
 * endpoints (DELETE /v1/machines/:id, /v1/sessions/:id); the relay itself is unchanged.
 *
 * Rules (owner, 2026-11-18), every number a flag:
 * - a computer offline for more than `machineDays` (5);
 * - a finished session (archived, or no longer running) idle for more than
 *   `shortDays` (5) when it has fewer than `shortMessages` (30) stored messages — empty and
 *   short chats — and for more than `longDays` (50) otherwise.
 * A running session is never touched, nor a bot's (one continuous conversation), nor a side
 * chat (it goes with its parent). The "90 days for everything" rule is covered: nothing
 * finished survives 50 days, and a running session is active by definition.
 *
 * `seq` counts the session's stored messages, agent events included (a short exchange is
 * about 4–10), which is why "short" is 30 rather than a handful.
 */

export type CleanupRules = {
    machineDays: number;
    shortDays: number;
    longDays: number;
    shortMessages: number;
};

export const DEFAULT_RULES: CleanupRules = { machineDays: 5, shortDays: 5, longDays: 50, shortMessages: 30 };

export type CleanupMachine = { id: string; active: boolean; activeAt: number; metadata: unknown };
export type CleanupSession = { id: string; seq: number; active: boolean; activeAt: number; metadata: unknown };

export type PlannedMachine = { id: string; name: string; idleDays: number };
export type PlannedSession = { id: string; name: string; host: string; messages: number; idleDays: number; reason: 'short' | 'long' };

export type CleanupPlan = { machines: PlannedMachine[]; sessions: PlannedSession[]; kept: { running: number; recent: number; bots: number } };

const DAY = 24 * 60 * 60 * 1000;

function meta(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function sessionName(m: Record<string, unknown>): string {
    const summary = m.summary;
    if (typeof summary === 'string' && summary.trim()) return summary;
    if (summary && typeof summary === 'object') {
        const text = str((summary as Record<string, unknown>).text);
        if (text) return text;
    }
    return '(no title)';
}

export function planCleanup(
    machines: readonly CleanupMachine[],
    sessions: readonly CleanupSession[],
    rules: CleanupRules = DEFAULT_RULES,
    now: number = Date.now(),
): CleanupPlan {
    const idleDays = (activeAt: number) => Math.floor((now - activeAt) / DAY);
    const plan: CleanupPlan = { machines: [], sessions: [], kept: { running: 0, recent: 0, bots: 0 } };

    for (const machine of machines) {
        if (machine.active || now - machine.activeAt <= rules.machineDays * DAY) continue;
        const m = meta(machine.metadata);
        plan.machines.push({ id: machine.id, name: str(m.displayName) ?? str(m.host) ?? machine.id, idleDays: idleDays(machine.activeAt) });
    }

    for (const session of sessions) {
        const m = meta(session.metadata);
        if (m.bot || m.isSideChat) { plan.kept.bots += m.bot ? 1 : 0; continue; }
        const finished = m.lifecycleState === 'archived' || !session.active;
        if (!finished) { plan.kept.running++; continue; }
        const short = session.seq < rules.shortMessages;
        const limit = (short ? rules.shortDays : rules.longDays) * DAY;
        if (now - session.activeAt <= limit) { plan.kept.recent++; continue; }
        plan.sessions.push({
            id: session.id, name: sessionName(m), host: str(m.host) ?? '-',
            messages: session.seq, idleDays: idleDays(session.activeAt), reason: short ? 'short' : 'long',
        });
    }
    plan.machines.sort((a, b) => b.idleDays - a.idleDays);
    plan.sessions.sort((a, b) => b.idleDays - a.idleDays);
    return plan;
}

export function formatCleanupPlan(plan: CleanupPlan, rules: CleanupRules): string {
    const lines: string[] = ['## Cleanup', ''];
    lines.push(`Rules: computers offline > ${rules.machineDays} d; finished sessions idle > ${rules.shortDays} d with < ${rules.shortMessages} messages, > ${rules.longDays} d otherwise.`);
    lines.push('', `### Computers to delete: ${plan.machines.length}`);
    for (const m of plan.machines) lines.push(`- ${m.name} (offline ${m.idleDays} d) \`${m.id}\``);
    lines.push('', `### Sessions to delete: ${plan.sessions.length}`);
    for (const s of plan.sessions) {
        const name = s.name.length > 70 ? `${s.name.slice(0, 69)}…` : s.name;
        lines.push(`- ${name} — ${s.host}, ${s.messages} messages, idle ${s.idleDays} d (${s.reason}) \`${s.id}\``);
    }
    lines.push('', `Kept: ${plan.kept.running} running, ${plan.kept.recent} finished but recent, ${plan.kept.bots} bots.`);
    return lines.join('\n');
}
