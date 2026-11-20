import { describe, expect, it } from 'vitest';
import type { Metadata } from './types';
import {
    getSessionNotificationBody,
    getSessionNotificationCopy,
    getSessionNotificationTitle,
    notificationExcerpt,
} from './pushNotifications';

function makeMetadata(overrides: Partial<Metadata> = {}): Metadata {
    return {
        path: '/Users/test/projects/happy',
        host: 'test-host',
        homeDir: '/Users/test',
        happyHomeDir: '/Users/test/.happy',
        happyLibDir: '/Users/test/.happy/lib',
        happyToolsDir: '/Users/test/.happy/tools',
        ...overrides,
    };
}

describe('getSessionNotificationTitle (Original Happy)', () => {
    const metadata = makeMetadata({ summary: { text: 'stock-review-bot', updatedAt: 1 } });

    it('names the session and what happened', () => {
        expect(getSessionNotificationTitle('done', metadata)).toBe('stock-review-bot · 完成');
        expect(getSessionNotificationTitle('permission', metadata)).toBe('stock-review-bot · 需要授权');
        expect(getSessionNotificationTitle('question', metadata)).toBe('stock-review-bot · 有问题问你');
    });

    it('falls back to the directory, then a generic label', () => {
        expect(getSessionNotificationTitle('done', makeMetadata({ path: '/Users/test/projects/happy-cli' }))).toBe('happy-cli · 完成');
        expect(getSessionNotificationTitle('done', null)).toBe('Session · 完成');
    });
});

describe('getSessionNotificationBody (Original Happy)', () => {
    it('is the start of the reply, plain, at most 50 characters', () => {
        const reply = '## 今日复盘\n\n**持仓**：`AAPL` 收涨 1.2%，[详情](https://x)。\n```\ncode\n```\n后面还有很多很多很多很多很多很多很多很多很多很多很多很多很多很多内容';
        const body = getSessionNotificationBody(makeMetadata(), reply);
        expect(body.startsWith('今日复盘 持仓：AAPL 收涨 1.2%，详情。 后面')).toBe(true);
        expect(Array.from(body)).toHaveLength(50);
        expect(body.endsWith('…')).toBe(true);
    });

    it('keeps short replies whole and falls back to machine:path without one', () => {
        expect(getSessionNotificationBody(makeMetadata(), '好了。')).toBe('好了。');
        expect(getSessionNotificationBody(makeMetadata(), '   ')).toBe('test-host:/Users/test/projects/happy');
        expect(getSessionNotificationBody(null)).toBe('Session');
    });

    it('counts characters, not UTF-16 units', () => {
        expect(notificationExcerpt('😀'.repeat(60))).toBe('😀'.repeat(49) + '…');
    });
});

describe('getSessionNotificationCopy', () => {
    it('combines both', () => {
        const metadata = makeMetadata({ summary: { text: 'Fix push', updatedAt: 1 } });
        expect(getSessionNotificationCopy('done', metadata, 'Pushed the fix.')).toEqual({
            title: 'Fix push · 完成',
            body: 'Pushed the fix.',
        });
    });
});
