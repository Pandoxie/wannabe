import { hashObject } from '@/utils/deterministicJson';
import type { EnhancedMode } from '../loop';

/**
 * What decides whether a queued message can join the running Claude query.
 * Messages with the same hash run in one query; a different hash ends it and
 * starts the next (claudeRemoteLauncher). `live` leaves out what the SDK can
 * change in a running query — the model (`Query.setModel`, Claude Code's
 * `/model`) and the effort (`applyFlagSettings({ effortLevel })`, its
 * `/effort`) — so a change of only those is applied without a restart.
 */
export function claudeModeHash(mode: EnhancedMode, opts: { live?: boolean } = {}): string {
    return hashObject({
        isPlan: mode.permissionMode === 'plan',
        model: opts.live ? undefined : mode.model,
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools,
        effort: opts.live ? undefined : mode.effort,
    });
}
