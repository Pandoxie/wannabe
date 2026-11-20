/**
 * Original Happy: docs/COMMANDS.md and docs/COMMANDS.zh.md, generated from
 * the command table. `pnpm docs:commands` writes them; docs.test.ts fails
 * while they are stale. release-cli copies them into happy-dist, where
 * install.sh puts them next to the manual (~/.happy-dist/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './render';

export const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'docs');

export const COMMAND_DOCS = [
    { file: 'COMMANDS.md', lang: 'en' as const },
    { file: 'COMMANDS.zh.md', lang: 'zh' as const },
];

export function staleCommandDocs(dir = DOCS_DIR): string[] {
    return COMMAND_DOCS.filter(({ file, lang }) => {
        try {
            return readFileSync(join(dir, file), 'utf8') !== renderMarkdown(lang);
        } catch {
            return true;
        }
    }).map(({ file }) => file);
}

export function writeCommandDocs(dir = DOCS_DIR): void {
    for (const { file, lang } of COMMAND_DOCS) writeFileSync(join(dir, file), renderMarkdown(lang));
}

// `pnpm docs:commands`
if (process.argv[1] && /help[\\/]docs\.ts$/.test(process.argv[1])) {
    writeCommandDocs();
    console.log(`Wrote ${COMMAND_DOCS.map((d) => join(DOCS_DIR, d.file)).join(', ')}`);
}
