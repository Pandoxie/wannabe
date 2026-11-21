/**
 * The agent's own session ID (Claude's session ID, Codex's thread ID) is what
 * resuming a Happy session needs. The daemon keeps it in its records
 * (sessions.json) so a restart works without asking the relay (Original
 * Happy).
 */

import type { Metadata } from '@/api/types';

export type AgentIds = { claudeSessionId?: string; codexThreadId?: string };

const flavorOf = (metadata: Pick<Metadata, 'flavor'>) => metadata.flavor ?? 'claude';

/** The agent session ID of this metadata's flavor, if it has one. */
export function agentIdOf(metadata: Metadata | undefined | null): AgentIds {
    if (!metadata) return {};
    const flavor = flavorOf(metadata);
    if (flavor === 'codex') return metadata.codexThreadId ? { codexThreadId: metadata.codexThreadId } : {};
    if (flavor === 'claude') return metadata.claudeSessionId ? { claudeSessionId: metadata.claudeSessionId } : {};
    return {};
}

/**
 * Fills a missing agent session ID from earlier metadata of the same session
 * and flavor (first one that has it). An ID already present is kept.
 */
export function withKnownAgentIds(metadata: Metadata, ...earlier: (Metadata | undefined | null)[]): Metadata {
    if (Object.keys(agentIdOf(metadata)).length) return metadata;
    for (const prev of earlier) {
        if (!prev || flavorOf(prev) !== flavorOf(metadata)) continue;
        const ids = agentIdOf(prev);
        if (Object.keys(ids).length) return { ...metadata, ...ids };
    }
    return metadata;
}

/** Applies a reported agent session ID; null when nothing changes. */
export function applyAgentIds(metadata: Metadata, ids: AgentIds): Metadata | null {
    const flavor = flavorOf(metadata);
    if (flavor === 'codex' && ids.codexThreadId && ids.codexThreadId !== metadata.codexThreadId) {
        return { ...metadata, codexThreadId: ids.codexThreadId };
    }
    if (flavor === 'claude' && ids.claudeSessionId && ids.claudeSessionId !== metadata.claudeSessionId) {
        return { ...metadata, claudeSessionId: ids.claudeSessionId };
    }
    return null;
}
