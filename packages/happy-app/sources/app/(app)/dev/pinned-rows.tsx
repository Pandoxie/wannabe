import * as React from 'react';
import { View } from 'react-native';
import { FlatSessionRow } from '@/components/FlatSessionRow';
import { buildFlatSessionRows } from '@/utils/flatSessionList';
import type { SessionRowData } from '@/sync/storage';

// Original Happy: the flat session list with pinned sessions, for rendering checks.
const now = Date.now();
const session = (id: string, name: string, active: boolean, minutesAgo: number): SessionRowData => ({
    id, name, subtitle: '', avatarId: id, flavor: id === 'b' ? 'codex' : 'claude', clientId: null, identityLine: null, providerKind: null,
    modelName: null, activitySummary: null, gitChangedFiles: null, gitCountsExact: false, gitDeletions: null, gitInsertions: null,
    state: active ? 'waiting' : 'disconnected', activeAt: active ? undefined : now - minutesAgo * 60_000, createdAt: now - 86_400_000,
    lastActivityAt: now - minutesAgo * 60_000, hasDraft: false, active, archived: false, machineId: 'm', machineOffline: false,
    path: '/home/demo/projects/x', homeDir: '/home/demo', completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
    projectId: null, projectName: null, workspaceId: null,
} as SessionRowData);

export default function PinnedRowsDemo() {
    const rows = buildFlatSessionRows([{ type: 'active-sessions', sessions: [
        session('a', 'ws-happy-claude-bot', true, 1),
        session('b', 'mini-codex-coder-bot', true, 3),
        session('c', 'stock-review-bot', false, 300),
        session('d', 'finance-bot', false, 60),
    ] } as any], { sortByActivity: true, pinnedIds: ['c'] });
    return (
        <View style={{ maxWidth: 480, width: '100%', alignSelf: 'center' }}>
            {rows.map((row, i) => <FlatSessionRow key={row.session.id} row={row} showBorder={i < rows.length - 1} />)}
        </View>
    );
}
