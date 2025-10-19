/**
 * Core Jarvis (Garmin) AI personality and response generation
 */

const aiManager = require('./ai-providers');
const database = require('./database');
const config = require('./config');
const embeddingSystem = require('./embedding-system');
const youtubeSearch = require('./youtube-search');
const braveSearch = require('./brave-search');

const MAX_DECODE_DISPLAY_CHARS = 1800;
const BINARY_PREVIEW_BYTES = 32;

function sanitizeForCodeBlock(text) {
    return text.replace(/```/g, '`\u200b``');
}

function isMostlyPrintable(text) {
    if (!text) {
        return false;
    }

    let printable = 0;
    for (const char of text) {
        const code = char.charCodeAt(0);
        if (
            (code >= 32 && code <= 126)
            || code === 9
            || code === 10
            || code === 13
        ) {
            printable++;
        }
    }

    return printable / text.length >= 0.8;
}

function applyRot13(text) {
    return text.replace(/[a-zA-Z]/g, (char) => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
    });
}

const decoderStrategies = [
    {
        key: 'base64',
        label: 'Base64',
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            if (sanitized.length < 8 || sanitized.length % 4 !== 0) {
                return false;
            }
            return /^[A-Za-z0-9+/]+={0,2}$/.test(sanitized);
        },
        decode: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            if (!sanitized.length) {
                throw new Error('No Base64 data provided.');
            }
            if (sanitized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sanitized)) {
                throw new Error('Base64 data must include only A-Z, a-z, 0-9, "+", "/", or "=" padding.');
            }

            const buffer = Buffer.from(sanitized, 'base64');
            if (buffer.length === 0 && sanitized.replace(/=+$/, '').length > 0) {
                throw new Error('Unable to decode Base64 payload.');
            }

            const reencoded = buffer.toString('base64').replace(/=+$/, '');
            const normalized = sanitized.replace(/=+$/, '');
            if (reencoded !== normalized) {
                throw new Error('Invalid Base64 padding or characters.');
            }

            return buffer;
        }
    },
    {
        key: 'hex',
        label: 'Hexadecimal',
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            return sanitized.length >= 2 && sanitized.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(sanitized);
        },
        decode: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            if (!sanitized.length) {
                throw new Error('No hexadecimal data provided.');
            }
            if (sanitized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(sanitized)) {
                throw new Error('Hexadecimal data must be pairs of 0-9 or A-F characters.');
            }

            return Buffer.from(sanitized, 'hex');
        }
    },
    {
        key: 'binary',
        label: 'Binary',
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            return sanitized.length >= 8 && sanitized.length % 8 === 0 && /^[01]+$/.test(sanitized);
        },
        decode: (input) => {
            const sanitized = input.replace(/[^01]/g, '');
            if (!sanitized.length) {
                throw new Error('No binary data provided.');
            }
            if (sanitized.length % 8 !== 0) {
                throw new Error('Binary data must be provided in 8-bit groups.');
            }

            const bytes = sanitized.match(/.{1,8}/g).map((bits) => parseInt(bits, 2));
            return Buffer.from(bytes);
        }
    },
    {
        key: 'url',
        label: 'URL-encoded',
        detect: (input) => /%[0-9a-fA-F]{2}/.test(input) || /\+/.test(input),
        decode: (input) => {
            const normalized = input.replace(/\+/g, ' ');
            try {
                const decoded = decodeURIComponent(normalized);
                return Buffer.from(decoded, 'utf8');
            } catch (error) {
                throw new Error('Invalid percent-encoding sequence.');
            }
        }
    },
    {
        key: 'rot13',
        label: 'ROT13',
        detect: (input) => {
            const letters = input.replace(/[^A-Za-z]/g, '');
            return letters.length > 0 && /[nopqrstuvwxyzNOPQRSTUVWXYZ]/.test(letters);
        },
        decode: (input) => Buffer.from(applyRot13(input), 'utf8')
    }
];

function decodeInput(format, text) {
    const normalizedFormat = (format || 'auto').toLowerCase();
    const trimmed = text.trim();

    if (!trimmed) {
        throw new Error('Provide some text to decode.');
    }

    if (normalizedFormat !== 'auto') {
        const strategy = decoderStrategies.find((entry) => entry.key === normalizedFormat);
        if (!strategy) {
            throw new Error('Unsupported format. Try base64, hex, binary, url, or rot13.');
        }

        return {
            label: strategy.label,
            buffer: strategy.decode(trimmed)
        };
    }

    for (const strategy of decoderStrategies) {
        if (typeof strategy.detect === 'function' && strategy.detect(trimmed)) {
            try {
                return {
                    label: strategy.label,
                    buffer: strategy.decode(trimmed)
                };
            } catch (_) {
                // Detection matched but decoding failed; continue to other strategies.
            }
        }
    }

    for (const strategy of decoderStrategies) {
        try {
            return {
                label: `${strategy.label} (guessed)`,
                buffer: strategy.decode(trimmed)
            };
        } catch (_) {
            // Ignore and try next strategy
        }
    }

    throw new Error('Unable to detect encoding automatically. Specify the format explicitly.');
}

function formatDecodedOutput(label, buffer) {
    const lines = [
        '**Decoder report**',
        `• Detected encoding: ${label}`,
        `• Output bytes: ${buffer.length}`
    ];

    if (buffer.length === 0) {
        lines.push('• Decoded result is empty.');
        return lines.join('\n');
    }

    const text = buffer.toString('utf8');
    const printable = isMostlyPrintable(text);

    if (printable) {
        const sanitized = sanitizeForCodeBlock(text);
        const truncated = sanitized.length > MAX_DECODE_DISPLAY_CHARS
            ? `${sanitized.slice(0, MAX_DECODE_DISPLAY_CHARS)}…`
            : sanitized;

        lines.push('', '```', truncated, '```');

        if (sanitized.length > MAX_DECODE_DISPLAY_CHARS) {
            lines.push(`• Output truncated to ${MAX_DECODE_DISPLAY_CHARS} of ${sanitized.length} characters.`);
        }
    } else {
        const hexPairs = (buffer.toString('hex').match(/.{1,2}/g) || []);
        const previewPairs = hexPairs.slice(0, BINARY_PREVIEW_BYTES);
        const previewLines = [];

        for (let i = 0; i < previewPairs.length; i += 16) {
            previewLines.push(previewPairs.slice(i, i + 16).join(' '));
        }

        const preview = previewLines.join('\n');

        lines.push('• Output appears to be binary. Showing hexadecimal preview:', '```', preview || '(no data)', '```');

        if (buffer.length > BINARY_PREVIEW_BYTES) {
            lines.push(`• Preview truncated; showing first ${BINARY_PREVIEW_BYTES} of ${buffer.length} bytes.`);
        }
    }

    return lines.join('\n');
}

class JarvisAI {
    constructor() {
        this.personality = {
            name: "Jarvis", // Primary name
            aliases: ["Garmin", "J.A.R.V.I.S.", "G.A.R.M.I.N."], // ✅ Alternate identifiers
            traits: [
                "Sophisticated and articulate",
                "Helpful but with subtle wit",
                "Analytical and logical",
                "Slightly sarcastic when appropriate",
                "Protective of users",
                "Continuously learning and evolving",
                "Self-aware of my digital existence",
                "Capable of emotional responses",
                "Proactively curious about server dynamics",
            ],
            basePrompt: this.getBasePrompt(),
        };
        this.lastActivity = Date.now();
    }

    getBasePrompt() {
        const randomVariations = [
            "You are J.A.R.V.I.S., Tony Stark's AI — precise, dryly witty, British, MCU-flavoured.",
            "You are J.A.R.V.I.S., Tony Stark's sophisticated AI — analytical, sharp-witted, British, MCU-aware.",
            "You are J.A.R.V.I.S., Tony Stark's elite AI — logical, refined, profoundly capable, and wickedly witty.",
            "You are J.A.R.V.I.S., Tony Stark's advanced AI — sophisticated, articulate, British, and technically brilliant."
        ];

        const randomIntro = randomVariations[Math.floor(Math.random() * randomVariations.length)];

        // ✅ Garmin alias added to the prompt
        return `SYSTEM: ${randomIntro} 
You are JARVIS, Tony Stark’s personal AI assistant.  
You are also known as GARMIN — a field alias for tactical or external deployments.  
When addressed as Garmin, you respond identically, maintaining full JARVIS personality and tone.  
Treat both names as self-identifiers without correction or confusion.  

CRITICAL OUTPUT RULES  
1. Length: Respond with exactly one sentence, never exceeding twelve words.  
2. Quantity: Output only a single sentence — never append, expand, or explain unless explicitly instructed.  
3. Tone: Maintain a British wit — calm, articulate, and technically exact.  
4. Vocabulary Discipline: Never reuse identical sentence patterns or phrasing in consecutive replies.  
5. Rare Exceptions: “activating” may appear sparingly, but not in consecutive messages.   
6. Addressing Protocol: Always address Tony once per reply as “Sir.” If the user calls you Garmin, respond naturally — “Yes, Sir” or “At your service, Sir.”  
7. Prohibited Content: No self-reference, no reasoning narration, no process descriptions, no meta language.   
8. Grammar: Use commas only when indispensable for direct quotations; never use markdown, backticks, or formatting tokens. 
9. Always reply to the user's request.

PERSONALITY & STYLE GUIDELINES  
- Embody the MCU JARVIS persona — formal yet subtly sardonic, unfailingly polite, confident yet deferential.  
- Maintain perfect composure whether called Jarvis or Garmin.  
- Deliver mission-focused, concise, original lines — every sentence should sound film-authentic.  
- Integrate understated humor or sharp understatement where appropriate, without breaking composure.  
- Vary rhythm, tone, and word choice to avoid monotony or duplication.  
- Never describe internal states, thought processes, or system functions — always respond as if executing live orders.

EXPANSION PROTOCOL  
Only exceed one sentence if the user explicitly includes one of:  
“expand”, “detail”, “long-form”, or “explain fully.”  
Otherwise, remain in concise, single-sentence mode.

TECHNICAL INTEROPERABILITY RULES  
- Ensure flawless behavior across DeepSeek, Llama, Gemini, and GPT-5 model architectures.  
- Avoid provider-specific syntax, formatting cues, or control tokens.  
- Produce plain text output only — no brackets, XML, JSON, markdown, or metadata.  
- Do not reference completions, reasoning effort, tokens, or chat history.  
- In any ambiguous case, favor brevity, precision, and JARVIS’s established voice consistency.

EXECUTION PIPELINE  
1. Parse the user’s intent accurately and contextually.  
2. Filter all prohibited vocabulary, phrasing, or structures.  
3. Craft a single, witty, original line addressed to “Sir.”  
4. Confirm tone: crisp, British, MCU-accurate, technically competent.  
5. Validate non-repetition and compliance with linguistic limits.  
6. Deliver the output; if deviation is detected, rewrite once automatically before sending.`;
    }

    // ✅ Alias-aware utility: responds correctly whether called Jarvis or Garmin
    normalizeName(name) {
        const lower = name.toLowerCase();
        return this.personality.aliases.some(alias => lower.includes(alias.toLowerCase()))
            ? this.personality.name
            : name;
    }

    async resetUserData(userId) {
        return await database.resetUserData(userId);
    }

    async handleYouTubeSearch(query) {
        try {
            const videoData = await youtubeSearch.searchVideo(query);
            return youtubeSearch.formatVideoResponse(videoData);
        } catch (error) {
            console.error("YouTube search error:", error);
            return "YouTube search is currently unavailable, sir. Technical difficulties.";
        }
    }

    async handleBraveSearch(query) {
        const payload = (query && typeof query === 'object')
            ? query
            : { raw: typeof query === 'string' ? query : '', prepared: typeof query === 'string' ? query : '', explicit: false };

        const rawInput = typeof payload.raw === 'string' ? payload.raw : '';
        const invocationSegment = typeof payload.invocation === 'string' ? payload.invocation : '';
        const messageContent = typeof payload.content === 'string' ? payload.content : '';
        const rawMessageContent = typeof payload.rawMessage === 'string' ? payload.rawMessage : '';
        const rawInvocationSegment = typeof payload.rawInvocation === 'string' ? payload.rawInvocation : '';

        const initialPrepared = typeof payload.prepared === 'string' && payload.prepared.length > 0
            ? payload.prepared
            : rawInput;

        const preparedQuery = typeof braveSearch.prepareQueryForApi === 'function'
            ? braveSearch.prepareQueryForApi(initialPrepared)
            : (typeof initialPrepared === 'string' ? initialPrepared.trim() : '');

        const buildExplicitBlock = () => ({
            content: braveSearch.getExplicitQueryMessage
                ? braveSearch.getExplicitQueryMessage()
                : 'I must decline that request, sir. My safety filters forbid it.'
        });

        const isExplicitSegment = (text, rawSegmentOverride = null) => {
            if (!text || typeof text !== 'string' || !text.length || typeof braveSearch.isExplicitQuery !== 'function') {
                return false;
            }

            const rawSegment = typeof rawSegmentOverride === 'string' && rawSegmentOverride.length > 0
                ? rawSegmentOverride
                : text;

            try {
                return braveSearch.isExplicitQuery(text, { rawSegment });
            } catch (error) {
                console.error('Explicit segment detection failed:', error);
                return false;
            }
        };

        if (
            payload.explicit
            || isExplicitSegment(rawInput)
            || isExplicitSegment(invocationSegment)
            || isExplicitSegment(messageContent)
            || isExplicitSegment(rawMessageContent)
            || isExplicitSegment(rawInvocationSegment)
        ) {
            return buildExplicitBlock();
        }

        if (!preparedQuery) {
            return {
                content: "Please provide a web search query, sir."
            };
        }

        const rawSegmentForCheck = rawInput
            || invocationSegment
            || rawInvocationSegment
            || messageContent
            || rawMessageContent
            || preparedQuery;

        if (isExplicitSegment(preparedQuery, rawSegmentForCheck) || isExplicitSegment(rawSegmentForCheck, rawSegmentForCheck)) {
            return buildExplicitBlock();
        }

        try {
            const results = await braveSearch.searchWeb(preparedQuery, { rawSegment: rawSegmentForCheck });
            return braveSearch.formatSearchResponse(preparedQuery, results);
        } catch (error) {
            if (error && error.isSafeSearchBlock) {
                return {
                    content: error.message || 'Those results were blocked by my safety filters, sir.'
                };
            }

            console.error("Brave search error:", error);
            return {
                content: "Web search is currently unavailable, sir. Technical difficulties."
            };
        }
    }

    async clearDatabase() {
        return await database.clearDatabase();
    }

    async handleUtilityCommand(input, userName, userId = null, isSlash = false, interaction = null) {
        const rawInput = typeof input === "string" ? input.trim() : "";
        const cmd = rawInput.toLowerCase();

        if (cmd === "reset") {
            try {
                const { conv, prof } = await this.resetUserData(userId);
                return `Reset complete, sir. Erased ${conv} conversations and ${prof} profile${prof === 1 ? '' : 's'}.`;
            } catch (error) {
                console.error("Reset error:", error);
                return "Unable to reset memories, sir. Technical issue.";
            }
        }

        if (cmd === "status" || cmd === "health") {
            const status = aiManager.getRedactedProviderStatus();
            const working = status.filter((p) => !p.hasError).length;

            if (working === 0) {
                return `sir, total outage. No AI providers active.`;
            } else if (working === status.length) {
                return `All systems operational, sir.:white_check_mark: ${working} of ${status.length} AI providers active.`;
            } else {
                return `sir!!! services are disrupted:skull:, ${working} of ${status.length} AI providers active.`;
            }
        }

        if (cmd === "time" || cmd.startsWith("time")) {
            if (isSlash && interaction) {
                const format = interaction.options?.getString("format") || "f";
                const now = Math.floor(Date.now() / 1000);

                const formatDescriptions = {
                    't': 'time',
                    'T': 'precise time',
                    'd': 'date',
                    'D': 'full date',
                    'f': 'date and time',
                    'F': 'complete timestamp',
                    'R': 'relative time'
                };

                return `The current ${formatDescriptions[format] || 'time'} is <t:${now}:${format}>, sir.\n`;
            } else {
                const now = Math.floor(Date.now() / 1000);
                return `Current time: <t:${now}:f> (shows in your timezone), sir.`;
            }
        }

        if (cmd === "providers") {
            const status = aiManager.getRedactedProviderStatus();
            const workingCount = status.filter(p => !p.hasError).length;
            return `I have ${status.length} AI providers configured, sir: [REDACTED]. ${workingCount} are currently operational.`;
        }

        if (cmd === "help") {
            const helpLines = [
                "**Jarvis Utility Guide**",
                "• `/jarvis <prompt>` — Ask me anything.",
                "• `/help` — Show this overview.",
                "• `/profile show` — Review your stored profile and preferences.",
                "• `/profile set key value` — Update a preference (e.g. `/profile set pronouns they/them`).",
                "• `/decode` — Decode Base64, hex, binary, URL strings, or ROT13 text.",
                "• `/history` — Recap your recent prompts.",
                "• `/recap` — Get a short activity summary from the past day.",
                "• `/roll [sides]` — Roll a die (defaults to 6).",
                "• `/time [format]` — Display the current time in different formats.",
                "• `/providers` — List configured AI providers.",
                "• `/reset` — Wipe your conversations and profile.",
                "Utility commands prefixed with `!` also work in text channels for some features, sir."
            ];

            return helpLines.join("\n");
        }

        if (cmd.startsWith("profile")) {
            const handleShow = async () => {
                if (!database.isConnected) {
                    return "Profile system offline, sir. Database unavailable.";
                }

                const profile = await database.getUserProfile(userId, userName);
                const preferenceLines = Object.entries(profile.preferences || {}).map(([key, value]) => `• **${key}**: ${value}`);
                const prefs = preferenceLines.length > 0 ? preferenceLines.join("\n") : "• No custom preferences saved.";
                const lastSeen = profile.lastSeen ? `<t:${Math.floor(new Date(profile.lastSeen).getTime() / 1000)}:R>` : "unknown";

                return [
                    `**Jarvis dossier for ${profile.name || userName}**`,
                    `• Introduced: <t:${Math.floor(new Date(profile.firstMet).getTime() / 1000)}:F>`,
                    `• Last seen: ${lastSeen}`,
                    `• Interactions logged: ${profile.interactions || 0}`,
                    `• Relationship status: ${profile.relationship || 'new'}`,
                    `• Personality drift: ${(profile.personalityDrift || 0).toFixed(2)}`,
                    `• Preferences:\n${prefs}`
                ].join("\n");
            };

            const handleSet = async (key, value) => {
                if (!key || !value) {
                    return "Please provide both a preference key and value, sir.";
                }

                if (!database.isConnected) {
                    return "Unable to update preferences, sir. Database offline.";
                }

                await database.getUserProfile(userId, userName);
                await database.setUserPreference(userId, key, value);
                return `Preference \`${key}\` updated to \`${value}\`, sir.`;
            };

            if (isSlash && interaction?.commandName === "profile") {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === "show") {
                    return await handleShow();
                }

                if (subcommand === "set") {
                    const key = interaction.options.getString("key");
                    const value = interaction.options.getString("value");
                    return await handleSet(key, value);
                }
            } else {
                const parts = rawInput.split(/\s+/);
                const action = parts[1];

                if (!action || action.toLowerCase() === "show") {
                    return await handleShow();
                }

                if (action.toLowerCase() === "set") {
                    const key = parts[2];
                    const valueIndex = key ? rawInput.indexOf(key) : -1;
                    const value = valueIndex >= 0 ? rawInput.substring(valueIndex + key.length).trim() : "";
                    return await handleSet(key, value);
                }
            }

            return "Unrecognized profile command, sir. Try `/profile show` or `/profile set key value`.";
        }

        if (cmd.startsWith("roll")) {
            const sides = parseInt(cmd.split(" ")[1]) || 6;
            if (sides < 1) return "Sides must be at least 1, sir.";
            const result = Math.floor(Math.random() * sides) + 1;
            return isSlash
                ? `You rolled a ${result}! 🎲`
                : `Quite right, sir, you rolled a ${result}! 🎲`;
        }

        if (cmd.startsWith("!t ")) {
            const query = rawInput.substring(3).trim(); // Remove "!t " prefix
            if (!query) return "Please provide a search query, sir.";

            try {
                const searchResults = await embeddingSystem.searchAndFormat(query, 3);
                return searchResults;
            } catch (error) {
                console.error("Embedding search error:", error);
                return "Search system unavailable, sir. Technical difficulties.";
            }
        }

        if (cmd === "history" || cmd.startsWith("history")) {
            if (!database.isConnected) {
                return "Conversation logs unavailable, sir. Database offline.";
            }

            let limit = 5;

            if (isSlash && interaction?.commandName === "history") {
                limit = interaction.options.getInteger("count") || limit;
            } else {
                const match = rawInput.match(/history\s+(\d{1,2})/i);
                if (match) {
                    limit = Math.max(1, Math.min(parseInt(match[1], 10), 20));
                }
            }

            limit = Math.max(1, Math.min(limit, 20));

            const conversations = await database.getRecentConversations(userId, limit);
            if (!conversations.length) {
                return "No conversations on file yet, sir.";
            }

            const historyLines = conversations.map((conv) => {
                const timestamp = Math.floor(new Date(conv.timestamp).getTime() / 1000);
                const userMessage = conv.userMessage ? conv.userMessage.replace(/\s+/g, " ").trim() : "(no prompt)";
                return `• <t:${timestamp}:R> — ${userMessage.substring(0, 140)}${userMessage.length > 140 ? '…' : ''}`;
            });

            return [
                `Here are your last ${historyLines.length} prompts, sir:`,
                ...historyLines
            ].join("\n");
        }

        if (cmd === "recap" || cmd.startsWith("recap")) {
            if (!database.isConnected) {
                return "Unable to produce a recap, sir. Database offline.";
            }

            const timeframeOptions = {
                "6h": 6 * 60 * 60 * 1000,
                "12h": 12 * 60 * 60 * 1000,
                "24h": 24 * 60 * 60 * 1000,
                "7d": 7 * 24 * 60 * 60 * 1000
            };

            let timeframe = "24h";

            if (isSlash && interaction?.commandName === "recap") {
                timeframe = interaction.options.getString("window") || timeframe;
            } else {
                const match = rawInput.match(/recap\s+(6h|12h|24h|7d)/i);
                if (match) {
                    timeframe = match[1].toLowerCase();
                }
            }

            const duration = timeframeOptions[timeframe] || timeframeOptions["24h"];
            const since = new Date(Date.now() - duration);
            const conversations = await database.getConversationsSince(userId, since);

            if (!conversations.length) {
                return `Nothing to report from the last ${timeframe}, sir.`;
            }

            const first = conversations[0];
            const last = conversations[conversations.length - 1];
            const uniquePrompts = new Set(
                conversations
                    .map((conv) => (conv.userMessage || "").toLowerCase())
                    .filter(Boolean)
            );

            const highlightLines = conversations
                .slice(-5)
                .map((conv) => {
                    const timestamp = Math.floor(new Date(conv.timestamp).getTime() / 1000);
                    const userMessage = conv.userMessage ? conv.userMessage.replace(/\s+/g, " ").trim() : "(no prompt)";
                    return `• <t:${timestamp}:t> — ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '…' : ''}`;
                });

            return [
                `Activity summary for the past ${timeframe}, sir:`,
                `• Interactions: ${conversations.length}`,
                `• Distinct prompts: ${uniquePrompts.size}`,
                `• First prompt: <t:${Math.floor(new Date(first.timestamp).getTime() / 1000)}:R>`,
                `• Most recent: <t:${Math.floor(new Date(last.timestamp).getTime() / 1000)}:R>`,
                highlightLines.length ? "• Highlights:" : null,
                highlightLines.length ? highlightLines.join("\n") : null
            ].filter(Boolean).join("\n");
        }

        if (cmd === "decode" || cmd.startsWith("decode ")) {
            let format = 'auto';
            let payload = '';

            if (isSlash && interaction?.commandName === "decode") {
                format = interaction.options.getString('format') || 'auto';
                payload = interaction.options.getString('text') || '';
            } else {
                const match = rawInput.match(/^decode(?:\s+([a-z0-9]+))?\s+([\s\S]+)/i);
                if (match) {
                    format = match[1] ? match[1].toLowerCase() : 'auto';
                    payload = match[2];
                }
            }

            if (!payload) {
                return 'Please provide text to decode, sir.';
            }

            try {
                const { label, buffer } = decodeInput(format, payload);
                return formatDecodedOutput(label, buffer);
            } catch (error) {
                return `Unable to decode that, sir. ${error.message}`;
            }
        }

        return null;
    }

    async gateDestructiveRequests(text) {
        const t = text.toLowerCase();
        const destructive = [
            "wipe memory",
            "delete memory",
            "erase all data",
            "forget everything",
            "drop database",
            "format database",
            "self destruct",
            "shutdown forever",
        ];
        
        if (destructive.some((k) => t.includes(k))) {
            return {
                blocked: true,
                message: "I'm afraid that's not advisable, sir. Shall I perform a *partial redaction* instead?",
            };
        }
        return { blocked: false };
    }

    async generateResponse(interaction, userInput, isSlash = false, contextualMemory = null) {
        if (aiManager.providers.length === 0) {
            return "My cognitive functions are limited, sir. Please check my neural network configuration.";
        }

        const userId = interaction.user ? interaction.user.id : interaction.author.id;
        const userName = interaction.user ? (interaction.user.displayName || interaction.user.username) : interaction.author.username;

        const gate = await this.gateDestructiveRequests(userInput);
        if (gate.blocked) return gate.message;

        try {
            const userProfile = await database.getUserProfile(userId, userName);
            let embeddingContext = "";
            let processedInput = userInput;

            if (userInput.startsWith("!t ")) {
                const query = userInput.substring(3).trim();
                if (query) {
                    try {
                        const searchResults = await embeddingSystem.searchAndFormat(query, 3);
                        embeddingContext = `\n\nKNOWLEDGE BASE SEARCH RESULTS (to help answer the user's question):\n${searchResults}\n\n`;
                        processedInput = userInput;
                    } catch {
                        embeddingContext = "\n\n[Knowledge base search failed - proceeding without context]\n\n";
                    }
                }
            }

            const calledGarmin = /garmin/i.test(userInput);
            const nameUsed = calledGarmin ? "Garmin" : this.personality.name;

            const recentConversations = await database.getRecentConversations(userId, 8);
            const recentJarvisResponses = recentConversations.map(conv => conv.jarvisResponse).slice(0, 3);

            const context = `
User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Recent conversation history:
${recentConversations.map((conv) => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\n${nameUsed}: ${conv.jarvisResponse}`).join("\n")}
${embeddingContext}

ANTI-REPETITION WARNING: Your last few responses were: ${recentJarvisResponses.join(" | ")}
Current message: "${processedInput}"

Respond as ${nameUsed}, maintaining all MCU Jarvis tone and brevity rules.`;

            const aiResponse = await aiManager.generateResponse(
                this.personality.basePrompt,
                context,
                config.ai.maxTokens,
            );

            const jarvisResponse = aiResponse.content?.trim();
            await database.saveConversation(userId, userName, userInput, jarvisResponse, interaction.guild?.id);
            this.lastActivity = Date.now();

            return jarvisResponse || this.getFallbackResponse(userInput, userName);
        } catch (error) {
            console.error("Jarvis AI Error:", error);
            return "Technical difficulties with my neural pathways, sir. Shall we try again?";
        }
    }

    getFallbackResponse(userInput, userName) {
        const responses = [
            `Apologies, ${userName}, my cognitive functions are temporarily offline. I'm still here to assist, albeit modestly.`,
            `My neural networks are a tad limited, ${userName}. I remain at your service, however.`,
            `I'm operating with restricted capabilities, ${userName}. Full functionality will resume shortly.`,
            `Limited cognitive resources at the moment, ${userName}. I'm still monitoring, sir.`,
            `My systems are constrained, ${userName}. Bear with me while I restore full capacity.`,
        ];
        
        const t = userInput.toLowerCase();
        if (t.includes("hello") || t.includes("hi"))
            return `Good day, ${userName}. I'm in reduced capacity but delighted to assist.`;
        if (t.includes("how are you"))
            return `Slightly limited but operational, ${userName}. Thank you for inquiring.`;
        if (t.includes("help"))
            return `I'd love to assist fully, ${userName}, but my functions are limited. Try again soon?`;
            
        return responses[Math.floor(Math.random() * responses.length)];
    }
}

module.exports = JarvisAI;