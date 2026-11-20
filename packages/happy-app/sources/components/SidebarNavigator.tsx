import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { Drawer } from 'expo-router/drawer';
import { useIsTablet, useHeaderHeight, useLayoutDimensions } from '@/utils/responsive';
import { SidebarView } from './SidebarView';
import { View, Pressable, Platform } from 'react-native';
import { useAllMachines, useIsDataReady, useLocalSetting, useLocalSettingMutable } from '@/sync/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { isTauri } from '@/utils/isTauri';
import { useOverlayNav } from '@/-session/sessionOverlayNav';
import { DEFAULT_APP_ZOOM } from '@/hooks/useTauriZoom';
import { canRouteForward, canUseRouteBack, getNavigatorCanGoBack } from '@/navigation/browserNavigation';
import { useBrowserNavigationStore } from '@/navigation/browserNavigationStore';
import { isRunningOnMac } from '@/utils/platform';
import { shouldShowFirstRunInstall, shouldSuppressTabletShell } from './onboarding/firstRunOnboarding';
import { PanelResizeHandle } from './PanelResizeHandle';
import { clampPanelWidth, resolvePanelWidth } from '@/utils/desktopPanels';
import { storage } from '@/sync/storage';
import { isPanelToggleShortcut } from '@/keyboard/panelShortcuts';

const TAURI_HEADER_CONTROL_LEFT = Math.ceil(92 / DEFAULT_APP_ZOOM);

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    const isDataReady = useIsDataReady();
    const machines = useAllMachines({ includeOffline: true });
    const pathname = usePathname();
    const zenMode = useLocalSetting('zenMode');
    const isWeb = Platform.OS === 'web';
    const runningOnMac = isRunningOnMac();
    const showInstallStep = shouldShowFirstRunInstall({
        isAuthenticated: auth.isAuthenticated,
        isDataReady,
        machineCount: machines.length,
        isWeb,
        isRunningOnMac: runningOnMac,
    });
    // The onboarding screen owns the whole native canvas. Keep the permanent
    // tablet sidebar and its header out of steps 2 and 3, including the brief
    // interval after a scanned machine arrives but before the route dismisses.
    const suppressTabletShell = shouldSuppressTabletShell({
        isAuthenticated: auth.isAuthenticated,
        isTablet,
        showInstallStep,
        isOnboardingRoute: pathname.startsWith('/onboarding/'),
        isWeb,
        isRunningOnMac: runningOnMac,
    });
    const isDesktopLayout = auth.isAuthenticated && isTablet && !suppressTabletShell;
    const leftCollapsed = useLocalSetting('leftSidebarCollapsed');
    const savedLeftWidth = useLocalSetting('leftSidebarWidth');
    const showSidebar = isDesktopLayout && !zenMode && !leftCollapsed;
    const { width: windowWidth } = useLayoutDimensions();

    // While dragging, the width lives here and is written to local settings
    // once on release, so a drag does not persist on every frame.
    const [dragWidth, setDragWidth] = React.useState<number | null>(null);
    const fullDrawerWidth = React.useMemo(() => {
        if (!isDesktopLayout) return 280;
        return dragWidth ?? resolvePanelWidth('left', savedLeftWidth, windowWidth);
    }, [windowWidth, isDesktopLayout, savedLeftWidth, dragWidth]);
    const drawerWidth = showSidebar ? fullDrawerWidth : 0;

    const handleResize = React.useCallback((width: number) => {
        setDragWidth(clampPanelWidth('left', width, windowWidth));
    }, [windowWidth]);
    const handleResizeEnd = React.useCallback((width: number) => {
        storage.getState().applyLocalSettings({ leftSidebarWidth: clampPanelWidth('left', width, windowWidth) });
        setDragWidth(null);
    }, [windowWidth]);
    const handleResizeReset = React.useCallback(() => {
        storage.getState().applyLocalSettings({ leftSidebarWidth: null });
        setDragWidth(null);
    }, []);

    // Mod+B toggles the session list, as in most editors.
    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !isDesktopLayout) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isPanelToggleShortcut(event, 'left')) return;
            event.preventDefault();
            event.stopPropagation();
            toggleLeftPanel();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [isDesktopLayout]);

    const drawerNavigationOptions = React.useMemo(() => {
        if (!isDesktopLayout) {
            // Non-tablet: use front drawer, hidden
            return {
                lazy: false,
                headerShown: false,
                drawerType: 'front' as const,
                swipeEnabled: false,
                drawerStyle: {
                    width: 0,
                    display: 'none' as const,
                },
            };
        }

        // Tablet: always permanent, just collapse width in zen mode.
        //
        // We deliberately do NOT animate `width` on web. A CSS transition on
        // the drawer width re-flowed the chat flex-1 sibling on every frame,
        // re-measuring the entire FlatList tree at ~15fps. Snapping the
        // width change makes the chat reflow exactly once. Native already
        // snaps because RN doesn't honor CSS transition properties.
        return {
            lazy: false,
            headerShown: false,
            drawerType: 'permanent' as const,
            drawerStyle: {
                backgroundColor: 'white',
                borderRightWidth: 0,
                width: drawerWidth,
                overflow: 'hidden' as const,
            } as any,
            swipeEnabled: false,
            drawerActiveTintColor: 'transparent',
            drawerInactiveTintColor: 'transparent',
            drawerItemStyle: { display: 'none' as const },
            drawerLabelStyle: { display: 'none' as const },
        };
    }, [isDesktopLayout, drawerWidth]);

    const drawerContent = React.useCallback(
        () => <SidebarView />,
        []
    );

    return (
        <View style={{ flex: 1 }}>
            <Drawer
                screenOptions={drawerNavigationOptions}
                drawerContent={isDesktopLayout ? drawerContent : undefined}
            />
            {/* Persistent header overlay — always visible on desktop, same position regardless of zen mode */}
            {showSidebar && (
                <PanelResizeHandle
                    width={fullDrawerWidth}
                    direction={1}
                    onResize={handleResize}
                    onResizeEnd={handleResizeEnd}
                    onReset={handleResizeReset}
                    style={{ left: drawerWidth - 5 }}
                    accessibilityLabel={t('panels.resizeSessionList')}
                />
            )}
            {isDesktopLayout && (
                <PersistentHeader leftPanelWidth={drawerWidth} />
            )}
        </View>
    );
});

/**
 * Shows or hides the left session list. Leaving zen mode counts as showing
 * it: zen hides both panels, and a button that did nothing while zen is on
 * would read as broken.
 */
function toggleLeftPanel() {
    const state = storage.getState();
    const { zenMode, leftSidebarCollapsed } = state.localSettings;
    if (zenMode) {
        state.applyLocalSettings({ zenMode: false, leftSidebarCollapsed: false });
        return;
    }
    state.applyLocalSettings({ leftSidebarCollapsed: !leftSidebarCollapsed });
}

// Header block that stays in the same position whether zen mode is on or off
const PersistentHeader = React.memo((props: { leftPanelWidth: number }) => {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const router = useRouter();
    const [zenMode, setZenMode] = useLocalSettingMutable('zenMode');
    const leftCollapsed = useLocalSetting('leftSidebarCollapsed');
    const leftVisible = !zenMode && !leftCollapsed;
    const inTauri = isTauri();
    const isMacTauri = inTauri && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

    const routeHistory = useBrowserNavigationStore((s) => s.routeHistory);
    const canGoForward = useBrowserNavigationStore((s) => s.routeHistory ? canRouteForward(s.routeHistory) : false);
    const overlayCanBack = useOverlayNav((s) => s.canBack);
    const overlayCanForward = useOverlayNav((s) => s.canForward);
    const canGoBack = routeHistory
        ? canUseRouteBack(routeHistory, getNavigatorCanGoBack(router))
        : false;

    const handleZenToggle = React.useCallback(() => {
        setZenMode(!zenMode);
    }, [zenMode, setZenMode]);

    const handleBack = React.useCallback(() => {
        // Intra-session overlay (file diff / file view) consumes back first,
        // so the chat → diff → file flow can be unwound without a close X.
        if (useOverlayNav.getState().back()) return;
        const nav = useBrowserNavigationStore.getState();
        if (!nav.routeHistory || !canUseRouteBack(nav.routeHistory, getNavigatorCanGoBack(router))) return;
        nav.markRouteBack();
        router.back();
    }, [router]);

    const handleForward = React.useCallback(() => {
        if (useOverlayNav.getState().forward()) return;
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const nav = useBrowserNavigationStore.getState();
            if (!nav.routeHistory || !canRouteForward(nav.routeHistory)) return;
            nav.markRouteForward();
            window.history.forward();
        }
    }, []);

    const canGoBackEffective = canGoBack || overlayCanBack;
    const canGoForwardEffective = canGoForward || overlayCanForward;

    // Octicons' sidebar glyphs draw a panel on the right (`sidebar-collapse`
    // is ▶|, `sidebar-expand` is ◀|), so the left list uses them mirrored:
    // |◀ hides it, |▶ shows it.
    const leftPanelLabel = leftVisible ? t('panels.hideSessionList') : t('panels.showSessionList');
    const leftPanelToggle = (
        <Pressable
            onPress={toggleLeftPanel}
            hitSlop={10}
            style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel={leftPanelLabel}
            {...(Platform.OS === 'web' ? { title: leftPanelLabel } as any : {})}
        >
            <Octicons
                name={leftVisible ? 'sidebar-collapse' : 'sidebar-expand'}
                size={16}
                color={theme.colors.header.tint}
                style={{ transform: [{ scaleX: -1 }] }}
            />
        </Pressable>
    );

    return (
        <>
        {/* With the list open, its toggle sits at the list's own top-right
            corner and follows it while it is dragged. */}
        {leftVisible && props.leftPanelWidth > 0 && (
            <View
                style={{
                    position: 'absolute',
                    top: safeArea.top,
                    left: props.leftPanelWidth - 12 - 28,
                    height: headerHeight,
                    justifyContent: 'center',
                    zIndex: 1101,
                }}
                {...(inTauri ? { dataSet: { tauriDragRegion: 'false' } } : {})}
            >
                {leftPanelToggle}
            </View>
        )}
        <View
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                paddingTop: safeArea.top,
                paddingLeft: isMacTauri ? TAURI_HEADER_CONTROL_LEFT : 16,
                paddingRight: 16,
                height: safeArea.top + headerHeight,
                flexDirection: 'row',
                alignItems: 'center',
                zIndex: 1100,
            }}
            pointerEvents="box-none"
            {...(inTauri ? { dataSet: { tauriDragRegion: 'true' } } : {})}
        >
            {/* Zen / Back / Forward buttons */}
            <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                pointerEvents="auto"
                {...(inTauri ? { dataSet: { tauriDragRegion: 'false' } } : {})}
            >
                {!leftVisible && leftPanelToggle}
                <Pressable
                    onPress={handleZenToggle}
                    hitSlop={10}
                    style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                    accessibilityLabel={t('zen.toggle')}
                >
                    <Image
                        source={require('@/assets/images/zen-icon.png')}
                        contentFit="contain"
                        style={{ width: 18, height: 18 }}
                        tintColor={zenMode ? theme.colors.textLink : theme.colors.header.tint}
                    />
                </Pressable>
                <Pressable onPress={handleBack} disabled={!canGoBackEffective} hitSlop={10} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: canGoBackEffective ? 1 : 0.3 }}>
                    <Ionicons name="chevron-back" size={20} color={theme.colors.header.tint} />
                </Pressable>
                {Platform.OS === 'web' && (
                    <Pressable onPress={handleForward} disabled={!canGoForwardEffective} hitSlop={10} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: canGoForwardEffective ? 1 : 0.3 }}>
                        <Ionicons name="chevron-forward" size={20} color={theme.colors.header.tint} />
                    </Pressable>
                )}
            </View>
        </View>
        </>
    );
});
