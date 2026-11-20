import { describe, expect, it, vi } from 'vitest';

describe('relay default', () => {
    it('is the Original Happy relay unless HAPPY_SERVER_URL or settings say otherwise', async () => {
        const saved = { url: process.env.HAPPY_SERVER_URL, home: process.env.HAPPY_HOME_DIR };
        const { mkdtempSync, writeFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        try {
            delete process.env.HAPPY_SERVER_URL;
            process.env.HAPPY_HOME_DIR = mkdtempSync(join(tmpdir(), 'happy-relay-'));
            vi.resetModules();
            expect((await import('./configuration')).configuration.serverUrl).toBe('https://api.cluster-fluster.com');
            expect((await import('./configuration')).configuration.webappUrl).toBe('https://pandoxie.github.io/wannabe');

            writeFileSync(join(process.env.HAPPY_HOME_DIR, 'settings.json'), JSON.stringify({ serverUrl: 'https://relay.example' }));
            vi.resetModules();
            expect((await import('./configuration')).configuration.serverUrl).toBe('https://relay.example');

            process.env.HAPPY_SERVER_URL = 'https://env.example';
            vi.resetModules();
            expect((await import('./configuration')).configuration.serverUrl).toBe('https://env.example');
        } finally {
            if (saved.url === undefined) delete process.env.HAPPY_SERVER_URL; else process.env.HAPPY_SERVER_URL = saved.url;
            if (saved.home === undefined) delete process.env.HAPPY_HOME_DIR; else process.env.HAPPY_HOME_DIR = saved.home;
            vi.resetModules();
        }
    });
});
