import { describe, expect, it } from 'vitest';
import { splitInlineMath } from './mathSyntax';
import { parseMarkdown } from './parseMarkdown';
import { parseMarkdownSpans } from './parseMarkdownSpans';

const maths = (text: string) => splitInlineMath(text).filter((s) => s.kind === 'math').map((s) => (s as any).tex);

describe('inline math', () => {
    it.each([
        ['质能方程 $E=mc^2$ 很有名', ['E=mc^2']],
        ['$x$ and $y_1$', ['x', 'y_1']],
        ['$\\frac{a}{b}$, then \\(\\sqrt{2}\\)', ['\\frac{a}{b}', '\\sqrt{2}']],
        ['the $x$-axis', ['x']],
        ['inline display $$\\sum_i i$$ here', ['\\sum_i i']],
        ['with a dollar inside $\\$5 + x$', ['\\$5 + x']],
    ])('finds math in %s', (text, expected) => {
        expect(maths(text)).toEqual(expected);
    });

    it.each([
        'costs $5 and $10',
        'price: $5.',
        'echo $HOME/$USER',
        'export PATH=$PATH:$HOME/bin',
        'a$b$c',
        'the $x$th term',
        '`$x$` in code',
        '``$a$ and $b$`` in code',
        'literal \\$5 and \\$6',
        '$ not math $',
        'a lone $ sign',
    ])('leaves %s as text', (text) => {
        expect(maths(text)).toEqual([]);
    });

    it('keeps the text around formulas and its markdown', () => {
        const spans = parseMarkdownSpans('**粗体** 然后 $a^2+b^2=c^2$ 和 `code $x$`', false);
        expect(spans.map((s) => [s.text, s.styles, s.math ?? null])).toEqual([
            ['粗体', ['bold'], null],
            [' 然后 ', [], null],
            ['a^2+b^2=c^2', [], 'inline'],
            [' 和 ', [], null],
            ['code $x$', ['code'], null],
        ]);
    });

    it('unescapes \\$ in text', () => {
        expect(parseMarkdownSpans('pay \\$5 now', false).map((s) => s.text).join('')).toBe('pay $5 now');
    });
});

describe('display math blocks', () => {
    it('reads $$ on one line and over several', () => {
        expect(parseMarkdown('$$E=mc^2$$')).toEqual([{ type: 'math', content: 'E=mc^2' }]);
        expect(parseMarkdown('$$\n\\int_0^1 x\\,dx\n= \\tfrac12\n$$\nafter')).toEqual([
            { type: 'math', content: '\\int_0^1 x\\,dx\n= \\tfrac12' },
            { type: 'text', content: [{ styles: [], text: 'after', url: null }] },
        ]);
    });

    it('reads \\[ … \\] and ```math blocks', () => {
        expect(parseMarkdown('\\[\n a+b \n\\]')).toEqual([{ type: 'math', content: 'a+b' }]);
        expect(parseMarkdown('```math\n\\alpha\n```')).toEqual([{ type: 'math', content: '\\alpha' }]);
        expect(parseMarkdown('```latex\n\\beta\n```')).toEqual([{ type: 'math', content: '\\beta' }]);
    });

    it('treats an unclosed $$ as text and leaves other code blocks alone', () => {
        expect(parseMarkdown('$$ not closed')[0].type).toBe('text');
        expect(parseMarkdown('```bash\necho $HOME\n```')).toEqual([{ type: 'code-block', language: 'bash', content: 'echo $HOME' }]);
    });

    it('does not take a math line with | for a table', () => {
        expect(parseMarkdown('$$|x| + |y|$$')).toEqual([{ type: 'math', content: '|x| + |y|' }]);
    });
});
