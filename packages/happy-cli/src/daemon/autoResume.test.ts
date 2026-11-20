import { describe, it, expect } from 'vitest';
import { pickResumableSessions, archivedOnRelay, AUTO_RESUME_MAX_AGE_MS } from './autoResume';
import type { PersistedSession } from '@/persistence';
import type { Metadata } from '@/api/types';

const now = 1_800_000_000_000;

function record(over: Partial<Metadata> = {}, at = now - 60_000): PersistedSession {
    return {
        encryptionKey: 'k',
        encryptionVariant: 'dataKey',
        seq: 0,
        metadataVersion: 0,
        agentStateVersion: 0,
        savedAt: at,
        lastAliveAt: at,
        metadata: {
            path: '/home/dev',
            host: 'box',
            startedBy: 'daemon',
            lifecycleState: 'running',
            hostPid: 4242,
            ...over,
        } as Metadata,
    };
}

const dead = () => false;
const alive = () => true;

describe('sessions to bring back at startup', () => {
    it('picks a daemon-started session that is not running any more', () => {
        const got = pickResumableSessions({ s1: record() }, { now, alive: dead });
        expect(got.map((c) => c.sessionId)).toEqual(['s1']);
    });

    it('never picks one the user archived', () => {
        const got = pickResumableSessions(
            { s1: record({ lifecycleState: 'archived', archivedBy: 'cli' }) },
            { now, alive: dead },
        );
        expect(got).toEqual([]);
    });

    it('never picks one that is still running', () => {
        expect(pickResumableSessions({ s1: record() }, { now, alive })).toEqual([]);
    });

    it('never picks one started from a terminal', () => {
        expect(pickResumableSessions({ s1: record({ startedBy: 'terminal' }) }, { now, alive: dead })).toEqual([]);
    });

    it('leaves old records alone', () => {
        const old = record({}, now - AUTO_RESUME_MAX_AGE_MS - 1);
        expect(pickResumableSessions({ s1: old }, { now, alive: dead })).toEqual([]);
    });

    it('falls back to savedAt when lastAliveAt is missing', () => {
        const r = record({}, now - 60_000);
        delete r.lastAliveAt;
        expect(pickResumableSessions({ s1: r }, { now, alive: dead })).toHaveLength(1);
    });

    it('skips a record without a path or metadata', () => {
        expect(pickResumableSessions({ s1: record({ path: '' }) }, { now, alive: dead })).toEqual([]);
        expect(pickResumableSessions({ s1: { ...record(), metadata: undefined as any } }, { now, alive: dead })).toEqual([]);
    });

    it('picks a Codex session the same way', () => {
        const got = pickResumableSessions({ s1: record({ flavor: 'codex', codexThreadId: 't1' }) }, { now, alive: dead });
        expect(got).toHaveLength(1);
    });
});

describe('the relay has the last word', () => {
    it('treats an archived session as archived', () => {
        expect(archivedOnRelay({ lifecycleState: 'archived' } as Metadata)).toBe(true);
    });
    it('treats running or unknown as not archived', () => {
        expect(archivedOnRelay({ lifecycleState: 'running' } as Metadata)).toBe(false);
        expect(archivedOnRelay(null)).toBe(false);
    });

    it('says why each record was not picked (Original Happy, 2026-11-18)', () => {
        const reasons: string[] = [];
        pickResumableSessions({
            live: record(),
            terminal: record({ startedBy: 'terminal' }),
        }, { now, alive: (r) => r.metadata?.startedBy === 'daemon', onSkip: (id, why) => reasons.push(`${id}: ${why}`) });
        expect(reasons).toEqual([
            expect.stringMatching(/^live: pid .* still its live process$/),
            'terminal: started by terminal',
        ]);
    });
});
