import { describe, expect, it } from 'vitest';
import { createEnvelope } from '@slopus/happy-wire';
import { normalizeRawMessage } from './typesRaw';

// happy-cli sends Codex slash command replies (/help, /status, …) as an
// agent text envelope inside its own turn. Without the turn id the web
// dropped it (session protocol), which is how the replies once vanished.
describe('Codex slash command reply', () => {
    const raw = (envelope: unknown) => ({ role: 'session', content: envelope, meta: { sentFrom: 'cli' } });

    it('renders the reply text when it carries a turn', () => {
        const env = createEnvelope('agent', { t: 'text', text: '**Commands in this Codex session**' }, { turn: 'turn-1' });
        const out = normalizeRawMessage('m1', null, Date.now(), raw(env) as any);
        expect(out?.role).toBe('agent');
        expect(JSON.stringify(out?.content)).toContain('Commands in this Codex session');
    });

    it('drops the same reply without a turn (the bug)', () => {
        const env = createEnvelope('agent', { t: 'text', text: 'lost' });
        expect(normalizeRawMessage('m2', null, Date.now(), raw(env) as any)).toBeNull();
    });
});
