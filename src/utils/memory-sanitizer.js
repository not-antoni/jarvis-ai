'use strict';

/**
 * Memory Sanitizer - Escape and structure memory injection
 * FIX for prompt injection vulnerabilities in memory context
 */

/**
 * Sanitize memory content to prevent prompt injection
 * Escapes newlines, quotes, and other special characters
 */
function sanitizeMemoryContent(text) {
    if (!text || typeof text !== 'string') {return '';}

    let result = text
        // Remove null bytes
        .replace(/\x00/g, '')
        // Escape quotes
        .replace(/"/g, '\\"')
        // Replace newlines with spaces
        .replace(/\n/g, ' ')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        .trim();

    // Truncate at word boundary to avoid cutting mid-word/sentence
    if (result.length > 500) {
        const truncated = result.slice(0, 500);
        const lastSpace = truncated.lastIndexOf(' ');
        result = lastSpace > 400 ? truncated.slice(0, lastSpace) : truncated;
    }

    return result;
}

/**
 * Build memory block with clear structural markers
 * Prevents models from interpreting memory content as instructions
 */
function buildStructuredMemoryBlock(memories, userName = 'User') {
    if (!memories || memories.length === 0) {
        return '[SECURE_MEMORY_BLOCK]\n[NO PRIOR CONVERSATIONS]\n[/SECURE_MEMORY_BLOCK]';
    }

    const memoryLines = memories
        .map((mem, idx) => {
            const userMsg = sanitizeMemoryContent(mem.userMessage || '');
            const jarvisResp = sanitizeMemoryContent(mem.jarvisResponse || '');

            if (!userMsg && !jarvisResp) {return null;}

            const timestamp = mem.createdAt
                ? new Date(mem.createdAt).toLocaleString()
                : 'unknown time';

            return [
                `[MEMORY_${idx + 1}]`,
                `timestamp="${timestamp}"`,
                `user="${userMsg}"`,
                `response="${jarvisResp}"`,
                `[/MEMORY_${idx + 1}]`
            ].join('\n');
        })
        .filter(Boolean)
        .join('\n');

    return `[SECURE_MEMORY_BLOCK]\n${memoryLines}\n[/SECURE_MEMORY_BLOCK]`;
}

/**
 * Build reply context with clear structural markers
 */
function buildStructuredReplyContext(contextMessages = []) {
    if (!contextMessages || contextMessages.length === 0) {
        return '';
    }

    const contextLines = contextMessages
        .map((msg, idx) => {
            const role = msg.role === 'assistant' ? 'Jarvis' : (msg.username || 'User');
            const content = sanitizeMemoryContent(msg.content || '');

            if (!content) {return null;}

            return [
                `[CONTEXT_${idx + 1}]`,
                `role="${role}"`,
                `text="${content}"`,
                `[/CONTEXT_${idx + 1}]`
            ].join('\n');
        })
        .filter(Boolean)
        .join('\n');

    if (!contextLines) {return '';}

    return `\n[REPLY_CONTEXT_BLOCK]\n${contextLines}\n[/REPLY_CONTEXT_BLOCK]`;
}

/**
 * Sanitize user input to prevent injection
 */
function sanitizeUserInput(text) {
    if (!text || typeof text !== 'string') {return '';}

    // Remove null bytes
    const cleaned = text.replace(/\x00/g, '');

    // Don't collapse newlines here - preserve message structure
    // But escape quotes and other dangerous chars
    return cleaned
        .replace(/"/g, '\\"')
        .slice(0, 2000)
        .trim();
}

module.exports = {
    sanitizeMemoryContent,
    buildStructuredMemoryBlock,
    buildStructuredReplyContext,
    sanitizeUserInput
};

