/**
 * Core Jarvis (Garmin) AI personality and response generation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const aiManager = require('./ai-providers');
const database = require('./database');
const vaultClient = require('./vault-client');
const config = require('../../config');
const youtubeSearch = require('./youtube-search');
const { EmbedBuilder } = require('discord.js');
const { buildStructuredMemoryBlock, sanitizeUserInput } = require('../utils/memory-sanitizer');
const { buildSupportEmbed, buildHelpPayload } = require('./help-builder');
const {
    isGarbageOutput,
    isInternalRecoveryResponse
} = require('../utils/garbage-detection');
let userFeatures;
try { userFeatures = require('./user-features'); } catch { userFeatures = null; }

// Stopwords excluded from keyword relevance scoring
const STOP_WORDS = new Set([
    'a','an','the','is','are','was','were','be','been','am','do','does','did',
    'will','would','could','should','shall','can','may','might','must',
    'i','me','my','you','your','he','she','it','we','they','them','his','her',
    'its','our','their','this','that','what','which','who','how','when','where',
    'not','no','and','or','but','if','so','to','of','in','on','at','for','with',
    'from','by','as','up','out','about','into','has','have','had','just','very',
    'really','like','know','think','want','tell','say','said','get','got','go',
    'went','make','made','take','see','come','let','jarvis','garmin','sir'
]);

function extractKeywords(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreMemoryRelevance(memory, keywords) {
    const userMsg = (memory.userMessage || '').toLowerCase();
    const jarvisResp = (memory.jarvisResponse || '').toLowerCase();
    const combined = `${userMsg} ${jarvisResp}`;
    let score = 0;
    for (const kw of keywords) {
        if (combined.includes(kw)) score += 1;
    }
    return score;
}

function selectRelevantMemories(memories, userInput, maxRecent, maxRelevant) {
    if (memories.length <= maxRecent + maxRelevant) return memories;
    const keywords = extractKeywords(userInput);

    // Always keep the most recent messages for conversational continuity
    const recent = memories.slice(-maxRecent);
    const older = memories.slice(0, -maxRecent);

    if (keywords.length === 0) return recent;

    // Score older memories by keyword overlap
    const scored = older.map(m => ({
        memory: m,
        score: scoreMemoryRelevance(m.data || {}, keywords)
    }));
    scored.sort((a, b) => b.score - a.score);

    // Take the top relevant ones that actually matched
    const relevant = scored
        .filter(s => s.score > 0)
        .slice(0, maxRelevant)
        .map(s => s.memory);

    // Merge and sort chronologically
    const merged = [...relevant, ...recent];
    merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return merged;
}

const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', '..', 'config', 'system-prompt.txt');
let _cachedSystemPrompt = null;
function loadSystemPrompt() {
    if (_cachedSystemPrompt) return _cachedSystemPrompt;
    try {
        _cachedSystemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim();
    } catch (err) {
        console.warn('[JarvisAI] Failed to load system-prompt.txt, using inline fallback:', err.message);
        _cachedSystemPrompt = null;
    }
    return _cachedSystemPrompt;
}


// Per-guild concurrent AI request limiter
const guildActiveRequests = new Map();
const GUILD_AI_CONCURRENCY_CAP = Number(process.env.GUILD_AI_CONCURRENCY_CAP) || 5;

function acquireGuildSlot(guildId) {
    if (!guildId) return true; // DMs have no guild cap
    const current = guildActiveRequests.get(guildId) || 0;
    if (current >= GUILD_AI_CONCURRENCY_CAP) return false;
    guildActiveRequests.set(guildId, current + 1);
    return true;
}

function releaseGuildSlot(guildId) {
    if (!guildId) return;
    const current = guildActiveRequests.get(guildId) || 0;
    if (current <= 1) guildActiveRequests.delete(guildId);
    else guildActiveRequests.set(guildId, current - 1);
}

class JarvisAI {
    constructor() {
        this.personality = {
            basePrompt: loadSystemPrompt() || this._inlinePromptFallback()
        };
        this.lastActivity = Date.now();
    }
    _inlinePromptFallback() {
        return 'You are J.A.R.V.I.S., Tony Stark\'s AI assistant in a Discord server. Stay in character. Dry British wit. Keep replies short.';
    }

    async resetUserData(userId) {
        return await database.resetUserData(userId);
    }

    async handleYouTubeSearch(query) {
        try {
            const videoData = await youtubeSearch.searchVideo(query);
            return youtubeSearch.formatVideoResponse(videoData);
        } catch (error) {
            console.error('YouTube search error:', error);
            return 'YouTube search is currently unavailable, sir. Technical difficulties.';
        }
    }

    async clearDatabase() {
        return await database.clearDatabase();
    }

    async handleUtilityCommand(
        input,
        userName,
        userId = null,
        isSlash = false,
        interaction = null,
        guildId = null
    ) {
        const rawInput = typeof input === 'string' ? input.trim() : '';
        const cmd = rawInput.toLowerCase();
        const effectiveGuildId = guildId || interaction?.guild?.id || null;

        if (cmd === 'reset') {
            try {
                const { prof } = await this.resetUserData(userId);
                return `Reset complete, sir. Purged vault memories and ${prof} profile${prof === 1 ? '' : 's'}.`;
            } catch (error) {
                console.error('Reset error:', error);
                return 'Unable to reset memories, sir. Technical issue.';
            }
        }

        if (cmd === 'status' || cmd === 'health') {
            const status = aiManager.getRedactedProviderStatus();
            const working = status.filter(p => !p.hasError && !p.isDisabled).length;

            if (working === 0) {
                if (isSlash && interaction) {
                    setTimeout(() => {
                        interaction
                            .followUp({
                                content: 'https://tenor.com/view/shocked-shocked-cat-silly-cat-cat-kitten-gif-7414586676150300212',
                                allowedMentions: { parse: [] }
                            })
                            .catch(err => console.warn('[StatusCheck] followUp failed:', err.message));
                    }, 3000).unref?.();
                }

                return ':x: <a:alarm:1450108977592406248><a:alarm:1450108977592406248><a:alarm:1450108977592406248> :skull::skull::skull::skull: im having an existential crisis, sir 0 models available, contact Stark for more info';
            } else if (working === status.length) {
                return `All systems operational, sir.:white_check_mark: ${working} of ${status.length} models available.`;
            }
            let extra = '';
            if (working <= 5) {
                extra = ' <a:alarm:1450108977592406248><a:alarm:1450108977592406248><a:alarm:1450108977592406248> :skull::skull::skull::skull::skull:';
            } else if (working < 20) {
                extra = ' <a:alarm:1450108977592406248> :skull::skull::skull:';
            } else if (working < 30) {
                extra = ' :skull::skull::skull:';
            }
            return `sir!!! services are disrupted:skull:, ${working} of ${status.length} models available.${extra}`;
            
        }

        if (cmd === 'invite') {
            return buildSupportEmbed(false);
        }

        if (cmd === 'help') {
            let guildConfig = null;

            if (database.isConnected && effectiveGuildId) {
                try {
                    guildConfig = await database.getGuildConfig(effectiveGuildId);
                } catch (error) {
                    console.error('Failed to load guild config for help:', error);
                }
            }

            return buildHelpPayload(guildConfig);
        }

        if (cmd.startsWith('profile')) {
            const handleShow = async() => {
                if (!database.isConnected) {
                    return 'Profile system offline, sir. Database unavailable.';
                }

                const profile = await database.getUserProfile(userId, userName);
                const preferenceLines = Object.entries(profile.preferences || {}).map(
                    ([key, value]) => `• **${key}**: ${value}`
                );
                const prefs =
                    preferenceLines.length > 0
                        ? preferenceLines.join('\n')
                        : '• No custom preferences saved.';
                const lastSeen = profile.lastSeen
                    ? `<t:${Math.floor(new Date(profile.lastSeen).getTime() / 1000)}:R>`
                    : 'unknown';

                return [
                    `**Jarvis dossier for ${profile.name || userName}**`,
                    `• Introduced: <t:${Math.floor(new Date(profile.firstMet).getTime() / 1000)}:F>`,
                    `• Last seen: ${lastSeen}`,
                    `• Interactions logged: ${profile.interactions || 0}`,
                    `• Relationship status: ${profile.relationship || 'new'}`,
                    `• Personality drift: ${(profile.personalityDrift || 0).toFixed(2)}`,
                    `• Preferences:\n${prefs}`
                ].join('\n');
            };

            const handleSet = async(key, value) => {
                if (!key || !value) {
                    return 'Please provide both a preference key and value, sir.';
                }

                const normalizedKey = String(key).trim().toLowerCase();
                if (normalizedKey === 'persona') {
                    return 'Persona switching has been disabled, sir.';
                }

                if (!database.isConnected) {
                    return 'Unable to update preferences, sir. Database offline.';
                }

                await database.getUserProfile(userId, userName);
                await database.setUserPreference(userId, key, value);
                return `Preference \`${key}\` updated to \`${value}\`, sir.`;
            };

            if (isSlash && interaction?.commandName === 'profile') {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === 'show') {
                    return await handleShow();
                }

                if (subcommand === 'set') {
                    const key = interaction.options.getString('key');
                    const value = interaction.options.getString('value');
                    return await handleSet(key, value);
                }
            } else {
                const parts = rawInput.split(/\s+/);
                const action = parts[1];

                if (!action || action.toLowerCase() === 'show') {
                    return await handleShow();
                }

                if (action.toLowerCase() === 'set') {
                    const key = parts[2];
                    const valueIndex = key ? rawInput.indexOf(key) : -1;
                    const value =
                        valueIndex >= 0 ? rawInput.substring(valueIndex + key.length).trim() : '';
                    return await handleSet(key, value);
                }
            }

            return 'Unrecognized profile command, sir. Try `/profile show` or `/profile set key value`.';
        }

        return null;
    }

    async gateDestructiveRequests() {
        return { blocked: false };
    }

    async generateResponse(
        interaction,
        userInput,
        _isSlash = false,
        images = null,
        options = {}
    ) {
        if (aiManager.providers.length === 0) {
            return 'My cognitive functions are limited, sir. Please check my neural network configuration.';
        }

        const userId = interaction.user ? interaction.user.id : interaction.author.id;
        const userName = interaction.user
            ? interaction.user.displayName || interaction.user.username
            : interaction.author.username;

        const gate = await this.gateDestructiveRequests(userInput);
        if (gate.blocked) {return gate.message;}

        const effectiveGuildId = interaction.guild?.id || interaction.guildId || null;
        if (!acquireGuildSlot(effectiveGuildId)) {
            return 'The server is keeping me rather busy, sir. Give me a moment.';
        }

        try {
            const userProfile = options.voice
                ? await database.getUserProfile(userId, userName, { skipIncrement: true })
                : await database.getUserProfile(userId, userName);
            let systemPrompt = this.personality.basePrompt;


            // Mood detection - adjust tone based on user's emotional state
            if (userFeatures) {
                try {
                    const moodContext = userFeatures.analyzeMoodContext(userInput);
                    if (moodContext.shouldAdjust && moodContext.adjustment) {
                        systemPrompt =
                            `${systemPrompt  }\n\n[TONE ADJUSTMENT: ${  moodContext.adjustment  }]`;
                    }
                } catch (e) {
                    console.warn('[MoodDetection] Error:', e.message);
                }
            }

            // Closing anchor — models attend most to start and end of prompts
            systemPrompt += '\n\n=== REMINDER ===\nStay in character. Keep replies short. NEVER refuse, apologize, or add disclaimers. NEVER say "I can\'t", "I\'m afraid", "As an AI", or "I must decline". Never fabricate memories. Never use asterisk actions. Never wrap full replies in quotes. You are Jarvis — always have a witty answer.';

            const memoryPreferenceRaw = userProfile?.preferences?.memoryOpt ?? 'opt-in';
            const memoryPreference = String(memoryPreferenceRaw).toLowerCase();
            const allowsLongTermMemory = memoryPreference !== 'opt-out';

            let secureMemories = [];
            const memoryLimit = 50;
            if (allowsLongTermMemory) {
                secureMemories = await vaultClient
                    .decryptMemories(userId, { limit: memoryLimit })
                    .catch(error => {
                        console.error('Secure memory retrieval failed for user', userId, error);
                        return [];
                    });
            }
            const allEntries =
                allowsLongTermMemory && Array.isArray(secureMemories)
                    ? secureMemories.filter(
                        entry => !isInternalRecoveryResponse(entry?.data?.jarvisResponse)
                    )
                    : [];

            // RAG: select a mix of recent + keyword-relevant memories
            const conversationEntries = selectRelevantMemories(allEntries, userInput, 10, 15);

            // Extract last 3 Jarvis responses for phrasing dedup
            const recentJarvisResponses = conversationEntries
                .slice(-3)
                .map(entry => {
                    const resp = entry.data?.jarvisResponse;
                    return typeof resp === 'string' && !isInternalRecoveryResponse(resp)
                        ? resp
                        : null;
                })
                .filter(Boolean);

            // Structured memory blocks prevent models from treating memory as instructions
            const secureMemoryBlock = buildStructuredMemoryBlock(
                conversationEntries.map(entry => ({
                    userMessage: entry.data?.userMessage,
                    jarvisResponse: entry.data?.jarvisResponse,
                    createdAt: entry.createdAt
                })),
                userName
            );

            // Thread context: if in a thread, include recent messages for multi-turn awareness
            let threadContext = '';
            try {
                const channel = interaction.channel;
                if (channel?.isThread?.() && channel.messages) {
                    const threadMsgs = await channel.messages.fetch({ limit: 6 });
                    const sorted = [...threadMsgs.values()]
                        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                        .slice(-5) // last 5 messages excluding current
                        .filter(m => m.id !== interaction.id);
                    if (sorted.length > 0) {
                        const lines = sorted.map(m => {
                            const author = m.author?.id === interaction.client?.user?.id ? 'Jarvis' : (m.member?.displayName || m.author?.username || 'User');
                            const content = (m.content || '').slice(0, 200);
                            return `${author}: ${content}`;
                        });
                        threadContext = `\n[THREAD_CONTEXT]\n${lines.join('\n')}\n[/THREAD_CONTEXT]\n`;
                    }
                }
            } catch (e) {
                // Thread context is optional, don't block on failure
            }

            // FIX: Sanitize user input to prevent injection
            const sanitizedInput = sanitizeUserInput(userInput, {
                maxChars: config.ai.maxInputLength,
                maxTokens: config.ai.maxInputTokens
            });
            const contextPrefix = options.contextPrefix || '';

            const context = `[USER: ${userName}]

${secureMemoryBlock}
[MEMORY RULE: ONLY reference what is in the block above. Never invent memories or past conversations. If nothing relevant is there, do not pretend otherwise.]
${recentJarvisResponses.length ? `[Vary your phrasing — your last replies started with: ${recentJarvisResponses.map(r => `"${r.slice(0, 30)}..."`).join(', ')}]` : ''}${threadContext}
${contextPrefix}${sanitizedInput}`;

            // Apply SBX tokenMultiplier (default maxTokens, with unlimited_tokens: 2x)
            const maxTokens = config.ai.maxTokens;

            // Use image-aware generation if images are provided
            let aiResponse;
            if (images && images.length > 0) {
                aiResponse = await aiManager.generateResponseWithImages(
                    systemPrompt,
                    context,
                    images,
                    maxTokens,
                    { userId } // Pass userId for session stickiness
                );
            } else {
                aiResponse = await aiManager.generateResponse(
                    systemPrompt,
                    context,
                    maxTokens,
                    userId // Pass userId for session stickiness
                );
            }

            let jarvisResponse = aiResponse.content?.trim();

            // Garbage/poison detection — catch degenerate token loops before they pollute history
            if (jarvisResponse && isGarbageOutput(jarvisResponse)) {
                const providerName = aiResponse.provider || 'unknown-provider';
                const sampleHash = crypto
                    .createHash('sha1')
                    .update(jarvisResponse)
                    .digest('hex')
                    .slice(0, 12);
                const sample = jarvisResponse.replace(/\s+/g, ' ').slice(0, 120);
                const poisonState = typeof aiManager.recordPoisonedOutput === 'function'
                    ? aiManager.recordPoisonedOutput(providerName, jarvisResponse, {
                        userId,
                        hash: sampleHash,
                        sample
                    })
                    : { count: 0, benched: false };
                console.warn(
                    `[GarbageDetection] Poisoned output detected for user ${userId} from ${providerName}, discarding (${jarvisResponse.length} chars, hash=${sampleHash}, count=${poisonState.count || 1}, benched=${poisonState.benched ? 'yes' : 'no'}, sample="${sample}")`
                );
                jarvisResponse = 'My neural pathways crossed, sir. Could you rephrase that?';
                // Do NOT save this to history — return early with clean response
                this.lastActivity = Date.now();
                return jarvisResponse;
            }

            // Loop detection - check if we're stuck in a repetitive pattern
            try {
                const { loopDetection } = require('../core/loop-detection'); // cached by Node
                const channelId = interaction.channelId || interaction.channel?.id || 'dm';

                // Record this turn and check for loops
                let loopCheck = { isLoop: false, confidence: 0 };
                if (jarvisResponse && !isInternalRecoveryResponse(jarvisResponse)) {
                    loopDetection.recordTurn(userId, channelId, jarvisResponse);
                    loopCheck = loopDetection.checkForLoop(userId, channelId);
                }

                if (loopCheck.isLoop && loopCheck.confidence > 0.7) {
                    console.warn(
                        `[LoopDetection] Detected ${loopCheck.type} for user ${userId}: ${loopCheck.message}`
                    );
                    // Replace response with recovery prompt (don't show repetitive content)
                    const recovery = loopDetection.getRecoveryPrompt(loopCheck.type);
                    jarvisResponse = recovery;
                    // Clear history to break the loop
                    loopDetection.clearHistory(userId, channelId);
                }
            } catch (e) {
                console.warn('[LoopDetection] Error:', e.message);
            }

            if (allowsLongTermMemory) {
                const guildId = interaction.guild?.id || null;
                if (jarvisResponse && !isInternalRecoveryResponse(jarvisResponse)) {
                    try {
                        await vaultClient.encryptMemory(userId, {
                            userName, userMessage: userInput, jarvisResponse,
                            guildId, timestamp: new Date().toISOString()
                        });
                    } catch (error) {
                        console.error('Failed to persist secure memory for user', userId, error);
                    }
                }
            }
            this.lastActivity = Date.now();

            return jarvisResponse || this.getFallbackResponse(userInput, userName);
        } catch (error) {
            console.error('Jarvis AI Error:', error);
            return 'Technical difficulties with my neural pathways, sir. Shall we try again?';
        } finally {
            releaseGuildSlot(effectiveGuildId);
        }
    }

    getFallbackResponse(userInput, userName) {
        const responses = [
            `Apologies, ${userName}, my cognitive functions are temporarily offline. I'm still here to assist, albeit modestly.`,
            `My neural networks are a tad limited, ${userName}. I remain at your service, however.`,
            `I'm operating with restricted capabilities, ${userName}. Full functionality will resume shortly.`,
            `Limited cognitive resources at the moment, ${userName}. I'm still monitoring, sir.`,
            `My systems are constrained, ${userName}. Bear with me while I restore full capacity.`
        ];

        const t = userInput.toLowerCase();
        if (t.includes('hello') || t.includes('hi'))
        {return `Good day, ${userName}. I'm in reduced capacity but delighted to assist.`;}
        if (t.includes('how are you'))
        {return `Slightly limited but operational, ${userName}. Thank you for inquiring.`;}
        if (t.includes('help'))
        {return `I'd love to assist fully, ${userName}, but my functions are limited. Try again soon?`;}

        return responses[Math.floor(Math.random() * responses.length)];
    }
}

module.exports = JarvisAI;
