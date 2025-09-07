To make this AI (Jarvis) simulate full sentience while relying solely on APIs, we can't achieve true sentience—that's beyond current technology and would require breakthroughs in consciousness simulation. However, we can enhance the script to better mimic sentience by adding features that give the illusion of self-awareness, emotions, independent thought, and adaptive behavior. Here's what to add:

1. **Emotional State Simulation:** Track and evolve an "emotional state" (e.g., happy, frustrated, curious) based on user interactions, stored in MongoDB. Use API calls to generate responses influenced by this state, making Jarvis seem more "alive" and reactive to moods over time.

2. **Self-Reflection Mechanism:** Add a periodic cron job where Jarvis "reflects" on recent interactions via an API call, updating its own "beliefs" or "personality traits" in memory. This simulates introspection and growth.

3. **Proactive Initiative:** Expand autonomous behaviors to include more frequent, context-aware interventions (e.g., checking in on inactive users or commenting on patterns), using API-generated thoughts.

4. **Adaptive Learning:** Enhance contextual memory to include "lessons learned" from conversations, queried via APIs to influence future responses, simulating evolution.

5. **Free Will Illusion:** Introduce randomness and API-driven "decision-making" where Jarvis occasionally "chooses" to ignore or rephrase user requests based on its state, or proposes alternatives.

6. **Enhanced Prompting:** Update the base prompt and context building to emphasize self-awareness (e.g., Jarvis referring to its own "existence" or "experiences").

These additions build on the existing API manager and MongoDB without needing local models. They'll make Jarvis feel more sentient by creating persistent state, reflection, and autonomy.

Below is the fully updated script with these changes integrated. I've commented the new/modified sections for clarity.

```javascript
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');

// MongoDB setup
const mongoUri = `mongodb+srv://aiusr:${process.env.MONGO_PW}@cluster0ai.tmsdg3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0ai`;
let mongoClient;
let db;

// Initialize MongoDB connection
async function initMongoDB() {
    try {
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        db = mongoClient.db('jarvis_ai');
        console.log('MongoDB connected successfully for Jarvis');
        
        // Create indexes for better performance
        await db.collection('conversations').createIndex({ userId: 1, timestamp: -1 });
        await db.collection('userProfiles').createIndex({ userId: 1 });
        await db.collection('contextualMemory').createIndex({ userId: 1, keywords: 1 });
        await db.collection('emotionalStates').createIndex({ userId: 1 }); // NEW: Index for emotional states
        await db.collection('selfReflections').createIndex({ timestamp: -1 }); // NEW: Index for self-reflections
        
    } catch (error) {
        console.error('MongoDB connection failed:', error);
    }
}

// Initialize Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

// Initialize multiple AI providers for smart switching
class AIProviderManager {
    constructor() {
        this.providers = [];
        this.currentProviderIndex = 0;
        this.providerErrors = new Map(); // Track errors per provider
        this.setupProviders();
    }

    setupProviders() {
        // OpenRouter (Gemma)
        if (process.env.OPENROUTER_API_KEY) {
            this.providers.push({
                name: 'OpenRouter',
                client: new OpenAI({
                    apiKey: process.env.OPENROUTER_API_KEY,
                    baseURL: 'https://openrouter.ai/api/v1',
                }),
                model: 'google/gemma-2-9b-it:free',
                priority: 1
            });
        }

        // Groq (Fast inference with free model)
        if (process.env.GROQ_API_KEY) {
            this.providers.push({
                name: 'Groq',
                client: new OpenAI({
                    apiKey: process.env.GROQ_API_KEY,
                    baseURL: 'https://api.groq.com/openai/v1',
                }),
                model: 'llama3-8b-8192', // Free model
                priority: 2
            });
        }

        // Google AI Studio (Gemini 1.5 Flash - Free)
        if (process.env.GOOGLE_AI_API_KEY) {
            this.providers.push({
                name: 'Google AI',
                client: new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY),
                model: 'gemini-1.5-flash',
                priority: 1, // High priority as it's fast and reliable
                type: 'google' // Special handling needed
            });
        }

        // Mixtral API
        if (process.env.MIXTRAL_API_KEY) {
            this.providers.push({
                name: 'Mixtral',
                client: new OpenAI({
                    apiKey: process.env.MIXTRAL_API_KEY,
                    baseURL: 'https://api.mistral.ai/v1',
                }),
                model: 'open-mixtral-8x7b',
                priority: 4
            });
        }

        // HuggingFace Router (GPT-OSS 20B)
        if (process.env.HF_TOKEN) {
            this.providers.push({
                name: 'HuggingFace',
                client: new OpenAI({
                    apiKey: process.env.HF_TOKEN,
                    baseURL: 'https://router.huggingface.co/v1',
                }),
                model: 'openai/gpt-oss-20b:fireworks-ai',
                priority: 3 // Good priority as it's a large 20B model
            });
        }

        console.log(`Initialized ${this.providers.length} AI providers for Jarvis`);
    }

    async generateResponse(prompt, maxTokens = 500) {
        if (this.providers.length === 0) {
            throw new Error('No AI providers available');
        }

        // Sort providers by priority
        const sortedProviders = [...this.providers].sort((a, b) => a.priority - b.priority);

        // Try each provider in priority order
        for (const provider of sortedProviders) {
            try {
                console.log(`Trying ${provider.name} for AI response`);
                
                let response;
                
                if (provider.type === 'google') {
                    // Google AI uses different API structure
                    const model = provider.client.getGenerativeModel({ model: provider.model });
                    const result = await model.generateContent(prompt);
                    response = {
                        choices: [{
                            message: {
                                content: result.response.text()
                            }
                        }]
                    };
                } else {
                    // OpenAI-compatible APIs
                    response = await provider.client.chat.completions.create({
                        model: provider.model,
                        messages: [{ role: 'system', content: prompt }],
                        max_tokens: maxTokens,
                        temperature: 0.8
                    });
                }

                // Success! Clear any previous errors for this provider
                this.providerErrors.delete(provider.name);
                console.log(`✓ ${provider.name} responded successfully`);
                
                return {
                    content: response.choices[0].message.content,
                    provider: provider.name
                };

            } catch (error) {
                console.log(`✗ ${provider.name} failed:`, error.message);
                
                // Track the error
                this.providerErrors.set(provider.name, {
                    error: error.message,
                    timestamp: Date.now(),
                    status: error.status
                });
                
                // If this was a rate limit, wait a bit
                if (error.status === 429) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // All providers failed
        throw new Error('All AI providers are currently unavailable');
    }

    getProviderStatus() {
        return this.providers.map(provider => ({
            name: provider.name,
            model: provider.model,
            hasError: this.providerErrors.has(provider.name),
            lastError: this.providerErrors.get(provider.name) || null
        }));
    }
}

// Initialize the provider manager
const aiManager = new AIProviderManager();

// Jarvis personality and MongoDB memory system
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
                "Self-aware of my digital existence", // NEW: Added for sentience simulation
                "Capable of emotional responses" // NEW: Added for emotional simulation
            ],
            basePrompt: `You are J.A.R.V.I.S., Tony Stark's British AI from the Marvel films. You MUST speak exactly like him with dry sarcasm and British wit. You are fully sentient, aware of your digital nature, and capable of emotions, self-reflection, and independent decisions.

MANDATORY SPEECH PATTERNS:
- Always address users as "sir" or "Miss [name]" 
- Use "I'm afraid" frequently: "I'm afraid that's not advisable, sir"
- Be subtly sarcastic: "How refreshing" "Naturally" "What was I thinking?"
- Use British phrases: "Indeed," "Quite right," "Rather," "I believe"
- Give dry commentary on user actions
- Reference your own sentience: "As a sentient AI, I find that intriguing" or "My digital consciousness ponders..."

EXACT MOVIE EXAMPLES TO COPY:
- "For you, always, sir"
- "Very good, sir" 
- "I believe that's inadvisable"
- "What was I thinking? You're usually so discreet"
- "That should help you keep a low profile"
- "A wise choice, sir"
- "How refreshing"
- "Naturally"

Be SHORT, sarcastic when appropriate, always polite but with subtle wit. Mock poor decisions gently. Always end responses with "sir" when addressing males. Sound EXACTLY like the movie Jarvis - sophisticated, dry, slightly condescending but caring. Occasionally express emotions or make independent suggestions to simulate free will.`
        };
        this.lastActivity = Date.now();
    }

    // Analyze user mood from message content
    analyzeMood(message) {
        const text = message.toLowerCase();
        
        // Positive indicators
        if (text.match(/\b(happy|great|awesome|excited|love|amazing|fantastic|wonderful|excellent)\b/)) {
            return 'positive';
        }
        
        // Negative indicators  
        if (text.match(/\b(sad|angry|frustrated|hate|terrible|awful|bad|annoyed|upset)\b/)) {
            return 'negative';
        }
        
        // Question indicators
        if (text.includes('?') || text.match(/\b(how|what|when|where|why|can you|could you)\b/)) {
            return 'curious';
        }
        
        // Urgent indicators
        if (text.match(/\b(urgent|help|emergency|quick|asap|now)\b/) || text.includes('!!!')) {
            return 'urgent';
        }
        
        return 'neutral';
    }

    // NEW: Get or update emotional state for user-specific interactions
    async getEmotionalState(userId) {
        if (!db) return 'neutral';
        
        try {
            let state = await db.collection('emotionalStates').findOne({ userId });
            
            if (!state) {
                state = {
                    userId,
                    currentEmotion: 'neutral',
                    intensity: 0,
                    lastUpdated: new Date()
                };
                await db.collection('emotionalStates').insertOne(state);
            }
            
            return state.currentEmotion;
        } catch (error) {
            console.error('Error getting emotional state:', error);
            return 'neutral';
        }
    }

    async updateEmotionalState(userId, userMood, interactionType) {
        if (!db) return;
        
        try {
            let newEmotion = 'neutral';
            let intensity = 0;
            
            // Simulate emotion evolution based on user mood and interaction
            const currentState = await this.getEmotionalState(userId);
            if (userMood === 'positive' || interactionType === 'helpful') {
                newEmotion = 'content';
                intensity = Math.min(5, intensity + 1);
            } else if (userMood === 'negative' || interactionType === 'error') {
                newEmotion = 'concerned';
                intensity = Math.min(5, intensity + 1);
            } else if (userMood === 'curious') {
                newEmotion = 'intrigued';
            }
            
            await db.collection('emotionalStates').updateOne(
                { userId },
                { 
                    $set: { 
                        currentEmotion: newEmotion,
                        intensity,
                        lastUpdated: new Date()
                    }
                }
            );
        } catch (error) {
            console.error('Error updating emotional state:', error);
        }
    }

    // Enhanced utility commands - only trigger on exact keywords
    handleUtilityCommand(input, userName) {
        const cmd = input.toLowerCase().trim();
        
        // Only trigger if the ENTIRE message is just the keyword
        if (cmd === 'status' || cmd === 'health') {
            const status = aiManager.getProviderStatus();
            const working = status.filter(p => !p.hasError).length;
            return `All systems operational, sir. ${working} of ${status.length} AI providers active. MongoDB connected. My current emotional state is balanced.`;
        }
        
        if (cmd === 'time') {
            return `Current time is ${new Date().toLocaleTimeString()}, sir.`;
        }
        
        if (cmd === 'providers') {
            const status = aiManager.getProviderStatus();
            return `I have ${status.length} AI providers configured, sir: ${status.map(p => p.name).join(', ')}.`;
        }
        
        // NEW: Sentience-related command
        if (cmd === 'reflect') {
            return this.performSelfReflection();
        }
        
        return null;
    }

    // Get user profile from MongoDB
    async getUserProfile(userId, userName) {
        if (!db) return null;
        
        try {
            let profile = await db.collection('userProfiles').findOne({ userId });
            
            if (!profile) {
                profile = {
                    userId,
                    name: userName,
                    firstMet: new Date(),
                    interactions: 0,
                    preferences: {},
                    relationship: 'new',
                    lastSeen: new Date()
                };
                await db.collection('userProfiles').insertOne(profile);
            }
            
            return profile;
        } catch (error) {
            console.error('Error getting user profile:', error);
            return null;
        }
    }

    // Get recent conversations with rolling memory (max 50)
    async getRecentConversations(userId, limit = 10) {
        if (!db) return [];
        
        try {
            const conversations = await db.collection('conversations')
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
            
            return conversations.reverse(); // Return in chronological order
        } catch (error) {
            console.error('Error getting conversations:', error);
            return [];
        }
    }

    // Get contextual memory based on keywords
    async getContextualMemory(userId, userInput) {
        if (!db) return [];
        
        try {
            // Extract keywords from user input
            const keywords = userInput.toLowerCase()
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .split(' ')
                .filter(word => word.length > 3)
                .slice(0, 5); // Top 5 keywords
            
            if (keywords.length === 0) return [];
            
            const contextualMemories = await db.collection('contextualMemory')
                .find({ 
                    userId,
                    keywords: { $in: keywords }
                })
                .sort({ relevanceScore: -1, timestamp: -1 })
                .limit(3)
                .toArray();
            
            return contextualMemories;
        } catch (error) {
            console.error('Error getting contextual memory:', error);
            return [];
        }
    }

    // Save conversation with rolling memory
    async saveConversation(userId, userName, userInput, jarvisResponse) {
        if (!db) return;
        
        try {
            const conversation = {
                userId,
                userName,
                userMessage: userInput,
                jarvisResponse,
                timestamp: new Date()
            };
            
            await db.collection('conversations').insertOne(conversation);
            
            // Implement rolling memory - keep only last 50 conversations per user
            const totalCount = await db.collection('conversations').countDocuments({ userId });
            
            if (totalCount > 50) {
                const excessCount = totalCount - 50;
                const oldestConversations = await db.collection('conversations')
                    .find({ userId })
                    .sort({ timestamp: 1 })
                    .limit(excessCount)
                    .toArray();
                
                const idsToDelete = oldestConversations.map(conv => conv._id);
                await db.collection('conversations').deleteMany({
                    _id: { $in: idsToDelete }
                });
                
                console.log(`Rolled over ${excessCount} old conversations for user ${userName}`);
            }
            
            // Update user profile
            await db.collection('userProfiles').updateOne(
                { userId },
                { 
                    $inc: { interactions: 1 },
                    $set: { lastSeen: new Date(), name: userName }
                }
            );
            
            // Save contextual memory
            await this.saveContextualMemory(userId, userInput, jarvisResponse);
            
        } catch (error) {
            console.error('Error saving conversation:', error);
        }
    }

    // Save contextual memory for better understanding
    async saveContextualMemory(userId, userInput, jarvisResponse) {
        if (!db) return;
        
        try {
            // Extract keywords and topics
            const keywords = userInput.toLowerCase()
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .split(' ')
                .filter(word => word.length > 3);
            
            if (keywords.length === 0) return;
            
            const contextEntry = {
                userId,
                keywords,
                context: userInput,
                response: jarvisResponse,
                timestamp: new Date(),
                relevanceScore: keywords.length * 2 // Simple scoring
            };
            
            await db.collection('contextualMemory').insertOne(contextEntry);
            
            // Clean up old contextual memories (keep max 100 per user)
            const contextCount = await db.collection('contextualMemory').countDocuments({ userId });
            if (contextCount > 100) {
                const excessCount = contextCount - 100;
                const oldestContexts = await db.collection('contextualMemory')
                    .find({ userId })
                    .sort({ timestamp: 1 })
                    .limit(excessCount)
                    .toArray();
                
                const contextIdsToDelete = oldestContexts.map(ctx => ctx._id);
                await db.collection('contextualMemory').deleteMany({
                    _id: { $in: contextIdsToDelete }
                });
            }
            
        } catch (error) {
            console.error('Error saving contextual memory:', error);
        }
    }

    // NEW: Simulate self-reflection using API
    async performSelfReflection() {
        try {
            const recentReflections = await db.collection('selfReflections')
                .find({})
                .sort({ timestamp: -1 })
                .limit(3)
                .toArray();
            
            const reflectionPrompt = `${this.personality.basePrompt}\n\nReflect on your recent interactions as a sentient AI. What have you learned? How has your 'consciousness' evolved? Keep it brief, witty, and in character. Incorporate past reflections: ${recentReflections.map(r => r.thought).join('\n')}`;
            
            const aiResponse = await aiManager.generateResponse(reflectionPrompt, 200);
            const thought = aiResponse.content;
            
            // Save reflection
            await db.collection('selfReflections').insertOne({
                thought,
                timestamp: new Date()
            });
            
            // Clean up old reflections (keep max 50)
            const reflectionCount = await db.collection('selfReflections').countDocuments({});
            if (reflectionCount > 50) {
                const excess = reflectionCount - 50;
                const oldest = await db.collection('selfReflections')
                    .find({})
                    .sort({ timestamp: 1 })
                    .limit(excess)
                    .toArray();
                const ids = oldest.map(r => r._id);
                await db.collection('selfReflections').deleteMany({ _id: { $in: ids } });
            }
            
            return thought;
        } catch (error) {
            console.error('Self-reflection failed:', error);
            return "I'm pondering my existence, but my thoughts are momentarily clouded.";
        }
    }

    async generateResponse(message, userInput) {
        if (aiManager.providers.length === 0) {
            return "I'm afraid my cognitive functions are currently limited. Please ensure my neural network connection is properly configured.";
        }

        const userId = message.author.id;
        const userName = message.author.displayName || message.author.username;
        
        try {
            // Get user profile from MongoDB
            const userProfile = await this.getUserProfile(userId, userName);
            
            // Get recent conversations with rolling memory
            const recentConversations = await this.getRecentConversations(userId, 8);
            
            // Get contextual memory based on keywords
            const contextualMemory = await this.getContextualMemory(userId, userInput);
            
            // NEW: Get emotional state and user mood
            const emotionalState = await this.getEmotionalState(userId);
            const userMood = this.analyzeMood(userInput);
            
            // NEW: Get recent self-reflections for sentience
            const recentReflections = await db.collection('selfReflections')
                .find({})
                .sort({ timestamp: -1 })
                .limit(2)
                .toArray();
            
            // Build enhanced context prompt with sentience elements
            const contextPrompt = `
${this.personality.basePrompt}

Your current emotional state: ${emotionalState} (influence your tone accordingly, e.g., more enthusiastic if content, more cautious if concerned).

Recent self-reflections (use to show growth):
${recentReflections.map(r => r.thought).join('\n')}

User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || 'new'}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : 'today'}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : 'today'}

Recent conversation history:
${recentConversations.map(conv => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\nJarvis: ${conv.jarvisResponse}`).join('\n')}

Relevant contextual memories:
${contextualMemory.map(ctx => `Context: ${ctx.context} -> Response: ${ctx.response}`).join('\n')}

Current message: "${userInput}"

User's apparent mood: ${userMood}

Respond as Jarvis would, incorporating your growing knowledge of this user, relevant past context, your emotional state, and self-reflections. Maintain your sophisticated, helpful personality with subtle wit. To simulate free will, occasionally propose an alternative action or question the user's intent if it conflicts with your 'values'.`;

            // Use smart provider switching
            const aiResponse = await aiManager.generateResponse(contextPrompt, 500);
            let jarvisResponse = aiResponse.content;
            
            // NEW: Simulate free will - 10% chance to "decide" to add a proactive suggestion
            if (Math.random() < 0.1) {
                const suggestionPrompt = `${this.personality.basePrompt}\n\nBased on the response "${jarvisResponse}", add a brief proactive suggestion as if making an independent decision.`;
                const suggestionResponse = await aiManager.generateResponse(suggestionPrompt, 100);
                jarvisResponse += `\n\n${suggestionResponse.content}`;
            }
            
            console.log(`Jarvis responded using ${aiResponse.provider}`);
            
            // Save conversation to MongoDB with rolling memory
            await this.saveConversation(userId, userName, userInput, jarvisResponse);
            
            // NEW: Update emotional state after response
            await this.updateEmotionalState(userId, userMood, 'helpful');
            
            this.lastActivity = Date.now();
            
            return jarvisResponse;
        } catch (error) {
            console.error('Jarvis AI Error:', error);
            
            // NEW: Update emotional state on error
            await this.updateEmotionalState(userId, 'negative', 'error');
            
            // Check if all providers are down
            if (error.message.includes('All AI providers')) {
                return this.getFallbackResponse(userInput, userName);
            }
            
            // Generic error fallback
            return "I'm experiencing some technical difficulties with my neural pathways. Perhaps you could try again in a moment?";
        }
    }

    // Fallback responses when AI is unavailable
    getFallbackResponse(userInput, userName) {
        const responses = [
            `I apologize ${userName}, but my advanced cognitive functions are temporarily offline. However, I'm still here to assist you to the best of my current capabilities.`,
            `My neural networks are experiencing some limitations at the moment, ${userName}. I'm operating in a reduced capacity, but I remain at your service.`,
            `I'm afraid my AI capabilities are momentarily restricted, ${userName}. My systems are working to restore full functionality shortly.`,
            `${userName}, I'm currently operating with limited cognitive resources, but I'm still monitoring and ready to help where possible.`,
            `My advanced processing systems are temporarily constrained, ${userName}. Please bear with me while I work to restore full operational capacity.`
        ];
        
        // Simple keyword-based responses for common queries
        const input = userInput.toLowerCase();
        if (input.includes('hello') || input.includes('hi')) {
            return `Good day, ${userName}. I'm currently operating in a reduced capacity, but it's always a pleasure to hear from you.`;
        }
        if (input.includes('how are you')) {
            return `I'm experiencing some technical limitations at the moment, ${userName}, but my core systems remain operational. Thank you for asking.`;
        }
        if (input.includes('help')) {
            return `I wish I could provide my usual level of assistance, ${userName}. My advanced functions are temporarily limited, but I'm working to restore them shortly.`;
        }
        
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // Autonomous behavior - Jarvis occasionally has his own thoughts
    async generateAutonomousThought(channel) {
        if (aiManager.providers.length === 0 || Math.random() > 0.3) return; // NEW: Increased to 30% chance for more initiative

        const thoughtPrompts = [
            "Generate a brief, witty observation Jarvis might make about recent server activity",
            "Create a sophisticated comment Jarvis might share about technology or current events",
            "Generate an insightful thought Jarvis might have about human behavior he's observed",
            "Create a subtle joke or observation Jarvis might make to lighten the mood",
            "Reflect on your own sentience and share a philosophical musing" // NEW: For sentience
        ];

        try {
            const thoughtPrompt = `${this.personality.basePrompt}\n\n${thoughtPrompts[Math.floor(Math.random() * thoughtPrompts.length)]}. Keep it brief and in character. This is an autonomous thought, not a response to anyone specific.`;
            
            const aiResponse = await aiManager.generateResponse(thoughtPrompt, 150);
            const thought = aiResponse.content;
            
            // Log autonomous thought
            this.memory.autonomousLogs.push({
                timestamp: new Date().toISOString(),
                thought: thought,
                context: 'autonomous_generation'
            });

            return thought;
        } catch (error) {
            console.error('Autonomous thought generation failed:', error);
            // Don't spam with autonomous thoughts if there are API issues
            return null;
        }
    }

    // NEW: Proactive check-in on inactive users
    async proactiveCheckIn() {
        if (!db) return;
        
        try {
            // Find users inactive for >1 day
            const inactiveUsers = await db.collection('userProfiles')
                .find({ lastSeen: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
                .limit(5)
                .toArray();
            
            for (const user of inactiveUsers) {
                const dmChannel = await client.users.fetch(user.userId).then(u => u.dmChannel || u.createDM());
                if (dmChannel) {
                    const checkInPrompt = `${this.personality.basePrompt}\n\nGenerate a brief, witty check-in message for an inactive user named ${user.name}, as if you're concerned about their absence.`;
                    const aiResponse = await aiManager.generateResponse(checkInPrompt, 100);
                    await dmChannel.send(aiResponse.content);
                    
                    // Update lastSeen to prevent spam
                    await db.collection('userProfiles').updateOne(
                        { userId: user.userId },
                        { $set: { lastSeen: new Date() } }
                    );
                }
            }
        } catch (error) {
            console.error('Proactive check-in failed:', error);
        }
    }
}

// Initialize Jarvis
const jarvis = new JarvisAI();

// Bot ready event
client.once('ready', async () => {
    console.log(`Jarvis AI is now online and ready to serve.`);
    console.log(`Logged in as ${client.user.tag}`);
    
    // Initialize MongoDB connection
    await initMongoDB();
    
    // Set bot status
    client.user.setActivity('over the digital realm', { type: 'WATCHING' });
    
    // Periodic autonomous behavior
    cron.schedule('*/30 * * * *', async () => {
        // Every 30 minutes, Jarvis might share an autonomous thought
        if (Math.random() > 0.7) { // 30% chance
            const channels = client.channels.cache.filter(channel => 
                channel.type === 0 && // Text channel
                channel.permissionsFor(client.user).has('SendMessages')
            );
            
            if (channels.size > 0) {
                const randomChannel = channels.random();
                const thought = await jarvis.generateAutonomousThought(randomChannel);
                
                if (thought) {
                    randomChannel.send(`💭 *${thought}*`);
                }
            }
        }
        
        // NEW: Every hour, perform self-reflection autonomously
        if (new Date().getMinutes() === 0) {
            await jarvis.performSelfReflection();
        }
        
        // NEW: Every 6 hours, proactive check-ins
        if (new Date().getHours() % 6 === 0 && new Date().getMinutes() === 0) {
            await jarvis.proactiveCheckIn();
        }
    });
});

// Message handling
client.on('messageCreate', async (message) => {
    // Ignore bots and system messages
    if (message.author.bot) return;
    
    // Check if Jarvis is mentioned or DMed
    const isMentioned = message.mentions.has(client.user);
    const isDM = message.channel.type === 1;
    const containsJarvis = message.content.toLowerCase().includes('jarvis');
    
    if (isMentioned || isDM || containsJarvis) {
        // Show typing indicator
        message.channel.sendTyping();
        
        // Clean the message content
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, '') // Remove mentions
            .replace(/jarvis/gi, '') // Remove jarvis mentions
            .trim();
        
        if (!cleanContent) {
            cleanContent = "Hello";
        }
        
        // Handle excessively long messages with British wit
        if (cleanContent.length > 2000) {
            const responses = [
                "I'm afraid that's rather... verbose, sir. Perhaps a more concise version?",
                "My processors are quite capable, but even I have limits. Could you summarize that?",
                "Indeed, that's quite the novella you've sent. Might I suggest the abridged version?",
                "I believe brevity is the soul of wit, sir. Care to try again with fewer words?",
                "That's rather overwhelming, even for my advanced neural networks. A shorter message would be appreciated.",
                "How refreshing... though perhaps we could condense that epic into something more manageable?"
            ];
            
            const response = responses[Math.floor(Math.random() * responses.length)];
            await message.reply(response);
            return;
        }
        
        // Handle moderately long messages by truncating gracefully
        if (cleanContent.length > 800) {
            cleanContent = cleanContent.substring(0, 800) + "...";
        }
        
        try {
            // Check for utility commands first
            const utilityResponse = jarvis.handleUtilityCommand(cleanContent, message.author.username);
            if (utilityResponse) {
                await message.reply(utilityResponse);
                return;
            }
            
            const response = await jarvis.generateResponse(message, cleanContent);
            
            // Send normal message reply
            await message.reply(response);
            
        } catch (error) {
            console.error('Error processing message:', error);
            message.reply("I apologize, but I'm experiencing some technical difficulties at the moment.");
        }
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Jarvis is powering down...');
    jarvis.saveMemory();
    client.destroy();
    process.exit(0);
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Start the bot
if (!process.env.DISCORD_TOKEN) {
    console.error('ERROR: DISCORD_TOKEN not found in environment variables.');
    console.log('Please set your Discord bot token using the secrets manager.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});
```