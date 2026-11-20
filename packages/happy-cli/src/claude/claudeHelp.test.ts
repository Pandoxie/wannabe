import { describe, expect, it } from 'vitest';
import { claudeHelpText, isClaudeHelpCommand } from './claudeHelp';

describe('claude /help', () => {
    it('matches only a bare /help', () => {
        expect(isClaudeHelpCommand('/help')).toBe(true);
        expect(isClaudeHelpCommand('  /HELP ')).toBe(true);
        expect(isClaudeHelpCommand('/help me')).toBe(false);
        expect(isClaudeHelpCommand('help')).toBe(false);
    });

    it('lists happy commands, Claude Code commands and skills separately', () => {
        const text = claudeHelpText({
            slashCommands: ['context', 'cost', 'review', 'design', 'compact', 'help', 'goal'],
            skills: ['design'],
            goalSupported: true,
        });
        expect(text).toContain('- /model <id> —');
        expect(text).toContain('- /goal <objective> —');
        expect(text).toContain('Claude Code commands (run by Claude Code):\n\n/context  /cost  /review');
        expect(text).toContain('Skills:\n\n/design');
        expect(text).not.toMatch(/`|\*\*/);
    });

    it('explains an empty list before the first message', () => {
        expect(claudeHelpText({})).toContain('after the first message');
        expect(claudeHelpText({})).not.toContain('/goal');
    });
});
