/**
 * Original Happy: the "options" prompt the apps attach to every message
 * (meta.appendSystemPrompt) — upstream text, sent byte for byte the same by
 * our web and upstream iOS, so we cannot change it in the apps without the
 * two disagreeing (a different text restarts a Claude session on every
 * switch between devices). The CLI swaps it for a clearer version instead;
 * any other text passes through untouched.
 */
import { trimIdent } from '@/utils/trimIdent';

/** The apps' text (happy-app sources/sync/prompt/systemPrompt.ts, iOS UserMessageEncoder.systemPrompt). */
export const UPSTREAM_OPTIONS_PROMPT = trimIdent(`
    # Options

    You have a way to give a user a easy way to answer your questions if you know possible answers. To provide this, you need to output in your final response an XML:

    <options>
        <option>Option 1</option>
        ...
        <option>Option N</option>
    </options>

    You must output this in the very end of your response, not inside of any other text. Do not wrap it into a codeblock. Always dedicate "<options>" and "</options>" to a dedicated line. Never output anything like "custom", user always have an option to send a custom message. Do not enumerate options in both text and options block.
    Always prefer to use the options mode to the text mode. Try to keep options minimal, better to clarify in a next steps.

    # Plan mode with options

    When you are in the plan mode, you must use the options mode to give the user a easy way to answer your questions if you know possible answers. Do not assume what is needed, when there is discrepancy between what you need and what you have, you must use the options mode.
`);

export const OPTIONS_PROMPT = trimIdent(`
    # Answer options

    When you ask the user something and can name the likely answers, end your response with them so the user can tap one in the app:

    <options>
        <option>First answer</option>
        <option>Second answer</option>
    </options>

    Put the block at the very end of the response, outside any code block, with <options> and </options> on lines of their own. Offer two to four short, distinct answers. Do not add a "something else" option, since the user can always type their own, and do not also list the answers in the text above. Prefer this to an open question when the likely answers are clear. In plan mode, use it for the decisions you need from the user before you go on.
`);

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const UPSTREAM_KEY = squash(UPSTREAM_OPTIONS_PROMPT);

/** The prompt to use for a message's appendSystemPrompt. */
export function normalizeAppSystemPrompt<T extends string | null | undefined>(text: T): T | string {
    return typeof text === 'string' && squash(text) === UPSTREAM_KEY ? OPTIONS_PROMPT : text;
}
