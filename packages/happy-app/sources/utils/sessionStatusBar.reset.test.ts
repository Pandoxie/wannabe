import { describe, expect, it } from 'vitest';
import { formatUsageLimitResetTime } from './sessionStatusBar';

describe('formatUsageLimitResetTime (Original Happy)', () => {
    it('always shows the day and the time', () => {
        const at = new Date(2026, 10, 20, 2, 0).getTime();
        expect(formatUsageLimitResetTime(at, 'en-US')).toMatch(/Nov 20.*02:00/);
        expect(formatUsageLimitResetTime(at, 'zh-CN')).toMatch(/11月20日.*02:00/);
        // soon or far, the same shape
        expect(formatUsageLimitResetTime(Date.now() + 3600_000, 'en-US')).toMatch(/[A-Z][a-z]{2} \d{1,2}.*\d{2}:\d{2}/);
    });
});
