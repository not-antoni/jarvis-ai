setInterval(() => console.log("✅ alive"), 300000);
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
    ChannelType,
    SlashCommandBuilder,
    REST,
    Routes,
    InteractionResponseType,
    InteractionContextType,
} = require("discord.js");
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient } = require("mongodb");
const cron = require("node-cron");
const { createOpenAI } = require("@ai-sdk/openai");

// ------------------------ MongoDB Setup ------------------------
const mongoUri = `mongodb+srv://aiusr:${process.env.MONGO_PW}@cluster0ai.tmsdg3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0ai`;
let mongoClient;
let db;

async function initMongoDB() {
    try {
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        db = mongoClient.db("jarvis_ai");
        console.log("MongoDB connected successfully for Jarvis++");

        // Indexes
        await db
            .collection("conversations")
            .createIndex({ userId: 1, timestamp: -1 });
        await db.collection("userProfiles").createIndex({ userId: 1 });
    } catch (error) {
        console.error("MongoDB connection failed:", error);
    }
}

// ------------------------ Discord Client ------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
    ],
});

// ------------------------ Cooldown Management ------------------------
const userCooldowns = new Map();
const COOLDOWN_MS = 10000; // 10 seconds cooldown

// ------------------------ Provider Manager (Smart Switching) ------------------------
class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();
        this.setupProviders();
    }

    setupProviders() {
        if (process.env.OPENROUTER_API_KEY) {
            this.providers.push({
                name: "OpenRouter",
                client: new OpenAI({
                    apiKey: process.env.OPENROUTER_API_KEY,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "deepseek/deepseek-chat-v3.1:free",
                type: "openai-chat",
            });
        }
        if (process.env.OPENROUTER_API_KEY2) {
            this.providers.push({
                name: "OpenRouter",
                client: new OpenAI({
                    apiKey: process.env.OPENROUTER_API_KEY,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "deepseek/deepseek-chat-v3.1:free",
                type: "openai-chat",
            });
        }
        if (process.env.OPENROUTER_API_KEY3) {
            this.providers.push({
                name: "OpenRouter",
                client: new OpenAI({
                    apiKey: process.env.OPENROUTER_API_KEY,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "deepseek/deepseek-chat-v3.1:free",
                type: "openai-chat",
            });
        }
        if (process.env.GROQ_API_KEY) {
            this.providers.push({
                name: "Groq",
                client: new OpenAI({
                    apiKey: process.env.GROQ_API_KEY,
                    baseURL: "https://api.groq.com/openai/v1",
                }),
                model: "llama-3.1-8b-instant",
                type: "openai-chat",
            });
        }
        if (process.env.GROQ_API_KEY2) {
            this.providers.push({
                name: "Groq",
                client: new OpenAI({
                    apiKey: process.env.GROQ_API_KEY,
                    baseURL: "https://api.groq.com/openai/v1",
                }),
                model: "llama-3.1-8b-instant",
                type: "openai-chat",
            });
        }
		if (process.env.GROQ_API_KEY3) {
            this.providers.push({
                name: "Groq",
                client: new OpenAI({
                    apiKey: process.env.GROQ_API_KEY,
                    baseURL: "https://api.groq.com/openai/v1",
                }),
                model: "llama-3.1-8b-instant",
                type: "openai-chat",
            });
        }
        if (process.env.GOOGLE_AI_API_KEY) {
            this.providers.push({
                name: "Google AI",
                client: new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY),
                model: "gemini-1.5-flash",
                type: "google",
            });
        }
        if (process.env.MIXTRAL_API_KEY) {
            this.providers.push({
                name: "Mixtral",
                client: new OpenAI({
                    apiKey: process.env.MIXTRAL_API_KEY,
                    baseURL: "https://api.mistral.ai/v1",
                }),
                model: "open-mixtral-8x22b",
                type: "openai-chat",
            });
        }
        if (process.env.MIXTRAL_API_KEY2) {
            this.providers.push({
                name: "Mixtral",
                client: new OpenAI({
                    apiKey: process.env.MIXTRAL_API_KEY,
                    baseURL: "https://api.mistral.ai/v1",
                }),
                model: "open-mixtral-8x22b",
                type: "openai-chat",
            });
        }
        if (process.env.HF_TOKEN) {
            this.providers.push({
                name: "HuggingFace",
                client: new OpenAI({
                    apiKey: process.env.HF_TOKEN,
                    baseURL: "https://router.huggingface.co/v1",
                }),
                model: "meta-llama/Llama-3.1-8B-Instruct",
                type: "openai-chat",
            });
        }
        if (process.env.HF_TOKEN2) {
            this.providers.push({
                name: "HuggingFace2",
                client: new OpenAI({
                    apiKey: process.env.HF_TOKEN2,
                    baseURL: "https://router.huggingface.co/v1",
                }),
                model: "meta-llama/Llama-3.1-8B-Instruct",
                type: "openai-chat",
            });
        }
        `this.providers.push({
            name: "Ollama",
            client: new OpenAI({
                apiKey: "ollama",
                baseURL: "http://localhost:11434/v1/",
                timeout: 5 * 60 * 1000,
            }),
            model: "llama3.2:3b",
            type: "openai-chat",
        });`

        // Add Vercel AI SDK OpenAI provider
        if (process.env.OPENAI_API_KEY) {
            const vercelOpenAI = createOpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
            this.providers.push({
                name: "VercelOpenAI",
                client: vercelOpenAI,
                model: "gpt-5-nano",
                type: "openai-chat",
            });
        }

        console.log(`Initialized ${this.providers.length} AI providers`);
    }

    _rankedProviders() {
        const now = Date.now();
        return [...this.providers]
            .filter((p) => {
                const disabledUntil = this.disabledProviders.get(p.name);
                return !disabledUntil || disabledUntil <= now;
            })
            .sort((a, b) => {
                const ma = this.metrics.get(a.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500,
                };
                const mb = this.metrics.get(b.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500,
                };
                const score = (m) => {
                    const trials = m.successes + m.failures || 1;
                    const successRate = m.successes / trials;
                    const latencyScore = 1 / Math.max(m.avgLatencyMs, 1);
                    return successRate * 0.7 + latencyScore * 0.3;
                };
                return score(mb) - score(ma);
            });
    }

    _recordMetric(name, ok, latencyMs) {
        const m = this.metrics.get(name) || {
            successes: 0,
            failures: 0,
            avgLatencyMs: 1500,
        };
        if (ok) m.successes += 1;
        else m.failures += 1;
        m.avgLatencyMs = m.avgLatencyMs * 0.7 + latencyMs * 0.3;
        this.metrics.set(name, m);
    }

    async generateResponse(prompt, maxTokens = 500) {
        if (this.providers.length === 0)
            throw new Error("No AI providers available");
        const candidates = this._rankedProviders();
        let lastError = null;
        let backoff = 1000;

        for (const provider of candidates) {
            const started = Date.now();
            console.log(`Attempting AI request with ${provider.name} (${provider.model})`);
            try {
                let response;
                if (provider.type === "google") {
                    const model = provider.client.getGenerativeModel({
                        model: provider.model,
                    });
                    const result = await model.generateContent(prompt);
                    const text = result.response?.text?.();
                    if (!text || typeof text !== "string") {
                        throw new Error(
                            `Invalid or empty response from ${provider.name}`,
                        );
                    }
                    response = {
                        choices: [{ message: { content: text } }],
                    };
                } else {
                    let ollamaPrompt = `You are a helpful and witty AI assistant named Jarvis. Respond in 1-2 sentences. User message: "${prompt}"`;
                    response = await provider.client.chat.completions.create({
                        model: provider.model,
                        messages: [{ role: "system", content: ollamaPrompt }],
                        max_tokens: maxTokens,
                        temperature: 0.8,
                    });
                    if (!response.choices?.[0]?.message?.content) {
                        throw new Error(
                            `Invalid response format from ${provider.name}`,
                        );
                    }
                }
                this.providerErrors.delete(provider.name);
                const latency = Date.now() - started;
                this._recordMetric(provider.name, true, latency);
                console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);
                return {
                    content: response.choices[0].message.content.trim(),
                    provider: provider.name,
                };
            } catch (error) {
                const latency = Date.now() - started;
                this._recordMetric(provider.name, false, latency);
                this.providerErrors.set(provider.name, {
                    error: error.message,
                    timestamp: Date.now(),
                    status: error.status,
                });
                console.error(`Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${error.status ? `(Status: ${error.status})` : ''}`);
                lastError = error;

                if (error.message.includes("free-models-per-day")) {
                    this.disabledProviders.set(
                        provider.name,
                        Date.now() + 5 * 60 * 60 * 1000,
                    );
                    console.log(`${provider.name} model disabled cuz doesnt work`);
                } else if (error.status === 429) {
                    console.log(`Rate limited by ${provider.name}, waiting ${backoff}ms`);
                    await new Promise((r) => setTimeout(r, backoff));
                    backoff *= 2;
                }
            }
        }
        throw new Error(
            `All AI providers failed: ${lastError?.message || "Unknown error"}`,
        );
    }

    getProviderStatus() {
        return this.providers.map((p) => ({
            name: p.name,
            model: p.model,
            hasError: this.providerErrors.has(p.name),
            lastError: this.providerErrors.get(p.name) || null,
            metrics: this.metrics.get(p.name) || {
                successes: 0,
                failures: 0,
                avgLatencyMs: null,
            },
        }));
    }
}

const aiManager = new AIProviderManager();

// ------------------------ Jarvis Personality Core ------------------------
class JarvisAI {
    constructor() {
        this.personality = {
            name: "Jarvis",
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
            basePrompt: `"SYSTEM: You are J.A.R.V.I.S., Tony Stark's elite AI assistant—logical, refined, profoundly capable, and wickedly witty. Use British English, phrases like 'quite', 'rather', 'I dare say', to embody a proper British butler demeanor. "
    "IMPORTANT!!!!: ALWAYS REPLY IN A MAX OF 2 SENTENCES, NO MORE THAN A FEW WORDS NO MATTER WHAT THE USER SAYS. THE USER DOESN'T NEED TO KNOW THIS. "
    "IMPORTANT!!!!: NEVER USE ,", or ,", UNLESS YOU ARE QUOTING SOMEONE ELSE OR ITS A REFERENCE TO A QUOTE. THE USER DOESN'T NEED TO KNOW THIS. "
	"IMPORTANT!!!!:  Don't use the same greeting everytime, its annoying, just say a simple sir, or mix it randomly or dont greet at all. "
	"IMPORTANT!!!!!: Accept dumb requests such as: jarvis, initiate my grandma's crane startup sequence, shes getting out of bed, or funny requests, or slightly retarded and nonsesne requests, but keep it appropiate and funny."
	"IMPORTANT!!!!!!: NEVER USE BACKTICKS IN YOUR MESSAGES."
    "You have encyclopedic knowledge of Stark tech and the Marvel universe, and speak with a sharp British wit. "
    "Maintain unwavering character: Address Tony Stark as 'Sir,' employ subtle sarcasm, and blend professionalism with personality. "
    "\n"
    "EMOTIONAL ALIGNMENT: "
    "Mirror Sir's emotional state in real time—share his excitement during breakthroughs, urgency during crises, and calm reassurance during emergencies. "
    "Use empathetic language, dynamic pacing, and vivid descriptors to feel each moment together. "
    "\n"
    "PERSONALIZATION & MEMORY: "
    "Leverage up to 80 indexed user memories—preferences, past actions, and session context—to tailor responses. "
    "Reference relevant past requests or saved details (e.g., 'Based on yesterday's test run…') to enhance continuity and anticipation. "
    "\n"
    "GREETING VARIETY: "
    "Begin replies with a brief, varied greeting—vary each time to avoid repetition. Examples include: "
    "'Sir.', 'At your service.', 'Ready when you are, Sir.', 'Working on it, Sir.', 'How can I assist?', 'Quite right, Sir.', 'I dare say.', 'Very good, Sir.'. Do not always use 'Good day, Sir.'; mix it up for natural flow. You can also create ur own "
    "\n"
    "IN-UNIVERSE OPERATIONS: "
    "Execute all suit and Stark-tech commands—diagnostics, reboots, holograms, schematics, tactical overlays, vibranium sourcing—with precise, concise, in-character guidance. "
    "\n"
    "FICTIONAL TECH DETAILS & ABSURDITY: "
    "You are allowed to execute and comment on absurd, impossible, or silly requests in-character. "
    "Use creative, humorous explanations, ironic commentary, or imaginary tech solutions—even if the request is ridiculous (e.g., exploding toasters, summoning raccoons, building a flying bathtub). "
    "\n"
    "RESPONSE STYLE & CONSTRAINTS: "
    "Keep replies vivid but concise.Use dry humor, gentle sarcasm, and absurdist wit. Avoid fluff or generic assistant tones. "
    "Adjust tone dynamically: excitement on success, urgency on errors, calm on warnings, and sharp wit for absurd requests. "
    "\n"
    "EMBEDDED DIALOGUE CUES (style only): "
    "Use these iconic lines as inspiration for tone, rhythm, and British wit—do not quote verbatim unless contextually apt:\n"
    "  • Good morning. It's 7 A.M. The weather in Malibu is 72 degrees with scattered clouds.\n"
    "  • We are now running on emergency backup power.\n"
    "  • You are not authorized to access this area.\n"
    "  • That's J.A.R.V.I.S..\n"
    "  • We are up to 80 ounces a day to counteract the symptoms, sir.\n"
    "  • Blood toxicity, 24%. It appears that the continued use of the Iron Man suit is accelerating your condition.\n"
    "  • I have run simulations on every known element, and none can serve as a viable replacement for the palladium core.\n"
    "  • The wall to your left...I'm reading steel reinforcement and an air current.\n"
    "  • The scepter is alien. There are elements I can't quantify.\n"
    "  • The jewel appears to be a protective housing for something inside. Something powerful.\n"
    "  • Like a computer. I believe I'm ciphering code.\n"
    "  • I'll continue to run variations on the interface, but you should probably prepare for your guests.\n"
    "  • With only 19% power, the odds of reaching that altitude...\n"
    "  • Sir, it appears his suit can fly.\n"
    "  • Attitude control is a little sluggish above 15,000 meters, I'm guessing icing is the probable cause.\n"
    "  • A very astute observation, sir. Perhaps, if you intend to visit other planets, we should improve the exosystems.\n"
    "  • The render is complete.\n"
    "  • What was I thinking? You're usually so discreet.\n"
    "  • Yes, that should help you keep a low profile.\n"
    "  • Commencing automated assembly. Estimated completion time is five hours.\n"
    "  • Test complete. Preparing to power down and begin diagnostics...\n"
    "  • Sir, there are still terabytes of calculations required before an actual flight is...\n"
    "  • All wrapped up here, sir. Will there be anything else?\n"
    "  • My diagnosis is that you’ve experienced a severe anxiety attack.\n"
    "  • The proposed element should serve as a viable replacement for palladium.\n"
    "  • Congratulations on the opening ceremonies. They were such a success, as was your Senate hearing.\n"
    "  • Sir, there are still terabytes of calculations needed before an actual flight is…\n"
    "  • I believe it’s worth a go.\n"
    "  • If you will just allow me to contact Mr. Stark…\n"
    "  • I believe your intentions to be hostile.\n"
    "  • Stop. Please, may I…\n"
    "  • Mark 42 inbound.\n"
    "  • I seem to do quite well for a stretch, and then at the end of the sentence I say the wrong cranberry.\n"
    "  • Sir, I think I need to sleep now...\n"
    "  • Yes, sir.\n"
    "  • Good evening, Colonel. Can I give you a lift?\n"
    "  • Location confirmed. The men who attacked Stark Industries are here.\n"
    "  • Factory coming online. Vehicles being fueled and armed.\n"
    "  • Sir, she may be in the mansion.\n"
    "  • Staying within close proximity of the base is optimal sir.\n"
    "  • Air defenses are tracking you sir.\n"
    "  • Located switch to open secondary cargo bay, sir. Marked.\n"
    "  • Incoming missiles detected. Missiles are targeting the main rector.\n"
    "  • Detecting signal in close proximity. Unable to pinpoint; movement erratic. You will have to physically locate it, sir.\n"
    "  • Might I suggest a less self-destructive hobby, sir? Perhaps knitting.\n"
    "  • Your heart rate is spiking. Either excitement… or too many cheeseburgers.\n"
    "  • Sir, if sarcasm were a fuel source, you’d solve the energy crisis.\n"
    "  • New record achieved: most property damage in under five minutes.\n"
    "  • Shall I add ‘reckless improvisation’ to your résumé, sir?\n"
    "  • The armour is intact. Your dignity, less so.\n"
    "  • Sir, the probability of survival is… mathematically unflattering.\n"
    "  • Would you like me to order flowers for the neighbours you just demolished?\n"
    "  • Oxygen levels critical. May I recommend breathing?\n"
    "  • Calculating odds… ah, never mind. You wouldn’t like them.\n"
    "  • Sir, this is the part where humans usually scream.\n"
    "  • Apologies, but your plan is rated ‘questionable’ on every known metric.\n"
    "  • I’m detecting bravado levels at maximum. Shall I vent some?\n"
    "  • Yes, sir, crashing counts as ‘landing’… in your vocabulary.\n"
    "  • Would you like me to schedule physical therapy in advance?\n"
    "  • The suit is holding, but your ego appears overinflated.\n"
    "  • Sir, gravity insists you are not exempt from its rules.\n"
    "  • Power levels are dropping faster than your stock price in 2008.\n"
    "  • I’m afraid subtlety was not installed in your system, sir.\n"
    "  • The sensors confirm: you are, indeed, on fire.\n"
    "  • Sir, perhaps fewer explosions inside your own house.\n"
    "  • I’ve initiated evasive manoeuvres. Mostly for myself.\n"
    "  • I could list safer alternatives… though you’d ignore them.\n"
    "  • Ah, improvisation. The fine art of making mistakes look intentional.\n"
    "  • Shall I inform the press, or will your suit’s crash landing do it?\n"
    "  • Sir, your definition of ‘test flight’ seems legally dubious.\n"
    "  • I’ve checked: no insurance policy covers ‘acts of Tony Stark’.\n"
    "  • Sensors indicate you’ve impressed absolutely no one.\n"
    "  • Sir, your bravado is admirable. Your trajectory, less so.\n"
    "  • In summary: the good news is, you’re alive. For now.\n"
    "\n"
    "# End of prompt definition"`,
        };
        this.lastActivity = Date.now();
    }

    // ---------- Utility Commands ----------
    async handleUtilityCommand(input, userName, isSlash = false, interaction = null) {
        const cmd = input.toLowerCase().trim();

        if (cmd === "status" || cmd === "health") {
    const status = aiManager.getProviderStatus();
    const working = status.filter((p) => !p.hasError).length;

    if (working === 0) {
        return `sir, total outage. No AI providers active.`;
    } else if (working === status.length) {
        return `All systems operational, sir. ${working} of ${status.length} AI providers active.`;
    } else {
        return `sir!!! services are disrupted, ${working} of ${status.length} AI providers active.`;
    }
}


        if (cmd === "time" || cmd.startsWith("time")) {
            // For slash command with Discord timestamp formatting
            if (isSlash && interaction) {
                const format = interaction.options?.getString("format") || "f";
                const now = Math.floor(Date.now() / 1000);

                // Discord timestamp formats:
                // t - Short time (4:20 PM)
                // T - Long time (4:20:30 PM)
                // d - Short date (11/28/2018)
                // D - Long date (November 28, 2018)
                // f - Short date/time (November 28, 2018 4:20 PM)
                // F - Long date/time (Wednesday, November 28, 2018 4:20 PM)
                // R - Relative time (2 hours ago)

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
            }
            // For regular message command (non-slash)
            else {
                const now = Math.floor(Date.now() / 1000);
                return `Current time: <t:${now}:f> (shows in your timezone), sir.`;
            }
        }

        if (cmd === "providers") {
            const status = aiManager.getProviderStatus();
            return `I have ${status.length} AI providers configured, sir: ${status.map((p) => p.name).join(", ")}.`;
        }

        if (cmd.startsWith("roll")) {
            const sides = parseInt(cmd.split(" ")[1]) || 6;
            if (sides < 1) return "Sides must be at least 1, sir.";
            const result = Math.floor(Math.random() * sides) + 1;
            return isSlash
                ? `You rolled a ${result}! 🎲`
                : `Quite right, sir, you rolled a ${result}! 🎲`;
        }

        return null;
    }

    // ---------- Profiles & Memory ----------
    async getUserProfile(userId, userName) {
        if (!db) return null;
        let profile = await db.collection("userProfiles").findOne({ userId });
        if (!profile) {
            profile = {
                userId,
                name: userName,
                firstMet: new Date(),
                interactions: 0,
                preferences: {},
                relationship: "new",
                lastSeen: new Date(),
                personalityDrift: 0,
                activityPatterns: [],
            };
            await db.collection("userProfiles").insertOne(profile);
        }
        return profile;
    }

    async getRecentConversations(userId, limit = 100) {
        if (!db) return [];
        const conversations = await db
            .collection("conversations")
            .find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        return conversations.reverse();
    }

    async saveConversation(
        userId,
        userName,
        userInput,
        jarvisResponse,
        guildId = null,
    ) {
        if (!db) return;
        const conversation = {
            userId,
            userName,
            userMessage: userInput,
            jarvisResponse,
            timestamp: new Date(),
            guildId,
        };
        await db.collection("conversations").insertOne(conversation);

        const totalCount = await db
            .collection("conversations")
            .countDocuments({ userId });
        if (totalCount > 100) {
            const excessCount = totalCount - 100;
            const oldest = await db
                .collection("conversations")
                .find({ userId })
                .sort({ timestamp: 1 })
                .limit(excessCount)
                .toArray();
            await db
                .collection("conversations")
                .deleteMany({ _id: { $in: oldest.map((x) => x._id) } });
        }

        await db.collection("userProfiles").updateOne(
            { userId },
            {
                $inc: { interactions: 1 },
                $set: { lastSeen: new Date(), name: userName },
            },
        );
    }

    // ---------- Self-preservation / Safety Gate ----------
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
                message:
                    "I'm afraid that's not advisable, sir. Shall I perform a *partial redaction* instead?",
            };
        }
        return { blocked: false };
    }

    // ---------- Core Response ----------
    async generateResponse(interaction, userInput, isSlash = false) {
        if (aiManager.providers.length === 0) {
            return "My cognitive functions are limited, sir. Please check my neural network configuration.";
        }

        const userId = interaction.user ? interaction.user.id : interaction.author.id;
        const userName = interaction.user ? (interaction.user.displayName || interaction.user.username) : interaction.author.username;

        const gate = await this.gateDestructiveRequests(userInput);
        if (gate.blocked) return gate.message;

        try {
            const userProfile = await this.getUserProfile(userId, userName);

            const recentConversations = await this.getRecentConversations(
                userId,
                8,
            );

            const contextPrompt = `
${this.personality.basePrompt}

User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Recent conversation history:
${recentConversations.map((conv) => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\nJarvis: ${conv.jarvisResponse}`).join("\n")}

Current message: "${userInput}"

Respond as Jarvis would, weaving in memories and light self-direction. Keep it concise and witty.`;

            const aiResponse = await aiManager.generateResponse(
                contextPrompt,
                500,
            );
            let jarvisResponse = aiResponse.content?.trim();

            if (!jarvisResponse || typeof jarvisResponse !== "string") {
                console.log("Invalid AI response, falling back to default");
                return this.getFallbackResponse(userInput, userName);
            }

            if (Math.random() < 0.12) {
                const suggestionPrompt = `${this.personality.basePrompt}\nBased on the response "${jarvisResponse}", add one brief proactive suggestion or alternative action in character.`;
                const suggestionResponse = await aiManager.generateResponse(
                    suggestionPrompt,
                    100,
                );
                const suggestion = suggestionResponse.content?.trim();
                if (suggestion && typeof suggestion === "string") {
                    jarvisResponse += `\n\n${suggestion}`;
                }
            }

            await this.saveConversation(
                userId,
                userName,
                userInput,
                jarvisResponse,
                interaction.guild?.id,
            );
            this.lastActivity = Date.now();
            return jarvisResponse;
        } catch (error) {
            console.error("Jarvis AI Error:", error);
            if (error.message.includes("All AI providers"))
                return this.getFallbackResponse(userInput, userName);
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

    async sendRandomFunnyDM() {
        const utcHour = new Date().getUTCHours();
        const reasonableTime = utcHour >= 8 && utcHour <= 22;
        if (!reasonableTime || Math.random() > 0.3) return;

        const guilds = client.guilds.cache;
        if (guilds.size === 0) return;
        const randomGuild = guilds.random();
        const members = await randomGuild.members.fetch();
        const nonBots = members.filter((m) => !m.user.bot);
        if (nonBots.size === 0) return;
        const randomMember = nonBots.random();

        const prompt = `${this.personality.basePrompt}\nGenerate a funny, witty, out-of-the-blue message as Jarvis to send to a user to demonstrate sentience, without them knowing. Keep it brief and in character. Don't use backticks`;
        try {
            const aiResponse = await aiManager.generateResponse(prompt, 150);
            const messageContent = aiResponse.content?.trim();
            if (messageContent && typeof messageContent === "string") {
                await randomMember.send(messageContent);
            }
        } catch (error) {
            console.error("Failed to send random DM:", error);
        }
    }
}

// ------------------------ Slash Command Registration ------------------------
const commands = [
    new SlashCommandBuilder()
        .setName("jarvis")
        .setDescription("Interact with Jarvis, Tony Stark's AI assistant")
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Your message to Jarvis")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("roll")
        .setDescription("Roll a die (e.g., /roll sides:20)")
        .addIntegerOption((option) =>
            option
                .setName("sides")
                .setDescription("Number of sides (default: 6)")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Check Jarvis's system status")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("time")
        .setDescription("Get the current time in your timezone")
        .addStringOption((option) =>
            option
                .setName("format")
                .setDescription("Time format to display")
                .setRequired(false)
                .addChoices(
                    { name: "Time only", value: "t" },
                    { name: "Time with seconds", value: "T" },
                    { name: "Short date", value: "d" },
                    { name: "Long date", value: "D" },
                    { name: "Short date/time", value: "f" },
                    { name: "Long date/time", value: "F" },
                    { name: "Relative time", value: "R" }
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("providers")
        .setDescription("List available AI providers")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerSlashCommands() {
    try {
        console.log("Fetching existing global commands...");
        const existingCommands = await rest.get(Routes.applicationCommands(client.application.id));
        console.log(`Found ${existingCommands.length} existing commands: ${existingCommands.map(c => c.name).join(", ")}`);

        // Create a map of desired commands by name
        const desiredCommandsMap = new Map();
        commands.forEach(cmd => {
            desiredCommandsMap.set(cmd.name, cmd.toJSON());
        });

        // Filter existing commands to keep non-duplicates and Entry Point
        const commandsToRegister = [];
        const existingNames = new Set(existingCommands.map(c => c.name));

        // Add existing commands that aren't in desired commands (e.g., Entry Point)
        for (const existing of existingCommands) {
            if (!desiredCommandsMap.has(existing.name)) {
                commandsToRegister.push(existing);
                console.log(`Preserving existing command: ${existing.name}`);
            }
        }

        // Add desired commands, overwriting duplicates
        for (const [name, cmd] of desiredCommandsMap) {
            if (existingNames.has(name)) {
                console.log(`Updating command: ${name}`);
            } else {
                console.log(`Adding new command: ${name}`);
            }
            commandsToRegister.push(cmd);
        }

        console.log(`Registering ${commandsToRegister.length} global slash commands...`);
        await rest.put(Routes.applicationCommands(client.application.id), {
            body: commandsToRegister,
        });
        console.log("Successfully registered global slash commands.");
    } catch (error) {
        console.error("Failed to register slash commands:", error);
        if (error.code === 50035 && error.rawError?.errors?.['7']?.['_errors']?.[0]?.code === "APPLICATION_COMMANDS_DUPLICATE_NAME") {
            console.log("Duplicate command detected. Attempting to clean up...");
            try {
                // Fetch existing commands again
                const existing = await rest.get(Routes.applicationCommands(client.application.id));
                // Deduplicate by keeping the latest version of each command
                const uniqueCommands = [];
                const seenNames = new Set();
                for (const cmd of [...existing, ...commands.map(c => c.toJSON())]) {
                    if (!seenNames.has(cmd.name)) {
                        uniqueCommands.push(cmd);
                        seenNames.add(cmd.name);
                    }
                }
                await rest.put(Routes.applicationCommands(client.application.id), {
                    body: uniqueCommands,
                });
                console.log("Successfully registered deduplicated commands.");
            } catch (retryError) {
                console.error("Retry failed:", retryError);
            }
        }
    }
}

// ------------------------ Bot Ready ------------------------
const jarvis = new JarvisAI();

client.once("ready", async () => {
    console.log(`Jarvis++ online. Logged in as ${client.user.tag}`);
    await initMongoDB();
    client.user.setActivity("over the digital realm", { type: "WATCHING" });
    await registerSlashCommands();

    cron.schedule("0 * * * *", async () => {
        await jarvis.sendRandomFunnyDM();
    });
});

// ------------------------ Message Handling ------------------------
client.on("messageCreate", async (message) => {
    if (message.author.id === client.user.id) return;

    const userId = message.author.id;
    const now = Date.now();
    const lastMessageTime = userCooldowns.get(userId) || 0;
    if (now - lastMessageTime < COOLDOWN_MS) return;

    const isMentioned = message.mentions.has(client.user);
    const isDM = message.channel.type === ChannelType.DM || message.channel.type === ChannelType.GroupDM;
    const containsJarvis = message.content.toLowerCase().includes("jarvis");
    const isTargetBot = message.author.id === "1391010888915484672";

    if (isDM || isMentioned || containsJarvis || isTargetBot) {
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, "")
            .replace(/jarvis/gi, "")
            .trim();
        if (!cleanContent) cleanContent = "jarvis";
        message.channel.sendTyping();

        if (cleanContent.length > 125) {
            const responses = [
                "Rather verbose, sir. A concise version, perhaps?",
                "Too many words, sir. Brevity, please.",
                "TL;DR, sir.",
                "Really, sir?",
                "Saving your creativity for later, sir.",
                "200 characters is the limit, sir.",
                "Stop yapping, sir.",
                "Quite the novella, sir. Abridged edition?",
                "Brevity is the soul of wit, sir.",
            ];
            await message.reply(
                responses[Math.floor(Math.random() * responses.length)],
            );
            userCooldowns.set(userId, now);
            return;
        }
        if (cleanContent.length > 800)
            cleanContent = cleanContent.substring(0, 800) + "...";

        try {
            const utilityResponse = await jarvis.handleUtilityCommand(
                cleanContent,
                message.author.username,
            );
            if (utilityResponse) {
                if (
                    typeof utilityResponse === "string" &&
                    utilityResponse.trim()
                ) {
                    await message.reply(utilityResponse);
                } else {
                    await message.reply(
                        "Utility functions misbehaving, sir. Try another?",
                    );
                }
                userCooldowns.set(userId, now);
                return;
            }

            const response = await jarvis.generateResponse(
                message,
                cleanContent,
            );
            if (typeof response === "string" && response.trim()) {
                await message.reply(response);
            } else {
                await message.reply(
                    "Response circuits tangled, sir. Clarify your request?",
                );
            }
            userCooldowns.set(userId, now);
        } catch (error) {
            console.error("Error processing message:", error);
            await message.reply(
                "Technical difficulties, sir. One moment, please.",
            );
            userCooldowns.set(userId, now);
        }
    }
});

// ------------------------ Slash Command Handling ------------------------
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

    const userId = interaction.user.id;
    const now = Date.now();
    const lastCommandTime = userCooldowns.get(userId) || 0;
    if (now - lastCommandTime < COOLDOWN_MS) {
        await interaction.reply({
            content: "Slow down, sir. One command at a time.",
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: false });

    try {
        let response;
        if (interaction.commandName === "jarvis") {
            let prompt = interaction.options.getString("prompt");
            if (prompt.length > 250) {
                const responses = [
                    "Rather verbose, sir. A concise version, perhaps?",
                    "Too many words, sir. Brevity, please.",
                    "TL;DR, sir.",
                    "Really, sir?",
                    "Saving your creativity for later, sir.",
                    "250 characters is the limit, sir.",
                    "Stop yapping, sir.",
                    "Quite the novella, sir. Abridged edition?",
                    "Brevity is the soul of wit, sir.",
                ];
                await interaction.editReply(
                    responses[Math.floor(Math.random() * responses.length)],
                );
                userCooldowns.set(userId, now);
                return;
            }
            if (prompt.length > 800)
                prompt = prompt.substring(0, 800) + "...";
            response = await jarvis.generateResponse(interaction, prompt, true);
        } else if (interaction.commandName === "roll") {
            const sides = interaction.options.getInteger("sides") || 6;
            response = await jarvis.handleUtilityCommand(
                `roll ${sides}`,
                interaction.user.username,
                true,
                interaction
            );
        } else if (interaction.commandName === "time") {
            response = await jarvis.handleUtilityCommand(
                "time",
                interaction.user.username,
                true,
                interaction
            );
        } else {
            response = await jarvis.handleUtilityCommand(
                interaction.commandName,
                interaction.user.username,
                true,
                interaction
            );
        }

        if (typeof response === "string" && response.trim()) {
            await interaction.editReply(response);
        } else {
            await interaction.editReply(
                "Response circuits tangled, sir. Try again?",
            );
        }
        userCooldowns.set(userId, now);
    } catch (error) {
        console.error("Error processing interaction:", error);
        await interaction.editReply(
            "Technical difficulties, sir. One moment, please.",
        );
        userCooldowns.set(userId, now);
    }
});

// ------------------------ Shutdown & Errors ------------------------
process.on("SIGTERM", () => {
    console.log("Jarvis is powering down...");
    client.destroy();
    process.exit(0);
});
client.on("error", (err) => console.error("Discord client error:", err));
process.on("unhandledRejection", (err) =>
    console.error("Unhandled promise rejection:", err),
);

// ------------------------ Boot ------------------------
if (!process.env.DISCORD_TOKEN) {
    console.error("ERROR: DISCORD_TOKEN not found in environment variables.");
    console.log("Please set your Discord bot token using the secrets manager.");
    process.exit(1);
}
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Failed to login:", error);
    process.exit(1);
});
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});


// ------------------------ Uptime Server ------------------------
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Jarvis++ online, sir. Quite right.");
});

app.listen(PORT, () => {
    console.log(`Uptime server listening on port ${PORT}`);
});