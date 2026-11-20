import * as React from 'react';
import { t } from '@/text';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { NativeSegmentedControl } from '@/components/NativeSegmentedControl';
import { navigateToSession } from '@/hooks/useNavigateToSession';
import { contentIndex, readAllMessages, useContentHits, useContentReader, useSearchableSessions, useSearchStore, type SearchScope } from '@/hooks/useSessionSearch';
import { useSearchFocus } from '@/sync/searchFocus';
import { filterSessions } from '@/utils/sessionSearch';
import { formatLastSeen } from '@/utils/sessionUtils';

const scopes = () => [{ key: 'titles', label: t('originalHappy.search.titles') }, { key: 'messages', label: t('originalHappy.search.messages') }];
let focusHandled = 0;
const SNIPPETS_SHOWN = 5;

/**
 * Original Happy: the right panel's Search, next to Changes / All files /
 * Side chat. The query and the results live outside the session, so they stay
 * while you jump between sessions: a message hit opens its session at that
 * message. Messages are read and searched in this browser only, once, and
 * again only on Refresh.
 */
export const SearchPanel = React.memo(function SearchPanel({ currentSessionId }: { currentSessionId: string }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const query = useSearchStore((s) => s.query);
    const scope = useSearchStore((s) => s.scope);
    const progress = useSearchStore((s) => s.progress);
    const failed = useSearchStore((s) => s.failed);
    const set = useSearchStore((s) => s.set);
    const focusInput = useSearchStore((s) => s.focusInput);
    const inputRef = React.useRef<TextInput>(null);
    React.useEffect(() => {
        // Each press of the header's Search button once, also when it mounts the panel.
        if (focusInput > focusHandled) {
            focusHandled = focusInput;
            inputRef.current?.focus();
        }
    }, [focusInput]);
    const rows = useSearchableSessions();
    useContentReader(rows, scope === 'messages');
    const hits = useContentHits();
    const byId = React.useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
    const titleMatches = React.useMemo(() => (scope === 'titles' && query.trim() ? filterSessions(rows, query, 'all') : []), [rows, query, scope]);
    const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
    const reading = scope === 'messages' && progress !== null;
    const refresh = React.useCallback(() => {
        void readAllMessages(rows.map((row) => row.id));
    }, [rows]);

    const openAt = React.useCallback((sessionId: string, createdAt: number, seq: number) => {
        useSearchFocus.getState().focus(sessionId, createdAt, useSearchStore.getState().query, seq);
        if (sessionId !== currentSessionId) navigateToSession(router, sessionId);
    }, [currentSessionId, router]);

    return (
        <View style={{ flex: 1 }}>
            <View style={styles.searchWrap}>
                <Octicons name="search" size={14} color={theme.colors.textSecondary} style={styles.searchIcon} />
                <TextInput
                    ref={inputRef}
                    value={query}
                    onChangeText={(text) => set({ query: text })}
                    placeholder={scope === 'titles' ? t('originalHappy.search.placeholderTitles') : t('originalHappy.search.placeholderMessages')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    style={[styles.searchInput, { color: theme.colors.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {query.length > 0 && (
                    <Pressable onPress={() => set({ query: '' })} hitSlop={8} accessibilityLabel={t('originalHappy.search.clear')}>
                        <Octicons name="x-circle-fill" size={14} color={theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>
            <View style={styles.scopeWrap}>
                <NativeSegmentedControl options={scopes()} selectedKey={scope} onSelect={(key) => set({ scope: key as SearchScope })} accessibilityLabel={t('originalHappy.search.searchIn')} />
            </View>
            {scope === 'messages' && (
                <View style={styles.status}>
                    {reading && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                    <Text style={styles.statusText} numberOfLines={2}>
                        {reading
                            ? t('originalHappy.search.reading', { progress: progress ? `${progress.done} / ${progress.total}` : '' })
                            : failed > 0
                                ? t('originalHappy.search.unread', { count: failed })
                                : contentIndex.lastBuiltAt > 0
                                    ? t('originalHappy.search.readAgo', { time: formatLastSeen(contentIndex.lastBuiltAt, false) })
                                    : ''}
                    </Text>
                    <Pressable
                        onPress={refresh}
                        disabled={reading}
                        hitSlop={8}
                        accessibilityLabel={t('originalHappy.search.refreshHint')}
                        style={({ pressed }) => [styles.refresh, (pressed || reading) && styles.refreshDim]}
                        {...(Platform.OS === 'web' ? { title: t('originalHappy.search.refreshHint') } as any : {})}
                    >
                        <Octicons name="sync" size={12} color={theme.colors.textSecondary} />
                        <Text style={styles.refreshText}>{t('originalHappy.search.refresh')}</Text>
                    </Pressable>
                </View>
            )}

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                {!query.trim() ? (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconWrap}>
                            <Octicons name="search" size={28} color={theme.colors.textSecondary} />
                        </View>
                        <Text style={styles.emptyTitle}>{scope === 'titles' ? t('originalHappy.search.emptyTitles') : t('originalHappy.search.emptyMessages')}</Text>
                        <Text style={styles.emptySubtitle}>
                            {scope === 'titles'
                                ? t('originalHappy.search.emptyTitlesHint')
                                : t('originalHappy.search.emptyMessagesHint')}
                        </Text>
                    </View>
                ) : scope === 'titles' ? (
                    titleMatches.length === 0 ? (
                        <Text style={styles.noResults}>{t('originalHappy.search.nothing')}</Text>
                    ) : (
                        <View style={styles.rows}>
                            {titleMatches.map((session) => (
                                <Pressable
                                    key={session.id}
                                    onPress={() => session.id !== currentSessionId && navigateToSession(router, session.id)}
                                    style={({ pressed }) => [styles.row, session.id === currentSessionId && styles.rowSelected, pressed && styles.rowPressed]}
                                >
                                    <Text style={styles.rowTitle} numberOfLines={1}>{session.name}</Text>
                                    <Text style={styles.rowMeta} numberOfLines={1}>
                                        {[session.machineName, session.path, session.archived ? formatLastSeen(session.lastActivityAt, false) : 'running'].filter(Boolean).join(' · ')}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    )
                ) : hits.length === 0 ? (
                    reading ? null : <Text style={styles.noResults}>{t('originalHappy.search.nothing')}</Text>
                ) : (
                    <View style={styles.rows}>
                        {hits.map((hit) => {
                            const session = byId.get(hit.sessionId);
                            if (!session) return null;
                            const open = expanded.has(hit.sessionId);
                            const shown = open ? hit.snippets : hit.snippets.slice(0, SNIPPETS_SHOWN);
                            return (
                                <View key={hit.sessionId} style={styles.group}>
                                    <View style={styles.groupHeader}>
                                        <Text style={styles.groupTitle} numberOfLines={1}>{session.name}</Text>
                                        <Text style={styles.groupCount}>{hit.count}</Text>
                                    </View>
                                    {shown.map((snippet, i) => (
                                        <Pressable
                                            key={`${snippet.createdAt}:${i}`}
                                            onPress={() => openAt(hit.sessionId, snippet.createdAt, snippet.seq)}
                                            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                                        >
                                            <Text style={styles.snippet} numberOfLines={3}>{snippet.text}</Text>
                                            <Text style={styles.rowMeta} numberOfLines={1}>
                                                {`${snippet.role === 'user' ? t('originalHappy.search.you') : t('originalHappy.search.agent')} · ${formatLastSeen(snippet.createdAt, false)}`}
                                            </Text>
                                        </Pressable>
                                    ))}
                                    {hit.snippets.length > SNIPPETS_SHOWN && (
                                        <Pressable
                                            onPress={() => setExpanded((current) => {
                                                const next = new Set(current);
                                                if (next.has(hit.sessionId)) next.delete(hit.sessionId); else next.add(hit.sessionId);
                                                return next;
                                            })}
                                            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                                        >
                                            <Text style={styles.more}>{open ? t('originalHappy.search.fewer') : t('originalHappy.search.more', { count: hit.snippets.length - SNIPPETS_SHOWN })}</Text>
                                        </Pressable>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </View>
    );
});

// Sizes, colours and the search field as in the All files panel (FilesSidebar).
const styles = StyleSheet.create((theme) => ({
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 12,
        marginBottom: 6,
        paddingHorizontal: 10,
        paddingVertical: Platform.select({ web: 6, default: 8 }),
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 6,
    },
    searchIcon: {
        opacity: 0.8,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
        padding: 0,
        ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : null),
    },
    scopeWrap: {
        marginHorizontal: 12,
        marginBottom: 6,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginBottom: 6,
    },
    statusText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    refresh: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    refreshDim: {
        opacity: 0.5,
    },
    refreshText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    list: {
        flex: 1,
    },
    listContent: {
        flexGrow: 1,
        paddingBottom: 16,
    },
    rows: {
        paddingHorizontal: 4,
    },
    row: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 6,
        gap: 2,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    rowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    rowTitle: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    rowMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    group: {
        marginBottom: 8,
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 2,
    },
    groupTitle: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    groupCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    snippet: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    more: {
        fontSize: 12,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
    noResults: {
        paddingTop: 24,
        textAlign: 'center',
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 4,
    },
    emptyIconWrap: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        marginBottom: 12,
    },
    emptyTitle: {
        fontSize: 15,
        color: theme.colors.text,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptySubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
