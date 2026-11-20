/**
 * Original Happy: the happy MCP tools (happy-cli src/claude/utils/happyTools.ts)
 * in plain words. Claude reports them as `mcp__happy__<tool>` with the
 * arguments as input; Codex as `McpTool` with `{ server: 'happy', tool, arguments }`.
 */
import type { ToolCall } from '@/sync/typesMessage';
import { t } from '@/text';

export const HAPPY_MCP_TOOLS = ['change_title', 'list_agents', 'send_to_agent', 'notify_owner', 'schedule_task', 'list_tasks', 'delete_task'] as const;
export type HappyMcpTool = typeof HAPPY_MCP_TOOLS[number];

export type HappyMcpCall = { tool: HappyMcpTool; args: Record<string, unknown> };

const isHappyTool = (name: unknown): name is HappyMcpTool => typeof name === 'string' && (HAPPY_MCP_TOOLS as readonly string[]).includes(name);

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
        try { return asRecord(JSON.parse(value)); } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseHappyMcpCall(tool: Pick<ToolCall, 'name' | 'input'>): HappyMcpCall | null {
    const claude = /^mcp__happy__(.+)$/.exec(tool.name);
    if (claude && isHappyTool(claude[1])) return { tool: claude[1], args: asRecord(tool.input) };
    if (tool.name === 'McpTool') {
        const input = asRecord(tool.input);
        if (input.server === 'happy' && isHappyTool(input.tool)) return { tool: input.tool, args: asRecord(input.arguments) };
    }
    return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** "35 15 * * *" → daily 15:35, "35 15 * * 1-5" → weekdays 15:35; anything else as written. */
export function describeCron(cron: string): string {
    const f = cron.split(/\s+/);
    if (f.length === 5 && /^\d{1,2}$/.test(f[0]) && /^\d{1,2}$/.test(f[1]) && f[2] === '*' && f[3] === '*') {
        const time = `${f[1].padStart(2, '0')}:${f[0].padStart(2, '0')}`;
        if (f[4] === '*') return t('tools.happy.daily', { time });
        if (f[4] === '1-5') return t('tools.happy.weekdays', { time });
    }
    return `cron ${cron}`;
}

/** One line for the tool's header, and the detail under it (the message, the schedule…). */
export function describeHappyMcpCall(call: HappyMcpCall): { title: string; detail: string | null } {
    const a = call.args;
    switch (call.tool) {
        case 'change_title':
            return { title: t('tools.happy.changeTitle', { title: str(a.title) }), detail: null };
        case 'list_agents':
            return { title: t('tools.happy.listAgents'), detail: null };
        case 'send_to_agent':
            return { title: t('tools.happy.sendToAgent', { to: str(a.to) || '?' }), detail: str(a.text) || null };
        case 'notify_owner':
            return { title: t('tools.happy.notifyOwner'), detail: str(a.text) || null };
        case 'schedule_task': {
            const when = str(a.cron) ? describeCron(str(a.cron)) : str(a.at) ? t('tools.happy.onceAt', { at: str(a.at) }) : '';
            const tz = str(a.timezone);
            return { title: t('tools.happy.scheduleTask', { name: str(a.name) || '?' }), detail: [when, tz].filter(Boolean).join(' · ') || null };
        }
        case 'list_tasks':
            return { title: t('tools.happy.listTasks'), detail: null };
        case 'delete_task':
            return { title: t('tools.happy.deleteTask', { id: str(a.id) || '?' }), detail: null };
    }
}
