/**
 * Original Happy: picking archived sessions in the left list to delete them
 * (the sidebar's Select button). Only archived sessions can be picked:
 * running work is stopped or archived first.
 */
import { create } from 'zustand';
import { sessionDelete } from '@/sync/ops';
import { Modal } from '@/modal';
import { t } from '@/text';

type SessionSelectionState = {
    selecting: boolean;
    selected: ReadonlySet<string>;
    start: () => void;
    stop: () => void;
    toggle: (id: string) => void;
    setAll: (ids: readonly string[]) => void;
};

export const useSessionSelection = create<SessionSelectionState>((set) => ({
    selecting: false,
    selected: new Set(),
    start: () => set({ selecting: true, selected: new Set() }),
    stop: () => set({ selecting: false, selected: new Set() }),
    toggle: (id) => set((state) => {
        const next = new Set(state.selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        return { selected: next };
    }),
    setAll: (ids) => set({ selected: new Set(ids) }),
}));

/**
 * Asks, then deletes the sessions from the relay for good (one request each).
 * Resolves true when it went ahead (some may have failed: they are reported).
 */
export async function deleteSessions(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    const confirmed = await Modal.confirm(
        t('originalHappy.select.confirmTitle', { count: ids.length }),
        t('sessionInfo.deleteSessionWarning'),
        { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
    );
    if (!confirmed) return false;
    const failed: string[] = [];
    for (const id of ids) {
        const result = await sessionDelete(id);
        if (!result.success) failed.push(result.message ?? id);
    }
    if (failed.length > 0) {
        Modal.alert(t('common.error'), `${t('originalHappy.select.notDeleted', { count: failed.length })}\n${failed.slice(0, 5).join('\n')}`);
    }
    return true;
}
