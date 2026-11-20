import * as React from 'react';
import { View } from 'react-native';
import { ChatListInternal } from '@/components/ChatList';
import type { Message } from '@/sync/typesMessage';
import { storage } from '@/sync/storage';

// Original Happy: the chat list with a streaming answer, for checking on the web
// that it follows the newest message (and leaves a reader in history alone).
const base = Date.now() - 3_600_000;
const text = (i: number, kind: 'user-text' | 'agent-text', body: string): Message =>
    ({ kind, id: `m${i}`, localId: null, createdAt: base + i * 1000, text: body } as Message);

const SESSION_ID = 'dev-chat-follow';

export default function ChatFollowDemo() {
    // The list's newest end reads its session from the store: give it a stand-in.
    React.useState(() => {
        if (!storage.getState().sessions[SESSION_ID]) {
            storage.setState((state: any) => ({ sessions: { ...state.sessions, [SESSION_ID]: { id: SESSION_ID, metadata: { path: '/demo', host: 'demo' }, agentState: null, active: true } } }));
        }
        return null;
    });
    const [messages, setMessages] = React.useState<Message[]>(() =>
        // Newest first, as the store keeps them.
        Array.from({ length: 40 }, (_, i) => text(i, i % 2 ? 'agent-text' : 'user-text', `Message ${i}: ` + 'lorem ipsum dolor sit amet '.repeat(4))).reverse());
    React.useEffect(() => {
        let n = 40;
        const timer = setInterval(() => {
            setMessages((current) => {
                const newest = current[0];
                // Every third tick a new message; otherwise the newest one grows, as streaming does.
                if (n % 3 === 0 || newest.kind !== 'agent-text') { const m = text(n, 'agent-text', `Message ${n}: streaming`); n++; return [m, ...current]; }
                n++;
                return [{ ...newest, text: newest.text + ' more words arriving in the stream,' }, ...current.slice(1)];
            });
        }, 250);
        (globalThis as any).__chatFollowCount = () => n;
        return () => clearInterval(timer);
    }, []);
    return (
        <View style={{ flex: 1 }}>
            <ChatListInternal metadata={null} sessionId={SESSION_ID} active messages={messages} hasMoreOlder={false} isLoadingOlder={false} />
        </View>
    );
}
