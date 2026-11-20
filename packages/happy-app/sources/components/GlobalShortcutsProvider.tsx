import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { useAllMachines } from '@/sync/storage';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { ShortcutHintsProvider } from '@/components/ShortcutHints';
import { isTauri } from '@/utils/isTauri';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { getSessionShortcutIdsInDisplayOrder } from '@/utils/sessionDisplayOrder';
import { t } from '@/text';

const EMPTY_SESSION_IDS: readonly string[] = [];

/**
 * App-wide keyboard shortcuts on web: Mod+N new session, Mod+, settings,
 * Mod+1…9 recent sessions, and the hint overlay while the modifier is held.
 * (Upstream also had a Cmd+K command palette here; removed, the session
 * list and these shortcuts cover it.)
 */
export function GlobalShortcutsProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const sessionListViewData = useVisibleSessionListViewData();
    const machines = useAllMachines();
    const navigateToSession = useNavigateToSession();
    const browserSafeShortcuts = useMemo(() => Platform.OS === 'web' && !isTauri(), []);
    const visibleSessionShortcutIds = useMemo(() => getSessionShortcutIdsInDisplayOrder(
        sessionListViewData,
        machines,
        t('status.unknown'),
    ), [machines, sessionListViewData]);

    const openNewSession = useCallback(() => {
        router.navigate('/new');
    }, [router]);

    const openSettings = useCallback(() => {
        router.push('/settings');
    }, [router]);

    const openRecentSession = useCallback((index: number) => {
        const sessionId = visibleSessionShortcutIds[index];
        if (!sessionId) {
            return false;
        }
        navigateToSession(sessionId);
        return true;
    }, [navigateToSession, visibleSessionShortcutIds]);

    const visibleModifier = useGlobalKeyboard(
        {
            newSession: isAuthenticated ? openNewSession : undefined,
            settings: isAuthenticated ? openSettings : undefined,
            recentSession: isAuthenticated ? openRecentSession : undefined,
        },
        browserSafeShortcuts,
    );

    return (
        <ShortcutHintsProvider
            modifier={isAuthenticated ? visibleModifier : null}
            recentSessionIds={isAuthenticated ? visibleSessionShortcutIds : EMPTY_SESSION_IDS}
            browserSafeShortcuts={browserSafeShortcuts}
        >
            {children}
        </ShortcutHintsProvider>
    );
}
