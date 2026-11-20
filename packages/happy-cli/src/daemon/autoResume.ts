/**
 * Original Happy: bring back sessions that were stopped, not archived.
 *
 * A session process is killed (`happy-sandbox down`, a host shutdown, the
 * daemon stopping) without the user asking for it. It keeps running state on
 * the relay as `active=false`, and its record stays in `sessions.json` with
 * `lifecycleState: 'running'` — but nothing starts it again, so the user has
 * to `happy resume <id>` by hand.
 *
 * At startup the daemon resumes exactly those, and never anything the user
 * archived: archiving stamps `lifecycleState: 'archived'` (from the app's
 * Archive, or `happy daemon stop-session`), and that is checked both in the
 * saved record and, when reachable, in the relay's current metadata.
 *
 * Only sessions the daemon started are considered (`startedBy: 'daemon'`):
 * one started in a terminal belongs to that terminal.
 */
import type { Metadata } from '@/api/types';
import type { PersistedSession } from '@/persistence';

/** How long after it was last alive a stopped session is brought back. */
export const AUTO_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResumeCandidate = { sessionId: string; record: PersistedSession };

export type PickOptions = {
    now: number;
    /** Does the record's host PID still name its own live process? */
    alive: (record: PersistedSession) => boolean;
    maxAgeMs?: number;
    /** Why a record was not picked (logged, so a silent "0" can be explained). */
    onSkip?: (sessionId: string, reason: string) => void;
};

/**
 * The stopped sessions worth resuming, decided from the saved record alone.
 * `resumeRejected` is the relay-side check, applied by the caller.
 */
export function pickResumableSessions(
    persisted: Record<string, PersistedSession>,
    opts: PickOptions,
): ResumeCandidate[] {
    const maxAge = opts.maxAgeMs ?? AUTO_RESUME_MAX_AGE_MS;
    const out: ResumeCandidate[] = [];
    const skip = (sessionId: string, reason: string) => opts.onSkip?.(sessionId, reason);
    for (const [sessionId, record] of Object.entries(persisted)) {
        const meta: Metadata | undefined = record?.metadata;
        if (!meta) { skip(sessionId, 'no metadata'); continue; }
        // Started by a daemon, and still meant to be running. Archiving —
        // the app's Archive, `happy daemon stop-session` — stamps
        // 'archived'; a killed process (sandbox down, reboot) leaves
        // 'running', which is the case this brings back.
        if (meta.startedBy !== 'daemon') { skip(sessionId, `started by ${meta.startedBy ?? 'a terminal'}`); continue; }
        if (meta.lifecycleState !== 'running') { skip(sessionId, `lifecycle ${meta.lifecycleState ?? 'unknown'}`); continue; }
        // Stopped because the user asked (the app's Stop): not a kill.
        if (record.stoppedByDaemon) { skip(sessionId, 'stopped by the user'); continue; }
        // A live process owns it: nothing to do (the daemon adopts it).
        if (opts.alive(record)) { skip(sessionId, `pid ${meta.hostPid} still its live process`); continue; }
        // Old records are history, not something to reopen on every boot.
        const lastAlive = record.lastAliveAt ?? record.savedAt ?? 0;
        if (opts.now - lastAlive > maxAge) { skip(sessionId, 'last alive over the age limit'); continue; }
        if (!meta.path) { skip(sessionId, 'no path'); continue; }
        out.push({ sessionId, record });
    }
    return out;
}

/** The relay's word on it: a session archived there is never resumed. */
export function archivedOnRelay(metadata: Metadata | null | undefined): boolean {
    return metadata?.lifecycleState === 'archived';
}
