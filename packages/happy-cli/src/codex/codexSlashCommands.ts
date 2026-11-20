/**
 * Slash commands for Codex sessions started from the apps (Original Happy).
 *
 * Claude Code runs its own slash commands (`/context`, `/model`, …) when it
 * gets them as text, so happy-cli just passes them through. The Codex
 * app-server does not: every message is a model turn. These commands are
 * handled here instead, with the app-server methods behind the Codex TUI's
 * commands. `/clear` (and `/new`, codexClearCommand.ts) and `/goal` are
 * handled in runCodex.ts as before;
 * anything else (including skills) still goes to the model.
 */

import { upgradeModelId } from '@/utils/modelUpgrade';

export type CodexSlashCommand =
    | { type: 'help' }
    | { type: 'status' }
    | { type: 'compact' }
    | { type: 'mcp' }
    | { type: 'model'; model?: string; effort?: string };

export const CODEX_SLASH_COMMANDS = ['compact', 'status', 'model', 'mcp', 'new', 'clear', 'goal', 'help'] as const;

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function parseCodexSlashCommand(text: string): CodexSlashCommand | null {
    const match = /^\s*\/([a-z]+)(?:\s+([\s\S]*?))?\s*$/i.exec(text);
    if (!match) return null;
    const name = match[1].toLowerCase();
    const rest = (match[2] ?? '').trim();
    switch (name) {
        case 'help':
            return rest ? null : { type: 'help' };
        case 'status':
            return rest ? null : { type: 'status' };
        case 'compact':
            return rest ? null : { type: 'compact' };
        case 'mcp':
            return rest ? null : { type: 'mcp' };
        case 'model': {
            if (!rest) return { type: 'model' };
            const [model, effort, ...extra] = rest.split(/\s+/);
            if (extra.length > 0) return null;
            if (effort && !EFFORTS.has(effort.toLowerCase())) return null;
            return { type: 'model', model, ...(effort ? { effort: effort.toLowerCase() } : {}) };
        }
        default:
            return null;
    }
}

/** What the handler needs from the session, the app-server and the current modes. */
export type CodexSlashContext = {
    request: (method: string, params?: unknown) => Promise<unknown>;
    threadId: string | null;
    currentModel?: string;
    currentEffort?: string;
    permissionMode?: string;
    cwd: string;
    codexVersion?: string;
    /** Record the picked model / effort so every app shows and sends it. */
    setModes: (modes: { modelMode?: string; effortLevel?: string }) => void;
};

type RateWindow = { usedPercent?: number; windowDurationMins?: number | null; resetsAt?: number | null } | null | undefined;
type RateSnapshot = { primary?: RateWindow; secondary?: RateWindow; planType?: string | null; limitName?: string | null } | null | undefined;

function formatWindow(label: string, w: RateWindow): string | null {
    if (!w || typeof w.usedPercent !== 'number') return null;
    const span = w.windowDurationMins
        ? (w.windowDurationMins >= 1440 ? `${Math.round(w.windowDurationMins / 1440)}d` : `${Math.round(w.windowDurationMins / 60)}h`)
        : label;
    const reset = w.resetsAt ? `, resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : '';
    return `  ${span} limit: ${w.usedPercent}% used${reset}`;
}

async function listModels(ctx: CodexSlashContext): Promise<Array<{ model: string; displayName?: string; supportedReasoningEfforts?: Array<{ reasoningEffort?: string } | string> }>> {
    const res = await ctx.request('model/list', {}) as { data?: any[] };
    return Array.isArray(res?.data) ? res.data : [];
}

/** Runs a command and returns the text to show in the chat. */
export async function runCodexSlashCommand(command: CodexSlashCommand, ctx: CodexSlashContext): Promise<string> {
    switch (command.type) {
        case 'help':
            return [
                'Commands in this Codex session:',
                '',
                '- /help — this list',
                '- /status — model, effort, permissions, Codex version, rate limits',
                '- /model — list models',
                '- /model <id> [effort] — switch model (and effort); an older id becomes the newest of its tier, and every app shows the model in use',
                '- /compact — summarize the conversation to free context',
                '- /new or /clear — start a new conversation',
                '- /mcp — MCP servers and their tools',
                '- /goal <objective> — set a goal; /goal clear',
                '',
                'Skills are run by Codex. Anything else is sent to Codex as a message.',
            ].join('\n');

        case 'status': {
            const lines = [
                'Status:',
                '',
                `- Model: ${ctx.currentModel ?? 'default'}${ctx.currentEffort ? `, effort ${ctx.currentEffort}` : ''}`,
                `- Permissions: ${ctx.permissionMode ?? 'default'}`,
                `- Directory: ${ctx.cwd}`,
                `- Codex: ${ctx.codexVersion ?? 'unknown'}`,
                `- Thread: ${ctx.threadId ?? 'none yet'}`,
            ];
            try {
                const res = await ctx.request('account/rateLimits/read', {}) as { rateLimits?: RateSnapshot; rateLimitsByLimitId?: Record<string, RateSnapshot> | null };
                const snapshots = res?.rateLimitsByLimitId && Object.keys(res.rateLimitsByLimitId).length > 0
                    ? Object.entries(res.rateLimitsByLimitId)
                    : [['', res?.rateLimits] as [string, RateSnapshot]];
                for (const [id, snap] of snapshots) {
                    if (!snap) continue;
                    const header = [snap.limitName ?? id, snap.planType ? `plan ${snap.planType}` : ''].filter(Boolean).join(', ');
                    const windows = [formatWindow('primary', snap.primary), formatWindow('secondary', snap.secondary)].filter(Boolean);
                    if (windows.length) lines.push(`- Rate limits${header ? ` (${header})` : ''}:`, ...windows as string[]);
                }
            } catch (error) {
                lines.push(`- Rate limits: unavailable (${error instanceof Error ? error.message : String(error)})`);
            }
            return lines.join('\n');
        }

        case 'compact': {
            if (!ctx.threadId) return 'Nothing to compact yet.';
            await ctx.request('thread/compact/start', { threadId: ctx.threadId });
            return 'Compacting the conversation…';
        }

        case 'mcp': {
            const res = await ctx.request('mcpServerStatus/list', {}) as { data?: Array<{ name: string; tools?: Record<string, unknown>; runtimeStatus?: unknown; authStatus?: unknown }> };
            const servers = Array.isArray(res?.data) ? res.data : [];
            if (servers.length === 0) return 'No MCP servers configured.';
            return ['MCP servers:', '', ...servers.map((s) => {
                const tools = Object.keys(s.tools ?? {});
                const status = typeof s.runtimeStatus === 'string' ? s.runtimeStatus : (s.runtimeStatus as any)?.type ?? '';
                return `- ${s.name}${status ? ` (${status})` : ''}: ${tools.length ? tools.join(', ') : 'no tools'}`;
            })].join('\n');
        }

        case 'model': {
            const models = await listModels(ctx).catch(() => []);
            if (!command.model) {
                if (models.length === 0) return `Model: ${ctx.currentModel ?? 'default'} (model list unavailable)`;
                return ['Models (/model <id> [effort]):', '', ...models.map((m) => {
                    const efforts = (m.supportedReasoningEfforts ?? []).map((e) => typeof e === 'string' ? e : e.reasoningEffort).filter(Boolean);
                    const current = m.model === ctx.currentModel ? ' ← current' : '';
                    return `- ${m.model}${m.displayName && m.displayName !== m.model ? ` ${m.displayName}` : ''}${efforts.length ? ` — ${efforts.join('/')}` : ''}${current}`;
                })].join('\n');
            }
            const model = upgradeModelId(command.model);
            const known = models.find((m) => m.model === model);
            if (models.length > 0 && !known) {
                return `Unknown model "${command.model}". Send /model for the list.`;
            }
            if (command.effort && known?.supportedReasoningEfforts?.length) {
                const efforts = known.supportedReasoningEfforts.map((e) => typeof e === 'string' ? e : e.reasoningEffort);
                if (!efforts.includes(command.effort)) {
                    return `${model} does not support effort "${command.effort}" (${efforts.join('/')}).`;
                }
            }
            ctx.setModes({ modelMode: model, ...(command.effort ? { effortLevel: command.effort } : {}) });
            const upgraded = model !== command.model ? ` (${command.model} is replaced by the newest of its tier)` : '';
            return `Model set to ${model}${command.effort ? `, effort ${command.effort}` : ''}${upgraded}. Takes effect from the next message.`;
        }
    }
}
