import { describe, expect, it, vi } from 'vitest';
import { ContentSearchIndex, docsFromMessages, snippet, type SeqMessage } from './contentSearch';

let seq = 0;
const at = (message: any): SeqMessage => ({ seq: ++seq, message });
const user = (id: string, text: string, createdAt: number) => at({ id, localId: null, createdAt, isSidechain: false, role: 'user', content: { type: 'text', text } });
const agent = (id: string, createdAt: number, content: any[], extra: Record<string, unknown> = {}) => at({ id, localId: null, createdAt, isSidechain: false, role: 'agent', content, ...extra });
const text = (t: string) => ({ type: 'text', text: t });

describe('content search: what is worth finding', () => {
    it('keeps what you wrote and the agent\'s last text of each turn, not its steps', () => {
        const docs = docsFromMessages([
            user('u1', 'Where is the relay storage going?', 1),
            agent('a1', 2, [{ type: 'thinking', thinking: 'secret thoughts' }, text('Let me count the rows first.'),
                { type: 'tool-call', name: 'Bash', title: 'Count rows', description: 'in Postgres' }]),
            agent('a2', 3, [{ type: 'tool-result', content: 'huge output' }]),
            agent('a3', 4, [text('I will write a script.'), { type: 'tool-call', name: 'Write', title: 'script.py', description: '' }]),
            agent('a4', 5, [text('It grows by messages: about 2 GB a year.')]),
            { seq: ++seq, message: { id: 'e', role: 'event', content: {}, createdAt: 6, isSidechain: false } as any },
            user('u2', 'And the attachments?', 7),
            agent('a5', 8, [text('Those are on S3.')]),
        ]);
        expect(docs.map((d) => [d.role, d.text])).toEqual([
            ['user', 'Where is the relay storage going?'],
            ['agent', 'It grows by messages: about 2 GB a year.'],
            ['user', 'And the attachments?'],
            ['agent', 'Those are on S3.'],
        ]);
    });

    it('a change of turn id ends a turn even without a user message here', () => {
        const docs = docsFromMessages([
            agent('a1', 1, [text('first answer')], { turn: 't1' }),
            agent('a2', 2, [text('second turn, a step')], { turn: 't2' }),
            agent('a3', 3, [text('second answer')], { turn: 't2' }),
        ]);
        expect(docs.map((d) => d.text)).toEqual(['first answer', 'second answer']);
    });

    it('leaves subagents out and carries each message\'s seq', () => {
        const u = user('u', 'hello', 1);
        const sub = at({ id: 's', localId: null, createdAt: 2, isSidechain: true, role: 'agent', content: [text('from a subagent')] });
        const a = agent('a', 3, [text('hi')]);
        const docs = docsFromMessages([u, sub, a]);
        expect(docs.map((d) => [d.text, d.seq])).toEqual([['hello', u.seq], ['hi', a.seq]]);
    });
});

describe('content search: read once, again only when asked', () => {
    it('reads every page of each session, then searches all words, newest first', async () => {
        const pages: Record<string, any[]> = {
            s1: [{ items: [user('1', 'relay storage plan', 10)], lastSeq: 100, hasMore: true }, { items: [user('2', 'more relay notes', 20)], lastSeq: 150, hasMore: false }],
            s2: [{ items: [user('3', 'GPU in the sandbox', 30)], lastSeq: 5, hasMore: false }],
        };
        const fetchPage = vi.fn(async (id: string, after: number) => pages[id].shift() ?? { items: [], lastSeq: after, hasMore: false });
        const index = new ContentSearchIndex(fetchPage);
        expect(index.isBuilt()).toBe(false);
        const progress: string[] = [];
        expect(await index.rebuild(['s1', 's2'], (d, t) => progress.push(`${d}/${t}`))).toEqual([]);
        expect(index.isBuilt()).toBe(true);
        expect(progress.at(-1)).toBe('2/2');
        expect(fetchPage).toHaveBeenCalledWith('s1', 0);
        expect(fetchPage).toHaveBeenCalledWith('s1', 100);
        expect(index.search('RELAY').map((h) => [h.sessionId, h.count])).toEqual([['s1', 2]]);
        expect(index.search('relay plan')[0].snippets.map((x) => x.text)).toEqual(['relay storage plan']);
        expect(index.search('gpu sandbox').map((h) => h.sessionId)).toEqual(['s2']);
    });

    it('a rebuild reads from scratch and drops sessions that are gone', async () => {
        let round = 0;
        const index = new ContentSearchIndex(async (id) => ({ items: [user(id, `${id} round ${round}`, 1)], lastSeq: 1, hasMore: false }));
        await index.rebuild(['a', 'b'], () => {});
        round = 1;
        await index.rebuild(['a'], () => {});
        expect(index.search('round').map((h) => [h.sessionId, h.snippets[0].text])).toEqual([['a', 'a round 1']]);
        expect(index.has('b')).toBe(false);
    });

    it('a failed session is reported, the others are read', async () => {
        const index = new ContentSearchIndex(async (id) => { if (id === 'bad') throw new Error('no key'); return { items: [user('x', 'hello', 1)], lastSeq: 1, hasMore: false }; });
        expect(await index.rebuild(['bad', 'good'], () => {})).toEqual(['bad']);
        expect(index.search('hello').map((h) => h.sessionId)).toEqual(['good']);
    });

    it('a second update while one runs waits for it instead of reading the same pages again', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const fetchPage = vi.fn(async () => { await gate; return { items: [user('1', 'only once', 1)], lastSeq: 1, hasMore: false }; });
        const index = new ContentSearchIndex(fetchPage);
        const a = index.update('s');
        const b = index.update('s');
        release();
        await Promise.all([a, b]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
        expect(index.search('only once')[0].count).toBe(1);
    });

    it('cuts a snippet around the first word', () => {
        const long = 'a '.repeat(100) + 'needle here' + ' b'.repeat(100);
        const s = snippet(long, ['needle'], 10);
        expect(s.startsWith('…')).toBe(true);
        expect(s).toContain('needle here');
        expect(s.length).toBeLessThan(40);
    });
});
