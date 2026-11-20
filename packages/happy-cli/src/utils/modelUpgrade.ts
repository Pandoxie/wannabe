/**
 * Upgrades an older model id from a client to the newest model of the same
 * tier (Original Happy policy: one model per tier, the newest).
 *
 * The native iOS app ships a hard-coded model table that is not updated with
 * ours, so it still offers e.g. Fable 5.1 or GPT-5.6 Terra. Every client sends
 * the model with each message (`meta.model`), and a user can also type
 * `/model <id>`; both pass through here before the agent sees them.
 *
 * Rules:
 * - Only a known tier with an OLDER version is changed. The same or a newer
 *   version (a model released before this table is updated) and any unknown
 *   id pass through unchanged — this never downgrades.
 * - A suffix is kept: `claude-opus-5-dev` → `claude-opus-5-5-dev`.
 * - What belongs to the old version is dropped on upgrade: a dated snapshot
 *   (`-20251001`) and `[1m]` (every model in the table is 1M-native).
 * - Bare Claude Code aliases (`opus`, `sonnet`, `haiku`, `fable`) become the
 *   newest id: Claude Code's own alias table lags (`sonnet` was Sonnet 4.6).
 *
 * Keep NEWEST in step with the web model table
 * (packages/happy-app/sources/components/modelModeOptions.ts).
 */

const NEWEST_CLAUDE: Record<string, [number, number]> = {
    fable: [5, 2],
    opus: [5, 5],
    sonnet: [5, 5],
    haiku: [5, 5],
};

const NEWEST_CODEX: Record<string, [number, number]> = {
    astra: [6, 2],
    sol: [6, 2],
    terra: [6, 1],
    luna: [6, 0],
};

const older = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Suffix kept on upgrade: without `[1m]` and without a dated snapshot. */
function carrySuffix(rest: string): string {
    return rest
        .replace(/\[1m\]$/i, '')
        .replace(/^-\d{8}(?=$|-)/, '');
}

function claudeId(tier: string, [major, minor]: [number, number], suffix: string): string {
    return `claude-${tier}-${major}-${minor}${suffix}`;
}

function codexId(tier: string, [major, minor]: [number, number], suffix: string): string {
    return `gpt-${minor === 0 ? major : `${major}.${minor}`}-${tier}${suffix}`;
}

export function upgradeModelId(model: string): string {
    const id = model.trim();

    const alias = /^(fable|opus|sonnet|haiku)(\[1m\])?$/i.exec(id);
    if (alias) {
        const tier = alias[1].toLowerCase();
        return claudeId(tier, NEWEST_CLAUDE[tier], '');
    }

    // claude-<tier>-<major>[-<minor>]<rest>; a minor is one or two digits, so
    // a dated snapshot (8 digits) is never read as a version.
    const claude = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?=$|-|\[)(.*)$/i.exec(id);
    if (claude) {
        const tier = claude[1].toLowerCase();
        const version: [number, number] = [Number(claude[2]), Number(claude[3] ?? 0)];
        const newest = NEWEST_CLAUDE[tier];
        return older(version, newest) ? claudeId(tier, newest, carrySuffix(claude[4])) : model;
    }

    // gpt-<major>[.<minor>]-<tier><rest>
    const codex = /^gpt-(\d+)(?:\.(\d+))?-(astra|sol|terra|luna)(?=$|-)(.*)$/i.exec(id);
    if (codex) {
        const tier = codex[3].toLowerCase();
        const version: [number, number] = [Number(codex[1]), Number(codex[2] ?? 0)];
        const newest = NEWEST_CODEX[tier];
        return older(version, newest) ? codexId(tier, newest, carrySuffix(codex[4])) : model;
    }

    return model;
}

/** `/model <id>` typed into the chat: upgrades the id, keeps everything else. */
export function upgradeModelCommand(text: string): string {
    const match = /^(\s*\/model\s+)(\S+)/.exec(text);
    if (!match) return text;
    const upgraded = upgradeModelId(match[2]);
    return upgraded === match[2] ? text : match[1] + upgraded + text.slice(match[0].length);
}
