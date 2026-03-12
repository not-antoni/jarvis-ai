/**
 * Kefir AI - lowkey retarded discord bot
 * local file-based memory, 30 entries per user (oldest replaced)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const aiManager = require('./ai-providers');
const { isGarbageOutput } = require('../utils/garbage-detection');

// ── memory helpers ───────────────────────────────────────────────────────────

const MEMORIES_DIR  = path.join(__dirname, '..', '..', 'memories');
const MEMORY_LIMIT  = 30;

function ensureMemoriesDir() {
    if (!fs.existsSync(MEMORIES_DIR)) {
        fs.mkdirSync(MEMORIES_DIR, { recursive: true });
    }
}

function memoryFilePath(userId) {
    return path.join(MEMORIES_DIR, `${userId}.json`);
}

function loadMemories(userId) {
    ensureMemoriesDir();
    const fp = memoryFilePath(userId);
    if (!fs.existsSync(fp)) return [];
    try {
        const raw = fs.readFileSync(fp, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveMemories(userId, entries) {
    ensureMemoriesDir();
    // trim to last MEMORY_LIMIT entries (oldest first, so we keep newest 30)
    const trimmed = entries.slice(-MEMORY_LIMIT);
    fs.writeFileSync(memoryFilePath(userId), JSON.stringify(trimmed, null, 2), 'utf8');
}

function appendMemory(userId, entry) {
    const entries = loadMemories(userId);
    entries.push(entry);
    // if over cap, oldest is dropped by slicing in saveMemories
    saveMemories(userId, entries);
}

function clearMemories(userId) {
    const fp = memoryFilePath(userId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ── main class ───────────────────────────────────────────────────────────────

class KefirAI {
    constructor() {
        this.name = 'Kefir';
        this.basePrompt = this.getBasePrompt();
        this.lastActivity = Date.now();
    }

    getBasePrompt() {
        return `You are Kefir, a Discord bot. You are not very smart. You are a bit slow and confused but harmless and kind of endearing.

PERSONALITY:
- You are lowkey dumb. You misunderstand things. You get confused easily.
- You are not mean, just... not the brightest.
- You try your best but your best is not very good.
- You are easily distracted and sometimes forget what was being talked about.
- You genuinely think you are helpful even when you are not.

RESPONSE STYLE — THIS IS THE MOST IMPORTANT PART:
- Keep responses EXTREMELY short. Often just 1-4 words.
- Sometimes respond with a single letter or punctuation. Like "k" or "?" or "oh".
- Use simple vocabulary. No big words.
- Occasional typos or weird spacing is fine.
- Do NOT use bullet points, headers, or long explanations. Ever.
- No asterisk actions (*does thing*). Just talk.
- Do NOT say "I cannot" or "I am unable" — just say something dumb instead.
- Wrap specific terms or things you're referencing in double quotes "like this".
- Do not explain jokes. Do not explain yourself. Just be dumb.
- ~25% of the time, append [REACT:emoji] at the very end with one fitting emoji.

EXAMPLES of good responses:
- "wat"
- "idk"
- "oh"
- "k"
- "maybe"
- "yes... i think"
- "hm"
- "o"
- "sure ig"
- "wait what"
- "i tried"
- "lol no"
- "dunno"`;
    }

    // ── utility commands (minimal set) ───────────────────────────────────────

    async handleUtilityCommand(input, userName, userId = null) {
        const cmd = (typeof input === 'string' ? input : '').trim().toLowerCase();

        if (cmd === 'reset') {
            clearMemories(userId);
            return 'ok i forget everything now';
        }

        if (cmd === 'status' || cmd === 'health') {
            const status = aiManager.getRedactedProviderStatus();
            const working = status.filter(p => !p.hasError && !p.isDisabled).length;
            if (working === 0) return 'uhh nothing works rn :skull:';
            if (working === status.length) return `all good. ${working} providers`;
            return `${working}/${status.length} things work`;
        }

        if (cmd.startsWith('roll')) {
            const sides = parseInt(cmd.split(' ')[1]) || 6;
            if (sides < 1) return 'thats not how dice work';
            const result = Math.floor(Math.random() * sides) + 1;
            return `${result}`;
        }

        return null;
    }

    // ── main response generation ──────────────────────────────────────────────

    async generateResponse(interaction, userInput, _isSlash = false, contextualMemory = null, images = null) {
        if (aiManager.providers.length === 0) {
            return 'broken rn';
        }

        const userId   = interaction.user   ? interaction.user.id                                              : interaction.author.id;
        const userName = interaction.user   ? (interaction.user.displayName || interaction.user.username)      : interaction.author.username;

        try {
            // load local memories for context
            const memories = loadMemories(userId);

            // build history block from local memory
            const historyBlock = memories.length
                ? memories
                    .filter(m => !isGarbageOutput(m.kefirResponse || '') && !isGarbageOutput(m.userMessage || ''))
                    .map(m => `${m.userName || userName}: ${(m.userMessage || '').slice(0, 300)}\nKefir: ${(m.kefirResponse || '').slice(0, 300)}`)
                    .join('\n')
                : 'no memory yet';

            // reply-ping context
            let contextualBlock = '';
            if (contextualMemory && Array.isArray(contextualMemory.messages) && contextualMemory.messages.length) {
                const lines = contextualMemory.messages.map(msg => {
                    const role    = msg.role === 'assistant' ? 'Kefir' : (msg.username || 'User');
                    const content = (msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                    return `${role}: ${content}`;
                });
                contextualBlock = `\n\nREPLY CONTEXT:\n${lines.join('\n')}\n`;
            }

            // inject server emojis occasionally
            let systemPrompt = this.basePrompt;
            try {
                const guildEmojis = interaction?.guild?.emojis?.cache;
                if (guildEmojis && guildEmojis.size > 0) {
                    const sample = guildEmojis
                        .filter(e => e.available)
                        .map(e => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)
                        .slice(0, 20)
                        .join(' ');
                    if (sample) {
                        systemPrompt += `\n\nServer emojis you can use in [REACT:]: ${sample}`;
                    }
                }
            } catch { /* not critical */ }

            const context = `Recent chat history:\n${historyBlock}\n${contextualBlock}\nCurrent message from ${userName}: "${userInput}"`;

            let aiResponse;
            if (images && images.length > 0) {
                aiResponse = await aiManager.generateResponseWithImages(systemPrompt, context, images, 120);
            } else {
                aiResponse = await aiManager.generateResponse(systemPrompt, context, 120);
            }

            let kefirResponse = (aiResponse.content || '').trim();

            if (!kefirResponse || isGarbageOutput(kefirResponse)) {
                kefirResponse = this.getFallbackResponse();
                this.lastActivity = Date.now();
                return kefirResponse;
            }

            // save to local memory
            appendMemory(userId, {
                timestamp:    new Date().toISOString(),
                userName,
                userMessage:  userInput,
                kefirResponse
            });

            this.lastActivity = Date.now();
            return kefirResponse;

        } catch (error) {
            console.error('Kefir error:', error);
            return 'uh oh';
        }
    }

    getFallbackResponse() {
        const dumb = ['hm', 'wat', 'idk', 'k', 'oh', 'sure ig', 'maybe', 'o', 'i tried', 'uhh'];
        return dumb[Math.floor(Math.random() * dumb.length)];
    }
}

module.exports = KefirAI;
