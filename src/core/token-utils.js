/**
 * Token Estimation Utilities
 * Provides fast local token estimation for context management
 * Based on Google's Gemini CLI implementation
 */

// Token estimation constants (empirically derived)
const ASCII_TOKENS_PER_CHAR = 0.25; // ASCII: ~4 chars per token
const NON_ASCII_TOKENS_PER_CHAR = 1.3; // CJK/Unicode: ~1.3 tokens per char
const OVERHEAD_PER_MESSAGE = 4; // Message structure overhead

/**
 * Estimate token count for a string
 * Uses character-level heuristics for speed (no API call)
 *
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;

    let tokens = 0;

    for (const char of text) {
        const codePoint = char.codePointAt(0);
        if (codePoint <= 127) {
            // ASCII characters
            tokens += ASCII_TOKENS_PER_CHAR;
        } else {
            // Non-ASCII (CJK, emoji, accented chars, etc.)
            tokens += NON_ASCII_TOKENS_PER_CHAR;
        }
    }

    return Math.ceil(tokens);
}

/**
 * Estimate tokens for a conversation message
 * Includes role overhead
 *
 * @param {Object} message - Message object with role and content
 * @returns {number} Estimated token count
 */
function estimateMessageTokens(message) {
    if (!message) return 0;

    let tokens = OVERHEAD_PER_MESSAGE;

    if (message.role) {
        tokens += estimateTokens(message.role);
    }

    if (typeof message.content === 'string') {
        tokens += estimateTokens(message.content);
    } else if (Array.isArray(message.content)) {
        // Handle array of parts (multimodal)
        for (const part of message.content) {
            if (typeof part === 'string') {
                tokens += estimateTokens(part);
            } else if (part.text) {
                tokens += estimateTokens(part.text);
            } else if (part.inlineData || part.fileData) {
                // Image/file tokens are harder to estimate
                // Use a reasonable default for images (~258 tokens for typical image)
                tokens += 258;
            }
        }
    }

    return tokens;
}

/**
 * Estimate tokens for an entire conversation
 *
 * @param {Array} messages - Array of message objects
 * @returns {number} Total estimated token count
 */
function estimateConversationTokens(messages) {
    if (!Array.isArray(messages)) return 0;

    let total = 0;
    for (const msg of messages) {
        total += estimateMessageTokens(msg);
    }

    return total;
}

/**
 * Calculate how much of a conversation fits within a token limit
 * Returns the index to slice from (keeps most recent messages)
 *
 * @param {Array} messages - Array of message objects
 * @param {number} maxTokens - Maximum token limit
 * @param {number} reserveTokens - Tokens to reserve for response
 * @returns {number} Index to start slicing from
 */
function calculateConversationSlice(messages, maxTokens, reserveTokens = 1000) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;

    const availableTokens = maxTokens - reserveTokens;
    let totalTokens = 0;

    // Start from the end (most recent) and work backwards
    for (let i = messages.length - 1; i >= 0; i--) {
        const messageTokens = estimateMessageTokens(messages[i]);

        if (totalTokens + messageTokens > availableTokens) {
            // Can't fit this message, return the next index
            return i + 1;
        }

        totalTokens += messageTokens;
    }

    // All messages fit
    return 0;
}

/**
 * Truncate text to fit within a token budget
 *
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum tokens
 * @param {string} suffix - Suffix to add if truncated (default: '...')
 * @returns {string} Truncated text
 */
function truncateToTokens(text, maxTokens, suffix = '...') {
    if (!text || typeof text !== 'string') return '';

    const currentTokens = estimateTokens(text);
    if (currentTokens <= maxTokens) return text;

    const suffixTokens = estimateTokens(suffix);
    const targetTokens = maxTokens - suffixTokens;

    if (targetTokens <= 0) return suffix;

    // Binary search for the right length
    let low = 0;
    let high = text.length;
    let result = '';

    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        const candidate = text.substring(0, mid);
        const tokens = estimateTokens(candidate);

        if (tokens <= targetTokens) {
            result = candidate;
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    return result + suffix;
}

/**
 * Get model token limits
 *
 * @param {string} model - Model name
 * @returns {Object} { input: number, output: number }
 */
function getModelTokenLimits(model) {
    const limits = {
        'gemini-2.5-pro': { input: 1048576, output: 65536 },
        'gemini-2.5-flash': { input: 1048576, output: 65536 },
        'gemini-2.0-flash': { input: 1048576, output: 8192 },
        'gemini-1.5-pro': { input: 2097152, output: 8192 },
        'gemini-1.5-flash': { input: 1048576, output: 8192 },
        'gpt-4': { input: 128000, output: 4096 },
        'gpt-4-turbo': { input: 128000, output: 4096 },
        'gpt-3.5-turbo': { input: 16385, output: 4096 },
        'claude-3-opus': { input: 200000, output: 4096 },
        'claude-3-sonnet': { input: 200000, output: 4096 },
        'claude-3-haiku': { input: 200000, output: 4096 }
    };

    // Normalize model name
    const normalized = model?.toLowerCase().replace(/[_-]/g, '').trim();

    for (const [key, value] of Object.entries(limits)) {
        if (normalized?.includes(key.replace(/-/g, ''))) {
            return value;
        }
    }

    // Default for unknown models
    return { input: 32000, output: 4096 };
}

/**
 * Check if content fits within model limits
 *
 * @param {string} content - Content to check
 * @param {string} model - Model name
 * @returns {Object} { fits: boolean, tokens: number, limit: number, overage: number }
 */
function checkContentFits(content, model) {
    const tokens = estimateTokens(content);
    const limits = getModelTokenLimits(model);
    const limit = limits.input;

    return {
        fits: tokens <= limit,
        tokens,
        limit,
        overage: Math.max(0, tokens - limit)
    };
}

module.exports = {
    estimateTokens,
    estimateMessageTokens,
    estimateConversationTokens,
    calculateConversationSlice,
    truncateToTokens,
    getModelTokenLimits,
    checkContentFits,
    // Constants for external use
    ASCII_TOKENS_PER_CHAR,
    NON_ASCII_TOKENS_PER_CHAR
};
