import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSessionSelection } from '@/sync/sessionSelection';
import { FlatSessionRow } from '@/components/FlatSessionRow';
import { storage } from '@/sync/storage';
import type { SessionRowData } from '@/sync/storage';

// Original Happy: the session row's menu — Delete for an archived session,
// Archive for a running one. Right-click a row. "Select" shows the left
// list's picking mode (archived rows only).
const now = Date.now();
const stub = (id: string, active: boolean) => ({ id, seq: 0, createdAt: now, updatedAt: now, active, activeAt: now, metadata: { path: '/home/demo', host: 'demo', summary: { text: id, updatedAt: now }, lifecycleState: active ? 'running' : 'archived' }, agentState: null, thinking: false });
const row = (id: string, active: boolean): SessionRowData => ({
    id, name: id, subtitle: '', avatarId: id, flavor: 'claude', clientId: null, identityLine: null, providerKind: null,
    modelName: null, activitySummary: null, gitChangedFiles: null, gitCountsExact: false, gitDeletions: null, gitInsertions: null,
    state: active ? 'waiting' : 'disconnected', activeAt: now, createdAt: now, lastActivityAt: now, hasDraft: false, active, archived: !active,
    machineId: 'm', machineOffline: false, path: '/home/demo', homeDir: '/home/demo', completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
    projectId: null, projectName: null, workspaceId: null,
} as SessionRowData);

export default function SessionMenuDemo() {
    React.useState(() => {
        storage.setState((state: any) => ({ isDataReady: true, sessions: { ...state.sessions, 'archived-chat': stub('archived-chat', false), 'old-notes': stub('old-notes', false), 'running-chat': stub('running-chat', true) } }));
        return null;
    });
    return (
        <View style={{ maxWidth: 420, width: '100%' }}>
            <Pressable onPress={() => { const s = useSessionSelection.getState(); if (s.selecting) s.stop(); else s.start(); }} style={{ padding: 8 }}>
                <Text>Select</Text>
            </Pressable>
            <FlatSessionRow row={{ session: row('archived-chat', false), projectName: 'demo', workspaceName: null }} archived showBorder />
            <FlatSessionRow row={{ session: row('old-notes', false), projectName: 'demo', workspaceName: null }} archived showBorder />
            <FlatSessionRow row={{ session: row('running-chat', true), projectName: 'demo', workspaceName: null }} showBorder={false} />
        </View>
    );
}
