import { describe, expect, it } from 'vitest';
import { upgradeModelCommand, upgradeModelId } from './modelUpgrade';

describe('upgradeModelId', () => {
    it.each([
        // The native iOS table (upstream AgentDefaults.swift, 2026-10)
        ['claude-fable-5-1', 'claude-fable-5-2'],
        ['claude-fable-5', 'claude-fable-5-2'],
        ['claude-opus-5', 'claude-opus-5-5'],
        ['gpt-6-sol', 'gpt-6.2-sol'],
        ['gpt-6.1-sol', 'gpt-6.2-sol'],
        ['gpt-6-astra', 'gpt-6.2-astra'],
        ['gpt-5.6-sol', 'gpt-6.2-sol'],
        ['gpt-5.6-terra', 'gpt-6.1-terra'],
        ['gpt-5.6-luna', 'gpt-6-luna'],
        // Older generations
        ['claude-sonnet-4-5', 'claude-sonnet-5-5'],
        ['claude-haiku-4-5', 'claude-haiku-5-5'],
        ['claude-opus-4-1', 'claude-opus-5-5'],
    ])('%s → %s', (from, to) => {
        expect(upgradeModelId(from)).toBe(to);
    });

    it.each([
        'claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
        'gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna',
    ])('leaves the newest %s alone', (id) => {
        expect(upgradeModelId(id)).toBe(id);
    });

    it('never downgrades a model newer than the table', () => {
        expect(upgradeModelId('claude-opus-5-6')).toBe('claude-opus-5-6');
        expect(upgradeModelId('claude-opus-6')).toBe('claude-opus-6');
        expect(upgradeModelId('gpt-6.3-sol')).toBe('gpt-6.3-sol');
        expect(upgradeModelId('gpt-7-luna')).toBe('gpt-7-luna');
    });

    it('keeps a suffix and upgrades the version under it', () => {
        expect(upgradeModelId('claude-opus-5-5-dev')).toBe('claude-opus-5-5-dev');
        expect(upgradeModelId('claude-opus-5-dev')).toBe('claude-opus-5-5-dev');
        expect(upgradeModelId('claude-fable-5-1-preview')).toBe('claude-fable-5-2-preview');
        expect(upgradeModelId('gpt-5.6-terra-dev')).toBe('gpt-6.1-terra-dev');
    });

    it('drops what belonged to the old version: dated snapshot and [1m]', () => {
        expect(upgradeModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-5-5');
        expect(upgradeModelId('claude-opus-5[1m]')).toBe('claude-opus-5-5');
        expect(upgradeModelId('claude-sonnet-4-5-20250929-dev')).toBe('claude-sonnet-5-5-dev');
    });

    it('keeps [1m] when the model is already the newest', () => {
        expect(upgradeModelId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5[1m]');
    });

    it('maps bare Claude Code aliases to the newest id', () => {
        expect(upgradeModelId('sonnet')).toBe('claude-sonnet-5-5');
        expect(upgradeModelId('opus')).toBe('claude-opus-5-5');
        expect(upgradeModelId('opus[1m]')).toBe('claude-opus-5-5');
        expect(upgradeModelId('haiku')).toBe('claude-haiku-5-5');
        expect(upgradeModelId('fable')).toBe('claude-fable-5-2');
    });

    it('passes unknown ids through', () => {
        for (const id of ['default', 'gpt-5-codex', 'o4-mini', 'claude-instant-1', 'my-proxy-model', '']) {
            expect(upgradeModelId(id)).toBe(id);
        }
    });
});

describe('upgradeModelCommand', () => {
    it('upgrades the id in /model and keeps the rest', () => {
        expect(upgradeModelCommand('/model claude-fable-5-1')).toBe('/model claude-fable-5-2');
        expect(upgradeModelCommand('/model claude-opus-5-dev')).toBe('/model claude-opus-5-5-dev');
        expect(upgradeModelCommand('  /model  gpt-5.6-sol and more')).toBe('  /model  gpt-6.2-sol and more');
    });

    it('leaves other text alone', () => {
        expect(upgradeModelCommand('/model claude-opus-5-5-dev')).toBe('/model claude-opus-5-5-dev');
        expect(upgradeModelCommand('use claude-opus-5 please')).toBe('use claude-opus-5 please');
        expect(upgradeModelCommand('/models claude-opus-5')).toBe('/models claude-opus-5');
    });
});

describe('incoming user messages', () => {
    it('upgrades meta.model and /model text, leaves the rest', async () => {
        const { upgradeUserMessageModel } = await import('@/api/apiSession');
        const message = {
            role: 'user' as const,
            content: { type: 'text' as const, text: '/model claude-fable-5-1' },
            localKey: 'k',
            meta: { model: 'gpt-5.6-terra', permissionMode: 'auto' as any, effortLevel: 'high' } as any,
        };
        const out = upgradeUserMessageModel(message);
        expect(out.meta?.model).toBe('gpt-6.1-terra');
        expect((out.meta as any).permissionMode).toBe('auto');
        expect((out.meta as any).effortLevel).toBe('high');
        expect(out.content.text).toBe('/model claude-fable-5-2');
        expect(out.localKey).toBe('k');
        // The original is not mutated.
        expect(message.meta.model).toBe('gpt-5.6-terra');
    });

    it('returns the same object when nothing changes', async () => {
        const { upgradeUserMessageModel } = await import('@/api/apiSession');
        const message = { role: 'user' as const, content: { type: 'text' as const, text: 'hi' }, meta: { model: 'claude-opus-5-5' } as any };
        expect(upgradeUserMessageModel(message)).toBe(message);
    });
});
