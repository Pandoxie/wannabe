import type { SDKAssistantMessage, SDKMessage } from '../sdk';

export function getAskUserQuestionToolCallIds(message: SDKMessage): string[] {
    if (message.type !== 'assistant') {
        return [];
    }

    const assistantMessage = message as SDKAssistantMessage;
    const content = assistantMessage.message.content;
    if (!Array.isArray(content)) {
        return [];
    }

    const ids: string[] = [];
    for (const block of content) {
        if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && typeof block.id === 'string' && block.id.length > 0) {
            ids.push(block.id);
        }
    }
    return ids;
}

/** Original Happy: the (first) question of an AskUserQuestion call, for the push body. */
export function getAskUserQuestionText(message: SDKMessage, toolCallId: string): string | null {
    if (message.type !== 'assistant') return null;
    const content = (message as SDKAssistantMessage).message.content;
    if (!Array.isArray(content)) return null;
    for (const block of content) {
        if (block.type === 'tool_use' && block.id === toolCallId) {
            const q = (block.input as { questions?: Array<{ question?: unknown }> } | undefined)?.questions?.[0]?.question;
            return typeof q === 'string' ? q : null;
        }
    }
    return null;
}
