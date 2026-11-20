/**
 * Math in markdown (Original Happy): which text is LaTeX.
 *
 * Inline: `$…$` and `\(…\)`. Display: `$$…$$` and `\[…\]` (a paragraph of
 * their own, or inline), and ```math / ```latex / ```tex code blocks
 * (parseMarkdownBlock).
 *
 * `$` is also money and shell, so an inline `$…$` must look like math, the
 * rules pandoc and most chat renderers use:
 * - the opening `$` is not followed by a space and not preceded by a letter
 *   or digit (`a$b`);
 * - the closing `$` is not preceded by a space and not followed by a letter
 *   or digit (`$5 and $10`, `$HOME/$USER`, `$x$th` stay text);
 * - `\$` is a literal dollar.
 * Inline code (backticks) is never searched: it goes through untouched.
 */

export type MathSegment =
    | { kind: 'text'; text: string }
    | { kind: 'math'; tex: string; display: boolean };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);

/** Splits one line of markdown into text and inline math. */
export function splitInlineMath(text: string): MathSegment[] {
    const out: MathSegment[] = [];
    let buf = '';
    const flush = () => {
        if (buf) out.push({ kind: 'text', text: buf });
        buf = '';
    };
    let i = 0;
    while (i < text.length) {
        const c = text[i];

        // Inline code: copy through to the closing backtick run.
        if (c === '`') {
            let ticks = 1;
            while (text[i + ticks] === '`') ticks++;
            const fence = '`'.repeat(ticks);
            const end = text.indexOf(fence, i + ticks);
            if (end >= 0) {
                buf += text.slice(i, end + ticks);
                i = end + ticks;
                continue;
            }
            buf += text.slice(i, i + ticks);
            i += ticks;
            continue;
        }

        // Escaped dollar.
        if (c === '\\' && text[i + 1] === '$') {
            buf += '$';
            i += 2;
            continue;
        }

        // \( … \) and \[ … \]
        if (c === '\\' && (text[i + 1] === '(' || text[i + 1] === '[')) {
            const close = text[i + 1] === '(' ? '\\)' : '\\]';
            const end = text.indexOf(close, i + 2);
            if (end > i + 2) {
                flush();
                out.push({ kind: 'math', tex: text.slice(i + 2, end).trim(), display: text[i + 1] === '[' });
                i = end + 2;
                continue;
            }
        }

        if (c === '$') {
            // $$ … $$ on one line.
            if (text[i + 1] === '$') {
                const end = text.indexOf('$$', i + 2);
                if (end > i + 2) {
                    flush();
                    out.push({ kind: 'math', tex: text.slice(i + 2, end).trim(), display: true });
                    i = end + 2;
                    continue;
                }
                buf += '$$';
                i += 2;
                continue;
            }
            // $ … $
            if (!isSpace(text[i + 1]) && !isWord(text[i - 1])) {
                let j = i + 1;
                let found = -1;
                while (j < text.length) {
                    if (text[j] === '\\') { j += 2; continue; }
                    if (text[j] === '`') break;
                    if (text[j] === '$') {
                        if (!isSpace(text[j - 1]) && !isWord(text[j + 1]) && text[j + 1] !== '$') found = j;
                        break;
                    }
                    j++;
                }
                if (found > i + 1) {
                    flush();
                    out.push({ kind: 'math', tex: text.slice(i + 1, found), display: false });
                    i = found + 1;
                    continue;
                }
            }
        }

        buf += c;
        i++;
    }
    flush();
    return out;
}

export const MATH_CODE_LANGUAGES = new Set(['math', 'latex', 'tex', 'katex']);

/**
 * A display-math paragraph starting at `lines[start]`: `$$…$$` or `\[…\]`,
 * on one line or over several. Null when the line does not open one or it
 * is never closed (then it is ordinary text).
 */
export function readDisplayMath(lines: string[], start: number): { tex: string; next: number } | null {
    const first = lines[start].trim();
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
    if (!open) return null;
    const close = open === '$$' ? '$$' : '\\]';
    const rest = first.slice(2);
    // One line: $$ x $$ (nothing after the closing delimiter).
    if (rest.trimEnd().endsWith(close) && rest.trimEnd().length >= close.length) {
        const body = rest.trimEnd().slice(0, -close.length);
        if (body.includes(close)) return null;
        return { tex: body.trim(), next: start + 1 };
    }
    const body: string[] = rest.trim() ? [rest] : [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        if (line.endsWith(close)) {
            const last = line.slice(0, -close.length);
            if (last.trim()) body.push(last);
            return { tex: body.join('\n').trim(), next: i + 1 };
        }
        body.push(lines[i]);
    }
    return null;
}
