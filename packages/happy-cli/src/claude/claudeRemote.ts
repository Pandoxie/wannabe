import { EnhancedMode } from "./loop";
import { query, type CanCallToolOptions, type QueryOptions, type SDKMessage, type SDKSystemMessage, AbortError, SDKUserMessage } from '@/claude/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
import { mapToClaudeMode } from "./utils/permissionMode";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join } from 'node:path';
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import { PermissionResult } from "./sdk/types";
import type { JsRuntime } from "./runClaude";
import { fromRateLimitEvent, windowsFromGetUsage, type UnboundRateLimit, type UsageLimitsPatch, type RateLimitEventInfo } from "./utils/usageLimits";
import type { UsageLimitWindow } from "@/api/types";
import { pluginsFromArgs } from './utils/pluginsFromArgs';
import { claudeProviderAuthMessage } from './utils/providerAuth';

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    signal?: AbortSignal,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: CanCallToolOptions) => Promise<PermissionResult>,
    /** Called when the Query object is ready — allows permission handler to call setPermissionMode */
    onQueryReady?: (query: { setPermissionMode: (mode: string) => Promise<void>; setModel: (model?: string) => Promise<void>; setEffort: (effort: string | null) => Promise<void> }) => void,
    /** Path to temporary settings file with SessionStart hook (required for session tracking) */
    hookSettingsPath: string,
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: MessageParam['content'], mode: EnhancedMode } | null>,
    onReady: (status?: 'failed') => void | Promise<void>,
    isAborted: (toolCallId: string) => boolean,

    // Callbacks
    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void,
    onSDKMetadata?: (metadata: { tools?: string[]; slashCommands?: string[]; mcpServers?: { name: string; status: string }[]; skills?: string[] }) => void,
    /** Per-turn plan rate-limit delta; the launcher merges it into agent state. */
    onUsageLimits?: (patch: UsageLimitsPatch) => void,
    /**
     * Original Happy: plain user text sent while a turn runs joins it
     * (`priority: 'next'`, as Claude Code's own prompt does). `take` returns
     * such text from the queue (null when the next item must wait for the
     * turn to end); `subscribe` calls back on every new queued message.
     */
    steer?: { take: () => string | null; subscribe: (listener: () => void) => () => void },
}) {

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }
    
    // Extract --resume from claudeArgs if present (for first spawn)
    if (!startFrom && opts.claudeArgs) {
        for (let i = 0; i < opts.claudeArgs.length; i++) {
            if (opts.claudeArgs[i] === '--resume') {
                // Check if next arg exists and looks like a session ID
                if (i + 1 < opts.claudeArgs.length) {
                    const nextArg = opts.claudeArgs[i + 1];
                    // If next arg doesn't start with dash and contains dashes, it's likely a UUID
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        startFrom = nextArg;
                        logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                        break;
                    } else {
                        // Just --resume without UUID - SDK doesn't support this
                        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                        break;
                    }
                } else {
                    // --resume at end of args - SDK doesn't support this
                    logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                    break;
                }
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // Handle special commands (extract text for parsing when content is a block array)
    const initialText = typeof initial.message === 'string'
        ? initial.message
        : (initial.message.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined)?.text ?? '';
    const specialCommand = parseSpecialCommand(initialText);

    // Handle /clear command
    if (specialCommand.type === 'clear') {
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Context was reset');
        }
        if (opts.onSessionReset) {
            opts.onSessionReset();
        }
        await opts.onReady();
        return;
    }

    // Handle /compact command
    let isCompactCommand = false;
    if (specialCommand.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected - will process as normal but with compaction behavior');
        isCompactCommand = true;
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction started');
        }
    }

    // Prepare SDK options
    let mode = initial.mode;
    const sdkOptions: QueryOptions = {
        cwd: opts.path,
        resume: startFrom ?? undefined,
        mcpServers: opts.mcpServers,
        plugins: pluginsFromArgs(opts.claudeArgs, opts.path),
        permissionMode: mapToClaudeMode(initial.mode.permissionMode),
        model: initial.mode.model,
        fallbackModel: initial.mode.fallbackModel,
        customSystemPrompt: initial.mode.customSystemPrompt ? initial.mode.customSystemPrompt + '\n\n' + systemPrompt : undefined,
        appendSystemPrompt: initial.mode.appendSystemPrompt ? initial.mode.appendSystemPrompt + '\n\n' + systemPrompt : systemPrompt,
        allowedTools: initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: initial.mode.disallowedTools,
        effort: initial.mode.effort,
        canCallTool: (toolName: string, input: unknown, options: CanCallToolOptions) => opts.canCallTool(toolName, input, mode, options),
        abort: opts.signal,
        settingsPath: opts.hookSettingsPath,
    }

    // Per-turn only: do not retain stale auth state after a user retries.
    let providerAuthFailed = false;

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        if (thinking !== newThinking) {
            thinking = newThinking;
            logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
            if (opts.onThinkingChange) {
                opts.onThinkingChange(thinking);
            }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        parent_tool_use_id: null,
        message: {
            role: 'user',
            content: initial.message,
        },
    });

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    // Expose query control methods to permission handler
    if (opts.onQueryReady) {
        opts.onQueryReady({
            setPermissionMode: (mode: string) => response.setPermissionMode(mode as any),
            setModel: (model?: string) => response.setModel(model),
            setEffort: (effort: string | null) => response.applyFlagSettings({ effortLevel: effort as any }),
        });
    }

    // Plan rate-limit accumulation: events are buffered and flushed once per
    // result (coalescing agent-state writes to at most one per turn). The seed
    // runs on the first result of this invocation — the Query object does not
    // exist before the first user message, so there is no session-start hook.
    const pendingUsageWindows = new Map<string, UsageLimitWindow>();
    let pendingUnbound: UnboundRateLimit | null = null;
    // When get_usage last seeded the windows. Re-read every few minutes:
    // allowed rate_limit_events carry no utilization, so a long-lived query
    // (model and effort now switch in place) would otherwise show the
    // percentage from its start — across a weekly reset, last week's.
    let lastUsageSeedAt = 0;
    const USAGE_RESEED_INTERVAL_MS = 5 * 60_000;
    let lastUsageSignature: string | null = null;
    let lastUsageEmittedAt = 0;
    // Identical data still gets re-written occasionally so the snapshot's
    // capturedAt (the app's "as of" footer) doesn't misreport freshness.
    const USAGE_REFRESH_INTERVAL_MS = 5 * 60_000;
    const flushUsageLimits = async () => {
        if (!opts.onUsageLimits) return;
        let seededThisFlush = false;
        if (Date.now() - lastUsageSeedAt >= USAGE_RESEED_INTERVAL_MS) {
            lastUsageSeedAt = Date.now();
            // typeof-gated: the method is experimental and absent in older SDKs.
            const usageFn = (response as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
            if (typeof usageFn === 'function') {
                try {
                    const usage = await usageFn.call(response);
                    if (usage?.rate_limits_available && usage.rate_limits) {
                        for (const w of windowsFromGetUsage(usage.rate_limits)) {
                            // Events are fresher than the seed for the same
                            // window, but allowed events carry no utilization —
                            // backfill the snapshot's percentage so it isn't
                            // dropped on the floor.
                            const pending = pendingUsageWindows.get(w.id);
                            if (!pending) {
                                pendingUsageWindows.set(w.id, w);
                            } else if (pending.utilization === null || pending.utilization === undefined) {
                                pendingUsageWindows.set(w.id, {
                                    ...pending,
                                    utilization: w.utilization,
                                    resetsAt: pending.resetsAt ?? w.resetsAt,
                                });
                            }
                        }
                        seededThisFlush = true;
                    }
                } catch (e) {
                    logger.debug('[claudeRemote] usage seed failed (ignored)', e);
                }
            }
        }
        if (pendingUsageWindows.size === 0 && !pendingUnbound) return;
        const patch: UsageLimitsPatch = {
            capturedAt: Date.now(),
            windows: [...pendingUsageWindows.values()],
            unbound: pendingUnbound ?? undefined,
            // A full snapshot replaces persisted windows so ones the backend
            // stopped reporting don't linger with a stale status.
            replace: seededThisFlush || undefined,
        };
        pendingUsageWindows.clear();
        pendingUnbound = null;
        const signature = JSON.stringify([patch.windows, patch.unbound ?? null]);
        if (signature === lastUsageSignature && Date.now() - lastUsageEmittedAt < USAGE_REFRESH_INTERVAL_MS) return;
        lastUsageSignature = signature;
        lastUsageEmittedAt = Date.now();
        opts.onUsageLimits(patch);
    };
    // Serialized: a second result must not interleave with a flush that is
    // still awaiting the seed, or it would drain the buffer mid-merge and
    // emit a second, out-of-order patch.
    let usageFlushChain: Promise<void> = Promise.resolve();
    const scheduleUsageFlush = () => {
        usageFlushChain = usageFlushChain
            .then(flushUsageLimits)
            .catch((e) => {
                logger.debug('[claudeRemote] usage flush failed (ignored)', e);
            });
    };

    // Original Happy: a turn is running from a pushed prompt until its result.
    let turnRunning = true;
    let waitingForNext = false;
    // Once the input is ended (the launcher holds the next message for a new
    // query: another mode, or nothing more), this query takes no message of
    // any kind: not the next one, not a steered one. Either would go into an
    // ended input and be lost — three user messages were, on 2026-11-18.
    let inputEnded = false;
    const endInput = () => {
        if (inputEnded) return;
        inputEnded = true;
        messages.end();
    };
    const steerInto = () => {
        if (!turnRunning || inputEnded || !opts.steer) return;
        const text = opts.steer.take();
        if (!text) return;
        logger.debug('[claudeRemote] Steering user text into the running turn');
        messages.push({ type: 'user', parent_tool_use_id: null, priority: 'next', message: { role: 'user', content: text } });
    };
    const stopSteering = opts.steer?.subscribe(steerInto);

    updateThinking(true);
    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        for await (const message of response) {
            const authMessage = claudeProviderAuthMessage(message);
            if (authMessage && !providerAuthFailed) {
                providerAuthFailed = true;
                opts.onCompletionEvent?.(authMessage);
            }
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // Handle messages. During /compact, Claude emits the generated
            // summary as a normal assistant text message before the result.
            // Mark it so downstream UI/protocol mapping can treat it as
            // housekeeping instead of a real assistant response.
            const outboundMessage = isCompactCommand && message.type === 'assistant'
                ? { ...message, isCompactSummary: true } as SDKMessage
                : message;
            opts.onMessage(outboundMessage);

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start thinking when session initializes
                updateThinking(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                // Emit SDK metadata (tools, slash commands) from init message
                if (opts.onSDKMetadata) {
                    opts.onSDKMetadata({
                        tools: systemInit.tools,
                        slashCommands: systemInit.slash_commands,
                        mcpServers: systemInit.mcp_servers?.map(s => ({ name: s.name, status: s.status })),
                        skills: systemInit.skills,
                    });
                }

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                if (systemInit.session_id) {
                    logger.debug(`[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`);
                    const projectDir = getProjectPath(opts.path);
                    const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`), 30000);
                    logger.debug(`[claudeRemote] Session file found: ${systemInit.session_id} ${found}`);
                    if (!found) {
                        // The transcript never landed on disk within the grace
                        // window. We still register the id so the (now
                        // bounded) scanner watcher can pick it up if it shows
                        // up late and otherwise drops it cleanly instead of
                        // wedging — but surface the anomaly so a stuck remote
                        // launch is visible in the app rather than a silent
                        // "dead instance".
                        logger.debug(`[claudeRemote] WARNING: session transcript ${systemInit.session_id} never appeared after 30s`);
                        opts.onCompletionEvent?.('⚠️ Claude session did not produce a transcript — the agent may be unresponsive. Try sending your message again.');
                    }
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            // Buffer plan rate-limit events; flushed on the next result
            if (message.type === 'rate_limit_event') {
                const info = (message as { rate_limit_info?: RateLimitEventInfo }).rate_limit_info;
                if (info) {
                    const normalized = fromRateLimitEvent(info);
                    if (normalized.window) {
                        pendingUsageWindows.set(normalized.window.id, normalized.window);
                    } else if (normalized.unbound) {
                        pendingUnbound = normalized.unbound;
                    }
                }
            }

            // Handle result messages
            if (message.type === 'result') {
                updateThinking(false);
                logger.debug('[claudeRemote] Result received');

                // Fire-and-forget: unavailable for API key / Bedrock / Vertex
                // sessions and experimental besides, so failures are ignored.
                scheduleUsageFlush();

                // Send completion messages
                if (isCompactCommand) {
                    logger.debug('[claudeRemote] Compaction completed');
                    if (opts.onCompletionEvent && !providerAuthFailed) {
                        opts.onCompletionEvent('Compaction completed');
                    }
                    isCompactCommand = false;
                }

                // Send ready event
                if (providerAuthFailed) {
                    await opts.onReady('failed');
                } else {
                    await opts.onReady();
                }
                providerAuthFailed = false;

                // Wait for next user message without blocking the message loop.
                // Background task messages (task_started, task_progress, task_notification)
                // continue flowing through while we wait for user input.
                turnRunning = false;
                // The input was ended while this turn ran (a message on
                // another mode came in): this was the last turn. End the query
                // now rather than wait for Claude Code to exit — it may not —
                // so the launcher starts the next one with the held message.
                if (inputEnded) {
                    logger.debug('[claudeRemote] Input ended and the last turn is done: ending this query');
                    // Leaving the loop only returns the SDK's message stream;
                    // close() is what stops the Claude Code process, so the
                    // next query (--resume) is not a second one on the session.
                    (response as { close?: () => void }).close?.();
                    return;
                }
                // A message steered in just as the turn ended runs as one more
                // turn and ends with a second result: one wait is enough.
                if (waitingForNext) continue;
                waitingForNext = true;
                opts.nextMessage().then((next) => {
                    waitingForNext = false;
                    if (!next) {
                        endInput();
                    } else if (inputEnded) {
                        // Cannot happen (no wait starts after the end), but a message must never be dropped silently.
                        logger.debug('[claudeRemote] A message arrived for an ended input; it is lost');
                    } else {
                        mode = next.mode;
                        turnRunning = true;
                        messages.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: next.message } });
                    }
                }).catch(() => {
                    waitingForNext = false;
                    endInput();
                });
            }

            // Handle tool result
            if (message.type === 'user') {
                const msg = message as SDKUserMessage;
                if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
                    for (let c of msg.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
                            logger.debug('[claudeRemote] Tool aborted, exiting claudeRemote');
                            return;
                        }
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof AbortError) {
            logger.debug(`[claudeRemote] Aborted`);
            // Ignore
        } else {
            throw e;
        }
    } finally {
        stopSteering?.();
        updateThinking(false);
    }
}
