import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { ToolView } from '@/components/tools/ToolView';
import type { ToolCall } from '@/sync/typesMessage';

// Original Happy: the happy MCP tools as the chat shows them (Claude and Codex forms), for rendering checks.
const now = Date.now();
const call = (name: string, input: unknown, result: unknown = 'ok'): ToolCall => ({
    name, state: 'completed', input, result, createdAt: now - 2000, startedAt: now - 1900, completedAt: now - 1000, description: null,
} as ToolCall);

const TOOLS: ToolCall[] = [
    call('mcp__happy__change_title', { title: 'stock-review-bot' }),
    call('mcp__happy__list_agents', {}),
    call('mcp__happy__send_to_agent', { to: 'mini-codex-coder-bot', text: '请跑一下 distill-saas 的单元测试，把失败的用例和原因发回给我。' }),
    call('McpTool', { server: 'happy', tool: 'send_to_agent', arguments: { to: 'ws-happy-claude-bot', text: '收到，测试全过（212 passed）。' } }),
    call('mcp__happy__notify_owner', { text: '复盘完成：持仓整体 +1.2%，NVDA 建议减仓' }),
    call('mcp__happy__schedule_task', { name: '股票复盘', prompt: '做今日复盘', cron: '35 15 * * 1-5', timezone: 'Asia/Shanghai' }),
    call('McpTool', { server: 'happy', tool: 'schedule_task', arguments: JSON.stringify({ name: '提醒开会', prompt: '提醒 owner 15 点开会', at: '2026-11-13 14:50' }) }),
    call('mcp__happy__list_tasks', {}),
    call('mcp__happy__delete_task', { id: 'task-1a2b3c4d' }),
    call('mcp__other__some_tool', { x: 1 }),
];

export default function HappyToolsDemo() {
    return (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
            {TOOLS.map((tool, i) => (
                <View key={i}>
                    <ToolView tool={tool} metadata={null} />
                </View>
            ))}
        </ScrollView>
    );
}
