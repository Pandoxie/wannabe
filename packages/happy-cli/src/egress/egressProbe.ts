/**
 * Original Happy: what the LLM providers see as this machine's address.
 *
 * Cloudflare answers `/cdn-cgi/trace` on every domain it serves with the
 * caller's IP and country. The Anthropic and OpenAI domains are behind it,
 * so asking them shows the exit their API traffic uses, through the same
 * proxy rules (a neutral domain may be routed differently). Rotating over
 * four of them keeps each one at a few requests a minute at most.
 *
 * curl is used so that HTTPS_PROXY and the like apply exactly as for the
 * agents; Node's fetch ignores them.
 */
import { execFile } from 'node:child_process';

export const EGRESS_ENDPOINTS = [
    'https://api.anthropic.com/cdn-cgi/trace',
    'https://api.openai.com/cdn-cgi/trace',
    'https://claude.ai/cdn-cgi/trace',
    'https://chatgpt.com/cdn-cgi/trace',
] as const;

export type ProbeResult =
    | { ok: true; ip: string; country: string | null; endpoint: string }
    | { ok: false; error: string; endpoint: string };

export function parseTrace(text: string): { ip: string; country: string | null } | null {
    const fields = new Map(text.split('\n').map((line) => {
        const i = line.indexOf('=');
        return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] as const : ['', ''] as const;
    }));
    const ip = fields.get('ip');
    if (!ip) return null;
    return { ip, country: fields.get('loc') || null };
}

export function probeEndpoint(endpoint: string, timeoutMs = 8_000): Promise<ProbeResult> {
    return new Promise((resolve) => {
        execFile('curl', ['-sS', '-m', String(Math.ceil(timeoutMs / 1000)), endpoint], { timeout: timeoutMs + 2_000, windowsHide: true }, (err, stdout, stderr) => {
            if (err) return resolve({ ok: false, error: String(stderr || err.message).trim().slice(0, 200), endpoint });
            const parsed = parseTrace(String(stdout));
            resolve(parsed ? { ok: true, ...parsed, endpoint } : { ok: false, error: 'unexpected answer', endpoint });
        });
    });
}
