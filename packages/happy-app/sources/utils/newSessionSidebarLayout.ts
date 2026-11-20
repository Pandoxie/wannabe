import { resolvePanelWidth } from './desktopPanels';

const RIGHT_SIDEBAR_MIN_WINDOW_WIDTH = 1100;

type NewSessionSidebarLayoutInput = {
    platform: 'web' | 'ios' | 'android' | 'macos' | 'windows';
    isMac: boolean;
    fileDiffsSidebarEnabled: boolean;
    zenMode: boolean;
    windowWidth: number;
    /** The chat's files panel is hidden (Mod+Alt+B / header button). */
    rightCollapsed?: boolean;
    /** The chat's saved files-panel width (local setting `rightSidebarWidth`). */
    savedRightWidth?: number | null;
    /** Width taken by the session list on the left (0 when hidden). */
    leftPanelWidth?: number;
};

/**
 * The config panel on the new-session screen sits where the chat's files
 * panel sits and follows the same rules, so the middle column is exactly as
 * wide as a chat: same saved width, same limits, hidden when the files panel
 * is hidden (the config then shows inline above the composer).
 */
export function getNewSessionSidebarLayout(input: NewSessionSidebarLayoutInput) {
    const canShowSidebar = input.fileDiffsSidebarEnabled
        && (input.isMac || input.platform === 'web')
        && input.windowWidth >= RIGHT_SIDEBAR_MIN_WINDOW_WIDTH;
    const showSidebar = canShowSidebar && !input.zenMode && !input.rightCollapsed;
    const sidebarWidth = resolvePanelWidth('right', input.savedRightWidth, input.windowWidth, input.leftPanelWidth ?? 0);

    return { canShowSidebar, showSidebar, sidebarWidth };
}
