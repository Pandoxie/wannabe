#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import type { Config } from './config';
import { requireCredentials } from './credentials';
import type { Credentials } from './credentials';
import { authLogin, authLogout, authStatus } from './auth';
import { listSessions, listActiveSessions, createSession, getSessionMessages, listMachines, listAllSessions, deleteMachine, deleteSession } from './api';
import { DEFAULT_RULES, formatCleanupPlan, planCleanup, type CleanupRules } from './cleanup';
import type { DecryptedMachine, DecryptedSession } from './api';
import { resumeSessionOnMachine, spawnSessionOnMachine, type SupportedAgent } from './machineRpc';
import { SessionClient } from './session';
import { formatMachineTable, formatSessionTable, formatSessionStatus, formatMessageHistory, formatJson } from './output';

// The package version (e.g. 0.1.0+orig.1); src/ and dist/ both sit next to package.json.
function packageVersion(): string {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

// --- Helpers ---

const SUPPORTED_AGENTS: SupportedAgent[] = ['claude', 'codex', 'gemini', 'openclaw', 'agy'];

function resolveByPrefix<T extends { id: string }>(items: T[], value: string, label: string): T {
    if (!value || value.trim().length === 0) {
        throw new Error(`${label} is required`);
    }
    const matches = items.filter(item => item.id.startsWith(value));
    if (matches.length === 0) {
        throw new Error(`No ${label.toLowerCase()} found matching "${value}"`);
    }
    if (matches.length > 1) {
        throw new Error(`Ambiguous ${label.toLowerCase()} "${value}" matches ${matches.length} records. Be more specific.`);
    }
    return matches[0];
}

async function resolveSession(config: Config, creds: Credentials, sessionId: string): Promise<DecryptedSession> {
    const sessions = await listSessions(config, creds);
    return resolveByPrefix(sessions, sessionId, 'Session ID');
}

async function resolveMachine(config: Config, creds: Credentials, machineId: string): Promise<DecryptedMachine> {
    const machines = await listMachines(config, creds);
    return resolveByPrefix(machines, machineId, 'Machine ID');
}

function createClient(session: DecryptedSession, creds: Credentials, config: Config): SessionClient {
    return new SessionClient({
        sessionId: session.id,
        encryptionKey: session.encryption.key,
        encryptionVariant: session.encryption.variant,
        token: creds.token,
        serverUrl: config.serverUrl,
        initialAgentState: session.agentState ?? null,
    });
}

function resolveRemotePath(rawPath: string | undefined, machine: DecryptedMachine): string {
    const metadata = (machine.metadata ?? {}) as { homeDir?: unknown };
    const homeDir = typeof metadata.homeDir === 'string' && metadata.homeDir.trim().length > 0
        ? metadata.homeDir
        : undefined;
    const path = rawPath ?? homeDir;

    if (!path) {
        throw new Error('Machine metadata does not include a home directory. Pass --path explicitly.');
    }

    if (path === '~') {
        if (!homeDir) {
            throw new Error('Machine metadata does not include a home directory, so `~` cannot be resolved. Pass an absolute --path.');
        }
        return homeDir;
    }
    if (path.startsWith('~/')) {
        if (!homeDir) {
            throw new Error('Machine metadata does not include a home directory, so `~/...` cannot be resolved. Pass an absolute --path.');
        }
        const normalizedHome = homeDir.endsWith('/') || homeDir.endsWith('\\')
            ? homeDir.slice(0, -1)
            : homeDir;
        const separator = normalizedHome.includes('\\') && !normalizedHome.includes('/')
            ? '\\'
            : '/';
        return join(normalizedHome, path.slice(2)).replaceAll('/', separator);
    }
    return path;
}

function resolveSessionMachineId(session: DecryptedSession): string {
    const metadata = (session.metadata ?? {}) as { machineId?: unknown };
    if (typeof metadata.machineId !== 'string' || metadata.machineId.trim().length === 0) {
        throw new Error(`Session ${session.id} is missing machine metadata and cannot be resumed.`);
    }
    return metadata.machineId;
}

function ensureMachineCanResume(machine: DecryptedMachine): void {
    const metadata = (machine.metadata ?? {}) as {
        resumeSupport?: {
            rpcAvailable?: unknown;
            happyAgentAuthenticated?: unknown;
        };
    };

    if (metadata.resumeSupport?.rpcAvailable === true) {
        return;
    }

    if (metadata.resumeSupport?.happyAgentAuthenticated === false) {
        throw new Error('Resume is unavailable on this machine. Run `happy-agent auth login` in that machine environment first.');
    }

    throw new Error('Resume RPC is unavailable on this machine right now.');
}

// --- CLI ---

const program = new Command();

program
    // Original Happy: `happy agent` runs this with HAPPY_AGENT_NAME='happy agent'.
    .name(process.env.HAPPY_AGENT_NAME || 'happy-agent')
    .description('CLI client for controlling Happy Coder agents remotely')
    .version(packageVersion());

program
    .command('auth')
    .description('Manage authentication')
    .addCommand(
        new Command('login').description('Authenticate via QR code').action(async () => {
            const config = loadConfig();
            await authLogin(config);
        })
    )
    .addCommand(
        new Command('logout').description('Clear stored credentials').action(async () => {
            const config = loadConfig();
            await authLogout(config);
        })
    )
    .addCommand(
        new Command('status').description('Show authentication status').action(async () => {
            const config = loadConfig();
            await authStatus(config);
        })
    );

program
    .command('machines')
    .description('List all machines')
    .option('--active', 'Show only active machines')
    .option('--json', 'Output as JSON')
    .action(async (opts: { active?: boolean; json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const machines = await listMachines(config, creds);
        const filtered = opts.active ? machines.filter(machine => machine.active) : machines;
        if (opts.json) {
            console.log(formatJson(filtered));
        } else {
            console.log(formatMachineTable(filtered));
        }
    });

program
    .command('cleanup')
    .description('Delete computers offline for days and finished sessions past their age (lists only, unless --yes)')
    .option('--yes', 'Delete what is listed')
    .option('--machine-days <n>', `Computers offline longer than this (default ${DEFAULT_RULES.machineDays})`)
    .option('--short-days <n>', `Finished short/empty sessions idle longer than this (default ${DEFAULT_RULES.shortDays})`)
    .option('--long-days <n>', `Other finished sessions idle longer than this (default ${DEFAULT_RULES.longDays})`)
    .option('--short-messages <n>', `"Short" means fewer stored messages than this (default ${DEFAULT_RULES.shortMessages})`)
    .option('--json', 'Output the plan as JSON')
    .action(async (opts: { yes?: boolean; machineDays?: string; shortDays?: string; longDays?: string; shortMessages?: string; json?: boolean }) => {
        const num = (value: string | undefined, fallback: number, name: string) => {
            if (value === undefined) return fallback;
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a number >= 0`);
            return n;
        };
        const rules: CleanupRules = {
            machineDays: num(opts.machineDays, DEFAULT_RULES.machineDays, 'machine-days'),
            shortDays: num(opts.shortDays, DEFAULT_RULES.shortDays, 'short-days'),
            longDays: num(opts.longDays, DEFAULT_RULES.longDays, 'long-days'),
            shortMessages: num(opts.shortMessages, DEFAULT_RULES.shortMessages, 'short-messages'),
        };
        const config = loadConfig();
        const creds = requireCredentials(config);
        const [machines, sessions] = await Promise.all([listMachines(config, creds), listAllSessions(config, creds)]);
        const plan = planCleanup(machines, sessions, rules);
        if (opts.json) {
            console.log(formatJson({ rules, ...plan }));
        } else {
            console.log(formatCleanupPlan(plan, rules));
        }
        if (!opts.yes) {
            if (plan.machines.length + plan.sessions.length > 0 && !opts.json) {
                console.log('\nNothing deleted. Run again with --yes to delete the above.');
            }
            return;
        }
        let failed = 0;
        for (const machine of plan.machines) {
            try { await deleteMachine(config, creds, machine.id); } catch (error) { failed++; console.error(`! ${machine.name}: ${(error as Error).message}`); }
        }
        for (const session of plan.sessions) {
            try { await deleteSession(config, creds, session.id); } catch (error) { failed++; console.error(`! ${session.id}: ${(error as Error).message}`); }
        }
        console.log(`\nDeleted ${plan.machines.length + plan.sessions.length - failed}${failed ? `, ${failed} failed` : ''}.`);
        if (failed) process.exitCode = 1;
    });

program
    .command('list')
    .description('List all sessions')
    .option('--active', 'Show only active sessions')
    .option('--json', 'Output as JSON')
    .action(async (opts: { active?: boolean; json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const sessions = opts.active
            ? await listActiveSessions(config, creds)
            : await listSessions(config, creds);
        if (opts.json) {
            console.log(formatJson(sessions));
        } else {
            console.log(formatSessionTable(sessions));
        }
    });

program
    .command('status')
    .description('Get live session state')
    .argument('<session-id>', 'Session ID or prefix')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, opts: { json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);

        const client = createClient(session, creds, config);

        let liveData = false;
        try {
            // Wait for connection, then wait for a state-change event or a short timeout
            await new Promise<void>(resolve => {
                let resolved = false;
                const done = () => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    client.removeAllListeners('state-change');
                    client.removeAllListeners('connect_error');
                    resolve();
                };

                const timeout = setTimeout(done, 3000);

                client.once('state-change', (data: { metadata: unknown; agentState: unknown }) => {
                    session.metadata = data.metadata ?? session.metadata;
                    session.agentState = data.agentState ?? session.agentState;
                    liveData = true;
                    done();
                });

                client.once('connect_error', () => {
                    done();
                });
            });
        } finally {
            client.close();
        }

        if (opts.json) {
            console.log(formatJson(session));
        } else {
            if (!liveData) {
                console.log('> Note: showing cached data (could not get live status).');
            }
            console.log(formatSessionStatus(session));
        }
    });

program
    .command('spawn')
    .description('Spawn a new session on a machine')
    .requiredOption('--machine <machine-id>', 'Machine ID or prefix')
    .option('--path <path>', 'Working directory path (defaults to machine home directory)')
    .option('--agent <agent>', `Agent to start (${SUPPORTED_AGENTS.join(', ')})`, (value: string) => {
        if (!SUPPORTED_AGENTS.includes(value as SupportedAgent)) {
            throw new Error(`--agent must be one of: ${SUPPORTED_AGENTS.join(', ')}`);
        }
        return value as SupportedAgent;
    })
    .option('--create-dir', 'Allow creating the directory if it does not exist')
    .option('--json', 'Output as JSON')
    .action(async (opts: {
        machine: string;
        path?: string;
        agent?: SupportedAgent;
        createDir?: boolean;
        json?: boolean;
    }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const machine = await resolveMachine(config, creds, opts.machine);
        const directory = resolveRemotePath(opts.path, machine);

        const result = await spawnSessionOnMachine(config, machine, creds.token, {
            directory,
            approvedNewDirectoryCreation: opts.createDir,
            agent: opts.agent,
        });

        const payload = {
            machineId: machine.id,
            directory,
            agent: opts.agent ?? null,
            ...result,
        };

        if (opts.json) {
            console.log(formatJson(payload));
            if (result.type !== 'success') {
                process.exitCode = 1;
            }
            return;
        }

        switch (result.type) {
            case 'success':
                console.log([
                    '## Session Spawned',
                    '',
                    `- Machine ID: \`${machine.id}\``,
                    `- Session ID: \`${result.sessionId}\``,
                    `- Path: ${directory}`,
                    `- Agent: ${opts.agent ?? 'default'}`,
                ].join('\n'));
                break;
            case 'requestToApproveDirectoryCreation':
                throw new Error(`The directory '${result.directory}' does not exist. Re-run with --create-dir to allow creating it.`);
            case 'error':
                throw new Error(result.errorMessage);
        }
    });

program
    .command('resume')
    .description('Resume a session on its original machine')
    .argument('<session-id>', 'Session ID or prefix')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, opts: { json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);
        const machineId = resolveSessionMachineId(session);
        const machine = await resolveMachine(config, creds, machineId);
        ensureMachineCanResume(machine);

        const result = await resumeSessionOnMachine(config, machine, creds.token, session.id);
        const payload = {
            sourceSessionId: session.id,
            machineId: machine.id,
            ...result,
        };

        if (opts.json) {
            console.log(formatJson(payload));
            if (result.type !== 'success') {
                process.exitCode = 1;
            }
            return;
        }

        switch (result.type) {
            case 'success':
                console.log([
                    '## Session Resumed',
                    '',
                    `- Machine ID: \`${machine.id}\``,
                    `- Source Session ID: \`${session.id}\``,
                    `- Resumed Session ID: \`${result.sessionId}\``,
                ].join('\n'));
                break;
            case 'requestToApproveDirectoryCreation':
                throw new Error(`Resume unexpectedly requested directory creation for '${result.directory}'. Resume should reuse the saved path.`);
            case 'error':
                throw new Error(result.errorMessage);
        }
    });

program
    .command('create')
    .description('Create a new session')
    .requiredOption('--tag <tag>', 'Session tag')
    .option('--path <path>', 'Working directory path')
    .option('--json', 'Output as JSON')
    .action(async (opts: { tag: string; path?: string; json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const metadata = {
            tag: opts.tag,
            path: opts.path ?? process.cwd(),
            host: hostname(),
        };
        const session = await createSession(config, creds, {
            tag: opts.tag,
            metadata,
        });
        if (opts.json) {
            console.log(formatJson(session));
        } else {
            console.log([
                '## Session Created',
                '',
                `- Session ID: \`${session.id}\``,
            ].join('\n'));
        }
    });

program
    .command('send')
    .description('Send a message to a session')
    .argument('<session-id>', 'Session ID or prefix')
    .argument('<message>', 'Message text')
    .option('--yolo', 'Send with permissionMode=yolo')
    .option('--model <model>', 'Model for this and later messages (e.g. claude-sonnet-5-5)')
    .option('--wait', 'Wait for agent to become idle')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, message: string, opts: { yolo?: boolean; model?: string; wait?: boolean; json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);
        const permissionMode = opts.yolo ? 'yolo' : null;

        const client = createClient(session, creds, config);
        try {
            await client.waitForConnect();
            const completion = opts.wait ? client.waitForTurnCompletion() : null;
            const meta: Record<string, unknown> = {
                ...(permissionMode ? { permissionMode } : {}),
                ...(opts.model ? { model: opts.model } : {}),
            };
            client.sendMessage(message, Object.keys(meta).length ? meta : undefined);

            if (completion) {
                await completion;
            } else {
                // Delay to allow the Socket.IO event to flush before closing
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } finally {
            client.close();
        }

        if (opts.json) {
            console.log(formatJson({ sessionId: session.id, message, sent: true, permissionMode }));
        } else {
            console.log([
                '## Message Sent',
                '',
                `- Session ID: \`${session.id}\``,
                `- Permission Mode: ${permissionMode ?? 'default'}`,
                `- Waited For Idle: ${opts.wait ? 'yes' : 'no'}`,
            ].join('\n'));
        }
    });

program
    .command('history')
    .description('Read message history')
    .argument('<session-id>', 'Session ID or prefix')
    .option('--limit <n>', 'Limit number of messages', (v: string) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n <= 0) throw new Error('--limit must be a positive integer');
        return n;
    })
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, opts: { limit?: number; json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);
        let messages = await getSessionMessages(config, creds, session.id, session.encryption);

        // Sort chronologically by createdAt
        messages.sort((a, b) => a.createdAt - b.createdAt);

        // Apply limit
        if (opts.limit && opts.limit > 0) {
            messages = messages.slice(-opts.limit);
        }

        if (opts.json) {
            console.log(formatJson(messages));
        } else {
            console.log(formatMessageHistory(messages));
        }
    });

program
    .command('stop')
    .description('Stop a session')
    .argument('<session-id>', 'Session ID or prefix')
    .action(async (sessionId: string) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);

        const client = createClient(session, creds, config);
        try {
            await client.waitForConnect();
            client.sendStop();

            // Delay to allow the Socket.IO event to flush before closing
            await new Promise(resolve => setTimeout(resolve, 500));
        } finally {
            client.close();
        }

        console.log([
            '## Session Stopped',
            '',
            `- Session ID: \`${session.id}\``,
        ].join('\n'));
    });

program
    .command('wait')
    .description('Wait for agent to become idle')
    .argument('<session-id>', 'Session ID or prefix')
    .option('--timeout <seconds>', 'Timeout in seconds', (v: string) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n <= 0) throw new Error('--timeout must be a positive integer');
        return n;
    }, 300)
    .action(async (sessionId: string, opts: { timeout: number }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const session = await resolveSession(config, creds, sessionId);

        const client = createClient(session, creds, config);
        try {
            await client.waitForConnect();
            await client.waitForIdle(opts.timeout * 1000);
            console.log([
                '## Session Idle',
                '',
                `- Session ID: \`${session.id}\``,
            ].join('\n'));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(msg);
            process.exitCode = 1;
        } finally {
            client.close();
        }
    });

program.parseAsync(process.argv).catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
