/**
 * The happy MCP tools, shared by the HTTP server (startHappyServer) and the
 * Codex STDIO bridge (codex/happyMcpStdioBridge). Original Happy: when to use
 * them is in HAPPY_AGENT_INSTRUCTIONS (agentInstructions.ts); a description
 * here says what the tool does and what its arguments are. Same wording
 * rules: "the user", reaching only the user and their own sessions.
 */
import { z } from 'zod';

export type HappyToolResult = { content: Array<{ type: 'text'; text: string }>; isError: boolean };

export const HAPPY_TOOLS = {
    change_title: {
        title: 'Change Session Title',
        description: 'Set the title of this session: a few words naming the task, shown in the user\'s session list and in their notifications. '
            + 'A title the user chose stays: the call keeps it and says so, unless userChosen is true.',
        inputSchema: {
            title: z.string().describe('The new title'),
            userChosen: z.boolean().optional().describe('True only when the user asked for this title (named or renamed the session)'),
        },
    },
    notify_owner: {
        title: 'Notify the User',
        description: 'Send the user a push notification on their own phone, through the Happy app they set up for this. '
            + 'The notification title is this session\'s name; you write the text: one sentence, result first, at most 50 characters, '
            + 'in the user\'s language (for example "Tests pass; PR #42 ready for review"). Use it when the work the user asked for is '
            + 'finished, after subagents and background work, or when you are blocked on their decision. At most one per minute.',
        inputSchema: {
            text: z.string().describe('One sentence, result first, at most 50 characters'),
        },
    },
    list_agents: {
        title: 'List Sessions',
        description: 'List the user\'s other Happy sessions that are online now: name (the session title), agent (Claude or Codex), '
            + 'machine, directory, busy or idle, and session id.',
        inputSchema: {},
    },
    send_to_agent: {
        title: 'Message a Session',
        description: 'Send a message to another of the user\'s Happy sessions: a name from list_agents, or a session id. '
            + 'It is delivered at once, into the current turn if that session is busy. Its answer, if any, arrives here later as a new message: end your turn instead of waiting or sending reminders. '
            + 'Write one self-contained message, since the other session cannot see this conversation. Answer a message only when it '
            + 'adds something; no thanks or confirmations back and forth. When you finish work another session gave you, send it the '
            + 'result: what changed, commit, tests, open questions. If a message is refused because of the rate limits, do not retry in a loop.',
        inputSchema: {
            to: z.string().describe('The session: its name (title) from list_agents, or its session id'),
            text: z.string().describe('The message'),
        },
    },
    schedule_task: {
        title: 'Schedule Task',
        description: 'Schedule a message to this session, once ("at") or repeating ("cron"), for example a daily review after the '
            + 'market closes. At that time the prompt arrives here as a message; if this session is offline then, it arrives once '
            + 'when it is back. Repeating tasks run at most every 5 minutes. Write the prompt so it stands on its own later: what '
            + 'to do, where, how to report. Afterwards tell the user the task id and the next run time from the result.',
        inputSchema: {
            name: z.string().describe('Short name, e.g. "股票复盘"'),
            prompt: z.string().describe('The message to send at each run'),
            cron: z.string().optional().describe('Repeating: 5-field cron "minute hour day-of-month month day-of-week", e.g. "35 15 * * 1-5" = weekdays 15:35'),
            at: z.string().optional().describe('Once: local time "YYYY-MM-DD HH:MM"'),
            timezone: z.string().optional().describe('IANA time zone, e.g. "Asia/Shanghai"; default: that of the machine running the fleet hub'),
        },
    },
    list_tasks: {
        title: 'List Scheduled Tasks',
        description: 'List the scheduled tasks of this session: id, name, schedule, next run, state and prompt.',
        inputSchema: {},
    },
    delete_task: {
        title: 'Delete Scheduled Task',
        description: 'Delete a scheduled task of this session by its id from list_tasks, when the user asks or the task is clearly obsolete.',
        inputSchema: {
            id: z.string().describe('The task id'),
        },
    },
} as const;

export type HappyToolName = keyof typeof HAPPY_TOOLS;
