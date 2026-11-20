/**
 * Picks the Claude Code that app-started (remote) sessions run.
 *
 * Upstream Happy lets the Agent SDK spawn the Claude Code binary bundled in
 * its platform package (`@anthropic-ai/claude-agent-sdk-<platform>`, ~330 MB),
 * so remote sessions ran a different Claude than the one on the machine and
 * `claude update` did not reach them. Original Happy runs the machine's own
 * `claude` instead — the same one local (terminal) sessions already use — and
 * does not install the bundled copy.
 *
 * Lookup order is the local launcher's (`scripts/claude_version_utils.cjs`):
 * HAPPY_CLAUDE_PATH, then PATH, npm, Bun, Homebrew and the native installer.
 * HAPPY_CLAUDE_USE_BUNDLED=1 restores the upstream behaviour (needs the SDK's
 * platform package installed).
 */

import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { projectPath } from '@/projectPath'

/**
 * Oldest Claude Code remote sessions accept. 2.1.295 is the version upstream
 * required through its bundled SDK (0.3.295) so Opus 5.5 works and Sonnet /
 * Haiku 5.5 get their 1M window (upstream b7c16f159). Raise it together with
 * the `@anthropic-ai/claude-agent-sdk` range in package.json.
 */
export const MIN_CLAUDE_CODE_VERSION = '2.1.295'

export type ClaudeLookup = {
    findGlobalClaudeCliPath: () => { path: string; source: string } | null
    getVersion: (cliPath: string) => string | null
    compareVersions: (a: string, b: string) => number
}

export class ClaudeExecutableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ClaudeExecutableError'
    }
}

let lookup: ClaudeLookup | null = null
function defaultLookup(): ClaudeLookup {
    if (!lookup) {
        const require = createRequire(import.meta.url)
        lookup = require(join(projectPath(), 'scripts', 'claude_version_utils.cjs')) as ClaudeLookup
    }
    return lookup
}

// `claude --version` takes a moment; cache it per resolved file. The lookup
// returns the real path, so an update (new file or new mtime) misses the cache.
const versionCache = new Map<string, string | null>()
function cachedVersion(path: string, l: ClaudeLookup): string | null {
    let key = path
    try {
        key = `${path}@${statSync(path).mtimeMs}`
    } catch {
        // Unreadable: let getVersion decide.
    }
    if (!versionCache.has(key)) {
        versionCache.set(key, l.getVersion(path))
    }
    return versionCache.get(key) ?? null
}

/**
 * Returns the path to pass as `pathToClaudeCodeExecutable`, or undefined when
 * HAPPY_CLAUDE_USE_BUNDLED asks for the SDK's own binary. Throws a
 * ClaudeExecutableError the app shows as the launch failure when no usable
 * Claude Code is installed.
 */
export function resolveClaudeExecutable(
    env: NodeJS.ProcessEnv = process.env,
    l: ClaudeLookup = defaultLookup(),
): string | undefined {
    if (env.HAPPY_CLAUDE_USE_BUNDLED === '1') {
        return undefined
    }
    const found = l.findGlobalClaudeCliPath()
    if (!found) {
        throw new ClaudeExecutableError(
            'Claude Code is not installed on this machine. Happy runs the machine\'s own `claude`; '
            + 'install it (curl -fsSL https://claude.ai/install.sh | bash) or set HAPPY_CLAUDE_PATH, then restart the Happy daemon.',
        )
    }
    const version = cachedVersion(found.path, l)
    if (!version) {
        throw new ClaudeExecutableError(
            `Cannot read the version of Claude Code at ${found.path} (${found.source}). Check that \`claude --version\` works, or set HAPPY_CLAUDE_PATH.`,
        )
    }
    if (l.compareVersions(version, MIN_CLAUDE_CODE_VERSION) < 0) {
        throw new ClaudeExecutableError(
            `Claude Code ${version} at ${found.path} is too old; Happy needs ${MIN_CLAUDE_CODE_VERSION} or newer. Run \`claude update\`.`,
        )
    }
    return found.path
}
