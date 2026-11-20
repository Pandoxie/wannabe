import { describe, expect, it } from 'vitest';
import { isStaleOffline } from './machineChoices';


describe('isStaleOffline (Original Happy)', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 1_800_000_000_000;
    it('is true only for computers offline longer than the limit', () => {
        expect(isStaleOffline({ online: false, activeAt: now - 6 * day }, now)).toBe(true);
        expect(isStaleOffline({ online: false, activeAt: now - 4 * day }, now)).toBe(false);
        expect(isStaleOffline({ online: true, activeAt: now - 30 * day }, now)).toBe(false);
    });
});
