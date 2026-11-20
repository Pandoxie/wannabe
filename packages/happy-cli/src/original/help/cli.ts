/**
 * Original Happy: which arguments ask for help, and printing it.
 *
 *   happy help [all | <command>...]   happy --help / -h
 *   happy <command>... --help / -h    happy <command>... help
 *
 * Before any command runs: `happy codex --help` used to start a login, and
 * `happy doctor --help` the whole doctor. Arguments after `--` are never help.
 */
import chalk from 'chalk';
import { commandPath, findCommand } from './registry';
import { helpLang, renderAll, renderCommand, renderMain, unknownCommand } from './render';

/** The command path to explain ([] = the overview, ['all'] = everything), or null. */
export function helpRequest(args: readonly string[]): string[] | null {
    if (args[0] === 'help') return args.slice(1).filter((a) => !a.startsWith('-'));
    const dd = args.indexOf('--');
    const head = dd >= 0 ? args.slice(0, dd) : args;
    const { path, end } = commandPath(head);
    if (head.includes('--help') || head.includes('-h')) return path;
    if (path.length && head[end] === 'help' && findCommand(path)?.subcommands?.length) return path;
    if (path.length === 1 && args.length === 1 && findCommand(path)?.helpWhenBare) return path;
    return null;
}

const style = { bold: (s: string) => chalk.bold(s), dim: (s: string) => chalk.gray(s) };

/** Prints the help for `path`; false when there is no such command. */
export function printHelp(path: readonly string[], version: string, claudeHelp: () => string | null): boolean {
    const lang = helpLang();
    if (path.length === 0) {
        console.log(renderMain(lang, version, style));
        return true;
    }
    if (path.length === 1 && path[0] === 'all' && !findCommand(path)) {
        console.log(renderAll(lang, version, style));
        return true;
    }
    const text = renderCommand(path, lang, style);
    if (!text) {
        console.log(chalk.red(unknownCommand(path, lang)) + '\n');
        console.log(renderMain(lang, version, style));
        return false;
    }
    console.log(text);
    if (path.length === 1 && path[0] === 'claude') {
        const own = claudeHelp();
        console.log('\n' + chalk.bold.cyan(lang === 'zh' ? 'Claude Code 自己的选项（claude --help）：' : 'Claude Code options (claude --help):'));
        console.log(own ?? chalk.yellow(lang === 'zh' ? '读不到 claude --help：Claude Code 装好了吗？' : 'Could not run claude --help: is Claude Code installed?'));
    }
    return true;
}
