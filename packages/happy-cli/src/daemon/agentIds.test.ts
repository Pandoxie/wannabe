import { describe, expect, it } from 'vitest';
import type { Metadata } from '@/api/types';
import { agentIdOf, applyAgentIds, withKnownAgentIds } from './agentIds';

const meta = (m: Partial<Metadata>) => ({ path: '/w', host: 'h', homeDir: '/h', happyHomeDir: '/h/.happy', happyLibDir: '', happyToolsDir: '', ...m }) as Metadata;

describe('agentIds', () => {
    it('reads the ID of the metadata’s own flavor only', () => {
        expect(agentIdOf(meta({ claudeSessionId: 'c1' }))).toEqual({ claudeSessionId: 'c1' });
        expect(agentIdOf(meta({ flavor: 'codex', claudeSessionId: 'c1', codexThreadId: 't1' }))).toEqual({ codexThreadId: 't1' });
        expect(agentIdOf(meta({ flavor: 'gemini', claudeSessionId: 'c1' }))).toEqual({});
        expect(agentIdOf(undefined)).toEqual({});
    });

    it('keeps a known ID when a resumed session reports itself without one', () => {
        const reported = meta({ hostPid: 2 });
        const spawnedWith = meta({ hostPid: 2, claudeSessionId: 'c1' });
        expect(withKnownAgentIds(reported, undefined, spawnedWith).claudeSessionId).toBe('c1');
        expect(withKnownAgentIds(meta({ claudeSessionId: 'c2' }), spawnedWith).claudeSessionId).toBe('c2');
        expect(withKnownAgentIds(meta({ flavor: 'codex' }), spawnedWith).codexThreadId).toBeUndefined();
    });

    it('applies a reported ID, null when nothing changes', () => {
        expect(applyAgentIds(meta({}), { claudeSessionId: 'c1' })?.claudeSessionId).toBe('c1');
        expect(applyAgentIds(meta({ claudeSessionId: 'c1' }), { claudeSessionId: 'c1' })).toBeNull();
        expect(applyAgentIds(meta({ flavor: 'codex' }), { claudeSessionId: 'c1' })).toBeNull();
        expect(applyAgentIds(meta({ flavor: 'codex', codexThreadId: 't1' }), { codexThreadId: 't2' })?.codexThreadId).toBe('t2');
    });
});
