import { describe, expect, it } from 'vitest';
import { getNewSessionSidebarLayout } from './newSessionSidebarLayout';

describe('getNewSessionSidebarLayout', () => {
    it('enables the right sidebar on supported wide web layouts', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1200,
        })).toEqual({
            canShowSidebar: true,
            showSidebar: true,
            sidebarWidth: 360,
        });
    });

    it('uses the chat files panel width so the middle column matches a chat', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1600,
            savedRightWidth: 520,
            leftPanelWidth: 300,
        }).sidebarWidth).toBe(520);
    });

    it('applies the files panel limits next to the left list', () => {
        // 1200 - 300 (left) - 420 (min chat) = 480
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1200,
            savedRightWidth: 900,
            leftPanelWidth: 300,
        }).sidebarWidth).toBe(480);
    });

    it('hides the panel when the chat files panel is hidden', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1600,
            rightCollapsed: true,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar when the setting is off', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: false,
            zenMode: false,
            windowWidth: 1200,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar in zen mode', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: true,
            windowWidth: 1200,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar below the minimum width', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1099,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar on unsupported native platforms', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'ios',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1400,
        }).showSidebar).toBe(false);
    });
});
