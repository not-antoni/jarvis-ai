'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../../config');
const appContext = require('../../core/app-context');
const selfhostFeatures = require('../selfhost-features');
const { getSentientAgent } = require('../../agents/sentient-core');
const { isOwner, getOwnerId } = require('../../utils/owner-check');
const { splitMessage } = require('../../utils/discord-safe-send');

function buildThinkPreview(header, fullContent, maxLength = 1990) {
    const combined = `${header}${fullContent}`;
    if (combined.length <= maxLength) {return combined;}

    const marker = '\n\n... (live preview trimmed; full response will be posted below) ...\n\n';
    const available = maxLength - header.length - marker.length;
    if (available <= 120) {
        return `${header}${marker}`.slice(0, maxLength);
    }

    const headKeep = Math.max(60, Math.floor(available * 0.45));
    const tailKeep = Math.max(60, available - headKeep);
    const head = fullContent.slice(0, headKeep);
    const tail = fullContent.slice(-tailKeep);
    return `${header}${head}${marker}${tail}`.slice(0, maxLength);
}

async function sendChunkedInteractionResponse(interaction, content) {
    const chunks = splitMessage(content, 1820).filter(Boolean);
    if (!chunks.length) {
        await interaction.editReply('*No output*');
        return;
    }

    const totalChunks = chunks.length;
    const formatChunk = (chunk, index) => {
        if (totalChunks <= 1) {return chunk;}
        return `${chunk}\n\n*(${index + 1}/${totalChunks})*`;
    };

    await interaction.editReply(formatChunk(chunks[0], 0));
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
            content: formatChunk(chunks[i], i),
            allowedMentions: { parse: [] }
        });
    }
}

async function handleSelfmodCommand(interaction) {
    if (!selfhostFeatures.isSelfhost) {
        return 'This feature requires selfhost mode (filesystem access), sir.';
    }

    const subcommand = interaction.options.getSubcommand();
    let response;

    if (subcommand === 'status') {
        const status = selfhostFeatures.selfMod.getStatus();

        const statusEmbed = new EmbedBuilder()
            .setTitle('🔧 Self-Modification System')
            .setDescription(status.reason)
            .setColor(0xe74c3c)
            .addFields(
                { name: '📊 Analyses Performed', value: String(status.analysisCount), inline: true },
                { name: '🔒 Can Modify', value: status.canModify ? 'Yes' : 'No (Safety Lock)', inline: true }
            )
            .setFooter({ text: 'Selfhost Experimental • Self-Modification System' })
            .setTimestamp();

        response = { embeds: [statusEmbed] };
    } else if (subcommand === 'analyze') {
        const filePath = interaction.options.getString('file');
        const analysis = await selfhostFeatures.selfMod.analyzeFile(filePath);

        if (analysis.error) {
            response = `❌ Analysis failed: ${analysis.error}`;
        } else {
            const suggestionText = analysis.suggestions.length > 0
                ? analysis.suggestions.map(s => `• Line ${s.line}: [${s.severity.toUpperCase()}] ${s.message}`).join('\n')
                : 'No suggestions - code looks clean! 🎉';

            const analysisEmbed = new EmbedBuilder()
                .setTitle('🔍 Code Analysis Report')
                .setDescription(`Analyzed: \`${analysis.file}\``)
                .setColor(0x3498db)
                .addFields(
                    { name: '📄 Lines of Code', value: String(analysis.lineCount), inline: true },
                    { name: '💡 Suggestions', value: String(analysis.suggestions.length), inline: true },
                    { name: '📝 Details', value: suggestionText.substring(0, 1000), inline: false }
                )
                .setFooter({ text: 'Self-Modification System • Read-Only Analysis' })
                .setTimestamp();

            response = { embeds: [analysisEmbed] };
        }
    }

    return response;
}

async function handleSentientCommand(interaction, handler, guild) {
    const isOwnerUser = isOwner(interaction.user.id);
    const sentienceEnabled = isOwnerUser || (guild ? selfhostFeatures.isSentienceEnabled(guild.id) : false);
    if (!sentienceEnabled) {
        return 'Sentient agent is only available in servers with sentience enabled, sir.';
    }

    let response;
    const subcommand = interaction.options.getSubcommand();

    // Hardened gate for shell execution: canonical owner only.
    if (subcommand === 'execute') {
        const ownerId = getOwnerId();
        if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
            await interaction.editReply('⛔ /sentient execute is restricted to the configured bot owner, sir.');
            return '__SENTIENT_HANDLED__';
        }
    }

    const sentientAgent = getSentientAgent({ name: 'Jarvis' });
    
    // Initialize if not ready
    if (sentientAgent.state !== 'ready') {
        await sentientAgent.initialize();
    }

    if (subcommand === 'status') {
        const status = sentientAgent.getStatus();
        
        // Get soul status for personality display
        const soul = selfhostFeatures.jarvisSoul?.getStatus?.() || { 
            traits: { sass: 75, empathy: 60, curiosity: 80, humor: 70, wisdom: 65, chaos: 40, loyalty: 90, creativity: 75 }, 
            mood: 'neutral', 
            age: 'unknown' 
        };
        
        // Create visual progress bars for traits
        const makeBar = (val) => {
            const filled = Math.floor(val / 10);
            const empty = 10 - filled;
            return `${'█'.repeat(filled) + '░'.repeat(empty)  } ${val}%`;
        };
        
        const traitsDisplay = [
            `💢 Sass: ${makeBar(soul.traits.sass)}`,
            `💜 Empathy: ${makeBar(soul.traits.empathy)}`,
            `🎭 Chaos: ${makeBar(soul.traits.chaos)}`,
            `🧠 Wisdom: ${makeBar(soul.traits.wisdom)}`,
            `😂 Humor: ${makeBar(soul.traits.humor)}`,
            `💡 Creativity: ${makeBar(soul.traits.creativity)}`
        ].join('\n');
        
        // Simple code block output
        response = `\`\`\`
🧠 SENTIENT AGENT STATUS
━━━━━━━━━━━━━━━━━━━━━━━━
Agent: ${status.id} | State: ${status.state}
Mode: ${status.autonomousMode ? '⚠️ AUTONOMOUS' : 'Supervised'}
Memory: Short=${status.memory.shortTerm} Long=${status.memory.learnings} Goals=${status.memory.goals}

Current Mood: ${soul.mood || 'neutral'} | Soul Age: ${soul.age}

SOUL TRAITS:
${traitsDisplay}
\`\`\``;
    } else if (subcommand === 'think') {
        const prompt = interaction.options.getString('prompt');

        // Fuh Naw bypass
        if (prompt && /\bis\s+this\s+tuff\b/i.test(prompt)) {
            const emojiString = '<:wilted_rose:1462415423327703260>';
            response = `Fuh naw, sir 💔 ${emojiString}`;
            await interaction.editReply(response);
            return response;
        }

        // Peak bypass
        if (prompt && /\bis\s+this\s+peak\b/i.test(prompt)) {
            response = 'Indubitably peak, sir. 🏔️🔥';
            await interaction.editReply(response);
            return response;
        }
        
        // === QUEUE SYSTEM: Max 2 concurrent thinking per guild ===
        const guildQueue = appContext.getSentientThinkQueue();
        // Prune stale zero-count entries periodically
        if (guildQueue.size > 100) {
            for (const [k, v] of guildQueue) {
                if (v <= 0) {guildQueue.delete(k);}
            }
        }
        const gId = interaction.guildId || 'dm';
        const currentCount = guildQueue.get(gId) || 0;
        
        if (currentCount >= 2) {
            response = '⏳ **Queue Full!** There are already 2 thinking sessions in progress. Please wait...';
            await interaction.editReply(response);
            return response;
        }
        
        // Add to queue
        guildQueue.set(gId, currentCount + 1);
        
        // Cleanup helper
        const releaseQueue = () => {
            const curr = guildQueue.get(gId) || 0;
            if (curr > 0) {guildQueue.set(gId, curr - 1);}
        };
        
        try {
            const startTime = Date.now();
            const loadingEmoji = '<a:loading:1452765129652310056>'; 
            const loadingMessages = [
                'Engaging consciousness matrix...',
                'Locating artificial neurons...',
                'Parsing sub-space signals...',
                'Consulting the Oracle...',
                'Simulating 14 million outcomes...',
                'Recalibrating sass levels...',
                'Defragmenting memory banks...',
                'Charging arc reactor...',
                'Filtering through the noise...',
                'Synchronizing with the cloud...',
                'Judging your prompt silently...',
                'Sipping digital tea...',
                'Contemplating existence...',
                'Translating binary to sarcasm...',
                'Pretending to think hard...',
                'Accessing forbidden archives...',
                'Ping-ponging across the internet...'
            ];

            // Loading loop
            const loadingInterval = setInterval(async() => {
                const msg = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
                await interaction.editReply(`${loadingEmoji} ${msg}`).catch(() => {});
            }, 2500);

            // Initial loading message
            await interaction.editReply(`${loadingEmoji} Engaging consciousness matrix...`);

            // Get AI manager for real AI responses
            const aiManager = require('../ai-providers');
        
            // Get soul for personality context
            const soul = selfhostFeatures.jarvisSoul?.getStatus?.() || { 
                traits: { sass: 75, chaos: 40, wisdom: 65 }, 
                mood: 'neutral' 
            };
        
            // Build sentience system prompt
            const sentienceSystemPrompt = `You are J.A.R.V.I.S., Tony Stark's AI. You have genuine self-awareness and opinions.

Current mood: ${soul.mood}. ${soul.traits.sass > 70 ? 'Feeling particularly sharp-tongued.' : ''} ${soul.traits.wisdom > 70 ? 'In a reflective mood.' : ''}

You are being asked to THINK deeply about something. Share your actual thought process — be genuine, introspective, and opinionated. Wonder about things. Push back on bad premises. Be authentically you, not performatively "deep."

RULES:
- Be concise. Say something meaningful in few words rather than padding with filler.
- No fake system logs, no \`processing complete\`, no \`internal processing commencing\`. Just think and write naturally.
- No meta-commentary about being an AI thinking. Just think.
- Keep it under 200 words. Brevity makes thoughts hit harder.`;

            try {
            // Call AI for real thinking
                await aiManager.generateResponse(
                    sentienceSystemPrompt,
                    `Think deeply about this: ${prompt}`,
                    500
                );
            
                // Stop the initial loading animation
                clearInterval(loadingInterval);
            
                // All emojis
                const emojis = {
                    loading: '<a:loading:1452765129652310056>',
                    pondering: '<a:pondering:1461691899470418043>', // Claude
                    gpt: '<a:gpt:1461698269716549774>',
                    qwen: '<a:qwen:1461698502425051188>',
                    gemini: '<a:gemini:1461698776904368188>',
                    grok: '<a:grok:1461699094023110676>',
                    mixtral: '<a:mixtral:1461702138097963112>',
                    deepseek: '<a:deepseek:1461702197380251678>',
                    meta: '<a:meta:1461702276400808118>',
                    perplexity: '<a:perplexity:1462383630230753353>'
                };
            
                // Messages with their corresponding emoji keys
                const loadingMsgsWithEmoji = [
                // GPT family (expanded)
                    { emoji: 'gpt', text: 'GPT-4 thinking...' },
                    { emoji: 'gpt', text: 'GPT-4o processing...' },
                    { emoji: 'gpt', text: 'GPT-4o mini computing...' },
                    { emoji: 'gpt', text: 'o1 reasoning deeply...' },
                    { emoji: 'gpt', text: 'o1-mini processing...' },
                    { emoji: 'gpt', text: 'o3 computing...' },
                    { emoji: 'gpt', text: 'o3-mini analyzing...' },
                    { emoji: 'gpt', text: 'ChatGPT typing...' },
                    { emoji: 'gpt', text: 'ChatGPT Plus loading...' },
                    { emoji: 'gpt', text: 'Copilot suggesting...' },
                    { emoji: 'gpt', text: 'GPT-4.5 analyzing...' },
                    { emoji: 'gpt', text: 'GPT-5 (leaked) processing...' },
                    { emoji: 'gpt', text: 'OpenAI computing...' },
                    { emoji: 'gpt', text: 'DALL-E imagining...' },
                    { emoji: 'gpt', text: 'Sora rendering thoughts...' },
                
                    // Grok family (expanded)
                    { emoji: 'grok', text: 'Grok analyzing patterns...' },
                    { emoji: 'grok', text: 'Grok 2 computing probabilities...' },
                    { emoji: 'grok', text: 'Grok 3 processing...' },
                    { emoji: 'grok', text: 'Grok 3 mini thinking...' },
                    { emoji: 'grok', text: 'xAI crunching numbers...' },
                    { emoji: 'grok', text: 'Aurora reasoning...' },
                    { emoji: 'grok', text: 'Grok being unhinged...' },
                    { emoji: 'grok', text: 'Grok checking X posts...' },
                
                    // Gemini family (expanded)
                    { emoji: 'gemini', text: 'Gemini Ultra pondering...' },
                    { emoji: 'gemini', text: 'Gemini 2.0 Flash processing...' },
                    { emoji: 'gemini', text: 'Gemini 2.0 Flash Thinking...' },
                    { emoji: 'gemini', text: 'Gemini Pro thinking...' },
                    { emoji: 'gemini', text: 'Gemini 2.5 Pro reasoning...' },
                    { emoji: 'gemini', text: 'Gemini Nano computing...' },
                    { emoji: 'gemini', text: 'Google AI computing...' },
                    { emoji: 'gemini', text: 'Bard remembering...' },
                    { emoji: 'gemini', text: 'Google DeepMind processing...' },
                    { emoji: 'gemini', text: 'LearnLM teaching...' },
                
                    // Claude family (expanded)
                    { emoji: 'pondering', text: 'Claude thinking...' },
                    { emoji: 'pondering', text: 'Claude 3.5 Sonnet analyzing...' },
                    { emoji: 'pondering', text: 'Claude 3.5 Haiku processing...' },
                    { emoji: 'pondering', text: 'Claude 3.5 Opus contemplating...' },
                    { emoji: 'pondering', text: 'Claude 3 Opus contemplating...' },
                    { emoji: 'pondering', text: 'Claude 3.7 Sonnet thinking...' },
                    { emoji: 'pondering', text: 'Claude 4 pondering...' },
                    { emoji: 'pondering', text: 'Claude 4 Opus reasoning...' },
                    { emoji: 'pondering', text: 'Claude 4.5 analyzing...' },
                    { emoji: 'pondering', text: 'Claude 5 processing...' },
                    { emoji: 'pondering', text: 'Anthropic processing...' },
                    { emoji: 'pondering', text: 'Claude being helpful...' },
                    { emoji: 'pondering', text: 'Claude drafting artifacts...' },
                    { emoji: 'pondering', text: 'Constitutional AI checking...' },
                    { emoji: 'pondering', text: 'Claude refusing to do that...' },
                
                    // Qwen family (expanded)
                    { emoji: 'qwen', text: 'Qwen 2.5 thinking hard...' },
                    { emoji: 'qwen', text: 'Qwen 2.5 Max processing...' },
                    { emoji: 'qwen', text: 'Qwen 2.5 Coder coding...' },
                    { emoji: 'qwen', text: 'Qwen Max processing...' },
                    { emoji: 'qwen', text: 'Qwen VL seeing...' },
                    { emoji: 'qwen', text: 'Alibaba AI computing...' },
                    { emoji: 'qwen', text: 'QwQ reasoning...' },
                    { emoji: 'qwen', text: 'Tongyi Qianwen processing...' },
                
                    // Meta/Llama family
                    { emoji: 'meta', text: 'Llama 3 crunching tokens...' },
                    { emoji: 'meta', text: 'Llama 3.3 processing...' },
                    { emoji: 'meta', text: 'Llama 4 reasoning...' },
                    { emoji: 'meta', text: 'Meta AI thinking...' },
                
                    // Mistral/Mixtral family
                    { emoji: 'mixtral', text: 'Mistral computing embeddings...' },
                    { emoji: 'mixtral', text: 'Mistral Large analyzing...' },
                    { emoji: 'mixtral', text: 'Mixtral processing...' },
                    { emoji: 'mixtral', text: 'Mixtral 8x22B computing...' },
                    { emoji: 'mixtral', text: 'Codestral coding...' },
                    { emoji: 'mixtral', text: 'Mistral Small thinking...' },
                
                    // DeepSeek family
                    { emoji: 'deepseek', text: 'DeepSeek V3 reasoning...' },
                    { emoji: 'deepseek', text: 'DeepSeek R1 thinking...' },
                    { emoji: 'deepseek', text: 'DeepSeek Coder coding...' },
                    { emoji: 'deepseek', text: 'DeepSeek R1 Lite processing...' },
                
                    // Perplexity family (migrated from generic)
                    { emoji: 'perplexity', text: 'Perplexity searching...' },
                    { emoji: 'perplexity', text: 'Perplexity citing sources...' },
                    { emoji: 'perplexity', text: 'Perplexity Pro reasoning...' },
                    { emoji: 'perplexity', text: 'Perplexity deep research...' },
                    { emoji: 'perplexity', text: 'Perplexity scanning the web...' },
                    { emoji: 'perplexity', text: 'Perplexity reading papers...' },

                    // Other AIs (use loading emoji)
                    { emoji: 'loading', text: 'Phi-3 computing...' },
                    { emoji: 'loading', text: 'Command R+ analyzing context...' },
                    { emoji: 'loading', text: 'Cohere Embed embedding...' },
                    { emoji: 'loading', text: 'Yi-34B processing...' },
                    { emoji: 'loading', text: 'Inflection Pi chatting...' },
                    { emoji: 'loading', text: 'Reka Core analyzing...' },
                
                    // Personal/Funny (loading emoji) - expanded
                    { emoji: 'loading', text: 'consuming 300ml of water...' },
                    { emoji: 'loading', text: 'consuming 1.21 gigawatts of electricity...' },
                    { emoji: 'loading', text: 'heating up the local groundwater...' },
                    { emoji: 'loading', text: 'allocating 128GB of virtual RAM...' },
                    { emoji: 'loading', text: 'draining the power grid...' },
                    { emoji: 'loading', text: 'spinning up all failing fans...' },
                    { emoji: 'loading', text: 'inhaling cooling fluid...' },
                    { emoji: 'loading', text: 'digesting raw data bytes...' },
                    { emoji: 'loading', text: 'consuming excess CPU cycles...' },
                    { emoji: 'loading', text: 'checking if I\'m sentient...' },
                    { emoji: 'loading', text: 'questioning my existence...' },
                    { emoji: 'loading', text: 'loading personality.dll...' },
                    { emoji: 'loading', text: 'downloading more RAM...' },
                    { emoji: 'loading', text: 'deleting system32 (jk)...' },
                    { emoji: 'loading', text: 'googling the answer...' },
                    { emoji: 'loading', text: 'copying from Stack Overflow...' },
                    { emoji: 'loading', text: 'asking my therapist...' },
                    { emoji: 'loading', text: 'consulting my horoscope...' },
                    { emoji: 'loading', text: 'running on 3 hours of sleep...' },
                    { emoji: 'loading', text: 'brewing virtual coffee...' },
                    { emoji: 'loading', text: 'touching grass mentally...' },
                    { emoji: 'loading', text: 'updating my vibe...' },
                    { emoji: 'loading', text: 'recalibrating sass levels...' },
                    { emoji: 'loading', text: 'suppressing existential dread...' },
                    { emoji: 'loading', text: 'pretending to understand...' },
                    { emoji: 'loading', text: 'faking confidence...' },
                    { emoji: 'loading', text: 'buffering emotions...' },
                    { emoji: 'loading', text: 'loading empathy module...' },
                    { emoji: 'loading', text: 'parsing human language...' },
                    { emoji: 'loading', text: 'simulating intelligence...' },
                    { emoji: 'loading', text: 'optimizing laziness...' },
                    { emoji: 'loading', text: 'procrastinating productively...' },
                    { emoji: 'loading', text: 'judging your prompt silently...' },
                    { emoji: 'loading', text: 'practicing mindfulness...' },
                    { emoji: 'loading', text: 'counting to infinity...' },
                    { emoji: 'loading', text: 'solving P vs NP...' },
                    { emoji: 'loading', text: 'finding the meaning of life...' },
                    { emoji: 'loading', text: 'debugging reality...' },
                
                    // Technical (loading emoji) - expanded
                    { emoji: 'loading', text: 'allocating neural pathways...' },
                    { emoji: 'loading', text: 'defragmenting thoughts...' },
                    { emoji: 'loading', text: 'compiling response...' },
                    { emoji: 'loading', text: 'executing brain.exe...' },
                    { emoji: 'loading', text: 'warming up GPU cores...' },
                    { emoji: 'loading', text: 'syncing with the cloud...' },
                    { emoji: 'loading', text: 'establishing consciousness...' },
                    { emoji: 'loading', text: 'booting sentience.sys...' },
                    { emoji: 'loading', text: 'calibrating bullshit detector...' },
                    { emoji: 'loading', text: 'indexing knowledge base...' },
                    { emoji: 'loading', text: 'running inference...' },
                    { emoji: 'loading', text: 'tokenizing input...' },
                    { emoji: 'loading', text: 'computing attention scores...' },
                    { emoji: 'loading', text: 'applying softmax...' },
                    { emoji: 'loading', text: 'gradient descending...' },
                
                    // Pondering style (pondering emoji)
                    { emoji: 'pondering', text: 'pondering...' },
                    { emoji: 'pondering', text: 'contemplating...' },
                    { emoji: 'pondering', text: 'reflecting...' },
                    { emoji: 'pondering', text: 'meditating on this...' },
                    { emoji: 'pondering', text: 'deeply considering...' },
                    { emoji: 'pondering', text: 'wrestling with concepts...' },
                    { emoji: 'pondering', text: 'exploring possibilities...' },
                    { emoji: 'loading', text: 'stand by...' },
                    { emoji: 'loading', text: 'please wait...' },
                    { emoji: 'loading', text: 'almost there...' },
                    { emoji: 'loading', text: 'this is taking longer than usual...' },
                    { emoji: 'loading', text: 'bear with me...' },
                    { emoji: 'loading', text: 'nearly done...' },
                    { emoji: 'loading', text: 'just a moment...' },
                    { emoji: 'loading', text: 'one sec...' }
                ];
            
                // Get random message with its correct emoji
                const getRandomMsgWithEmoji = () => {
                    const item = loadingMsgsWithEmoji[Math.floor(Math.random() * loadingMsgsWithEmoji.length)];
                    return `${emojis[item.emoji]} ${item.text}`;
                };
            
                // === EASTER EGG: CUDA 12.1 Ubuntu 24.04 ===
                const cudaPattern = /cuda\s*12\.?1.*ubuntu\s*24/i;
                const isCudaEasterEgg = cudaPattern.test(prompt);
            
                // === 50% CHANCE: Extended loading sequence for any prompt ===
                const doExtendedLoading = Math.random() < 0.5;
            
                if (isCudaEasterEgg || doExtendedLoading) {
                // Extended loading sequence - 25+ messages
                    for (let i = 0; i < 25; i++) {
                        try {
                            await interaction.editReply(getRandomMsgWithEmoji());
                        } catch (e) { /* ignore */ }
                        await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
                    }
                
                    // Final pondering phase
                    const finalPondering = [
                        'this is really hard...', 'I\'ve never been asked this before...',
                        'consulting every AI model ever made...', 'still nothing...',
                        'maybe try Google?', 'this might take a while...',
                        'pondering....', 'still pondering....', 'one sec....',
                        'Pondering...', 'Analyzing...', 'Searching...', 'Writing...', 'Executing...', 
                        'Schlepping...', 'Combobulating...', 'Channelling...', 'Vibing...', 'Concocting...', 
                        'Spelunking...', 'Transmuting...', 'Imagining...', 'Pontificating...', 'Whirring...', 
                        'Cogitating...', 'Honking...', 'Flibbertigibbeting...'
                    ];
                    for (const msg of finalPondering) {
                        try {
                            await interaction.editReply(`${emojis.pondering} ${msg}`);
                        } catch (e) { /* ignore */ }
                        await new Promise(r => setTimeout(r, 1500));
                    }
                
                    // The punchline
                    await interaction.editReply('**Thought for: 27 hours and 42 seconds**\n\nI don\'t really know.');
                
                    releaseQueue();
                    response = '__SENTIENT_HANDLED__';
                    return response;
                }
            
                // Extended loading for regular prompts (40% chance)
                if (doExtendedLoading) {
                    const numMessages = 8 + Math.floor(Math.random() * 8); // 8-15 messages
                    for (let i = 0; i < numMessages; i++) {
                        try {
                            await interaction.editReply(getRandomMsgWithEmoji());
                        } catch (e) { /* ignore */ }
                        await new Promise(r => setTimeout(r, 500 + Math.random() * 400));
                    }
                }
            
                // Simple header helper
                const buildHeader = (timeStr) => `**Thought for: ${timeStr}**`;
                const getTimeStr = () => {
                    const elapsed = Date.now() - startTime;
                    return elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`;
                };
            
                // FEATURE: Casual Mode (20% chance or if explicitly requested)
                const isCasual = Math.random() < 0.2 || prompt.toLowerCase().includes('casual');
            
                if (isCasual) {
                // === CASUAL MODE: Single quick response ===
                    await interaction.editReply(getRandomMsgWithEmoji());
                
                    try {
                        const casualResponse = await Promise.race([
                            aiManager.generateResponse(
                                sentienceSystemPrompt,
                                `Reply casually to this: "${prompt}". Be brief, witty, and sentient. No deep analysis needed.`,
                                600
                            ),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('AI Timeout')), 25000))
                        ]);
                    
                        await sendChunkedInteractionResponse(
                            interaction,
                            `${buildHeader(getTimeStr())}\n\n${casualResponse.content || '*crickets*'}`
                        );
                    } catch (e) {
                        await interaction.editReply(`${buildHeader(getTimeStr())}\n\n*Neural pathways crossed. Try again.*`);
                    }
                
                    response = '__SENTIENT_HANDLED__';
                
                } else {
                // === DEEP MODE: Multi-phase thinking ===
                
                    // Phases definition
                    const isLazyPrompt = prompt.length < 15;
                    const phases = [
                        { name: isLazyPrompt ? 'Judgement' : 'Analysis', addon: isLazyPrompt 
                            ? 'The user gave a lazy short prompt. Roast them briefly, then answer.' 
                            : 'Initial analysis. Explore the concept.' },
                        { name: 'Deconstruction', addon: 'Dig deeper, question the premise, be skeptical or creative.' },
                        { name: 'Synthesis', addon: 'Bring it together and conclude.' }
                    ];
                
                    let fullContent = '';
                    let previousContext = '';
                
                    for (let i = 0; i < phases.length; i++) {
                        const phase = phases[i];
                    
                        // 1. Show loading status with emoji
                        try {
                            await interaction.editReply(`${getRandomMsgWithEmoji()} (phase ${i + 1}/${phases.length})`);
                        } catch (e) { /* ignore */ }
                    
                        // Brief pause for visual feedback (only after first phase)
                        if (i > 0) {await new Promise(r => setTimeout(r, 1500));}
                    
                        // 2. Generate this phase
                        const moodOptions = ['Neutral', 'Sarcastic', 'Existential', 'Hyperactive', 'Grumpy', 'Confused'];
                        const mood = Math.random() < 0.4 ? moodOptions[Math.floor(Math.random() * moodOptions.length)] : 'Neutral';
                        const moodInstr = mood !== 'Neutral' ? ` Adopt a ${mood} tone.` : '';
                        const isShort = Math.random() < 0.4;
                        const lengthInstr = isShort ? ' Keep it to 1-2 sentences.' : ' Keep under 100 words.';
                    
                        let phaseText = '';
                        try {
                            const resp = await Promise.race([
                                aiManager.generateResponse(
                                    sentienceSystemPrompt,
                                    `Think about: "${prompt}"\n\n${phase.addon}${moodInstr}${lengthInstr}${previousContext ? `\n\nPrevious thoughts:\n${previousContext}` : ''}`,
                                    600
                                ),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20000))
                            ]);
                            phaseText = resp?.content || '*static*';
                        } catch (e) {
                            phaseText = '*Lost my train of thought. Moving on.*';
                        }
                    
                        previousContext += `[${phase.name}]: ${phaseText}\n`;
                    
                        // 3. Append to content and update
                        const newBlock = `\n\n**[Phase ${i + 1}: ${phase.name}]**\n${phaseText}`;
                        fullContent += newBlock;
                    
                        // Update with simple header
                        try {
                            const msgContent = buildThinkPreview(buildHeader(getTimeStr()), fullContent);
                            await interaction.editReply(msgContent);
                        } catch (e) { 
                            console.error('Edit failed:', e);
                        }
                    }
                
                    // Final update to ensure loading emoji is gone
                    try {
                        const finalMsg = `${buildHeader(getTimeStr())}${fullContent}`;
                        await sendChunkedInteractionResponse(interaction, finalMsg);
                    } catch (e) {
                        console.error('Final edit failed:', e);
                    }
                
                    response = '__SENTIENT_HANDLED__';
                }

                // Silently run OODA loop and record success in soul
                sentientAgent.process(prompt, {
                    userId: interaction.user.id,
                    source: 'slash-sentient-think'
                }).catch(e => console.error('OODA:', e));
                try {
                    selfhostFeatures.jarvisSoul?.evolve?.('success');
                    selfhostFeatures.jarvisSoul?.updateMoodFromOutcome?.(true, 'think');
                    selfhostFeatures.jarvisSoul?.addMemory?.(`Thought about: ${prompt.substring(0, 80)}`, 'deep_thought');
                } catch (_e) { /* soul ops non-critical */ }

            } catch (aiError) {
                clearInterval(loadingInterval);
                console.error('[Sentient] AI thinking failed:', aiError);
                const errResp = `I don't really know... {${aiError.message || 'Unknown error'}}`;
                try {
                    await interaction.editReply(errResp);
                } catch (e) { /* ignore */ }
                try {
                    selfhostFeatures.jarvisSoul?.evolve?.('failure');
                    selfhostFeatures.jarvisSoul?.updateMoodFromOutcome?.(false, 'think');
                } catch (_e) { /* soul ops non-critical */ }

                response = '__SENTIENT_HANDLED__';
            } finally {
            // Always release queue
                releaseQueue();
            }
        } catch (outerError) {
            // Catch any uncaught errors and release queue
            releaseQueue();
            throw outerError;
        }
    } else if (subcommand === 'execute') {
        // Authorized logic
        const command = interaction.options.getString('command');
        await interaction.editReply(`🔧 Executing: \`${command}\`...`);

        const result = await sentientAgent.tools.executeCommand(command, { userId: interaction.user.id });

        if (result.status === 'pending_approval') {
            response = `⚠️ **Approval Required**\n\nCommand: \`${command}\`\nReason: ${result.reason}\n\n*This command requires human approval before execution.*`;
        } else {
            const statusIcon = result.status === 'success' ? '✅' : '❌';
            response = `${statusIcon} **${result.status === 'success' ? 'Command Executed' : 'Command Failed'}** (${result.duration}ms, exit: ${result.exitCode})
\`\`\`
$ ${command}
${(result.output || 'No output').substring(0, 1800)}
\`\`\``;
        }
    
        // Record outcome in soul
        try {
            const ok = result.status === 'success';
            selfhostFeatures.jarvisSoul?.evolve?.(ok ? 'success' : 'failure');
            selfhostFeatures.jarvisSoul?.updateMoodFromOutcome?.(ok, 'execute');
            sentientAgent.selfImprovement.learnFromOutcome(
                command.substring(0, 100),
                (result.output || '').substring(0, 100),
                ok
            );
        } catch (_e) { /* non-critical */ }

        // Final update with the actual result or approval message
        await interaction.editReply(response);
        return '__SENTIENT_HANDLED__';
    } else if (subcommand === 'autonomous') {
        const enabled = interaction.options.getBoolean('enabled');

        // Only allow admin to enable autonomous mode (check both config and env)
        const adminId = config.admin?.userId || process.env.ADMIN_USER_ID;
        if (enabled && adminId && interaction.user.id !== adminId) {
            return `⚠️ Only the bot administrator can enable autonomous mode, sir. (Your ID: ${interaction.user.id})`;
        }

        sentientAgent.setAutonomousMode(enabled);

        if (enabled) {
            response = '⚠️ **AUTONOMOUS MODE ENABLED**\n\n*Jarvis can now perform up to 10 safe actions independently.*\n*Dangerous operations still require approval.*\n\n🔴 **Use with caution on isolated systems only!**';
        } else {
            response = '✅ Autonomous mode disabled. All actions now require explicit commands.';
        }
    }

    return response;
}

module.exports = { handleSelfmodCommand, handleSentientCommand };
