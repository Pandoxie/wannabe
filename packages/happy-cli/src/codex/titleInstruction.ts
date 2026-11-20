import { trimIdent } from '@/utils/trimIdent';

/**
 * Asks the agent to call the change_title tool for the session title.
 * Appended to Codex prompts (see codexPrompt.ts).
 */
export const CHANGE_TITLE_INSTRUCTION = trimIdent(
  `Give this session a short title naming the task with the happy tool change_title, and update it when the task changes substantially. A title the user chose stays (the call keeps it and says so); when the user asks for a title, pass userChosen: true.`
);
