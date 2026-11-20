/**
 * Original Happy: `happy completion bash|zsh|install|uninstall`.
 *
 * The scripts carry the command table (help/registry.ts) as plain shell case
 * statements: starting happy takes most of a second, too slow for every Tab.
 * Only session ids (sessions.json of HAPPY_HOME_DIR, through a small
 * `node -e`) and sandbox names (~/.happy-sandbox/<name>) are looked up at Tab
 * time. Bash 3.2 (macOS) has no associative arrays: hence the case statements.
 *
 * `install` writes both scripts to ~/.happy-dist/completion/ and adds one
 * source line to ~/.bashrc and ~/.zshrc; release/install.sh runs it after
 * every install, so the scripts follow the installed happy. `uninstall`
 * removes the line and leaves ~/.happy-dist/no-completion, which keeps the
 * installer from adding it again. `happy uninstall` removes the line too
 * (the scripts go with ~/.happy-dist).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { distHome } from './commands';
import { CLAUDE, allCommands, type Command, type Complete, type Lang, type Option } from './help/registry';
import { helpLang } from './help/render';

type Shell = 'bash' | 'zsh';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Every completion context: '' (plain happy), 'agent', 'agent send', …, with
 * its options and those of the commands above it (`happy cage up --name`);
 * plain happy's (Claude's) only at the top and under `claude`.
 */
function contexts(): { path: string; cmd: Command }[] {
    const out: { path: string; cmd: Command }[] = [];
    const root: Command = { ...CLAUDE, name: '', subcommands: allCommands() };
    const walk = (path: string, cmd: Command, inherited: Option[]) => {
        const options = [...(cmd.options ?? []), ...inherited.filter((o) => !cmd.options?.some((own) => own.flag === o.flag))];
        out.push({ path, cmd: { ...cmd, options } });
        for (const sub of cmd.subcommands ?? []) {
            if (!sub.hidden) walk(path ? `${path} ${sub.name}` : sub.name, sub, path ? options : []);
        }
    };
    walk('', root, []);
    return out;
}

function flags(cmd: Command): Option[] {
    return cmd.options ?? [];
}

function valueKind(o: Option): string {
    if (o.values) return `values ${o.values.join(' ')}`;
    return o.complete ?? 'any';
}

function argKind(cmd: Command): string | null {
    if (cmd.argValues) return `values ${cmd.argValues.join(' ')}`;
    return cmd.argComplete ?? null;
}

function oneLine(s: string): string {
    return s.replace(/\s+/g, ' ');
}

/** The shell functions both scripts share: plain `case`, valid in bash 3.2 and zsh. */
function tables(lang: Lang, shell: Shell): string {
    const ctx = contexts();
    const subs = ctx.filter((c) => c.cmd.subcommands?.some((s) => !s.hidden))
        .map((c) => `        ${q(c.path)}) echo ${q(c.cmd.subcommands!.filter((s) => !s.hidden).map((s) => s.name).join(' '))} ;;`);
    const fl = ctx.filter((c) => flags(c.cmd).length)
        .map((c) => `        ${q(c.path)}) echo ${q(flags(c.cmd).flatMap((o) => (o.alias ? [o.flag, o.alias] : [o.flag])).join(' '))} ;;`);
    const values = ctx.flatMap((c) => flags(c.cmd).filter((o) => o.value).flatMap((o) =>
        [o.flag, ...(o.alias ? [o.alias] : [])].map((f) => `        ${q(`${c.path}|${f}`)}) echo ${q(valueKind(o))} ;;`)));
    const args = ctx.filter((c) => argKind(c.cmd)).map((c) => `        ${q(c.path)}) echo ${q(argKind(c.cmd)!)} ;;`);
    const parts = [
        '_happy_subs() {\n    case "$1" in\n' + subs.join('\n') + '\n        *) return 1 ;;\n    esac\n}',
        '_happy_flags() {\n    case "$1" in\n' + fl.join('\n') + '\n        *) return 1 ;;\n    esac\n}',
        '# Options that take a value, and what the value completes to.\n_happy_optval() {\n    case "$1" in\n' + values.join('\n') + '\n        *) return 1 ;;\n    esac\n}',
        '# What the first positional argument completes to.\n_happy_arg() {\n    case "$1" in\n' + args.join('\n') + '\n        *) return 1 ;;\n    esac\n}',
    ];
    if (shell === 'zsh') {
        const desc = (cmds: { name: string; text: string }[]) => cmds.map((c) => `${c.name}:${oneLine(c.text)}`).join('\n');
        const subDesc = ctx.filter((c) => c.cmd.subcommands?.some((s) => !s.hidden)).map((c) =>
            `        ${q(c.path)}) print -r -- ${q(desc(c.cmd.subcommands!.filter((s) => !s.hidden).map((s) => ({ name: s.name, text: s.text[lang] }))))} ;;`);
        const flagDesc = ctx.filter((c) => flags(c.cmd).length).map((c) =>
            `        ${q(c.path)}) print -r -- ${q(desc(flags(c.cmd).flatMap((o) => [o.flag, ...(o.alias ? [o.alias] : [])].map((f) => ({ name: f, text: o.text[lang] })))))} ;;`);
        parts.push(
            '_happy_sub_desc() {\n    case "$1" in\n' + subDesc.join('\n') + '\n    esac\n}',
            '_happy_flag_desc() {\n    case "$1" in\n' + flagDesc.join('\n') + '\n    esac\n}',
        );
    }
    return parts.join('\n\n');
}

/** Session ids of HAPPY_HOME_DIR, newest first; zsh: `id:flavor directory`. */
const SESSIONS_JS = [
    'const fs = require("fs");',
    'let s = {}; try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).sessions || {}; } catch (e) {}',
    'const at = (r) => r.lastAliveAt || r.savedAt || 0;',
    'for (const [id, r] of Object.entries(s).sort((a, b) => at(b[1]) - at(a[1])).slice(0, 60)) {',
    '  const m = r.metadata || {}; const what = ((m.summary && m.summary.text) || m.path || "").replace(/[:\\s]+/g, " ").slice(0, 70);',
    '  console.log(process.argv[2] === "zsh" ? id + ":" + (m.flavor || "claude") + " " + what : id);',
    '}',
].join(' ');

function dynamic(shell: Shell): string {
    return [
        `_happy_sessions() {\n    command -v node >/dev/null 2>&1 || return 0\n    node -e ${q(SESSIONS_JS)} "\${HAPPY_HOME_DIR:-$HOME/.happy}/sessions.json" ${shell} 2>/dev/null\n}`,
        `_happy_sandboxes() {\n    local f\n${shell === 'zsh' ? '    setopt localoptions nullglob\n' : ''}    for f in "\${HSB_HOME:-$HOME/.happy-sandbox}"/*/config.json; do\n        [ -f "$f" ] && basename "$(dirname "$f")"\n    done\n}`,
    ].join('\n\n');
}

export function bashScript(version: string, lang: Lang = helpLang()): string {
    return `# bash completion for happy ${version} (generated: happy completion bash)

${tables(lang, 'bash')}

${dynamic('bash')}

_happy_values() {
    case "$1" in
        values\\ *) COMPREPLY=($(compgen -W "\${1#values }" -- "$cur")) ;;
        sessions) COMPREPLY=($(compgen -W "$(_happy_sessions)" -- "$cur")) ;;
        sandboxes) COMPREPLY=($(compgen -W "$(_happy_sandboxes)" -- "$cur")) ;;
        files) compopt -o filenames 2>/dev/null; COMPREPLY=($(compgen -f -- "$cur")) ;;
        dirs) compopt -o filenames 2>/dev/null; COMPREPLY=($(compgen -d -- "$cur")) ;;
        *) COMPREPLY=() ;;
    esac
}

_happy() {
    local cur="\${COMP_WORDS[COMP_CWORD]}" p="" npos=0 skip=0 i w subs kind
    COMPREPLY=()
    for ((i = 1; i < COMP_CWORD; i++)); do
        w="\${COMP_WORDS[i]}"
        if [ "$skip" = 1 ]; then skip=0; continue; fi
        if [ "$w" = "--" ]; then compopt -o default 2>/dev/null; return 0; fi
        case "$w" in -*) _happy_optval "$p|$w" >/dev/null && skip=1; continue ;; esac
        if [ "$npos" = 0 ] && subs="$(_happy_subs "$p")" && [[ " $subs " == *" $w "* ]]; then
            p="\${p:+$p }$w"
        else
            npos=$((npos + 1))
        fi
    done
    if [ "$skip" = 1 ]; then
        _happy_values "$(_happy_optval "$p|\${COMP_WORDS[COMP_CWORD-1]}")"
        return 0
    fi
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "$(_happy_flags "$p")" -- "$cur"))
        return 0
    fi
    [ "$npos" = 0 ] || return 0
    if subs="$(_happy_subs "$p")"; then
        COMPREPLY=($(compgen -W "$subs" -- "$cur"))
    elif kind="$(_happy_arg "$p")"; then
        _happy_values "$kind"
    fi
}

complete -F _happy happy
`;
}

export function zshScript(version: string, lang: Lang = helpLang()): string {
    return `#compdef happy
# zsh completion for happy ${version} (generated: happy completion zsh)

${tables(lang, 'zsh')}

${dynamic('zsh')}

_happy_values() {
    local -a items
    case "$1" in
        values\\ *) items=(\${=\${1#values }}); compadd -a items ;;
        sessions) items=("\${(@f)$(_happy_sessions)}"); [ -n "$items" ] && _describe -t sessions 'session' items ;;
        sandboxes) items=("\${(@f)$(_happy_sandboxes)}"); [ -n "$items" ] && compadd -a items ;;
        files) _files ;;
        dirs) _files -/ ;;
    esac
}

_happy() {
    local cur="\${words[CURRENT]}" p="" npos=0 skip=0 i w subs kind
    local -a items
    for ((i = 2; i < CURRENT; i++)); do
        w="\${words[i]}"
        if [ "$skip" = 1 ]; then skip=0; continue; fi
        if [ "$w" = "--" ]; then _files; return; fi
        case "$w" in -*) _happy_optval "$p|$w" >/dev/null && skip=1; continue ;; esac
        if [ "$npos" = 0 ] && subs="$(_happy_subs "$p")" && [[ " $subs " == *" $w "* ]]; then
            p="\${p:+$p }$w"
        else
            npos=$((npos + 1))
        fi
    done
    if [ "$skip" = 1 ]; then
        _happy_values "$(_happy_optval "$p|\${words[CURRENT-1]}")"
        return
    fi
    if [[ "$cur" == -* ]]; then
        items=("\${(@f)$(_happy_flag_desc "$p")}")
        [ -n "$items" ] && _describe -t options 'option' items
        return
    fi
    [ "$npos" = 0 ] || return
    if _happy_subs "$p" >/dev/null; then
        items=("\${(@f)$(_happy_sub_desc "$p")}")
        _describe -t commands 'command' items
    elif kind="$(_happy_arg "$p")"; then
        _happy_values "$kind"
    fi
}

if (( $+functions[compdef] )); then
    compdef _happy happy
else
    autoload -Uz compinit && compinit -i && compdef _happy happy
fi
`;
}

// ─── install / uninstall ───

export const RC_MARK = '# happy completion';

export function completionDir(): string {
    return join(distHome(), 'completion');
}

function rcLine(shell: Shell, file: string, home: string): string {
    const shown = file.startsWith(home + '/') ? `$HOME/${file.slice(home.length + 1)}` : file;
    return `[ -f "${shown}" ] && . "${shown}" ${RC_MARK} (happy completion uninstall removes it)`;
}

/** The rc text with our line added (once) or replaced. */
export function withRcLine(text: string, line: string): string {
    const kept = withoutRcLine(text);
    return (kept && !kept.endsWith('\n') ? kept + '\n' : kept) + line + '\n';
}

export function withoutRcLine(text: string): string {
    return text.split('\n').filter((l) => !l.includes(RC_MARK)).join('\n');
}

/** Which rc files get the line: those that exist, and the login shell's own. */
export function rcFiles(home: string, shell: string | undefined, exists: (p: string) => boolean = existsSync): { shell: Shell; file: string }[] {
    const out: { shell: Shell; file: string }[] = [];
    const bashrc = join(home, '.bashrc');
    const zshrc = join(home, '.zshrc');
    if (exists(bashrc) || /bash$/.test(shell ?? '')) out.push({ shell: 'bash', file: bashrc });
    if (exists(zshrc) || /zsh$/.test(shell ?? '')) out.push({ shell: 'zsh', file: zshrc });
    return out;
}

/** Set by `uninstall`: the installer then leaves completion off. */
function offMark(): string {
    return join(distHome(), 'no-completion');
}

function install(version: string, quiet: boolean): void {
    const home = homedir();
    const dir = completionDir();
    rmSync(offMark(), { force: true });
    mkdirSync(dir, { recursive: true });
    const scripts: Record<Shell, string> = { bash: join(dir, 'happy.bash'), zsh: join(dir, 'happy.zsh') };
    writeFileSync(scripts.bash, bashScript(version));
    writeFileSync(scripts.zsh, zshScript(version));
    const done: string[] = [];
    for (const { shell, file } of rcFiles(home, process.env.SHELL)) {
        const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
        const after = withRcLine(before, rcLine(shell, scripts[shell], home));
        if (after !== before) writeFileSync(file, after);
        done.push(file);
    }
    if (quiet) return;
    console.log(`Completion scripts: ${dir}`);
    console.log(done.length ? `Loaded from: ${done.join(', ')}\nOpen a new shell (or: source ${done[0]}) and try: happy <Tab>` : 'No ~/.bashrc or ~/.zshrc: source a script from your shell\'s startup file yourself.');
}

export function uninstallCompletion(quiet = false): void {
    const home = homedir();
    if (existsSync(distHome())) writeFileSync(offMark(), 'happy completion uninstall: the installer leaves tab completion off\n');
    for (const file of [join(home, '.bashrc'), join(home, '.zshrc')]) {
        if (!existsSync(file)) continue;
        const before = readFileSync(file, 'utf8');
        const after = withoutRcLine(before);
        if (after !== before) {
            writeFileSync(file, after);
            if (!quiet) console.log(`Removed the completion line from ${file}`);
        }
    }
}

export async function handleCompletionCommand(args: string[], version: string): Promise<void> {
    const quiet = args.includes('--quiet');
    switch (args[0]) {
        case 'bash': process.stdout.write(bashScript(version)); return;
        case 'zsh': process.stdout.write(zshScript(version)); return;
        case 'install': install(version, quiet); return;
        case 'uninstall': uninstallCompletion(quiet); return;
        default: {
            const { renderCommand } = await import('./help/render');
            console.log(renderCommand(['completion'], helpLang()));
        }
    }
}

export type { Complete };
