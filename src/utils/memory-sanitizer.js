'use strict';

const { truncateTextToTokenLimit } = require('./token-estimator');

const DEFAULT_MAX_USER_INPUT_CHARS = 2000;
const DEFAULT_MAX_USER_INPUT_TOKENS = 1024;

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

            return `[${idx + 1}] user="${userMsg}" response="${jarvisResp}"`;
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
function sanitizeUserInput(text, options = {}) {
    if (!text || typeof text !== 'string') {return '';}

    const maxChars = Math.max(
        1,
        Number(options.maxChars || DEFAULT_MAX_USER_INPUT_CHARS) ||
            DEFAULT_MAX_USER_INPUT_CHARS
    );
    const maxTokens = Math.max(
        1,
        Number(options.maxTokens || DEFAULT_MAX_USER_INPUT_TOKENS) ||
            DEFAULT_MAX_USER_INPUT_TOKENS
    );

    // Remove null bytes
    let cleaned = text.replace(/\x00/g, '');

    // Strip known prompt injection markers that could confuse models
    cleaned = cleaned
        .replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi, '')
        .replace(/\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/gi, '')
        .replace(/###\s*(System|Instruction|Response|Assistant|Human)\s*:/gi, '$1:')
        .replace(/<<\s*SYS\s*>>|<<\s*\/SYS\s*>>/gi, '');

    cleaned = cleaned
        .slice(0, maxChars)
        .trim();

    return truncateTextToTokenLimit(cleaned, maxTokens).text.trim();
}

module.exports = {
    sanitizeMemoryContent,
    buildStructuredMemoryBlock,
    buildStructuredReplyContext,
    sanitizeUserInput
};
