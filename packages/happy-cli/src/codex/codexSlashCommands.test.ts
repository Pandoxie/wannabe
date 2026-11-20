import { describe, expect, it, vi } from 'vitest';
import { parseCodexSlashCommand, runCodexSlashCommand, type CodexSlashContext } from './codexSlashCommands';
import { isCodexClearText } from './codexClearCommand';

describe('parseCodexSlashCommand', () => {
    it.each([
        ['/status', { type: 'status' }],
        ['  /compact ', { type: 'compact' }],
        ['/mcp', { type: 'mcp' }],
        ['/help', { type: 'help' }],
        ['/model', { type: 'model' }],
        ['/model gpt-6.1-terra', { type: 'model', model: 'gpt-6.1-terra' }],
        ['/model gpt-6-astra HIGH', { type: 'model', model: 'gpt-6-astra', effort: 'high' }],
    ])('%s', (text, expected) => {
        expect(parseCodexSlashCommand(text)).toEqual(expected);
    });

    it.each([
        'please run /status', '/status now', '/compact the code', '/model a b c', '/model gpt-6-astra fast',
        '/review', '/my-skill do it', 'hello', '/clear', '/goal ship it',
    ])('passes %s through to the model or the existing handlers', (text) => {
        expect(parseCodexSlashCommand(text)).toBeNull();
    });

    it('treats /new like /clear', () => {
        expect(isCodexClearText('/new')).toBe(true);
        expect(isCodexClearText('/clear')).toBe(true);
        expect(isCodexClearText('/new idea')).toBe(false);
    });
});

const models = {
    data: [
        { model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
        { model: 'gpt-6.1-terra', displayName: 'GPT-6.1-Terra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
    ],
};

function ctx(overrides: Partial<CodexSlashContext> = {}): CodexSlashContext & { request: ReturnType<typeof vi.fn>; setModes: ReturnType<typeof vi.fn> } {
    return {
        request: vi.fn(async (method: string) => {
            if (method === 'model/list') return models;
            if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 }, planType: 'pro' } };
            if (method === 'mcpServerStatus/list') return { data: [{ name: 'happy', tools: { change_title: {} }, runtimeStatus: 'connected' }] };
            return {};
        }),
        threadId: 'thr-1',
        currentModel: 'gpt-6.1-sol',
        currentEffort: 'high',
        permissionMode: 'auto',
        cwd: '/w',
        codexVersion: '0.167.0',
        setModes: vi.fn(),
        ...overrides,
    } as any;
}

describe('runCodexSlashCommand', () => {
    it('/status shows modes and rate limits', async () => {
        const out = await runCodexSlashCommand({ type: 'status' }, ctx());
        expect(out).toContain('Model: gpt-6.1-sol, effort high');
        expect(out).toContain('Codex: 0.167.0');
        expect(out).toContain('5h limit: 12% used');
    });

    it('/status still answers when rate limits are unavailable', async () => {
        const c = ctx();
        c.request.mockImplementation(async (m: string) => { if (m === 'account/rateLimits/read') throw new Error('chatgpt authentication required'); return {}; });
        expect(await runCodexSlashCommand({ type: 'status' }, c)).toContain('- Rate limits: unavailable (chatgpt authentication required)');
    });

    it('/compact compacts the current thread', async () => {
        const c = ctx();
        await runCodexSlashCommand({ type: 'compact' }, c);
        expect(c.request).toHaveBeenCalledWith('thread/compact/start', { threadId: 'thr-1' });
        expect(await runCodexSlashCommand({ type: 'compact' }, ctx({ threadId: null }))).toBe('Nothing to compact yet.');
    });

    it('/model lists models and marks the current one', async () => {
        const out = await runCodexSlashCommand({ type: 'model' }, ctx());
        expect(out).toContain('- gpt-6.1-sol GPT-6.1-Sol — low/high ← current');
        expect(out).toContain('- gpt-6.1-terra');
    });

    it('/model <id> [effort] records the pick, upgrading an older id', async () => {
        const c = ctx();
        const out = await runCodexSlashCommand({ type: 'model', model: 'gpt-5.6-terra', effort: 'medium' }, c);
        expect(c.setModes).toHaveBeenCalledWith({ modelMode: 'gpt-6.1-terra', effortLevel: 'medium' });
        expect(out).toContain('Model set to gpt-6.1-terra, effort medium');
    });

    it('/model rejects an unknown model or an unsupported effort', async () => {
        const c = ctx();
        expect(await runCodexSlashCommand({ type: 'model', model: 'gpt-9-nope' }, c)).toContain('Unknown model');
        expect(await runCodexSlashCommand({ type: 'model', model: 'gpt-6.1-terra', effort: 'high' }, c)).toContain('does not support effort');
        expect(c.setModes).not.toHaveBeenCalled();
    });

    it('/mcp lists servers and tools', async () => {
        expect(await runCodexSlashCommand({ type: 'mcp' }, ctx())).toContain('- happy (connected): change_title');
    });
});
