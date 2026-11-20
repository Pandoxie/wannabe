/**
 * Original Happy: is this machine's Claude Code / Codex logged in?
 *
 * Asks the CLIs themselves (`claude auth status`, `codex login status`), so
 * nothing touches the vendors' servers: both read local credentials only
 * (strace: no connection; Claude's start-up telemetry is switched off with
 * CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC). Also so
 * every way of logging in counts: OAuth, API keys, tokens in the
 * environment, the macOS keychain. `null` = not installed or no answer.
 * Reported to the apps as machine metadata `cliAuth` (unknown to upstream
 * clients, which ignore it). happy-fleet does the same check on its own.
 */
import { execFile } from 'node:child_process';

export type CLIAuth = {
    claude: boolean | null;
    codex: boolean | null;
    detectedAt: number;
};

const TIMEOUT_MS = 15_000;
/** No telemetry or update checks from the status commands: they only read local credentials. */
const LOCAL_ONLY_ENV = () => ({ ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });

/** `claude auth status` prints JSON with `loggedIn`; older versions only set the exit code. */
export function parseClaudeAuthStatus(stdout: string, exitCode: number): boolean {
    try {
        const json = JSON.parse(stdout.slice(stdout.indexOf('{')));
        if (typeof json.loggedIn === 'boolean') return json.loggedIn;
    } catch {}
    return exitCode === 0;
}

type Probe = { cmd: string; args: string[]; parse: (stdout: string, code: number) => boolean };
const PROBES: Record<'claude' | 'codex', Probe> = {
    claude: { cmd: 'claude', args: ['auth', 'status'], parse: parseClaudeAuthStatus },
    codex: { cmd: 'codex', args: ['login', 'status'], parse: (_out, code) => code === 0 },
};

function probe(p: Probe, installed: boolean): Promise<boolean | null> {
    if (!installed) return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(p.cmd, p.args, { timeout: TIMEOUT_MS, windowsHide: true, env: LOCAL_ONLY_ENV() }, (err, stdout) => {
            const code = (err as { code?: unknown } | null)?.code;
            if (err && typeof code !== 'number') return resolve(null); // timed out / not runnable
            resolve(p.parse(String(stdout ?? ''), err ? (code as number) : 0));
        });
    });
}

export async function detectCLIAuth(installed: { claude: boolean; codex: boolean }): Promise<CLIAuth> {
    const [claude, codex] = await Promise.all([probe(PROBES.claude, installed.claude), probe(PROBES.codex, installed.codex)]);
    return { claude, codex, detectedAt: Date.now() };
}

