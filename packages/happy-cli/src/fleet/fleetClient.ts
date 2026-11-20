/**
 * Original Happy: the agents of one account find and message each other
 * through the fleet hub (packages/happy-fleet, `happy fleet on`), called
 * over the relay's per-account RPC. Wire format: happy-fleet protocol.mjs.
 */
import { randomBytes } from 'node:crypto';
import type { ApiSessionClient } from '@/api/apiSession';

export const FLEET_RPC_METHOD = 'original-happy-fleet';

export type FleetAgent = { name: string | null; session: string; agent: string; host: string | null; path: string | null; state: 'busy' | 'idle'; duplicateName?: boolean };
export type FleetAnswer = { ok: true; [key: string]: any } | { ok: false; error: string };

const HUB_DOWN = 'The fleet hub is not running for this account, so sessions cannot reach each other or schedule tasks right now. '
    + 'The user switches it on with: happy fleet on';

export type FleetRequest =
    | { op: 'list' }
    | { op: 'send'; to: string; text: string }
    | { op: 'task.create'; name: string; prompt: string; cron?: string; at?: string; timezone?: string }
    | { op: 'task.list' }
    | { op: 'task.delete'; id: string };

export type FleetTask = { id: string; name: string; schedule: string; next: string | null; lastRun: string | null; state: string; prompt: string };

export function formatTask(t: FleetTask): string {
    return `- ${t.id} "${t.name}" — ${t.schedule}; next ${t.next ?? 'none'}${t.lastRun ? `; last ${t.lastRun}` : ''}; ${t.state}\n  prompt: ${t.prompt.length > 200 ? t.prompt.slice(0, 197) + '…' : t.prompt}`;
}

export async function fleetRequest(session: Pick<ApiSessionClient, 'callSealedRpc'>, body: FleetRequest): Promise<FleetAnswer> {
    const r = await session.callSealedRpc(FLEET_RPC_METHOD, { ...body, ts: Date.now(), nonce: randomBytes(12).toString('hex') });
    if (!r.ok) return { ok: false, error: /not available|timeout/i.test(r.error) ? HUB_DOWN : `Fleet request failed: ${r.error}` };
    const a = r.result;
    if (a && typeof a === 'object' && typeof a.ok === 'boolean') return a.ok ? a : { ok: false, error: String(a.error ?? 'refused') };
    return { ok: false, error: 'Fleet hub gave an unreadable answer.' };
}

export function formatAgents(a: { you?: { name: string | null; session: string }; agents: FleetAgent[] }): string {
    const lines = a.agents.map((x) => `- ${x.name ? `"${x.name}"` : '(untitled)'}${x.duplicateName ? ' (name shared; use the session id)' : ''}`
        + ` — ${x.agent}, ${[x.host, x.path].filter(Boolean).join(':')}, ${x.state}, session ${x.session}`);
    const you = a.you ? `You are ${a.you.name ? `"${a.you.name}"` : '(untitled)'} (session ${a.you.session}).\n` : '';
    return `${you}${lines.length ? `Agents online:\n${lines.join('\n')}` : 'No other agents are online.'}`;
}
