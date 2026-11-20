/**
 * The version of the agent runtime a session runs on — the machine's Claude
 * Code or Codex — for the session's metadata, so the apps can show it next
 * to the session ids. Best effort: undefined when it cannot be read; never
 * throws, never blocks a session from starting.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';

type ClaudeLookup = {
    findGlobalClaudeCliPath: () => { path: string; source: string } | null;
    getVersion: (cliPath: string) => string | null;
};

const SEMVER = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;

/** Same lookup the remote launcher uses (sdk/claudeExecutable.ts). */
export function readClaudeCodeVersion(): string | undefined {
    try {
        const require = createRequire(import.meta.url);
        const lookup = require(join(projectPath(), 'scripts', 'claude_version_utils.cjs')) as ClaudeLookup;
        const found = lookup.findGlobalClaudeCliPath();
        return (found && lookup.getVersion(found.path)) || undefined;
    } catch {
        return undefined;
    }
}

/** `codex --version` prints e.g. "codex-cli 0.167.0". */
export function readCodexVersion(): string | undefined {
    try {
        const out = execFileSync('codex', ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 5000,
            windowsHide: true,
        });
        return out.match(SEMVER)?.[1];
    } catch {
        return undefined;
    }
}
