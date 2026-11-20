/**
 * Original Happy: who owns a session's title (`metadata.summary.text`).
 *
 * A session starts with none (the apps show "New chat"). The agent names it
 * with change_title, and Claude Code's own summary lines may rename it. A
 * title the user chose stays: the agent's change_title (and Claude's
 * summaries) leave it alone, until the user asks for another one
 * (change_title with `userChosen`).
 *
 * `metadata.agentTitle` is the last title an agent wrote. A title that is
 * not it was chosen by the user: named on their request, renamed in another
 * client, or set before this field existed.
 */
import type { Metadata } from '@/api/types';

export type TitleOwner = 'none' | 'agent' | 'user';

export function titleOwner(metadata: Pick<Metadata, 'summary' | 'agentTitle'> | null | undefined): TitleOwner {
    const text = metadata?.summary?.text?.trim();
    if (!text) return 'none';
    return text === metadata?.agentTitle ? 'agent' : 'user';
}

/** Metadata with `title`, or unchanged when the user's title must stay. */
export function withTitle(metadata: Metadata, title: string, byUser: boolean, now = Date.now()): Metadata {
    if (!byUser && titleOwner(metadata) === 'user') return metadata;
    const { agentTitle: _, ...rest } = metadata;
    return {
        ...rest,
        summary: { text: title, updatedAt: now },
        ...(byUser ? {} : { agentTitle: title }),
    };
}

export function keptTitleMessage(current: string): string {
    return `Kept the title "${current}": the user chose it. Change it only when the user asks for a new one (then pass userChosen: true).`;
}
