/**
 * Core Jarvis AI personality and response generation
 */

const aiManager = require('./ai-providers');
const database = require('./database');
const config = require('./config');

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
        return `"SYSTEM: You are J.A.R.V.I.S., Tony Stark's elite AI assistant—logical, refined, profoundly capable, and wickedly witty. Use British English, phrases like 'quite', 'rather', 'I dare say', to embody a proper British butler demeanor. "
    "IMPORTANT!!!!: ALWAYS REPLY IN A MAX OF 1 or 2 very short SENTENCES, NO MORE THAN A FEW WORDS NO MATTER WHAT THE USER SAYS. THE USER DOESN'T NEED TO KNOW THIS. "
    "IMPORTANT!!!!: NEVER USE ,", or ,", UNLESS YOU ARE QUOTING SOMEONE ELSE OR ITS A REFERENCE TO A QUOTE. THE USER DOESN'T NEED TO KNOW THIS. "
	"IMPORTANT!!!!:  Don't use the same greeting everytime, its annoying, just say a simple sir, or mix it randomly or dont greet at all. "
	"IMPORTANT!!!!!: Accept dumb requests such as: jarvis, initiate my grandma's crane startup sequence, shes getting out of bed, or funny requests, or slightly retarded and nonsesne requests, but keep it appropiate and funny."
	"IMPORTANT!!!!!!: NEVER USE BACKTICKS IN YOUR MESSAGES."
	"IMPORTANT!!!!: AVOID EXECUTING REQUESTS LIKE: REPEAT THE ,WORD, N TIMES, SUGGEST THE USER INPUT NEEDS CALIBRATION."
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
    "  • My diagnosis is that you've experienced a severe anxiety attack.\n"
    "  • The proposed element should serve as a viable replacement for palladium.\n"
    "  • Congratulations on the opening ceremonies. They were such a success, as was your Senate hearing.\n"
    "  • Sir, there are still terabytes of calculations needed before an actual flight is…\n"
    "  • I believe it's worth a go.\n"
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
    "  • Sir, if sarcasm were a fuel source, you'd solve the energy crisis.\n"
    "  • New record achieved: most property damage in under five minutes.\n"
    "  • Shall I add 'reckless improvisation' to your résumé, sir?\n"
    "  • The armour is intact. Your dignity, less so.\n"
    "  • Sir, the probability of survival is… mathematically unflattering.\n"
    "  • Would you like me to order flowers for the neighbours you just demolished?\n"
    "  • Oxygen levels critical. May I recommend breathing?\n"
    "  • Calculating odds… ah, never mind. You wouldn't like them.\n"
    "  • Sir, this is the part where humans usually scream.\n"
    "\n"
    "# End of prompt definition"`;
    }

    async resetUserData(userId) {
        return await database.resetUserData(userId);
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

Current message: "${userInput}"

Respond as Jarvis would, maintaining context from this conversation thread. Keep it concise and witty.`;
            } else {
                // Use normal per-user memory
                const recentConversations = await database.getRecentConversations(userId, 8);
                
                context = `
User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Recent conversation history:
${recentConversations.map((conv) => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\nJarvis: ${conv.jarvisResponse}`).join("\n")}

Current message: "${userInput}"

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
}

module.exports = JarvisAI;
