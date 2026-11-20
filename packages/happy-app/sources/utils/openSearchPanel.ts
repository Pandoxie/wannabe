/**
 * Original Happy: open the right panel at its Search tab — the panel shown
 * (its setting turned on if it was off), zen mode left, the tab opened and
 * made active, and the search field asked to take the keyboard.
 */
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useSearchStore } from '@/hooks/useSessionSearch';

export function openSearchPanel(): void {
    const state = storage.getState();
    if (!state.settings.fileDiffsSidebar) sync.applySettings({ fileDiffsSidebar: true });
    const open = state.localSettings.sidebarPanelsOpen as string[];
    state.applyLocalSettings({
        zenMode: false,
        rightSidebarCollapsed: false,
        sidebarPanelsOpen: (open.includes('search') ? open : [...open, 'search']) as any,
        sidebarPanelActive: 'search',
    });
    const search = useSearchStore.getState();
    search.set({ focusInput: search.focusInput + 1 });
}
