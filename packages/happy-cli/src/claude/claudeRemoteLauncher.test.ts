import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { claudeRemoteLauncher } from './claudeRemoteLauncher';
import { claudeModeHash } from './utils/claudeModeHash';
import { closeClaudeTurnWithStatus, mapClaudeLogMessageToSessionEnvelopes, type ClaudeSessionProtocolState } from './utils/sessionProtocolMapper';
import { CLAUDE_LOGIN_EXPIRED_MESSAGE } from './utils/providerAuth';
import type { SessionEnvelope } from '@slopus/happy-wire';

// Exercise the real outgoing queue, SDK converter and protocol mapper without
// a terminal, credential store, provider process, relay or push service.
vi.mock('./claudeRemote', () => ({ claudeRemote: vi.fn() }));
vi.mock('ink', () => ({ render: vi.fn() }));
vi.mock('@/ui/ink/RemoteModeDisplay', () => ({ RemoteModeDisplay: vi.fn() }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/ui/messageFormatterInk', () => ({ formatClaudeMessageForInk: vi.fn() }));
vi.mock('@/utils/terminalStdinCleanup', () => ({ cleanupStdinAfterInk: vi.fn() }));
vi.mock('node:child_process', () => ({ execSync: () => 'fixture-branch' }));
vi.mock('./utils/permissionHandler', () => ({
    PermissionHandler: class {
        reset = vi.fn();
        setOnPermissionRequest = vi.fn();
        getResponseLookup = () => new Map();
        handleToolCall = vi.fn();
        handleModeChange = vi.fn();
        setPermissionModeUpdater = vi.fn();
    },
}));

function fixture() {
    const handlers = new Map<string, () => Promise<void>>();
    const state: ClaudeSessionProtocolState = { currentTurnId: null };
    const envelopes: SessionEnvelope[] = [];
    const session = {
        sessionId: 'fixture-session', path: '/fixture/project', hookSettingsPath: '/fixture/settings.json',
        queue: { size: () => 0 },
        consumeOneTimeFlags: vi.fn(),
        api: { push: () => ({ sendSessionNotification: notification }) },
        client: {
            sessionId: 'fixture-happy-session',
            rpcHandlerManager: { registerHandler: (name: string, handler: () => Promise<void>) => handlers.set(name, handler) },
            getMetadata: () => ({}),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn((message) => {
                const mapped = mapClaudeLogMessageToSessionEnvelopes(message, state);
                state.currentTurnId = mapped.currentTurnId;
                envelopes.push(...mapped.envelopes);
            }),
            closeClaudeSessionTurn: vi.fn((status) => {
                const mapped = closeClaudeTurnWithStatus(state, status);
                state.currentTurnId = mapped.currentTurnId;
                envelopes.push(...mapped.envelopes);
            }),
        },
    };
    const notification = vi.fn();
    const stop = () => { void handlers.get('switch')!(); };
    return { session, state, envelopes, notification, stop };
}

describe('claudeRemoteLauncher provider auth', () => {
    beforeEach(() => { vi.mocked(claudeRemote).mockReset(); });

    it('flushes back-to-back auth output before closing the failed wire turn, without a done push', async () => {
        const { session, state, envelopes, notification, stop } = fixture();
        let eventsAtReady: string[] = [];
        let turnAtReady: string | null | undefined;
        vi.mocked(claudeRemote).mockImplementation(async opts => {
            opts.onCompletionEvent?.(CLAUDE_LOGIN_EXPIRED_MESSAGE);
            opts.onMessage({
                type: 'assistant', error: 'authentication_failed', parent_tool_use_id: null,
                message: { role: 'assistant', content: [{ type: 'text', text: 'Provider login failed' }] },
            } as any);
            await opts.onReady('failed');
            // Verify before cleanup's final flush can hide incorrect ordering.
            eventsAtReady = envelopes.map(envelope => envelope.ev.t);
            turnAtReady = state.currentTurnId;
            stop();
        });
        await claudeRemoteLauncher(session as any);
        expect(eventsAtReady).toEqual(['turn-start', 'text', 'turn-end']);
        expect(envelopes.at(-1)?.ev).toEqual({ t: 'turn-end', status: 'failed' });
        expect(turnAtReady).toBeNull();
        expect(notification).not.toHaveBeenCalled();
        expect(session.client.sendSessionEvent).toHaveBeenCalledWith({ type: 'message', message: CLAUDE_LOGIN_EXPIRED_MESSAGE });
        expect(envelopes.filter(envelope => envelope.ev.t === 'turn-end')).toHaveLength(1);
    });

    it('shows untruncated host-login guidance for a thrown OAuth error and accepts a later invocation', async () => {
        const { session, notification, stop } = fixture();
        vi.mocked(claudeRemote)
            .mockRejectedValueOnce(new Error('Failed to authenticate: OAuth session expired and could not be refreshed\nhttps://fixture-secret@example.invalid'))
            .mockImplementationOnce(async () => { stop(); });
        await claudeRemoteLauncher(session as any);
        expect(session.client.closeClaudeSessionTurn).toHaveBeenCalledWith('failed');
        expect(session.client.sendSessionEvent).toHaveBeenCalledWith({ type: 'message', message: CLAUDE_LOGIN_EXPIRED_MESSAGE });
        expect(JSON.stringify(session.client.sendSessionEvent.mock.calls)).not.toContain('fixture-secret');
        expect(notification).not.toHaveBeenCalled();
        expect(claudeRemote).toHaveBeenCalledTimes(2);
    });
});
describe('claudeRemoteLauncher model changes (Original Happy)', () => {
    beforeEach(() => { vi.mocked(claudeRemote).mockReset(); });

    const mode = (model: string, effort = 'medium') => ({ permissionMode: 'auto', model, effort });
    const batch = (message: string, m: ReturnType<typeof mode>) => ({ message, mode: m, isolate: false, hash: claudeModeHash(m as any), attachments: [] });

    function run(batches: any[], opts: { setModelFails?: boolean; queries: number }) {
        const { session, stop } = fixture();
        (session as any).queue = { size: () => 0, waitForMessagesAndGetAsString: vi.fn(async () => batches.shift() ?? null) };
        (session as any).client.updateMetadata = vi.fn();
        (session as any).client.updateAgentState = vi.fn();
        const queries: string[][] = [];
        const setModel = vi.fn(async (model?: string) => { if (opts.setModelFails) throw new Error('no'); });
        const setEffort = vi.fn(async (effort: string | null) => {});
        vi.mocked(claudeRemote).mockImplementation(async (o: any) => {
            o.onQueryReady?.({ setPermissionMode: vi.fn(), setModel, setEffort });
            // One query: its first message, then follow-ups until told to end (null).
            const models: string[] = [];
            for (let next = await o.nextMessage(); next; next = await o.nextMessage()) models.push(next.mode.model);
            queries.push(models);
            // Stop after the last expected query (a pending batch still opens one).
            if (queries.length === opts.queries) stop();
        });
        return { done: claudeRemoteLauncher(session as any), queries, setModel, setEffort };
    }

    it('switches the model in the running query, every time, without a restart', async () => {
        const { done, queries, setModel } = run([
            batch('a', mode('claude-opus-5-5')), batch('b', mode('claude-fable-5-2')), batch('c', mode('claude-sonnet-5-5')),
        ], { queries: 1 });
        await done;
        expect(queries[0]).toEqual(['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5']);
        expect(setModel.mock.calls).toEqual([['claude-fable-5-2'], ['claude-sonnet-5-5']]);
    });

    it('switches the effort in the running query too, and model + effort together', async () => {
        const { done, queries, setModel, setEffort } = run([
            batch('a', mode('claude-opus-5-5')), batch('b', mode('claude-opus-5-5', 'high')), batch('c', mode('claude-sonnet-5-5', 'low')),
        ], { queries: 1 });
        await done;
        expect(queries[0]).toEqual(['claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
        expect(setEffort.mock.calls).toEqual([['high'], ['low']]);
        expect(setModel.mock.calls).toEqual([['claude-sonnet-5-5']]);
    });

    it('still restarts for other changes (plan mode), then switches live again', async () => {
        const plan = { ...mode('claude-fable-5-2'), permissionMode: 'plan' };
        const { done, queries, setModel } = run([
            batch('a', mode('claude-opus-5-5')), batch('b', plan as any), batch('c', { ...plan, model: 'claude-sonnet-5-5' } as any),
        ], { queries: 2 });
        await done;
        expect(queries.slice(0, 2)).toEqual([['claude-opus-5-5'], ['claude-fable-5-2', 'claude-sonnet-5-5']]);
        expect(setModel.mock.calls).toEqual([['claude-sonnet-5-5']]);
    });

    it('keeps the pictures of a batch that opens the next query (upstream cf1e5da3d)', async () => {
        // A 1x1 PNG: the magic bytes are what decide that it is sent.
        const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
        const plan = { ...mode('claude-fable-5-2'), permissionMode: 'plan' };
        const withPicture = { ...batch('look', plan as any), attachments: [{ name: 'a.png', mimeType: 'image/png', data: png }] };
        const { session, stop } = fixture();
        const batches: any[] = [batch('a', mode('claude-opus-5-5')), withPicture];
        (session as any).queue = { size: () => 0, waitForMessagesAndGetAsString: vi.fn(async () => batches.shift() ?? null) };
        (session as any).client.updateMetadata = vi.fn();
        (session as any).client.updateAgentState = vi.fn();
        const firsts: any[] = [];
        vi.mocked(claudeRemote).mockImplementation(async (o: any) => {
            o.onQueryReady?.({ setPermissionMode: vi.fn(), setModel: vi.fn(), setEffort: vi.fn() });
            const first = await o.nextMessage();
            firsts.push(first);
            while (await o.nextMessage()) { /* follow-ups */ }
            if (firsts.length === 2) stop();
        });
        await claudeRemoteLauncher(session as any);
        const content = firsts[1].message;
        expect(Array.isArray(content)).toBe(true);
        expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
        expect(content[1]).toEqual({ type: 'text', text: 'look' });
    });

    it('restarts the query when setModel fails, on every change', async () => {
        const { done, queries } = run([
            batch('a', mode('claude-opus-5-5')), batch('b', mode('claude-fable-5-2')), batch('c', mode('claude-sonnet-5-5')),
        ], { setModelFails: true, queries: 3 });
        await done;
        expect(queries.slice(0, 3)).toEqual([['claude-opus-5-5'], ['claude-fable-5-2'], ['claude-sonnet-5-5']]);
    });
});
