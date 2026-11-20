/**
 * Original Happy: help text and docs/COMMANDS*.md from the command table
 * (registry.ts). Language: HAPPY_LANG, else LC_ALL / LC_MESSAGES / LANG;
 * Chinese for zh*, English otherwise.
 */
import { CLAUDE, GROUPS, findCommand, type Command, type Lang, type Option, type Text } from './registry';

export function helpLang(env: NodeJS.ProcessEnv = process.env): Lang {
    const pick = env.HAPPY_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
    return /^zh/i.test(pick) ? 'zh' : 'en';
}

type Style = { bold: (s: string) => string; dim: (s: string) => string };
const plain: Style = { bold: (s) => s, dim: (s) => s };

const L = {
    usage: { en: 'Usage', zh: '用法' },
    commands: { en: 'Commands', zh: '命令' },
    options: { en: 'Options', zh: '选项' },
    examples: { en: 'Examples', zh: '示例' },
    command: { en: '<command>', zh: '<命令>' },
    optionsArg: { en: '[options]', zh: '[选项]' },
    tagline: {
        en: 'happy — Claude Code and Codex you can follow and steer from your phone and the web',
        zh: 'happy — 在手机和网页上跟进、操控 Claude Code 和 Codex',
    },
    oneCommand: { en: 'one command in detail', zh: '查看单个命令的详细说明' },
    footer: {
        en: [
            'Claude Code options (all of them work with happy): happy help claude',
            'Everything on one page: happy help all   (also ~/.happy-dist/COMMANDS.md)',
            'Tab completion: happy completion install   (Chinese help: HAPPY_LANG=zh)',
        ],
        zh: [
            'Claude Code 自己的选项（happy 全部支持）：happy help claude',
            '全部命令一页看完：happy help all   （也在 ~/.happy-dist/COMMANDS.md）',
            'Tab 补全：happy completion install   （英文帮助：HAPPY_LANG=en）',
        ],
    },
    unknown: { en: 'Unknown command', zh: '没有这个命令' },
} satisfies Record<string, Text | { en: string[]; zh: string[] }>;

/** Display width: CJK and full-width characters take two columns. */
export function width(s: string): number {
    let w = 0;
    for (const ch of s) {
        const c = ch.codePointAt(0)!;
        w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
    }
    return w;
}

function pad(s: string, n: number): string {
    return s + ' '.repeat(Math.max(0, n - width(s)));
}

/** Wrap at `max` columns; CJK text breaks anywhere, other text at spaces. */
export function wrap(text: string, max: number): string[] {
    const lines: string[] = [];
    let line = '';
    const tokens = text.match(/[ᄀ-￿]|[^\sᄀ-￿]+|\s+/g) ?? [];
    for (const token of tokens) {
        if (/^\s+$/.test(token)) {
            if (line) line += ' ';
            continue;
        }
        // CJK punctuation never starts a line.
        if (line && width(line) + width(token) > max && !/^[，。、：；！？）」』】》,.:;!?)]$/.test(token)) {
            lines.push(line.trimEnd());
            line = '';
        }
        line += token;
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
}

const WIDTH = 100;

/** Two columns: `left` padded to `col`, or alone on its line when longer. */
function row(indent: string, left: string, right: string, col: number): string[] {
    const rightLines = wrap(right, Math.max(30, WIDTH - indent.length - col));
    if (width(left) >= col - 1) {
        return [indent + left, ...rightLines.map((l) => indent + ' '.repeat(col) + l)];
    }
    return rightLines.map((l, i) => indent + (i === 0 ? pad(left, col) : ' '.repeat(col)) + l);
}

function optionLabel(o: Option): string {
    const flags = o.alias ? `${o.alias}, ${o.flag}` : o.flag;
    return o.value ? `${flags} ${o.value}` : flags;
}

function commandWords(path: readonly string[]): string[] {
    return ['happy', ...(path[0] === 'claude' ? path.slice(1) : path)];
}

/** `happy agent send <session-id> <message>`; `happy agent <command>` when it has subcommands. */
export function usageOf(path: readonly string[], cmd: Command, lang: Lang): string {
    const words = commandWords(path);
    const hasSubs = !!cmd.subcommands?.some((s) => !s.hidden);
    if (hasSubs && cmd.args) words.push(`[${L.command[lang]} | ${cmd.args.replace(/^\[|\]$/g, '')}]`);
    else if (hasSubs) words.push(L.command[lang]);
    else if (cmd.args) words.push(cmd.args === '[options]' ? L.optionsArg[lang] : cmd.args);
    if (!hasSubs && cmd.options?.length && cmd.args !== '[options]') words.push(L.optionsArg[lang]);
    return words.join(' ');
}

export function renderMain(lang: Lang, version: string, style: Style = plain): string {
    const out: string[] = [`${style.bold(L.tagline[lang])}  ${style.dim(`(${version})`)}`, ''];
    out.push(`${style.bold(L.usage[lang])}: happy ${L.command[lang]} …     happy help ${L.command[lang]}  ${style.dim(L.oneCommand[lang])}`);
    for (const group of GROUPS) {
        out.push('', style.bold(group.title[lang]));
        if (group.intro) out.push(...wrap(group.intro[lang], WIDTH - 2).map((l) => '  ' + style.dim(l)));
        for (const cmd of group.commands) {
            out.push(...row('  ', usageOf([cmd.name], cmd, lang), cmd.text[lang], 32));
        }
    }
    out.push('');
    for (const line of L.footer[lang]) out.push(style.dim(line));
    return out.join('\n');
}

function renderSubcommands(prefix: string[], subs: readonly Command[], lang: Lang, out: string[], style: Style): void {
    for (const sub of subs) {
        if (sub.hidden) continue;
        const words = [...prefix, sub.name];
        if (sub.subcommands?.length) {
            renderSubcommands(words, sub.subcommands, lang, out, style);
            continue;
        }
        out.push(...row('  ', [...words, sub.args].filter(Boolean).join(' '), sub.text[lang], 34));
        for (const o of sub.options ?? []) out.push(...row('      ', optionLabel(o), o.text[lang], 28).map(style.dim));
    }
}

export function renderCommand(path: readonly string[], lang: Lang, style: Style = plain): string | null {
    const cmd = findCommand(path);
    if (!cmd) return null;
    const out: string[] = [style.bold(`${commandWords(path).join(' ')} — ${cmd.text[lang]}`), ''];
    out.push(`${style.bold(L.usage[lang])}: ${usageOf(path, cmd, lang)}`);
    if (cmd.more) out.push('', ...wrap(cmd.more[lang], WIDTH));
    const subs = cmd.subcommands?.filter((s) => !s.hidden) ?? [];
    if (subs.length) {
        out.push('', style.bold(L.commands[lang]));
        renderSubcommands([], subs, lang, out, style);
    }
    // A command's options apply to its subcommands too (`happy cage up --name`).
    const inherited = path.slice(0, -1).flatMap((_, i) => findCommand(path.slice(0, i + 1))?.options ?? [])
        .filter((o) => !cmd.options?.some((own) => own.flag === o.flag));
    const options = [...(cmd.options ?? []), ...inherited];
    if (options.length) {
        out.push('', style.bold(L.options[lang]));
        for (const o of options) out.push(...row('  ', optionLabel(o), o.text[lang], 30));
    }
    if (cmd.examples?.length) {
        out.push('', style.bold(L.examples[lang]));
        for (const e of cmd.examples) out.push('  ' + e);
    }
    return out.join('\n');
}

/** Every command, for `happy help all`. */
export function renderAll(lang: Lang, version: string, style: Style = plain): string {
    const parts = [renderMain(lang, version, style)];
    for (const group of GROUPS) {
        for (const cmd of group.commands) {
            if (cmd.name === 'help') continue;
            parts.push('─'.repeat(60), renderCommand([cmd.name], lang, style)!);
        }
    }
    return parts.join('\n\n');
}

// ─── docs/COMMANDS.md ───

const MD = {
    title: { en: 'happy commands', zh: 'happy 命令参考' },
    generated: {
        en: 'Generated from `packages/happy-cli/src/original/help/registry.ts` (`pnpm docs:commands`); do not edit by hand. The same text: `happy help all`. 中文版：[COMMANDS.zh.md](COMMANDS.zh.md).',
        zh: '由 `packages/happy-cli/src/original/help/registry.ts` 生成（`pnpm docs:commands`），请勿手改。终端里同样的内容：`happy help all`。English: [COMMANDS.md](COMMANDS.md).',
    },
    lang: {
        en: 'Help is in Chinese when `LANG` (or `HAPPY_LANG`) starts with `zh`. Tab completion for bash and zsh: `happy completion install` (the installer does this).',
        zh: '`LANG`（或 `HAPPY_LANG`）以 `zh` 开头时帮助显示中文。bash/zsh 的 Tab 补全：`happy completion install`（安装器会自动做）。',
    },
    command: { en: 'Command', zh: '命令' },
    option: { en: 'Option', zh: '选项' },
    what: { en: 'What it does', zh: '作用' },
    claudeAll: {
        en: 'All other Claude Code options work too: happy passes them to `claude` (`happy help claude` lists them).',
        zh: 'Claude Code 的其他选项也都能用：happy 会原样交给 `claude`（`happy help claude` 会列出）。',
    },
} satisfies Record<string, Text>;

const cell = (s: string) => s.replace(/\|/g, '\\|');

function mdCommand(cmd: Command, lang: Lang): string[] {
    const path = [cmd.name];
    const out = [`### \`${usageOf(path, cmd, lang)}\``, '', cmd.text[lang] + (/[.。]$/.test(cmd.text[lang]) ? '' : lang === 'zh' ? '。' : '.')];
    if (cmd.more) out.push('', cmd.more[lang]);
    const rows: string[] = [];
    const walk = (prefix: string[], subs: readonly Command[]) => {
        for (const sub of subs) {
            if (sub.hidden) continue;
            const words = [...prefix, sub.name];
            if (sub.subcommands?.length) { walk(words, sub.subcommands); continue; }
            const flags = (sub.options ?? []).map((o) => `\`${optionLabel(o)}\` ${o.text[lang]}`).join('<br>');
            rows.push(`| \`${cell(['happy', ...words, sub.args].filter(Boolean).join(' '))}\` | ${cell(sub.text[lang])}${flags ? `<br>${cell(flags)}` : ''} |`);
        }
    };
    walk(path, cmd.subcommands ?? []);
    if (rows.length) out.push('', `| ${MD.command[lang]} | ${MD.what[lang]} |`, '| --- | --- |', ...rows);
    if (cmd.options?.length) {
        out.push('', `| ${MD.option[lang]} | ${MD.what[lang]} |`, '| --- | --- |');
        for (const o of cmd.options) out.push(`| \`${cell(optionLabel(o))}\` | ${cell(o.text[lang])} |`);
    }
    if (cmd === CLAUDE) out.push('', MD.claudeAll[lang]);
    if (cmd.examples?.length) out.push('', '```sh', ...cmd.examples, '```');
    return out;
}

export function renderMarkdown(lang: Lang): string {
    const out = [`# ${MD.title[lang]}`, '', MD.generated[lang], '', MD.lang[lang], ''];
    for (const group of GROUPS) {
        out.push(`- [${group.title[lang]}](#${group.id})`);
    }
    for (const group of GROUPS) {
        out.push('', `<a id="${group.id}"></a>`, '', `## ${group.title[lang]}`);
        if (group.intro) out.push('', group.intro[lang]);
        for (const cmd of group.commands) out.push('', ...mdCommand(cmd, lang));
    }
    return out.join('\n') + '\n';
}

export function unknownCommand(path: readonly string[], lang: Lang): string {
    return `${L.unknown[lang]}: happy ${path.join(' ')}`;
}
