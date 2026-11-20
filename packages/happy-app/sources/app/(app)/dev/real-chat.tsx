import * as React from 'react';
import { Text, View } from 'react-native';
import { ChatListInternal } from '@/components/ChatList';
import { SearchPanel } from '@/components/SearchPanel';
import { contentIndex } from '@/hooks/useSessionSearch';
import { docsFromMessages } from '@/sync/contentSearch';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { storage } from '@/sync/storage';
import { normalizeRawMessage } from '@/sync/typesRaw';
import type { Message } from '@/sync/typesMessage';

// Original Happy, development only: a real session's decrypted messages,
// loaded from /dev-data/session.json if a developer put one into a LOCAL
// export (never into the repository or an image), through the real
// normalize → reducer → chat list, beside the Search panel, to check where
// a hit lands. Without the file it shows a note and nothing else.
const SESSION_ID = 'dev-real-chat';

export default function RealChatDemo() {
    const [messages, setMessages] = React.useState<Message[] | null>(null);
    const [note, setNote] = React.useState('loading /dev-data/session.json…');
    React.useEffect(() => {
        fetch('/dev-data/session.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))).then((raw: any[]) => {
            const items: any[] = [];
            for (const r of raw) { const n = normalizeRawMessage(r.id, r.localId, r.createdAt, r.content); if (n) items.push({ seq: r.seq, message: n }); }
            const result = reducer(createReducer(), items.map((i) => i.message));
            const sorted = [...result.messages].sort((a, b) => b.createdAt - a.createdAt);
            storage.setState((state: any) => ({ isDataReady: true, sessions: { ...state.sessions, [SESSION_ID]: { id: SESSION_ID, seq: 0, createdAt: 0, updatedAt: 0, active: false, activeAt: 0, metadata: { path: '/demo', host: 'demo', flavor: 'codex', summary: { text: 'Real session', updatedAt: 0 } }, agentState: null, thinking: false } } }));
            contentIndex.seedForDev(SESSION_ID, docsFromMessages(items));
            setMessages(sorted);
            setNote(`${raw.length} raw, ${items.length} normalized, ${sorted.length} rows`);
        }).catch((e) => setNote(`no data: ${e.message}`));
    }, []);
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
                <Text nativeID="dev-real-note">{note}</Text>
                {messages && <ChatListInternal metadata={{ flavor: 'codex' } as any} sessionId={SESSION_ID} active messages={messages} hasMoreOlder={false} isLoadingOlder={false} />}
            </View>
            <View style={{ width: 340, paddingTop: 12 }}>
                {messages && <SearchPanel currentSessionId={SESSION_ID} />}
            </View>
        </View>
    );
}
