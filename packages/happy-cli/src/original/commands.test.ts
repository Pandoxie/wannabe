import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORIGINAL_COMMANDS, distUrl, findOriginalCommand, findTool } from './commands';
import { findCommand } from './help/registry';

describe('Original Happy command table', () => {
    it('holds every subcommand we add, once', () => {
        const names = ORIGINAL_COMMANDS.map((c) => c.name);
        expect(names).toEqual(['update', 'egress', 'fleet', 'agent', 'cage', 'uninstall', 'completion']);
        expect(new Set(names).size).toBe(names.length);
        // upstream's `happy sandbox` (OS-level sandboxing) stays upstream's
        expect(findOriginalCommand('sandbox')).toBeUndefined();
        expect(findOriginalCommand(undefined)).toBeUndefined();
    });

    it('describes every one of them in the help table', () => {
        for (const c of ORIGINAL_COMMANDS) expect(findCommand([c.name]), c.name).toBeDefined();
    });

    it('finds a tool at its install path first, then on PATH', () => {
        const dir = mkdtempSync(join(tmpdir(), 'happy-tool-'));
        writeFileSync(join(dir, 'happy-sandbox'), '');
        expect(findTool([join(dir, 'happy-sandbox')], 'x', { PATH: '' })).toBe(join(dir, 'happy-sandbox'));
        expect(findTool(['/nonexistent/happy-sandbox'], 'happy-sandbox', { PATH: `/nonexistent:${dir}` })).toBe(join(dir, 'happy-sandbox'));
        expect(findTool(['/nonexistent/x'], 'x', { PATH: '/nonexistent' })).toBeNull();
    });
});

describe('distUrl', () => {
    it('takes HAPPY_DIST_URL, else the saved source, else the default', () => {
        const home = mkdtempSync(join(tmpdir(), 'dist-'));
        const fallback = distUrl({}, home);
        expect(typeof fallback).toBe('string'); // the build's default (may be empty)
        writeFileSync(join(home, 'url'), 'file:///srv/dist/\n');
        expect(distUrl({}, home)).toBe('file:///srv/dist');
        expect(distUrl({ HAPPY_DIST_URL: 'https://example.com/dist/' }, home)).toBe('https://example.com/dist');
    });
});
