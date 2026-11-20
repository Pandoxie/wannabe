import type { DesktopPanelSide } from '@/utils/desktopPanels';

type PanelShortcutEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>;

/**
 * Mod+B toggles the left session list and Mod+Alt+B the right files panel,
 * the editor convention. Mod is ⌘ or Ctrl; matched on the physical key so
 * Option+B producing "∫" on a Mac still counts.
 */
export function isPanelToggleShortcut(event: PanelShortcutEvent, side: DesktopPanelSide): boolean {
    if (event.isComposing || event.shiftKey || event.code !== 'KeyB') return false;
    if (event.metaKey === event.ctrlKey) return false;
    return side === 'left' ? !event.altKey : event.altKey;
}
