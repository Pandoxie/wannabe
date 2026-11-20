import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAppSystemPrompt, OPTIONS_PROMPT, UPSTREAM_OPTIONS_PROMPT } from './appOptionsPrompt';

describe('the apps\' options prompt', () => {
    it('is the text our web sends, byte for byte', () => {
        const web = readFileSync(join(__dirname, '../../../happy-app/sources/sync/prompt/systemPrompt.ts'), 'utf8');
        const body = /trimIdent\(`([\s\S]*?)`\)/.exec(web)![1];
        expect(normalizeAppSystemPrompt(body)).toBe(OPTIONS_PROMPT);
        expect(normalizeAppSystemPrompt(UPSTREAM_OPTIONS_PROMPT)).toBe(OPTIONS_PROMPT);
    });

    it('leaves any other text alone', () => {
        expect(normalizeAppSystemPrompt('custom')).toBe('custom');
        expect(normalizeAppSystemPrompt(undefined)).toBeUndefined();
        expect(normalizeAppSystemPrompt(null)).toBeNull();
    });
});
