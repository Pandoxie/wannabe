import { describe, it, expect, vi } from 'vitest';

// The English strings, with their parameters filled in.
vi.mock('@/text', () => ({
    t: (key: string, p: Record<string, string> = {}) => ({
        'tools.happy.sendToAgent': `Message to ${p.to}`,
        'tools.happy.notifyOwner': 'Notified you',
        'tools.happy.listAgents': 'Checked which agents are online',
        'tools.happy.daily': `daily at ${p.time}`,
        'tools.happy.weekdays': `weekdays at ${p.time}`,
    } as Record<string, string>)[key] ?? key,
}));
import { describeCron, describeHappyMcpCall, parseHappyMcpCall } from './happyMcpTools';

describe('happy MCP tools in plain words', () => {
    it('recognises the Claude and Codex forms, and nothing else', () => {
        expect(parseHappyMcpCall({ name: 'mcp__happy__send_to_agent', input: { to: 'a', text: 'b' } } as any)).toEqual({ tool: 'send_to_agent', args: { to: 'a', text: 'b' } });
        expect(parseHappyMcpCall({ name: 'McpTool', input: { server: 'happy', tool: 'notify_owner', arguments: '{"text":"done"}' } } as any)).toEqual({ tool: 'notify_owner', args: { text: 'done' } });
        expect(parseHappyMcpCall({ name: 'McpTool', input: { server: 'other', tool: 'notify_owner' } } as any)).toBeNull();
        expect(parseHappyMcpCall({ name: 'mcp__happy__unknown', input: {} } as any)).toBeNull();
        expect(parseHappyMcpCall({ name: 'Bash', input: {} } as any)).toBeNull();
    });

    it('says what happened, with the message or schedule as detail', () => {
        expect(describeHappyMcpCall({ tool: 'send_to_agent', args: { to: 'mini', text: ' hi ' } })).toEqual({ title: 'Message to mini', detail: 'hi' });
        expect(describeHappyMcpCall({ tool: 'notify_owner', args: { text: '复盘完成' } })).toEqual({ title: 'Notified you', detail: '复盘完成' });
        expect(describeHappyMcpCall({ tool: 'schedule_task', args: { name: '复盘', cron: '35 15 * * 1-5', timezone: 'Asia/Shanghai' } }).detail).toBe('weekdays at 15:35 · Asia/Shanghai');
        expect(describeHappyMcpCall({ tool: 'list_agents', args: {} })).toEqual({ title: 'Checked which agents are online', detail: null });
    });

    it('reads common schedules', () => {
        expect(describeCron('0 9 * * *')).toBe('daily at 09:00');
        expect(describeCron('*/30 * * * *')).toBe('cron */30 * * * *');
    });
});
