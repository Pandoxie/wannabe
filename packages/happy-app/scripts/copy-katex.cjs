// Copies KaTeX's stylesheet and woff2 fonts into public/katex, served as
// /katex/… by the web build (Original Happy math rendering). From the
// installed package, so the files always match the KaTeX version bundled.
// Only woff2: every browser the web client supports reads it; the
// stylesheet's woff/ttf fallbacks are simply never requested.
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(path.dirname(require.resolve('katex/package.json')), 'dist');
const out = path.join(__dirname, '..', 'public', 'katex');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(dist, 'katex.min.css'), path.join(out, 'katex.min.css'));
let fonts = 0;
for (const f of fs.readdirSync(path.join(dist, 'fonts'))) {
    if (f.endsWith('.woff2')) {
        fs.copyFileSync(path.join(dist, 'fonts', f), path.join(out, 'fonts', f));
        fonts++;
    }
}
console.log(`[copy-katex] public/katex: stylesheet + ${fonts} fonts`);
