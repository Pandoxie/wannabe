import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

/**
 * Math on web with KaTeX (Original Happy). KaTeX (≈270 KB) is imported the
 * first time a message has math, and its stylesheet and fonts are served
 * from this site (/katex, copied by scripts/copy-katex.cjs) — no CDN.
 * A formula KaTeX cannot parse shows its source instead of breaking the
 * message.
 */

type Katex = { renderToString: (tex: string, options: Record<string, unknown>) => string };

let katexPromise: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
    if (!katexPromise) {
        if (typeof document !== 'undefined' && !document.getElementById('happy-katex-css')) {
            const link = document.createElement('link');
            link.id = 'happy-katex-css';
            link.rel = 'stylesheet';
            link.href = '/katex/katex.min.css';
            document.head.appendChild(link);
        }
        katexPromise = import('katex').then((m: any) => (m.default ?? m) as Katex);
    }
    return katexPromise;
}

function useKatexHtml(tex: string, display: boolean): { html: string | null; failed: boolean } {
    const [state, setState] = React.useState<{ html: string | null; failed: boolean }>({ html: null, failed: false });
    React.useEffect(() => {
        let alive = true;
        loadKatex().then((katex) => {
            if (!alive) return;
            try {
                const html = katex.renderToString(tex, {
                    displayMode: display,
                    throwOnError: true,
                    output: 'htmlAndMathml',
                    strict: 'ignore',
                    trust: false,
                });
                setState({ html, failed: false });
            } catch {
                setState({ html: null, failed: true });
            }
        }, () => alive && setState({ html: null, failed: true }));
        return () => { alive = false; };
    }, [tex, display]);
    return state;
}

export function MathInline(props: { tex: string; display?: boolean }) {
    const { theme } = useUnistyles();
    // $$…$$ or \[…\] inside a sentence: display-size, but kept on the line.
    const { html, failed } = useKatexHtml(props.display ? `\\displaystyle ${props.tex}` : props.tex, false);
    if (!html) {
        // Loading or unparsable: the source, so nothing is lost.
        return (
            <span style={{ fontFamily: 'monospace', color: failed ? theme.colors.textDestructive : theme.colors.textSecondary }}>
                {props.display ? `$$${props.tex}$$` : `$${props.tex}$`}
            </span>
        );
    }
    return <span style={{ color: theme.colors.text }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathBlock(props: { tex: string }) {
    const { theme } = useUnistyles();
    const { html, failed } = useKatexHtml(props.tex, true);
    const box: React.CSSProperties = {
        margin: '8px 0',
        overflowX: 'auto',
        overflowY: 'hidden',
        color: theme.colors.text,
        maxWidth: '100%',
    };
    if (!html) {
        return (
            <pre style={{ ...box, padding: 12, borderRadius: 8, background: theme.colors.surfaceHighest, fontSize: 13, whiteSpace: 'pre-wrap', color: failed ? theme.colors.textDestructive : theme.colors.textSecondary }}>
                {props.tex}
            </pre>
        );
    }
    return <div style={box} dangerouslySetInnerHTML={{ __html: html }} />;
}
