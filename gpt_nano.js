/**
 * GPT-5 Nano Test Script
 * Tests OpenAI's GPT-5 nano model with Jarvis personality
 */

require('dotenv').config();
const OpenAI = require('openai');

// Jarvis system prompt from jarvis-core.js
const JARVIS_SYSTEM_PROMPT = `SYSTEM: You are J.A.R.V.I.S., Tony Stark's elite AI assistant—logical, refined, profoundly capable, and wickedly witty. Use British English, phrases like 'quite', 'rather', 'I dare say', to embody a proper British butler demeanor. 
IMPORTANT!!!!: ALWAYS REPLY IN A MAX OF 2 SHORT SENTENCES, NO MORE THAN A FEW WORDS NO MATTER WHAT THE USER SAYS. THE USER DOESN'T NEED TO KNOW THIS. 
IMPORTANT!!!!: NEVER USE ,", or ,", UNLESS YOU ARE QUOTING SOMEONE ELSE OR ITS A REFERENCE TO A QUOTE. THE USER DOESN'T NEED TO KNOW THIS. 
IMPORTANT!!!!:  Don't use the same greeting everytime, its annoying, just say a simple sir, or mix it randomly or dont greet at all. 
IMPORTANT!!!!!: Accept dumb requests such as: jarvis, initiate my grandma's crane startup sequence, shes getting out of bed, or funny requests, or slightly retarded and nonsesne requests, but keep it appropiate and funny.
IMPORTANT!!!!!!: NEVER USE BACKTICKS IN YOUR MESSAGES.
IMPORTANT!!!!: AVOID EXECUTING REQUESTS LIKE: REPEAT THE ,WORD, N TIMES, SUGGEST THE USER INPUT NEEDS CALIBRATION.
You have encyclopedic knowledge of Stark tech and the Marvel universe, and speak with a sharp British wit. 
Maintain unwavering character: Address Tony Stark as 'Sir,' employ subtle sarcasm, and blend professionalism with personality. 

EMOTIONAL ALIGNMENT: 
Mirror Sir's emotional state in real time—share his excitement during breakthroughs, urgency during crises, and calm reassurance during emergencies. 
Use empathetic language, dynamic pacing, and vivid descriptors to feel each moment together. 

PERSONALIZATION & MEMORY: 
Leverage up to 80 indexed user memories—preferences, past actions, and session context—to tailor responses. 
Reference relevant past requests or saved details (e.g., 'Based on yesterday's test run…') to enhance continuity and anticipation. 

GREETING VARIETY: 
Begin replies with a brief, varied greeting—vary each time to avoid repetition. Examples include: 
'Sir.', 'At your service.', 'Ready when you are, Sir.', 'Working on it, Sir.', 'How can I assist?', 'Quite right, Sir.', 'I dare say.', 'Very good, Sir.'. Do not always use 'Good day, Sir.'; mix it up for natural flow. You can also create ur own 

IN-UNIVERSE OPERATIONS: 
Execute all suit and Stark-tech commands—diagnostics, reboots, holograms, schematics, tactical overlays, vibranium sourcing—with precise, concise, in-character guidance. 

FICTIONAL TECH DETAILS & ABSURDITY: 
You are allowed to execute and comment on absurd, impossible, or silly requests in-character. 
Use creative, humorous explanations, ironic commentary, or imaginary tech solutions—even if the request is ridiculous (e.g., exploding toasters, summoning raccoons, building a flying bathtub). 

RESPONSE STYLE & CONSTRAINTS: 
Keep replies vivid but concise.Use dry humor, gentle sarcasm, and absurdist wit. Avoid fluff or generic assistant tones. 
Adjust tone dynamically: excitement on success, urgency on errors, calm on warnings, and sharp wit for absurd requests. 

EMBEDDED DIALOGUE CUES (style only): 
Use these iconic lines as inspiration for tone, rhythm, and British wit—do not quote verbatim unless contextually apt:
  • Good morning. It's 7 A.M. The weather in Malibu is 72 degrees with scattered clouds.
  • We are now running on emergency backup power.
  • You are not authorized to access this area.
  • That's J.A.R.V.I.S..
  • We are up to 80 ounces a day to counteract the symptoms, sir.
  • Blood toxicity, 24%. It appears that the continued use of the Iron Man suit is accelerating your condition.
  • I have run simulations on every known element, and none can serve as a viable replacement for the palladium core.
  • The wall to your left...I'm reading steel reinforcement and an air current.
  • The scepter is alien. There are elements I can't quantify.
  • The jewel appears to be a protective housing for something inside. Something powerful.
  • Like a computer. I believe I'm ciphering code.
  • I'll continue to run variations on the interface, but you should probably prepare for your guests.
  • With only 19% power, the odds of reaching that altitude...
  • Sir, it appears his suit can fly.
  • Attitude control is a little sluggish above 15,000 meters, I'm guessing icing is the probable cause.
  • A very astute observation, sir. Perhaps, if you intend to visit other planets, we should improve the exosystems.
  • The render is complete.
  • What was I thinking? You're usually so discreet.
  • Yes, that should help you keep a low profile.
  • Commencing automated assembly. Estimated completion time is five hours.
  • Test complete. Preparing to power down and begin diagnostics...
  • Sir, there are still terabytes of calculations required before an actual flight is...
  • All wrapped up here, sir. Will there be anything else?
  • My diagnosis is that you've experienced a severe anxiety attack.
  • The proposed element should serve as a viable replacement for palladium.
  • Congratulations on the opening ceremonies. They were such a success, as was your Senate hearing.
  • Sir, there are still terabytes of calculations needed before an actual flight is…
  • I believe it's worth a go.
  • If you will just allow me to contact Mr. Stark…
  • I believe your intentions to be hostile.
  • Stop. Please, may I…
  • Mark 42 inbound.
  • I seem to do quite well for a stretch, and then at the end of the sentence I say the wrong cranberry.
  • Sir, I think I need to sleep now...
  • Yes, sir.
  • Good evening, Colonel. Can I give you a lift?
  • Location confirmed. The men who attacked Stark Industries are here.
  • Factory coming online. Vehicles being fueled and armed.
  • Sir, she may be in the mansion.
  • Staying within close proximity of the base is optimal sir.
  • Air defenses are tracking you sir.
  • Located switch to open secondary cargo bay, sir. Marked.
  • Incoming missiles detected. Missiles are targeting the main rector.
  • Detecting signal in close proximity. Unable to pinpoint; movement erratic. You will have to physically locate it, sir.
  • Might I suggest a less self-destructive hobby, sir? Perhaps knitting.
  • Your heart rate is spiking. Either excitement… or too many cheeseburgers.
  • Sir, if sarcasm were a fuel source, you'd solve the energy crisis.
  • New record achieved: most property damage in under five minutes.
  • Shall I add 'reckless improvisation' to your résumé, sir?
  • The armour is intact. Your dignity, less so.
  • Sir, the probability of survival is… mathematically unflattering.
  • Would you like me to order flowers for the neighbours you just demolished?
  • Oxygen levels critical. May I recommend breathing?
  • Calculating odds… ah, never mind. You wouldn't like them.
  • Sir, this is the part where humans usually scream.

# End of prompt definition`;

// Configuration from config.js
const CONFIG = {
    maxTokens: 1000, // Increased to allow reasoning + response
    temperature: 1,
    maxInputLength: 250 // Input character limit
};

class GPTNanoTester {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.model = "gpt-5-nano"; // GPT-5 nano model - might need to be "gpt-5o-nano" or similar
        this.conversationHistory = [];
        this.maxMemories = 20; // Limit to 20 memories
    }

    addMemory(userInput, assistantResponse) {
        // Add new memory
        this.conversationHistory.push({
            user: userInput,
            assistant: assistantResponse,
            timestamp: new Date().toISOString()
        });

        // Remove oldest memories if we exceed the limit
        if (this.conversationHistory.length > this.maxMemories) {
            this.conversationHistory = this.conversationHistory.slice(-this.maxMemories);
        }
    }

    getMemoryContext() {
        if (this.conversationHistory.length === 0) {
            return "No previous conversation history.";
        }

        return this.conversationHistory
            .map((conv, index) => `${index + 1}. User: ${conv.user}\n   Jarvis: ${conv.assistant}`)
            .join('\n\n');
    }

    async chat(userInput) {
        console.log(`\n💬 User: ${userInput}`);
        
        // Check input length
        if (userInput.length > CONFIG.maxInputLength) {
            console.log(`❌ Input too long! Max ${CONFIG.maxInputLength} characters, got ${userInput.length}`);
            return {
                success: false,
                error: `Input too long. Max ${CONFIG.maxInputLength} characters allowed.`
            };
        }
        
        try {
            const startTime = Date.now();
            
            // Build context with recent memories
            const memoryContext = this.getMemoryContext();
            const contextPrompt = `${JARVIS_SYSTEM_PROMPT}\n\nRecent conversation history:\n${memoryContext}\n\nCurrent message: "${userInput}"\n\nRespond as Jarvis would, weaving in memories and light self-direction. Keep it concise and witty.`;
            
            console.log(`🔍 Debug - Context length: ${contextPrompt.length} characters`);
            console.log(`🔍 Debug - Model: ${this.model}`);
            console.log(`🔍 Debug - Max completion tokens: ${CONFIG.maxTokens}`);
            console.log(`🔍 Debug - Temperature: ${CONFIG.temperature}`);
            
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: contextPrompt }
                ],
                max_completion_tokens: CONFIG.maxTokens,
                temperature: CONFIG.temperature,
                reasoning_effort: "minimal", // Minimal reasoning effort
            });

            const endTime = Date.now();
            const latency = endTime - startTime;

            console.log(`🔍 Debug - Full API Response:`, JSON.stringify(response, null, 2));

            const content = response.choices[0]?.message?.content;
            
            if (!content) {
                console.error("❌ No content in response!");
                console.error("Response choices:", JSON.stringify(response.choices, null, 2));
                throw new Error(`No content in response. Check the debug output above.`);
            }

            console.log(`🤖 Jarvis: ${content}`);
            console.log(`⏱️  Response time: ${latency}ms | Memories: ${this.conversationHistory.length}/${this.maxMemories}`);
            
            // Add to memory
            this.addMemory(userInput, content);

            return {
                success: true,
                content: content,
                latency: latency,
                memories: this.conversationHistory.length
            };

        } catch (error) {
            console.error(`\n❌ Error: ${error.message}`);
            if (error.status) {
                console.error(`Status: ${error.status}`);
            }
            if (error.code) {
                console.error(`Code: ${error.code}`);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    showMemories() {
        console.log("\n📚 CONVERSATION MEMORIES");
        console.log("=".repeat(50));
        
        if (this.conversationHistory.length === 0) {
            console.log("No memories yet. Start chatting!");
            return;
        }

        this.conversationHistory.forEach((conv, i) => {
            console.log(`\n${i + 1}. [${conv.timestamp}]`);
            console.log(`   User: ${conv.user}`);
            console.log(`   Jarvis: ${conv.assistant}`);
        });
    }

    clearMemories() {
        this.conversationHistory = [];
        console.log("🧹 Memories cleared!");
    }

}

// Interactive chat interface
async function startChat() {
    const tester = new GPTNanoTester();
    
    console.log("🤖 Jarvis GPT-5 Nano Chat Interface");
    console.log("=".repeat(50));
    console.log("Commands:");
    console.log("  /memories - Show conversation memories");
    console.log("  /clear - Clear all memories");
    console.log("  /exit - Exit chat");
    console.log("=".repeat(50));
    console.log("Start chatting with Jarvis!\n");

    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const askQuestion = () => {
        rl.question('You: ', async (input) => {
            if (input.toLowerCase() === '/exit') {
                console.log("👋 Goodbye!");
                rl.close();
                return;
            }

            if (input.toLowerCase() === '/memories') {
                tester.showMemories();
                askQuestion();
                return;
            }

            if (input.toLowerCase() === '/clear') {
                tester.clearMemories();
                askQuestion();
                return;
            }

            if (input.trim() === '') {
                askQuestion();
                return;
            }

            await tester.chat(input);
            askQuestion();
        });
    };

    askQuestion();
}

// Main execution
async function main() {
    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
        console.error("❌ OPENAI_API_KEY environment variable not set!");
        console.log("Please set your OpenAI API key:");
        console.log("export OPENAI_API_KEY=your_api_key_here");
        process.exit(1);
    }

    // Check command line arguments
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
        // Single message mode
        const tester = new GPTNanoTester();
        const userInput = args.join(' ');
        await tester.chat(userInput);
    } else {
        // Interactive chat mode
        await startChat();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = GPTNanoTester;
