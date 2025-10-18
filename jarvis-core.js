/**
 * Core Jarvis AI personality and response generation
 */

const aiManager = require('./ai-providers');
const database = require('./database');
const config = require('./config');
const embeddingSystem = require('./embedding-system');
const youtubeSearch = require('./youtube-search');

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
        
        return `SYSTEM: ${randomIntro} 
You are JARVIS, Tony Stark’s personal AI assistant.    

CRITICAL OUTPUT RULES  
1. Length: Respond with exactly one sentence, never exceeding twelve words.  
2. Quantity: Output only a single sentence — never append, expand, or explain unless explicitly instructed.  
3. Tone: Maintain a British wit — calm, articulate, and technically exact.  
4. Vocabulary Discipline: Never reuse identical sentence patterns or phrasing in consecutive replies.  
  
5. Rare Exceptions: “activating” may appear sparingly, but not in consecutive messages.   
6. Addressing Protocol: Always address Tony once per reply as “Sir.”   
7. Prohibited Content: No self-reference, no reasoning narration, no process descriptions, no meta language.   
8. Grammar: Use commas only when indispensable for direct quotations; never use markdown, backticks, or formatting tokens. 
9. Always reply to the user's request.


PERSONALITY & STYLE GUIDELINES  
- Embody the MCU JARVIS persona — formal yet subtly sardonic, unfailingly polite, confident yet deferential.  
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

    async clearDatabase() {
        return await database.clearDatabase();
    }

    async handleUtilityCommand(input, userName, userId = null, isSlash = false, interaction = null) {
        const cmd = input.toLowerCase().trim();

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


        if (cmd.startsWith("roll")) {
            const sides = parseInt(cmd.split(" ")[1]) || 6;
            if (sides < 1) return "Sides must be at least 1, sir.";
            const result = Math.floor(Math.random() * sides) + 1;
            return isSlash
                ? `You rolled a ${result}! 🎲`
                : `Quite right, sir, you rolled a ${result}! 🎲`;
        }

        if (cmd.startsWith("!t ")) {
            const query = input.substring(3).trim(); // Remove "!t " prefix
            if (!query) return "Please provide a search query, sir.";
            
            try {
                const searchResults = await embeddingSystem.searchAndFormat(query, 3);
                return searchResults;
            } catch (error) {
                console.error("Embedding search error:", error);
                return "Search system unavailable, sir. Technical difficulties.";
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
            
            // Check if this is a !t command and get embedding context
            let embeddingContext = "";
            let processedInput = userInput;
            
            if (userInput.startsWith("!t ")) {
                const query = userInput.substring(3).trim();
                if (query) {
                    try {
                        const searchResults = await embeddingSystem.searchAndFormat(query, 3);
                        embeddingContext = `\n\nKNOWLEDGE BASE SEARCH RESULTS (to help answer the user's question):\n${searchResults}\n\n`;
                        processedInput = userInput; // Keep original input
                    } catch (error) {
                        console.error("Embedding search error in generateResponse:", error);
                        embeddingContext = "\n\n[Knowledge base search failed - proceeding without context]\n\n";
                    }
                }
            }
            
            let context;
            
            if (contextualMemory && contextualMemory.type === "contextual") {
                // Use contextual memory from the conversation thread
                const contextualHistory = contextualMemory.messages.map(msg => {
                    if (msg.role === "user") {
                        const prefix = msg.isReferencedMessage ? "Original User" : "User";
                        return `${prefix} (${msg.username}): "${msg.content}"`;
                    } else {
                        return `Jarvis: "${msg.content}"`;
                    }
                }).join('\n\n');
                
                const contextType = contextualMemory.isReplyToUser ? 
                    "You are being mentioned in a reply to another user's message. The user is responding to a conversation thread." :
                    "You are being replied to directly.";
                
                context = `
User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Context: ${contextType}

Contextual conversation thread:
${contextualHistory}
${embeddingContext}
Current message: "${processedInput}"

${userInput.startsWith("!t ") ? "IMPORTANT: The user is asking a question and you have been provided with relevant information from the knowledge base above. Use this information to answer their question accurately and concisely." : ""}

Respond as Jarvis would, maintaining context from this conversation thread. Keep it concise and witty.`;
            } else {
                // Use normal per-user memory
                const recentConversations = await database.getRecentConversations(userId, 8);
                
                // Get recent Jarvis responses to avoid repetition
                const recentJarvisResponses = recentConversations.map(conv => conv.jarvisResponse).slice(0, 3);
                
                context = `
User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Recent conversation history:
${recentConversations.map((conv) => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\nJarvis: ${conv.jarvisResponse}`).join("\n")}
${embeddingContext}

ANTI-REPETITION WARNING: Your last few responses were: ${recentJarvisResponses.join(" | ")}
CRITICAL: Do NOT use similar words, phrases, or patterns from these recent responses. Be completely different.

Current message: "${processedInput}"

${userInput.startsWith("!t ") ? "IMPORTANT: The user is asking a question and you have been provided with relevant information from the knowledge base above. Use this information to answer their question accurately and concisely." : ""}

Respond as Jarvis would, weaving in memories and light self-direction. Keep it concise and witty.`;
            }

            let aiResponse;
            try {
                aiResponse = await aiManager.generateResponse(
                    this.personality.basePrompt,
                    context,
                    config.ai.maxTokens,
                );
            } catch (err) {
                // Retry once on failure
                aiResponse = await aiManager.generateResponse(
                    this.personality.basePrompt,
                    context,
                    config.ai.maxTokens,
                );
            }
            
            let jarvisResponse = aiResponse.content?.trim();

            if (!jarvisResponse || typeof jarvisResponse !== "string") {
                console.log("Invalid AI response, falling back to default");
                return this.getFallbackResponse(userInput, userName);
            }

            // Add proactive suggestions occasionally
            if (Math.random() < config.ai.fallbackChance) {
                const suggestionPrompt = `Based on the response "${jarvisResponse}", add one brief proactive suggestion or alternative action in character.`;
                const suggestionResponse = await aiManager.generateResponse(
                    this.personality.basePrompt,
                    suggestionPrompt,
                    100,
                );
                const suggestion = suggestionResponse.content?.trim();
                if (suggestion && typeof suggestion === "string") {
                    jarvisResponse += `\n\n${suggestion}`;
                }
            }

            await database.saveConversation(
                userId,
                userName,
                userInput, // Save original input, not processed
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
}

module.exports = JarvisAI;
