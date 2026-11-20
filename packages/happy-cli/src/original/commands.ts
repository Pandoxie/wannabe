/**
 * Original Happy: every `happy` subcommand this fork adds, in one table.
 *
 * index.ts asks this table first and only then runs upstream's commands, so
 * what is ours is dispatched here and nowhere else (the implementations stay
 * in their own files; descriptions and help: help/registry.ts). `agent`
 * and `cage` run tools that are already installed, `uninstall` removes what
 * release/install.sh put there (keep its list in step with the installer),
 * `completion install` writes its scripts under ~/.happy-dist and one line
 * into ~/.bashrc / ~/.zshrc.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import packageJson from '../../package.json';

export type OriginalCommand = {
    name: string;
    run: (args: string[]) => Promise<void>;
};

/** The happy-dist installer's state directory (install.sh `STATE`). */
export function distHome(): string {
    return process.env.HAPPY_DIST_HOME || join(homedir(), '.happy-dist');
}

/** The happy-sandbox install (its own installer: `~/.happy-sandbox/bin`). */
export function cageBin(): string {
    return join(process.env.HSB_HOME || join(homedir(), '.happy-sandbox'), 'bin');
}

/** First existing file of `candidates`, else a name found on PATH, else null. */
export function findTool(candidates: string[], name: string, env: NodeJS.ProcessEnv = process.env): string | null {
    for (const c of candidates) if (existsSync(c)) return c;
    for (const dir of (env.PATH ?? '').split(':')) {
        if (dir && existsSync(join(dir, name))) return join(dir, name);
    }
    return null;
}

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): never {
    const r = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    if (r.error) throw r.error;
    process.exit(r.status ?? 1);
}

/** happy-agent sits next to happy in the same global node_modules. */
function happyAgentPath(): string | null {
    // projectPath() is <prefix>/lib/node_modules/happy
    return findTool([join(projectPath(), '..', 'happy-agent', 'dist', 'index.mjs')], 'happy-agent');
}

/** Where happy's releases come from (install.sh's DEFAULT_DIST_URL). */
const DEFAULT_DIST_URL = '';

/** The release source happy was installed from: HAPPY_DIST_URL, ~/.happy-dist/url, or the default. */
export function distUrl(env: NodeJS.ProcessEnv = process.env, home: string = distHome()): string {
    const saved = join(home, 'url');
    const url = env.HAPPY_DIST_URL || (existsSync(saved) ? readFileSync(saved, 'utf8').split('\n')[0].trim() : '') || DEFAULT_DIST_URL;
    return url.replace(/\/+$/, '');
}

function cageInstall(): never {
    const dist = distUrl();
    if (!dist) throw new Error('no release source: set HAPPY_DIST_URL to where your build is published (https://… or file:///path/to/dist)');
    const authFile = join(distHome(), 'auth');
    const auth = process.env.HAPPY_DIST_AUTH || (existsSync(authFile) ? readFileSync(authFile, 'utf8').split('\n')[0].trim() : '');
    // Same as the sandbox README's one-liner, with the source and login happy already has.
    const login = auth ? '-u "$HAPPY_DIST_AUTH" ' : '';
    run('bash', ['-c', `curl -fsSL ${login}"$HAPPY_DIST_URL/sandbox/install.sh" | bash`], { HAPPY_DIST_URL: dist, ...(auth ? { HAPPY_DIST_AUTH: auth } : {}) });
}

const agent: OriginalCommand = {
    name: 'agent',
    async run(args) {
        const tool = happyAgentPath();
        if (!tool) throw new Error('happy-agent is not installed (it comes with happy: run happy update)');
        // Its usage lines then read `happy agent …`: one name for users.
        const env = { HAPPY_AGENT_NAME: 'happy agent' };
        if (tool.endsWith('.mjs')) run(process.execPath, [tool, ...args], env);
        run(tool, args, env);
    },
};

const cage: OriginalCommand = {
    name: 'cage',
    async run(args) {
        const bin = cageBin();
        if (args[0] === 'install') cageInstall();
        const tool = findTool([join(bin, 'happy-sandbox')], 'happy-sandbox');
        if (!tool) {
            console.log('happy-sandbox is not installed. Install it (Linux, rootless Podman): happy cage install');
            process.exit(1);
        }
        if (args[0] === 'update') run(join(bin, 'install.sh'), []);
        if (args[0] === 'uninstall') run(join(bin, 'install.sh'), ['--uninstall']);
        // Its usage text then reads `happy cage …`: one name for users.
        run(tool, args, { HSB_AS: 'happy cage' });
    },
};

const egress: OriginalCommand = {
    name: 'egress',
    async run(args) {
        const { handleEgressCommand } = await import('@/commands/egress');
        await handleEgressCommand(args);
    },
};

const update: OriginalCommand = {
    name: 'update',
    async run(args) {
        const { handleUpdateCommand } = await import('@/commands/update');
        handleUpdateCommand(args);
    },
};

const fleet: OriginalCommand = {
    name: 'fleet',
    async run(args) {
        const { handleFleetCommand } = await import('@/commands/fleet');
        await handleFleetCommand(args);
    },
};

const uninstall: OriginalCommand = {
    name: 'uninstall',
    async run(args) {
        const { handleUninstallCommand } = await import('@/original/uninstall');
        await handleUninstallCommand(args);
    },
};

const completion: OriginalCommand = {
    name: 'completion',
    async run(args) {
        const { handleCompletionCommand } = await import('@/original/completion');
        await handleCompletionCommand(args, packageJson.version);
    },
};

/** Dispatch only: what each command does and its help live in help/registry.ts. */
export const ORIGINAL_COMMANDS: readonly OriginalCommand[] = [update, egress, fleet, agent, cage, uninstall, completion];

export function findOriginalCommand(name: string | undefined): OriginalCommand | undefined {
    return ORIGINAL_COMMANDS.find((command) => command.name === name);
}
