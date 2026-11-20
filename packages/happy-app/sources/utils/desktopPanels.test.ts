import { describe, expect, it } from 'vitest';
import { clampPanelWidth, defaultPanelWidth, MIN_CENTER_WIDTH, resolvePanelWidth } from './desktopPanels';

describe('desktop panel widths', () => {
    it('defaults to 30% of the window, kept within 250–360px', () => {
        expect(defaultPanelWidth(1000)).toBe(300);
        expect(defaultPanelWidth(600)).toBe(250);
        expect(defaultPanelWidth(2000)).toBe(360);
    });

    it('uses a saved width when there is room for it', () => {
        expect(resolvePanelWidth('left', 420, 1600)).toBe(420);
        expect(resolvePanelWidth('right', 700, 1800)).toBe(700);
        expect(resolvePanelWidth('left', null, 1000)).toBe(300);
    });

    it('keeps each panel inside its own limits', () => {
        expect(clampPanelWidth('left', 50, 1600)).toBe(200);
        expect(clampPanelWidth('left', 2000, 3000)).toBe(560);
        expect(clampPanelWidth('right', 50, 1600)).toBe(260);
        expect(clampPanelWidth('right', 5000, 4000)).toBe(1000);
        // Fraction of the window caps it before the absolute max does.
        expect(clampPanelWidth('left', 560, 1000)).toBe(400);
    });

    it('leaves room for the chat column next to the other panel', () => {
        const width = clampPanelWidth('right', 900, 1600, 360);
        expect(width).toBe(1600 - 360 - MIN_CENTER_WIDTH);
    });

    it('never goes below the minimum, even in a cramped window', () => {
        expect(clampPanelWidth('right', 500, 900, 360)).toBe(260);
    });
});
