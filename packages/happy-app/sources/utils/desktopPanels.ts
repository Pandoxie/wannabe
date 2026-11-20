/**
 * Widths of the two desktop side panels: the session list on the left and the
 * files / diff panel on the right. Both can be dragged; the chat column takes
 * whatever is left.
 */

export type DesktopPanelSide = 'left' | 'right';

/**
 * Width of the floating header controls at the window's top-left (panel
 * toggle, zen, back, forward) plus their padding: 16 + 4 × 28 + 3 × 4. Content that runs under
 * them while the left list is hidden starts after this.
 */
export const DESKTOP_HEADER_CONTROLS_WIDTH = 140;

/** Never let the panels squeeze the chat column below this. */
export const MIN_CENTER_WIDTH = 420;

const LIMITS: Record<DesktopPanelSide, { min: number; max: number; maxFraction: number }> = {
    left: { min: 200, max: 560, maxFraction: 0.4 },
    right: { min: 260, max: 1000, maxFraction: 0.55 },
};

/** What a panel gets before anyone drags it: 30% of the window, 250–360px. */
export function defaultPanelWidth(windowWidth: number): number {
    return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
}

/**
 * Keeps a width inside the panel's own limits and leaves at least
 * MIN_CENTER_WIDTH for the chat next to `otherPanelWidth`. The minimum wins
 * over the room left for the chat, so a narrow window cannot collapse a panel
 * to nothing.
 */
export function clampPanelWidth(
    side: DesktopPanelSide,
    width: number,
    windowWidth: number,
    otherPanelWidth = 0,
): number {
    const limits = LIMITS[side];
    const max = Math.min(
        limits.max,
        Math.floor(windowWidth * limits.maxFraction),
        windowWidth - otherPanelWidth - MIN_CENTER_WIDTH,
    );
    return Math.round(Math.max(limits.min, Math.min(width, max)));
}

/** The width to render: the saved drag width if any, else the default. */
export function resolvePanelWidth(
    side: DesktopPanelSide,
    saved: number | null | undefined,
    windowWidth: number,
    otherPanelWidth = 0,
): number {
    const base = typeof saved === 'number' && Number.isFinite(saved) ? saved : defaultPanelWidth(windowWidth);
    return clampPanelWidth(side, base, windowWidth, otherPanelWidth);
}
