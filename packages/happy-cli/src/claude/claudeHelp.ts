/**
 * `/help` for Claude sessions started from the apps (Original Happy).
 *
 * Claude Code's own `/help` is interactive-only. This lists what a message
 * starting with `/` does in a remote Claude session: the commands happy-cli
 * handles, the commands Claude Code reported for this session (its
 * `system/init` slash_commands, minus skills) and the skills.
 */

export function isClaudeHelpCommand(text: string): boolean {
    return /^\s*\/help\s*$/i.test(text);
}

export function claudeHelpText(opts: {
    slashCommands?: string[];
    skills?: string[];
    goalSupported?: boolean;
}): string {
    const clean = (names: string[] | undefined) => [...new Set((names ?? []).map((n) => n.replace(/^\//, '')).filter(Boolean))];
    const skills = clean(opts.skills);
    const handled = new Set(['help', 'model', 'clear', 'compact', 'mcp', 'skills', 'goal']);
    const claude = clean(opts.slashCommands).filter((n) => !skills.includes(n) && !handled.has(n)).sort();

    // Plain text like the rest of the chat (and Claude Code's own /context
    // output): no inline code or bold, which rendered as small monospace chips.
    const lines = [
        'Commands in this Claude session:',
        '',
        '- /help — this list',
        '- /model <id> — switch model; an older id becomes the newest of its tier, suffixes are kept (claude-opus-5-dev → claude-opus-5-5-dev), and every app shows the model in use',
        '- /clear — start a new conversation',
        '- /compact — summarize the conversation to free context',
        '- /mcp — MCP servers',
        '- /skills — skills',
        ...(opts.goalSupported ? ['- /goal <objective> — set a goal; /goal clear'] : []),
    ];
    if (claude.length) {
        lines.push('', 'Claude Code commands (run by Claude Code):', '', claude.map((n) => `/${n}`).join('  '));
    }
    if (skills.length) {
        lines.push('', 'Skills:', '', skills.map((n) => `/${n}`).join('  '));
    }
    if (!claude.length && !skills.length) {
        lines.push('', 'Claude Code reports its own commands after the first message; send /help again then.');
    }
    lines.push('', 'Commands that need the terminal UI (e.g. /doctor) do not work from the app. Anything else is sent to Claude as a message.');
    return lines.join('\n');
}
