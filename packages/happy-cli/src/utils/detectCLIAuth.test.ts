import { describe, it, expect } from 'vitest';
import { detectCLIAuth, parseClaudeAuthStatus } from './detectCLIAuth';

describe('Claude / Codex login detection', () => {
    it('reads loggedIn from `claude auth status`, else the exit code', () => {
        expect(parseClaudeAuthStatus('{\n  "loggedIn": true,\n  "authMethod": "oauth_token"\n}', 0)).toBe(true);
        expect(parseClaudeAuthStatus('{"loggedIn": false}', 1)).toBe(false);
        expect(parseClaudeAuthStatus('Not logged in', 1)).toBe(false);
        expect(parseClaudeAuthStatus('Logged in', 0)).toBe(true);
    });
    it('does not run CLIs that are not installed', async () => {
        const auth = await detectCLIAuth({ claude: false, codex: false });
        expect(auth.claude).toBeNull();
        expect(auth.codex).toBeNull();
    });
});
