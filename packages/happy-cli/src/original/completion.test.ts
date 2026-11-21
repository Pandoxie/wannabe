import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RC_MARK, bashScript, rcFiles, withRcLine, withoutRcLine, zshScript } from './completion';

const home = mkdtempSync(join(tmpdir(), 'happy-completion-'));
mkdirSync(join(home, '.happy'), { recursive: true });
writeFileSync(join(home, '.happy', 'sessions.json'), JSON.stringify({
    sessions: {
        cold111: { savedAt: 1, metadata: { path: '/a' } },
        hot2222: { savedAt: 1, lastAliveAt: 9, metadata: { path: '/b', flavor: 'codex' } },
    },
}));
for (const name of ['1', '2']) {
    mkdirSync(join(home, '.happy-sandbox', name), { recursive: true });
    writeFileSync(join(home, '.happy-sandbox', name, 'config.json'), '{}');
}
const script = join(home, 'happy.bash');
writeFileSync(script, bashScript('1.0.0', 'en'));

/** What bash completes for `line` (the cursor at its end). */
function complete(line: string): string[] {
    const words = line.split(' ');
    const program = `source ${JSON.stringify(script)}
COMP_WORDS=(${words.map((w) => `'${w}'`).join(' ')}); COMP_CWORD=${words.length - 1}
_happy; printf '%s\\n' "\${COMPREPLY[@]}"`;
    const r = spawnSync('bash', ['--norc', '-c', program], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
    expect(r.stderr).toBe('');
    return r.stdout.split('\n').filter(Boolean);
}

const hasBash = spawnSync('bash', ['--version']).status === 0;

describe.skipIf(!hasBash)('bash completion', () => {
    it('completes commands and nested subcommands', () => {
        expect(complete('happy ag')).toEqual(['agent']);
        expect(complete('happy c')).toEqual(expect.arrayContaining(['claude', 'codex', 'cage', 'completion', 'connect']));
        expect(complete('happy agent s')).toEqual(['status', 'spawn', 'send', 'stop']);
        expect(complete('happy agent auth l')).toEqual(['login', 'logout']);
        expect(complete('happy cage share ')).toEqual(['list', 'add', 'rm']);
        expect(complete('happy daemon ')).not.toContain('start-sync');
    });

    it('completes options, inherited ones too, and fixed values', () => {
        expect(complete('happy --yo')).toEqual(['--yolo']);
        expect(complete('happy agent spawn --a')).toEqual(['--agent']);
        expect(complete('happy agent spawn --agent ')).toEqual(['claude', 'codex']);
        expect(complete('happy cage destroy --')).toEqual(['--yes']);
        expect(complete('happy codex --effort x')).toEqual(['xhigh']);
    });

    it('completes session ids (newest first) and sandbox names', () => {
        expect(complete('happy resume ')).toEqual(['hot2222', 'cold111']);
        expect(complete('happy agent send h')).toEqual(['hot2222']);
        expect(complete('happy cage status ')).toEqual(['1', '2']);
        expect(complete('happy cage up 2')).toEqual(['2']);
    });

    it('skips option values and stops at --', () => {
        expect(complete('happy cage init --node x.yaml ')).toEqual([]);
        expect(complete('happy cage sh')).toEqual(['shell', 'share']);
        expect(complete('happy agent send abc ')).toEqual([]);
    });
});

describe('zsh script', () => {
    it('parses (zsh -n) and carries descriptions', () => {
        const text = zshScript('1.0.0', 'zh');
        expect(text).toContain('send:给会话发消息');
        if (spawnSync('zsh', ['--version']).status !== 0) return;
        const file = join(home, 'happy.zsh');
        writeFileSync(file, text);
        expect(spawnSync('zsh', ['-n', file], { encoding: 'utf8' }).stderr).toBe('');
    });
});

describe('rc line', () => {
    it('is added once, replaced, and removed', () => {
        const line = `[ -f x ] && . x ${RC_MARK}`;
        const once = withRcLine('alias ll=ls', line);
        expect(once).toBe(`alias ll=ls\n${line}\n`);
        expect(withRcLine(once, line)).toBe(once);
        expect(withoutRcLine(once)).toBe('alias ll=ls\n');
    });

    it('goes into the rc files that exist, and the login shell\'s', () => {
        expect(rcFiles('/h', '/bin/zsh', () => false)).toEqual([{ shell: 'zsh', file: '/h/.zshrc' }]);
        expect(rcFiles('/h', '/bin/bash', (p) => p === '/h/.zshrc').map((r) => r.shell)).toEqual(['bash', 'zsh']);
    });
});
