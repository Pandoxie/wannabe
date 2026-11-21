import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, allCommands, commandPath, findCommand, type Command } from './registry';
import { helpLang, renderAll, renderCommand, renderMain, width, wrap } from './render';
import { helpRequest } from './cli';
import { staleCommandDocs } from './docs';

const packages = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function everyCommand(): { path: string[]; cmd: Command }[] {
    const out: { path: string[]; cmd: Command }[] = [];
    const walk = (path: string[], cmd: Command) => {
        out.push({ path, cmd });
        for (const sub of cmd.subcommands ?? []) walk([...path, sub.name], sub);
    };
    for (const cmd of allCommands()) walk([cmd.name], cmd);
    return out;
}

const CJK = /[一-鿿]/;

describe('command table', () => {
    it('is complete in English and Chinese', () => {
        for (const { path, cmd } of everyCommand()) {
            const texts = [cmd.text, cmd.more, ...(cmd.options ?? []).map((o) => o.text)].filter(Boolean);
            for (const text of texts) {
                expect(text!.en.trim(), path.join(' ')).not.toBe('');
                expect(CJK.test(text!.en), `${path.join(' ')}: Chinese in the English text`).toBe(false);
                expect(CJK.test(text!.zh), `${path.join(' ')}: no Chinese in "${text!.zh}"`).toBe(true);
            }
        }
        for (const group of GROUPS) expect(CJK.test(group.title.zh)).toBe(true);
    });

    it('has unique names at every level', () => {
        const check = (list: readonly Command[]) => {
            const names = list.map((c) => c.name);
            expect(new Set(names).size).toBe(names.length);
            for (const c of list) check(c.subcommands ?? []);
        };
        check(allCommands());
    });

    it('finds command paths, skipping options and their values', () => {
        expect(commandPath(['agent', 'send', 'abc', 'hi']).path).toEqual(['agent', 'send']);
        expect(commandPath(['cage', 'init', '--node', 'up', 'list'])).toEqual({ path: ['cage', 'init'], end: 2 });
        expect(commandPath(['--yolo']).path).toEqual([]);
        expect(commandPath(['cage', 'exec', '--', 'up']).path).toEqual(['cage', 'exec']);
        expect(findCommand(['agent', 'auth', 'login'])?.name).toBe('login');
        expect(findCommand(['nope'])).toBeUndefined();
    });

    it('mirrors happy-agent (its commander definitions)', () => {
        const src = readFileSync(join(packages, 'happy-agent', 'src', 'index.ts'), 'utf8');
        const blocks = src.split(/\n\s*\.command\('/).slice(1);
        const agent = findCommand(['agent'])!;
        const theirs = blocks.map((b) => b.slice(0, b.indexOf("'")));
        expect(agent.subcommands!.map((c) => c.name).sort()).toEqual(theirs.sort());
        for (const block of blocks) {
            const name = block.slice(0, block.indexOf("'"));
            const flags = [...block.matchAll(/\.(?:required)?[oO]ption\('(--[a-z-]+)/g)].map((m) => m[1]).sort();
            const ours = (findCommand(['agent', name])!.options ?? []).map((o) => o.flag).sort();
            expect(ours, `happy agent ${name}`).toEqual(flags);
        }
        const authSubs = [...src.matchAll(/new Command\('([a-z]+)'\)/g)].map((m) => m[1]);
        expect(findCommand(['agent', 'auth'])!.subcommands!.map((c) => c.name).sort()).toEqual(authSubs.sort());
    });

    it('mirrors happy-sandbox (its usage text and commands)', () => {
        const main = readFileSync(join(packages, 'happy-sandbox', 'cmd', 'happy-sandbox', 'main.go'), 'utf8');
        const usage = main.slice(main.indexOf('const usage = `'), main.indexOf('`\n', main.indexOf('const usage = `') + 20));
        const documented = new Set([...usage.matchAll(/^ {2}happy-sandbox ([a-z-]+)/gm)].map((m) => m[1]));
        const cage = findCommand(['cage'])!;
        const ours = cage.subcommands!.map((c) => c.name).filter((n) => !['install', 'update', 'uninstall'].includes(n));
        expect(ours.sort()).toEqual([...documented].sort());
        for (const name of ours) expect(main, name).toContain(`case "${name}"`);
        for (const flag of [...usage.matchAll(/--([a-z-]+)/g)].map((m) => `--${m[1]}`)) {
            const anywhere = everyCommand().some(({ path, cmd }) => path[0] === 'cage' && cmd.options?.some((o) => o.flag === flag));
            expect(anywhere, flag).toBe(true);
        }
    });
});

describe('help', () => {
    it('picks the language from HAPPY_LANG, then LC_ALL / LC_MESSAGES / LANG', () => {
        expect(helpLang({ LANG: 'zh_CN.UTF-8' })).toBe('zh');
        expect(helpLang({ LANG: 'en_US.UTF-8' })).toBe('en');
        expect(helpLang({ LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh');
        expect(helpLang({ HAPPY_LANG: 'en', LANG: 'zh_CN.UTF-8' })).toBe('en');
        expect(helpLang({})).toBe('en');
    });

    it('tells help requests from commands', () => {
        expect(helpRequest(['--help'])).toEqual([]);
        expect(helpRequest(['-h'])).toEqual([]);
        expect(helpRequest(['help'])).toEqual([]);
        expect(helpRequest(['help', 'all'])).toEqual(['all']);
        expect(helpRequest(['help', 'agent', 'send'])).toEqual(['agent', 'send']);
        expect(helpRequest(['codex', '--help'])).toEqual(['codex']);
        expect(helpRequest(['doctor', '--help'])).toEqual(['doctor']);
        expect(helpRequest(['daemon', 'help'])).toEqual(['daemon']);
        expect(helpRequest(['cage', 'up', '--help'])).toEqual(['cage', 'up']);
        expect(helpRequest(['cage'])).toEqual(['cage']);
        expect(helpRequest(['agent'])).toEqual(['agent']);
        expect(helpRequest(['--yolo', '--help'])).toEqual([]);
        expect(helpRequest(['claude', '--help'])).toEqual(['claude']);
        // not help
        expect(helpRequest([])).toBeNull();
        expect(helpRequest(['--yolo'])).toBeNull();
        expect(helpRequest(['update'])).toBeNull();
        expect(helpRequest(['fleet'])).toBeNull();
        expect(helpRequest(['cage', 'exec', '--', 'ls', '--help'])).toBeNull();
        expect(helpRequest(['agent', 'send', 'abc', 'help'])).toBeNull();
        expect(helpRequest(['resume', 'help'])).toBeNull();
    });

    it('renders every command in both languages', () => {
        for (const lang of ['en', 'zh'] as const) {
            const main = renderMain(lang, '1.0.0');
            for (const cmd of allCommands()) expect(main).toContain(cmd.name === 'claude' ? 'happy ' : `happy ${cmd.name}`);
            for (const { path } of everyCommand()) expect(renderCommand(path, lang), path.join(' ')).toBeTruthy();
            expect(renderAll(lang, '1.0.0')).toContain('happy cage');
        }
        expect(renderMain('zh', '1')).toContain('开始会话');
        expect(renderCommand(['agent'], 'en')).toContain('send <session-id> <message>');
    });

    it('keeps lines within the width (CJK counts double)', () => {
        expect(width('中文ab')).toBe(6);
        for (const line of wrap('一'.repeat(70), 100)) expect(width(line)).toBeLessThanOrEqual(100);
        expect(wrap('甲'.repeat(49) + '：乙', 100)[1]).toBe('乙');
        for (const lang of ['en', 'zh'] as const) {
            for (const line of renderAll(lang, '1').split('\n')) {
                if (!line.trimStart().startsWith('happy') && !/^\s*-/.test(line)) expect(width(line), line).toBeLessThanOrEqual(104);
            }
        }
    });

    it('docs/COMMANDS*.md are up to date (pnpm docs:commands)', () => {
        expect(staleCommandDocs()).toEqual([]);
    });
});
