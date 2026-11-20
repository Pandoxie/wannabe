import { describe, expect, it } from 'vitest';
import { isPanelToggleShortcut } from './panelShortcuts';

const key = (over: Partial<KeyboardEvent>) => ({
    code: 'KeyB', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...over,
}) as KeyboardEvent;

describe('panel toggle shortcuts', () => {
    it('maps Mod+B to the left panel and Mod+Alt+B to the right one', () => {
        expect(isPanelToggleShortcut(key({ metaKey: true }), 'left')).toBe(true);
        expect(isPanelToggleShortcut(key({ ctrlKey: true }), 'left')).toBe(true);
        expect(isPanelToggleShortcut(key({ metaKey: true, altKey: true }), 'right')).toBe(true);
        expect(isPanelToggleShortcut(key({ metaKey: true, altKey: true }), 'left')).toBe(false);
        expect(isPanelToggleShortcut(key({ metaKey: true }), 'right')).toBe(false);
    });

    it('ignores B alone, Shift, both modifiers and other keys', () => {
        expect(isPanelToggleShortcut(key({}), 'left')).toBe(false);
        expect(isPanelToggleShortcut(key({ metaKey: true, shiftKey: true }), 'left')).toBe(false);
        expect(isPanelToggleShortcut(key({ metaKey: true, ctrlKey: true }), 'left')).toBe(false);
        expect(isPanelToggleShortcut(key({ metaKey: true, code: 'KeyN' }), 'left')).toBe(false);
        expect(isPanelToggleShortcut(key({ metaKey: true, isComposing: true }), 'left')).toBe(false);
    });
});
