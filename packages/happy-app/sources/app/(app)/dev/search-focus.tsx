import * as React from 'react';
import { View } from 'react-native';
import { ChatListInternal } from '@/components/ChatList';
import { SearchPanel } from '@/components/SearchPanel';
import { contentIndex } from '@/hooks/useSessionSearch';
import { storage } from '@/sync/storage';
import type { Message } from '@/sync/typesMessage';

// Original Happy: a long chat (3000 messages) beside the right panel's Search,
// for checking that a message hit lands on its message (window grown, scrolled
// to the middle, marked) and that the results stay.
const SESSION_ID = 'dev-search-focus';
const OTHER_ID = 'dev-search-other';
const base = Date.now() - 30 * 86_400_000;
const N = 3000;
// Heights vary as in a real chat: one line, or a long answer of dozens of lines.
const filler = (i: number) => { const k = (i * 7919) % 97; return k < 70 ? 'lorem ipsum dolor sit amet '.repeat(1 + (k % 4)) : ('a long step with many lines of output\n\n'.repeat(k - 60)); };
const textOf = (i: number) => `Message ${i}: ` + (i % 250 === 40 ? `the needle is here, number ${i}. ` : '') + filler(i);
const messages: Message[] = Array.from({ length: N }, (_, i) => ({
    kind: i % 2 ? 'agent-text' : 'user-text', id: `m${i}`, localId: null, createdAt: base + i * 1000, text: textOf(i),
} as Message)).reverse();

let seeded = false;
function seed() {
    if (seeded) return;
    seeded = true;
    const stub = (id: string, title: string) => ({ id, seq: 0, createdAt: base, updatedAt: base, active: false, activeAt: base, metadata: { path: '/home/demo/projects/happy', host: 'workstation', summary: { text: title, updatedAt: base } }, agentState: null, thinking: false });
    storage.setState((state: any) => ({ isDataReady: true, sessions: { ...state.sessions, [SESSION_ID]: stub(SESSION_ID, 'A long session'), [OTHER_ID]: stub(OTHER_ID, 'Another session') } }));
    contentIndex.seedForDev(SESSION_ID, Array.from({ length: N }, (_, i) => ({ messageId: `m${i}`, role: i % 2 ? 'agent' as const : 'user' as const, text: textOf(i), createdAt: base + i * 1000, seq: i + 1 })));
    contentIndex.seedForDev(OTHER_ID, [{ messageId: 'x', role: 'agent', text: 'another needle, elsewhere', createdAt: base, seq: 1 }]);
}

export default function SearchFocusDemo() {
    React.useState(() => { seed(); return null; });
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
                <ChatListInternal metadata={null} sessionId={SESSION_ID} active messages={messages} hasMoreOlder={false} isLoadingOlder={false} />
            </View>
            <View style={{ width: 340, borderLeftWidth: 1, borderColor: '#8884', paddingTop: 12 }}>
                <SearchPanel currentSessionId={SESSION_ID} />
            </View>
        </View>
    );
}
