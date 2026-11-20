/**
 * Original Happy: `happy update` — the installer kept in ~/.happy-dist
 * (release/install.sh), so updating needs no second command name.
 *
 *   happy update             claude update, codex update, newest happy release;
 *                            restarts sessions if anything changed
 *   happy update status      versions and daemon (install.sh --status)
 *   happy update verify      check the install against the release
 *   happy update list        releases, newest last
 *   happy update <version>   install that release (rollback)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SUBCOMMANDS: Record<string, string[]> = {
    status: ['--status'],
    verify: ['--verify'],
    list: ['--list'],
};

export function updateArguments(args: string[]): string[] | 'help' {
    const [first, ...rest] = args;
    if (first === undefined) return ['--update'];
    if (first === '-h' || first === '--help' || first === 'help') return 'help';
    if (SUBCOMMANDS[first]) return [...SUBCOMMANDS[first], ...rest];
    if (first.startsWith('-')) return ['--update', ...args];
    return args; // a release, e.g. 1.2.6+orig.31
}

export function handleUpdateCommand(args: string[]): never {
    const parsed = updateArguments(args);
    if (parsed === 'help') {
        console.log(`happy update — update Claude Code, Codex and happy (Original Happy)

  happy update             claude update, codex update, newest happy; restarts
                           sessions if anything changed
  happy update status      versions and daemon
  happy update verify      check the install (after an interrupted update)
  happy update list        releases, newest last
  happy update <version>   install that release (rollback)

Other accounts: HAPPY_HOME_DIR=~/.happy_x happy update …`);
        process.exit(0);
    }
    const installer = join(process.env.HAPPY_DIST_HOME || join(homedir(), '.happy-dist'), 'install.sh');
    if (!existsSync(installer)) {
        console.error(`No installer at ${installer}: install Original Happy with the one-line command first.`);
        process.exit(1);
    }
    const r = spawnSync(installer, parsed, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
}
