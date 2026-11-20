import * as React from 'react';
import { Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from '@/utils/responsive';
import { useSettingMutable } from '@/sync/storage';
import { deleteSessions, useSessionSelection } from '@/sync/sessionSelection';
import { useSearchableSessions } from '@/hooks/useSessionSearch';
import { MainView } from './MainView';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { ShortcutHintBadge, useShortcutHints } from './ShortcutHints';
import { useHasArchivedSessions } from '@/hooks/useVisibleSessionListViewData';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    topControls: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        gap: 8,
    },
    newSessionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 8,
    },
    newSessionButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    archiveButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    archiveButtonActive: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    shortcutTargetActive: {
        backgroundColor: theme.colors.surfacePressed,
    },
    newSessionText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
    settingsText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default(),
    },
    shortcutBadgeInline: {
        marginLeft: 'auto',
    },
    selectBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 6,
        gap: 8,
    },
    selectBarButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    selectBarText: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    selectBarDelete: {
        color: theme.colors.textDestructive,
    },
    selectBarDisabled: {
        color: theme.colors.textSecondary,
    },
    selectBarHint: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

export const SidebarView = React.memo(() => {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
    const hasArchivedSessions = useHasArchivedSessions();
    // Stored under its original `hideInactiveSessions` key — synced settings
    // have no rename migration — but it hides archived sessions only.
    const [hideArchivedSessions, setHideArchivedSessions] = useSettingMutable('hideInactiveSessions');
    const { visible: shortcutHintsVisible } = useShortcutHints();

    const handleNewSession = React.useCallback(() => {
        router.navigate('/new');
    }, [router]);
    // Original Happy: Select picks archived sessions in the list to delete
    // them. Archived rows are shown while picking (and hidden again after, if
    // they were); Search lives in the session header (right panel).
    const selecting = useSessionSelection((state) => state.selecting);
    const selected = useSessionSelection((state) => state.selected);
    const searchable = useSearchableSessions();
    const archivedIds = React.useMemo(() => searchable.filter((row) => row.deletable).map((row) => row.id), [searchable]);
    const toDelete = React.useMemo(() => archivedIds.filter((id) => selected.has(id)), [archivedIds, selected]);
    const hiddenBeforeRef = React.useRef<boolean | null>(null);
    const [deleting, setDeleting] = React.useState(false);
    const startSelecting = React.useCallback(() => {
        hiddenBeforeRef.current = !!hideArchivedSessions;
        if (hideArchivedSessions) setHideArchivedSessions(false);
        useSessionSelection.getState().start();
    }, [hideArchivedSessions, setHideArchivedSessions]);
    const stopSelecting = React.useCallback(() => {
        useSessionSelection.getState().stop();
        if (hiddenBeforeRef.current) setHideArchivedSessions(true);
        hiddenBeforeRef.current = null;
    }, [setHideArchivedSessions]);
    const runDelete = React.useCallback(async () => {
        setDeleting(true);
        try {
            if (await deleteSessions(toDelete)) stopSelecting();
        } finally {
            setDeleting(false);
        }
    }, [toDelete, stopSelecting]);
    const allSelected = archivedIds.length > 0 && toDelete.length === archivedIds.length;
    const handleArchiveVisibility = React.useCallback(() => {
        setHideArchivedSessions(!hideArchivedSessions);
    }, [hideArchivedSessions, setHideArchivedSessions]);
    return (
        <View style={[styles.container, { paddingTop: safeArea.top + headerHeight }]}>
            <View style={styles.topControls}>
                <Pressable
                    onPress={handleNewSession}
                    style={({ pressed }) => [
                        styles.newSessionButton,
                        shortcutHintsVisible && styles.shortcutTargetActive,
                        pressed && styles.newSessionButtonPressed,
                    ]}
                >
                    <Ionicons name="create-outline" size={16} color={stylesheet.newSessionText.color} />
                    <Text style={styles.newSessionText}>{t('sidebar.newSession')}</Text>
                    <ShortcutHintBadge shortcutKey="N" style={styles.shortcutBadgeInline} />
                </Pressable>
                {hasArchivedSessions && (
                    <Pressable
                        onPress={selecting ? stopSelecting : startSelecting}
                        accessibilityLabel={selecting ? t('originalHappy.select.done') : t('originalHappy.select.start')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: selecting }}
                        style={({ pressed }) => [
                            styles.archiveButton,
                            selecting && styles.archiveButtonActive,
                            pressed && styles.newSessionButtonPressed,
                        ]}
                        {...({ title: selecting ? t('originalHappy.select.done') : t('originalHappy.select.start') } as any)}
                    >
                        <Ionicons
                            name={selecting ? 'checkmark-circle' : 'checkmark-circle-outline'}
                            size={18}
                            color={stylesheet.newSessionText.color}
                        />
                    </Pressable>
                )}
                {hasArchivedSessions && !selecting && (
                    <Pressable
                        onPress={handleArchiveVisibility}
                        accessibilityLabel={hideArchivedSessions
                            ? t('sidebar.showArchived')
                            : t('sidebar.hideArchived')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !hideArchivedSessions }}
                        style={({ pressed }) => [
                            styles.archiveButton,
                            !hideArchivedSessions && styles.archiveButtonActive,
                            pressed && styles.newSessionButtonPressed,
                        ]}
                    >
                        <Ionicons
                            name={hideArchivedSessions ? 'archive-outline' : 'archive'}
                            size={18}
                            color={stylesheet.newSessionText.color}
                        />
                    </Pressable>
                )}
            </View>

            {selecting && (
                <View style={styles.selectBar}>
                    <Text style={styles.selectBarHint} numberOfLines={1}>
                        {toDelete.length > 0 ? t('originalHappy.select.selected', { count: toDelete.length }) : t('originalHappy.select.pick')}
                    </Text>
                    <Pressable
                        onPress={() => useSessionSelection.getState().setAll(allSelected ? [] : archivedIds)}
                        style={({ pressed }) => [styles.selectBarButton, pressed && styles.newSessionButtonPressed]}
                    >
                        <Text style={styles.selectBarText}>{allSelected ? t('originalHappy.select.none') : t('originalHappy.select.all', { count: archivedIds.length })}</Text>
                    </Pressable>
                    <Pressable
                        onPress={runDelete}
                        disabled={toDelete.length === 0 || deleting}
                        style={({ pressed }) => [styles.selectBarButton, pressed && styles.newSessionButtonPressed]}
                    >
                        <Text style={[styles.selectBarText, toDelete.length > 0 && !deleting ? styles.selectBarDelete : styles.selectBarDisabled]}>
                            {deleting ? t('originalHappy.select.deleting') : t('common.delete')}
                        </Text>
                    </Pressable>
                </View>
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Settings at bottom */}
            <Pressable
                onPress={() => router.push('/settings')}
                style={[
                    styles.settingsRow,
                    shortcutHintsVisible && styles.shortcutTargetActive,
                ]}
            >
                <Ionicons name="settings-outline" size={18} color={stylesheet.settingsText.color} />
                <Text style={styles.settingsText}>{t('settings.title')}</Text>
                <ShortcutHintBadge shortcutKey="," style={styles.shortcutBadgeInline} />
            </Pressable>
        </View>
    );
});
