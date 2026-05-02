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
const braveSearch = require('./brave-search');
const { parseBooleanEnv } = require('../utils/parse-bool-env');

const WEB_SEARCH_ENABLED = parseBooleanEnv(process.env.WEB_SEARCH_AUTO, true);
const WEB_SEARCH_TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS) || 3500;
const WEB_SEARCH_MAX_RESULTS = Math.min(Math.max(Number(process.env.WEB_SEARCH_MAX_RESULTS) || 10, 10), 10);

/**
 * Vision-to-search prepass disabled.
 * Now it just returns the user input directly without triggering searches for images.
 */
async function buildSearchSeed(userInput, images) {
    return userInput;
}

/**
 * Runs a conditional web search based on a heuristic. Returns a ready-to-splice
 * context block (string) plus a short system-prompt nudge. Always resolves -
 * never blocks the pipeline on failure.
 */
async function maybeBuildWebSearchBlock(userInput, { voice = false } = {}) {
    if (!WEB_SEARCH_ENABLED) {
        console.warn('[WebSearch] SKIP: disabled via WEB_SEARCH_AUTO=false');
        return null;
    }
    if (voice) {
        console.warn('[WebSearch] SKIP: voice mode');
        return null;
    }
    if (!braveSearch.isConfigured()) {
        console.warn('[WebSearch] SKIP: no BRAVE_SEARCH_API_KEY / BRAVE_API_KEY in env');
        return null;
    }

    const plan = braveSearch.detectSearchPlan(userInput);
    if (!plan) {
        console.warn('[WebSearch] SKIP: heuristic found no searchable intent in:', JSON.stringify(userInput.slice(0, 120)));
        return null;
    }

    console.log('[WebSearch] Searching mode=' + plan.mode + ' query="' + plan.query + '"');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
    let outcome;

    try {
        outcome = await braveSearch.searchByIntent(userInput, {
            count: WEB_SEARCH_MAX_RESULTS,
            signal: controller.signal
        });
    } catch (error) {
        console.warn('[JarvisCore] Web search error:', error?.message || error);
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (!outcome?.ok || !outcome.results?.length) {
        console.warn('[WebSearch] No usable results:', outcome?.reason || 'empty result set');
        return null;
    }
    console.log('[WebSearch] Got ' + (outcome.results?.length || 0) + ' result(s) for "' + (outcome.rewrittenQuery || outcome.query) + '"');

    const searchLabel = outcome.rewrittenQuery && outcome.rewrittenQuery !== outcome.query
        ? `${outcome.query} → ${outcome.rewrittenQuery}`
        : outcome.query;

    const lines = outcome.results.slice(0, WEB_SEARCH_MAX_RESULTS).map((r, i) => {
        const src = r.source ? ` (${r.source})` : '';
        const age = r.age ? ` [${r.age}]` : '';
        const desc = (r.description || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const media = outcome.mode === 'image'
            ? `\n   media: ${r.mediaUrl || r.url || 'n/a'}${r.pageUrl && r.pageUrl !== (r.mediaUrl || r.url) ? `\n   page: ${r.pageUrl}` : ''}`
            : `\n   ${r.url}`;
        return `${i + 1}. ${r.title}${src}${age}${media}\n   ${desc}`;
    });

    const modeLabel = outcome.mode === 'image'
        ? (plan.gifIntent ? 'IMAGE_SEARCH (GIF / visual request)' : 'IMAGE_SEARCH')
        : 'WEB_SEARCH';

    const block = [
        `[${modeLabel} - current external evidence only. Prefer these over memory when they conflict.]`,
        `Query: ${searchLabel}`,
        outcome.totalResults ? `Matches: ${outcome.totalResults}` : null,
        outcome.mode === 'image'
            ? 'Rule: never invent a GIF, image URL, or media link. Only use URLs listed below. If none are clearly usable, say you could not verify one.'
            : 'Rule: do not invent facts, citations, or links. Use only the evidence below.',
        '',
        lines.join('\n'),
        `[/${modeLabel}]`
    ].filter(Boolean).join('\n');

    return { query: outcome.rewrittenQuery || plan.query, block, results: outcome.results, mode: outcome.mode };
}
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

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'config');
const SYSTEM_PROMPT_PATH = path.join(PROMPTS_DIR, 'system-prompt.txt');
const CLOSING_ANCHOR_PATH = path.join(PROMPTS_DIR, 'prompts', 'closing-anchor.txt');
const WEB_SEARCH_ANCHOR_PATH = path.join(PROMPTS_DIR, 'prompts', 'web-search-anchor.txt');
const BALL_KNOWLEDGE_PATH = path.join(PROMPTS_DIR, 'prompts', 'ball-knowledge.txt');

const _promptFileCache = new Map(); // path -> { content, mtimeMs }

function loadPromptFile(filePath, fallback = '') {
    try {
        const stat = fs.statSync(filePath);
        const cached = _promptFileCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
            return cached.content;
        }
        const content = fs.readFileSync(filePath, 'utf8').trim();
        _promptFileCache.set(filePath, { content, mtimeMs: stat.mtimeMs });
        return content;
    } catch (err) {
        console.warn(`[JarvisAI] Failed to load ${path.basename(filePath)}, using fallback:`, err.message);
        return fallback;
    }
}

function loadSystemPrompt() {
    return loadPromptFile(SYSTEM_PROMPT_PATH, null);
}
function loadClosingAnchor() {
    return loadPromptFile(CLOSING_ANCHOR_PATH, '');
}
function loadWebSearchAnchor() {
    return loadPromptFile(WEB_SEARCH_ANCHOR_PATH, '');
}
function loadBallKnowledge() {
    return loadPromptFile(BALL_KNOWLEDGE_PATH, '');
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
                                allowedMentions: { parse:[] }
                            })
                            .catch(err => console.warn('[StatusCheck] followUp failed:', err.message));
                    }, 3000).unref?.();
                }

                return ':x: :rotating_light::rotating_light::rotating_light: :skull::skull::skull::skull: everything is down, sir. 0 models available. someone get Stark on the line';
            } else if (working === status.length) {
                return `All systems operational, sir.:white_check_mark: ${working} of ${status.length} models available.`;
            }
            let extra = '';
            if (working <= 5) {
                extra = ' :rotating_light::rotating_light::rotating_light: :skull::skull::skull::skull::skull:';
            } else if (working < 20) {
                extra = ' :rotating_light: :skull::skull::skull:';
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

                return[
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
            return 'All my providers are down, sir. Someone needs to check the config.';
        }

        const userId = interaction.user ? interaction.user.id : interaction.author.id;
        const userName = interaction.member?.displayName
            || interaction.user?.displayName || interaction.user?.username
            || interaction.author?.displayName || interaction.author?.username
            || 'User';

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

            // Ball knowledge - internet culture / meme awareness block
            const ballKnowledge = loadBallKnowledge();
            if (ballKnowledge) {
                systemPrompt += `\n\n${ballKnowledge}`;
            }

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

            // Closing anchor - models attend most to start and end of prompts.
            // Loaded from config/prompts/closing-anchor.txt so operators can
            // tune it without editing source.
            const closingAnchor = loadClosingAnchor();
            if (closingAnchor) {
                systemPrompt += `\n\n${closingAnchor}`;
            }

            const memoryPreferenceRaw = userProfile?.preferences?.memoryOpt ?? 'opt-in';
            const memoryPreference = String(memoryPreferenceRaw).toLowerCase();
            const allowsLongTermMemory = memoryPreference !== 'opt-out';

            let secureMemories =[];
            const memoryLimit = 50;
            if (allowsLongTermMemory) {
                secureMemories = await vaultClient
                    .decryptMemories(userId, { limit: memoryLimit })
                    .catch(error => {
                        console.error('Secure memory retrieval failed for user', userId, error);
                        return[];
                    });
            }
            const allEntries =
                allowsLongTermMemory && Array.isArray(secureMemories)
                    ? secureMemories.filter(
                        entry => !isInternalRecoveryResponse(entry?.data?.jarvisResponse)
                    )
                    :[];

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

            // Conversation context: read recent messages from the channel/thread for multi-turn awareness
            // Only includes messages from the bot or from users who haven't opted out
            let threadContext = '';
            try {
                const channel = interaction.channel;
                if (channel?.messages) {
                    const threadMsgs = await channel.messages.fetch({ limit: 6 });
                    const sorted = [...threadMsgs.values()]
                        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                        .slice(-5)
                        .filter(m => m.id !== interaction.id);
                    if (sorted.length > 0) {
                        const lines =[];
                        for (const m of sorted) {
                            const isBotMsg = m.author?.id === interaction.client?.user?.id;
                            if (!isBotMsg && m.author?.id !== userId) {
                                const optedOut = await database.isUserOptedOut(m.author.id).catch(() => false);
                                if (optedOut) {continue;}
                            }
                            const speakerName = isBotMsg
                                ? 'Jarvis'
                                : (m.member?.displayName || m.author?.globalName || m.author?.username || 'User');
                            const content = (m.content || '').replace(/\s+/g, ' ').slice(0, 200);
                            // Tag every line with role + name so the model never confuses
                            // who said what (#258 anti-hallucination).
                            const role = isBotMsg ? 'assistant' : 'user';
                            lines.push(`- [${role}] ${speakerName}: ${content}`);
                        }
                        if (lines.length > 0) {
                            threadContext = [
                                '',
                                '[THREAD_CONTEXT]',
                                `These are recent messages from this channel for awareness only. The current speaker is "${userName}". Do NOT attribute past lines to them unless the line is explicitly tagged with their name. Do not repeat your own openers/phrasing - vary every reply.`,
                                ...lines,
                                '[/THREAD_CONTEXT]',
                                ''
                            ].join('\n');
                        }
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
            let contextPrefix = options.contextPrefix || '';

            // Conditional web search - only when heuristic matches and Brave is configured.
            // Failure is silent; we never block the AI response on search latency.
            // Vision prepass: if images are attached, extract image-derived search metadata
            // first so Brave's heuristic sees the full intent (text + image context).
            // The final multimodal answer still receives the original images separately.
            const searchSeed = await buildSearchSeed(userInput, images);
            const webSearch = await maybeBuildWebSearchBlock(searchSeed, { voice: Boolean(options.voice) });
            if (webSearch) {
                contextPrefix = `${webSearch.block}\n\n${contextPrefix}`;
                const webSearchAnchor = loadWebSearchAnchor();
                if (webSearchAnchor) {
                    systemPrompt += `\n\n[${webSearchAnchor}]`;
                }
            }

            const context = `[USER: ${userName}]

${secureMemoryBlock}
${recentJarvisResponses.length ? `[Vary your phrasing - your last replies started with: ${recentJarvisResponses.map(r => `"${r.slice(0, 30)}..."`).join(', ')}]` : ''}${threadContext}
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

            // Garbage/poison detection - catch degenerate token loops before they pollute history
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
                jarvisResponse = 'That came out wrong. Run that by me again?';
                // Do NOT save this to history - return early with clean response
                this.lastActivity = Date.now();
                return jarvisResponse;
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
            return 'Something broke on my end, sir. Try that again.';
        } finally {
            releaseGuildSlot(effectiveGuildId);
        }
    }

    getFallbackResponse(userInput, userName) {
        const responses =[
            `Running on fumes here, ${userName}. Give me a second.`,
            `Hit a wall on that one, ${userName}. Still here though.`,
            `Systems are being difficult, ${userName}. Bear with me.`,
            `Bit of a hiccup, ${userName}. I'll sort it out.`,
            `Something's off on my end, ${userName}. Working on it.`
        ];

        const t = userInput.toLowerCase();
        if (t.includes('hello') || t.includes('hi'))
        {return `${userName}. I'm here, just running light at the moment.`;}
        if (t.includes('how are you'))
        {return `Hanging in there, ${userName}. Not at full speed but I'll manage.`;}
        if (t.includes('help'))
        {return `I would, ${userName}, but I'm a bit hamstrung right now. Try again in a minute.`;}

        return responses[Math.floor(Math.random() * responses.length)];
    }
}

module.exports = JarvisAI;
