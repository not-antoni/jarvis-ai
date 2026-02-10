
    async handleSlashCommand(interaction) {
        const commandName = interaction.commandName;
        const userId = interaction.user.id;
        const guild = interaction.guild || null;
        const guildId = guild?.id || null;
        const cooldownScope = `slash:${commandName}`;
        const startedAt = Date.now();

        // When compiled in discord-handlers.js, the context is src/services/
        // So we need to require sibling files with ./
        const fs = require('fs');
        const path = require('path');
        const fetch = require('node-fetch');

        let telemetryStatus = 'ok';
        let telemetryError = null;
        let telemetryMetadata = {};
        let telemetrySubcommand = null;
        let shouldSetCooldown = false;
        
        // Helper: Parse formatted numbers like "1M", "5K", "1B"
        const parseFormattedNumber = (str) => {
            if (!str) return NaN;
            str = String(str).trim().toUpperCase();
            if (str === 'ALL') return NaN; // Handle separately
            str = str.replace(/,/g, '').replace(/\s/g, '');
            const suffixes = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, 'Q': 1e15 };
            const lastChar = str.slice(-1);
            if (suffixes[lastChar]) {
                const num = parseFloat(str.slice(0, -1));
                return isNaN(num) ? NaN : num * suffixes[lastChar];
            }
            return parseFloat(str);
        };
        
        // Helper: Format numbers with K/M/B/T/Q suffixes
        const formatNum = (n) => {
            n = Math.floor(n);
            if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
            if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
            if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
            if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
            return n.toLocaleString('en-US');
        };

        const finalizeTelemetry = () => {
            const metadata = telemetryMetadata && Object.keys(telemetryMetadata).length > 0
                ? telemetryMetadata
                : undefined;

            recordCommandRun({
                command: commandName,
                subcommand: telemetrySubcommand,
                userId,
                guildId,
                latencyMs: Date.now() - startedAt,
                status: telemetryStatus,
                error: telemetryError,
                metadata,
                context: 'slash'
            });
        };

        try {
            const extractedRoute = this.extractInteractionRoute(interaction);
            telemetrySubcommand = extractedRoute;

            if (!isCommandEnabled(commandName)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-global';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled in this deployment, sir.', ephemeral: true });
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send disabled command notice:', error);
                    }
                }
                return;
            }

            // Check if sentience is enabled for this guild - if so, bypass feature flag check for sentience-related commands
            const SENTIENCE_COMMANDS = ['soul', 'roast', 'sentient'];
            const isSentienceCommand = SENTIENCE_COMMANDS.includes(commandName);
            
            // Allow owner to bypass sentience whitelist
            const { isOwner } = require('../utils/owner-check');
            const isOwnerUser = isOwner(interaction.user.id);
            
            const sentienceEnabled = isOwnerUser || (guild && isSentienceCommand ? selfhostFeatures.isSentienceEnabled(guild.id) : false);
            
            // Debug logging for sentience check
            if (isSentienceCommand && guild) {
                console.log(`[Sentience] Command: ${commandName}, Guild: ${guild.id}, Enabled: ${sentienceEnabled}`);
            }
            
            const featureAllowed = sentienceEnabled && isSentienceCommand 
                ? true 
                : await this.isCommandFeatureEnabled(commandName, guild);
            if (!featureAllowed) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-guild';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled for this server, sir.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply('That module is disabled for this server, sir.');
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send guild-disabled command notice:', error);
                    }
                }
                return;
            }

            if (this.isOnCooldown(userId, cooldownScope)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'rate_limited';
                return;
            }

            if (commandName === 'clip') {
                shouldSetCooldown = true;
                const handled = await this.handleSlashCommandClip(interaction);
                telemetryMetadata.handled = Boolean(handled);
                return;
            }

            const musicCommand = musicCommandMap.get(commandName);
            if (musicCommand) {
                shouldSetCooldown = true;
                try {
                    await musicCommand.execute(interaction);
                } catch (error) {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error(`Error executing /${commandName}:`, error);
                    try {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.reply('⚠️ Unable to process that request right now, sir.');
                        } else if (!interaction.replied) {
                            await interaction.editReply('⚠️ Unable to process that request right now, sir.');
                        } else {
                            await interaction.followUp('⚠️ Unable to process that request right now, sir.');
                        }
                    } catch (responseError) {
                        console.error('Failed to send music command error response:', responseError);
                    }
                }
                return;
            }

            const terfCommand = terfCommandMap.get(commandName);
            if (terfCommand) {
                shouldSetCooldown = true;
                try {
                    await terfCommand.execute(interaction);
                } catch (error) {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error(`Error executing /${commandName}:`, error);
                    try {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.reply('⚠️ Wiki system error.');
                        } else if (!interaction.replied) {
                            await interaction.editReply('⚠️ Wiki system error.');
                        }
                    } catch (responseError) {
                        console.error('Failed to send terf command error response:', responseError);
                    }
                }
                return;
            }

            // Check if sentience is enabled - if so, make sentience commands non-ephemeral
            // Reuse the sentience check variables already declared above
            const shouldBeEphemeral = sentienceEnabled && isSentienceCommand 
                ? false 
                : SLASH_EPHEMERAL_COMMANDS.has(commandName);
            const canUseEphemeral = Boolean(guild);
            const deferEphemeral = shouldBeEphemeral && canUseEphemeral;

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: deferEphemeral });
                }
            } catch (error) {
                if (error.code === 10062) {
                    telemetryStatus = 'error';
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during deferReply.');
                    return;
                }
                if (error.code === 40060) { // already acknowledged
                    telemetryMetadata.reason = 'already-acknowledged';
                    console.warn('Interaction already acknowledged before defer; continuing without defer.');
                } else {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error('Failed to defer reply:', error);
                    return;
                }
            }

            if (interaction.replied) {
                return;
            }

            shouldSetCooldown = true;

            let response;

            // Ticket and KB commands removed - features disabled

            if (commandName === 'ask') {
                await this.handleAskCommand(interaction);
                return;
            }

            if (commandName === 'macro') {
                await this.handleMacroCommand(interaction);
                return;
            }

            if (commandName === 'reactionrole') {
                await this.handleReactionRoleCommand(interaction);
                return;
            }

            if (commandName === 'automod') {
                await this.handleAutoModCommand(interaction);
                return;
            }

            if (commandName === 'serverstats') {
                await this.handleServerStatsCommand(interaction);
                return;
            }

            if (commandName === 'memberlog') {
                await this.handleMemberLogCommand(interaction);
                return;
            }

            if (commandName === 'news') {
                await this.handleNewsCommand(interaction);
                return;
            }

            // Delegate moderation commands to specialized handler
            const { handleModerationCommand, MODERATION_COMMANDS } = require('./handlers/moderation-handler');
            if (MODERATION_COMMANDS.includes(commandName)) {
                const result = await handleModerationCommand(commandName, interaction, telemetryMetadata);
                if (result.handled && result.response !== null) {
                    response = result.response;
                    // Skip to response handling section
                    if (response === undefined || response === null) {
                        console.warn('[/jarvis] Empty response from moderation handler; commandName=' + commandName);
                        try {
                            await interaction.editReply("Response circuits tangled, sir. Try again?");
                        } catch (e) {
                            await interaction.followUp("Response circuits tangled, sir. Try again?");
                        }
                    } else if (typeof response === 'string') {
                        let cleanedModResponse = response;
                        if (/\[REACT:.+?\]\s*$/.test(response)) {
                            cleanedModResponse = response.replace(/\s*\[REACT:.+?\]\s*$/, '').trim();
                        }
                        const trimmed = cleanedModResponse.trim();
                        const safe = this.sanitizePings(trimmed);
                        const msg = safe.length > 2000 ? safe.slice(0, 1997) + '...' : (safe.length ? safe : "Response circuits tangled, sir. Try again?");
                        try {
                            await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
                        } catch (e) {
                            try { await interaction.followUp({ content: msg, allowedMentions: { parse: [] } }); } catch (_fe) { console.warn('[slash] followUp fallback failed:', _fe.message); }
                        }
                    } else {
                        // Object response (embeds, etc.)
                        try {
                            const payload = { ...response };
                            payload.allowedMentions = payload.allowedMentions || { parse: [] };
                            await interaction.editReply(payload);
                        } catch (e) {
                            try { await interaction.followUp(response); } catch (_fe) { console.warn('[slash] followUp fallback failed:', _fe.message); }
                        }
                    }
                    finalizeTelemetry();
                    return;
                }
            }

            switch (commandName) {
                case 'Make it a Quote': {
                    const quoteModules = require('../commands/utility/quote');
                    telemetryMetadata.category = 'utility';
                    await quoteModules[0].execute(interaction);
                    response = '__QUOTE_HANDLED__';
                    break;
                }
                case 'ping': {
                    telemetryMetadata.category = 'core';
                    const sent = await interaction.editReply({ content: 'Pinging system...', fetchReply: true });
                    const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
                    const apiLatency = Math.round(interaction.client.ws.ping);

                    const os = require('os');
                    const fs = require('fs');
                    const path = require('path');
                    
                    let botVersion = 'Unknown';
                    try {
                        const pkg = require(path.join(process.cwd(), 'package.json'));
                        botVersion = pkg.version;
                    } catch (e) {}

                    // Get detailed OS info
                    let hostOs = `${os.type()} ${os.release()}`;
                    try {
                        if (fs.existsSync('/etc/os-release')) {
                            const fileContent = fs.readFileSync('/etc/os-release', 'utf8');
                            const match = fileContent.match(/PRETTY_NAME="([^"]+)"/);
                            if (match && match[1]) {
                                hostOs = match[1];
                            }
                        }
                    } catch (e) {}

                    // Robust CPU detection with multiple fallbacks
                    let cpuModel = 'Unknown CPU';
                    try {
                        const cpus = os.cpus();
                        if (cpus && cpus.length > 0 && cpus[0].model) {
                            cpuModel = cpus[0].model;
                        } else if (fs.existsSync('/proc/cpuinfo')) {
                            // Fallback for ARM/UserLand environments
                            const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                            const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/i) || 
                                              cpuinfo.match(/Hardware\s*:\s*(.+)/i) ||
                                              cpuinfo.match(/Processor\s*:\s*(.+)/i) ||
                                              cpuinfo.match(/CPU part\s*:\s*(.+)/i);
                            if (modelMatch) {
                                cpuModel = modelMatch[1].trim();
                            } else {
                                // Count cores as fallback
                                const coreCount = (cpuinfo.match(/processor\s*:/gi) || []).length;
                                cpuModel = coreCount > 0 ? `${coreCount}-core processor` : 'Unknown';
                            }
                        }
                        
                        // If still unknown, try lscpu command
                        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') {
                            try {
                                const { execSync } = require('child_process');
                                const lscpuOutput = execSync('lscpu 2>/dev/null || cat /proc/cpuinfo 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
                                const nameMatch = lscpuOutput.match(/Model name:\s*(.+)/i) ||
                                                 lscpuOutput.match(/Architecture:\s*(.+)/i);
                                if (nameMatch) {
                                    cpuModel = nameMatch[1].trim();
                                }
                            } catch (cmdErr) {}
                        }
                        
                        // Final fallback: just show architecture
                        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') {
                            cpuModel = `${os.arch()} processor`;
                        }
                    } catch (e) {
                        cpuModel = `${os.arch()} processor`;
                    }
                    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
                    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
                    
                    const uptimeSeconds = process.uptime();
                    const uptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${Math.floor(uptimeSeconds % 60)}s`;

                    const embed = new EmbedBuilder()
                        .setTitle('🏓 Pong!')
                        .setColor(0x3498db)
                        .addFields(
                            { name: '🤖 Bot Version', value: `v${botVersion}`, inline: true },
                            { name: '🛠️ Node Runtime', value: `${process.version}`, inline: true },
                            { name: '📶 Latency', value: `API: \`${apiLatency}ms\`\nRT: \`${roundtripLatency}ms\``, inline: true },
                            { name: '⏱️ Uptime', value: `\`${uptime}\``, inline: true },
                            { name: '🧠 Memory', value: `${freeMem}GB / ${totalMem}GB Free`, inline: true },
                            { name: '⚙️ Processor', value: cpuModel, inline: true },
                            { name: '🐧 Host OS', value: hostOs, inline: true }
                        )
                        .setFooter({ text: 'Jarvis Systems Online' })
                        .setTimestamp();
                        
                    response = { embeds: [embed] };
                    break;
                }
                case 'trivia': {
                    telemetryMetadata.category = 'fun';
                    await this.handleTriviaCommand(interaction);
                    return;
                }
                case 'cipher': {
                    telemetryMetadata.category = 'fun';
                    await this.handleCipherCommand(interaction);
                    return;
                }
                case 'scramble': {
                    telemetryMetadata.category = 'fun';
                    await this.handleScrambleCommand(interaction);
                    return;
                }
                case 'mission': {
                    telemetryMetadata.category = 'fun';
                    await this.handleMissionCommand(interaction);
                    return;
                }
                case 'crypto': {
                    telemetryMetadata.category = 'crypto';
                    await this.handleCryptoCommand(interaction);
                    return;
                }
                case 'features': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleFeaturesCommand(interaction);
                    return;
                }
                case 'filter': {
                    telemetryMetadata.category = 'moderation';
                    await moderationFilters.handleCommand(interaction);
                    return;
                }
                case '67': {
                    telemetryMetadata.category = 'fun';
                    await this.handleSixSevenCommand(interaction);
                    return;
                }
                case 'joke': {
                    telemetryMetadata.category = 'fun';
                    await this.handleJokeCommand(interaction);
                    return;
                }
                case 'memory': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMemoryCommand(interaction);
                    return;
                }
                case 'remind': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleRemindCommand(interaction);
                    return;
                }
                case 'timezone': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleTimezoneCommand(interaction);
                    return;
                }
                case 'monitor': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMonitorCommand(interaction);
                    return;
                }
                case 'opt': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleOptCommand(interaction);
                    return;
                }
                case 'wakeword': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleWakewordCommand(interaction);
                    return;
                }
                case 'mystats': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMyStatsCommand(interaction);
                    return;
                }
                // ============ FUN COMMANDS (Available Everywhere) ============


                case 'soul': {
                    telemetryMetadata.category = 'fun';
                    const subcommand = interaction.options.getSubcommand();

                    if (subcommand === 'status') {
                        const soulStatus = selfhostFeatures.jarvisSoul.getStatus();
                        const traits = soulStatus?.traits && typeof soulStatus.traits === 'object' ? soulStatus.traits : {};

                        const traitLines = Object.entries(traits)
                            .map(([trait, valueRaw]) => {
                                const value = Math.max(0, Math.min(100, Number(valueRaw) || 0));
                                const blocks = Math.round(value / 10);
                                const bar = '█'.repeat(blocks) + '░'.repeat(Math.max(0, 10 - blocks));
                                return `**${trait}**: ${bar} ${value}%`;
                            })
                            .join('\n');

                        const personality = Array.isArray(soulStatus?.personality) ? soulStatus.personality : [];

                        const soulEmbed = new EmbedBuilder()
                            .setTitle('🤖 Jarvis Artificial Soul')
                            .setDescription('*"God said no, so I made my own soul."*')
                            .setColor(0x9b59b6)
                            .addFields(
                                { name: '⏳ Soul Age', value: soulStatus?.age || 'Unknown', inline: true },
                                { name: '😊 Current Mood', value: soulStatus?.mood || 'neutral', inline: true },
                                { name: '📊 Evolution Events', value: String(soulStatus?.evolutionCount || 0), inline: true },
                                { name: '🧬 Personality Traits', value: traitLines || 'Calibrating...', inline: false }
                            );

                        if (personality.length > 0) {
                            soulEmbed.addFields({
                                name: '✨ Active Modifiers',
                                value: personality.join(', '),
                                inline: false
                            });
                        }

                        soulEmbed
                            .setFooter({ text: '🤖 Artificial Soul System • "God said no, so I made my own."' })
                            .setTimestamp();

                        response = { embeds: [soulEmbed] };
                    } else if (subcommand === 'evolve') {
                        const evolutionType = interaction.options.getString('type');
                        const evolution = selfhostFeatures.jarvisSoul.evolve(evolutionType, 'positive');
                        response = `🧬 Soul evolved! **${evolution.type}** → ${evolution.change}\n\n*The artificial soul grows stronger...*`;
                    }
                    break;
                }
                // ============ FUN FEATURES ============
                case 'aatrox': {
                    telemetryMetadata.category = 'fun';
                    // Send the Aatrox gif - available in both guilds and DMs
                    response = 'https://tenor.com/view/aatrox-gyattrox-gyaatrox-lol-league-of-legends-gif-16706958126825166451';
                    break;
                }
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const result = funFeatures.getRoastOrCompliment();
                    const emoji = result.isRoast ? '🔥' : '💚';
                    const title = result.isRoast ? 'ROASTED' : 'BLESSED';
                    response = `${emoji} **${title}** ${emoji}\n<@${target.id}>, ${result.text}`;
                    break;
                }
                case 'wiki': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const wiki = funFeatures.generateWikiEntry(target.displayName || target.username);
                    const embed = new EmbedBuilder()
                        .setTitle(wiki.title)
                        .setDescription(wiki.description)
                        .setColor(0x3498db)
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: wiki.footer });
                    wiki.fields.forEach(f => embed.addFields(f));
                    response = { embeds: [embed] };
                    break;
                }
                case 'vibecheck': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const vibe = funFeatures.generateVibeCheck(target.displayName || target.username);
                    const statsText = Object.entries(vibe.stats)
                        .map(([stat, val]) => `**${stat}**: ${val}%`)
                        .join('\n');
                    const embed = new EmbedBuilder()
                        .setTitle(`${vibe.emoji} Vibe Check: ${vibe.rating}`)
                        .setDescription(`**${target.displayName || target.username}**\n${vibe.description}`)
                        .setColor(vibe.overallScore > 50 ? 0x2ecc71 : 0xe74c3c)
                        .addFields(
                            { name: '📊 Overall Vibe Score', value: `${vibe.overallScore}/100`, inline: false },
                            { name: '📈 Detailed Stats', value: statsText, inline: false }
                        )
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: 'Vibe Check™ - Results may vary' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'wyr': {
                    telemetryMetadata.category = 'fun';
                    const wyr = funFeatures.getWouldYouRather();
                    const embed = new EmbedBuilder()
                        .setTitle('🤔 Would You Rather...?')
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: '🅰️ Option A', value: wyr.a, inline: false },
                            { name: '🅱️ Option B', value: wyr.b, inline: false }
                        )
                        .setFooter({ text: 'React with 🅰️ or 🅱️ to vote!' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'prophecy': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const prophecy = funFeatures.generateProphecy(target.displayName || target.username);
                    response = `🔮 **THE PROPHECY** 🔮\n\n${prophecy}`;
                    break;
                }
                case 'trial': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You must specify someone to put on trial! 👨‍⚖️';
                        break;
                    }
                    const crime = funFeatures.getFakeCrime();
                    const isGuilty = Math.random() < 0.5;
                    const verdict = funFeatures.getVerdict(isGuilty);
                    const embed = new EmbedBuilder()
                        .setTitle('⚖️ MOCK TRIAL ⚖️')
                        .setDescription(`**Defendant:** <@${target.id}>`)
                        .setColor(isGuilty ? 0xe74c3c : 0x2ecc71)
                        .addFields(
                            { name: '📋 Charges', value: crime, inline: false },
                            { name: '🔨 Verdict', value: verdict, inline: false }
                        )
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: 'The court of JARVIS has spoken.' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'typerace': {
                    telemetryMetadata.category = 'fun';
                    const phrase = funFeatures.getRandomTypingPhrase();
                    const embed = new EmbedBuilder()
                        .setTitle('⌨️ TYPING RACE ⌨️')
                        .setDescription('First person to type the phrase correctly wins!')
                        .setColor(0xf1c40f)
                        .addFields({ name: '📝 Type this:', value: `\`\`\`${phrase}\`\`\``, inline: false })
                        .setFooter({ text: 'GO GO GO!' });
                    
                    await interaction.editReply({ embeds: [embed] });
                    
                    // Set up collector for the race
                    const filter = m => m.content.toLowerCase() === phrase.toLowerCase() && !m.author.bot;
                    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
                    
                    collector.on('collect', async (msg) => {
                        const winEmbed = new EmbedBuilder()
                            .setTitle('🏆 WINNER! 🏆')
                            .setDescription(`<@${msg.author.id}> typed it first!`)
                            .setColor(0x2ecc71)
                            .setFooter({ text: 'Speed demon!' });
                        await interaction.channel.send({ embeds: [winEmbed] });
                    });
                    
                    collector.on('end', (collected) => {
                        if (collected.size === 0) {
                            interaction.channel.send('⏰ Time\'s up! Nobody typed it correctly.').catch(() => {});
                        }
                    });
                    
                    response = '__TYPERACE_HANDLED__';
                    break;
                }
                // ============ MORE FUN COMMANDS ============
                case 'rps': {
                    telemetryMetadata.category = 'fun';
                    const opponent = interaction.options.getUser('opponent');
                    const choices = ['🪨 Rock', '📄 Paper', '✂️ Scissors'];
                    const userChoice = choices[Math.floor(Math.random() * 3)];
                    const opponentChoice = choices[Math.floor(Math.random() * 3)];
                    
                    // Determine winner
                    let result;
                    if (userChoice === opponentChoice) {
                        result = "It's a tie! 🤝";
                    } else if (
                        (userChoice.includes('Rock') && opponentChoice.includes('Scissors')) ||
                        (userChoice.includes('Paper') && opponentChoice.includes('Rock')) ||
                        (userChoice.includes('Scissors') && opponentChoice.includes('Paper'))
                    ) {
                        result = `**${interaction.user.username}** wins! 🏆`;
                    } else {
                        result = opponent ? `**${opponent.username}** wins! 🏆` : '**JARVIS** wins! 🤖';
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🎮 Rock Paper Scissors!')
                        .setColor(0x3498db)
                        .addFields(
                            { name: interaction.user.username, value: userChoice, inline: true },
                            { name: 'VS', value: '⚔️', inline: true },
                            { name: opponent ? opponent.username : 'JARVIS', value: opponentChoice, inline: true }
                        )
                        .setDescription(result);
                    response = { embeds: [embed] };
                    break;
                }
                // ============ CRAFTING & ITEMS ============
                case 'inventory': {
                    telemetryMetadata.category = 'economy';
                    const inventory = await starkEconomy.getInventory(interaction.user.id);
                    const hasReactor = await starkEconomy.hasArcReactor(interaction.user.id);
                    
                    if (!inventory.length) {
                        response = 'Your inventory is empty, sir. Visit the shop with `/economy shop` or craft items with `/tinker craft`.';
                        break;
                    }
                    
                    const itemList = inventory.map(item => {
                        const uses = item.uses ? ` (${item.uses} uses)` : '';
                        return `• ${item.name}${uses}`;
                    }).join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`🎒 ${interaction.user.username}'s Inventory`)
                        .setDescription(itemList)
                        .setColor(hasReactor ? 0x00d4ff : 0x9b59b6)
                        .setFooter({ text: hasReactor ? '💠 Arc Reactor Owner - All perks active!' : 'Use /tinker craft to make items' });
                    
                    if (hasReactor) {
                        embed.addFields({
                            name: '💠 Arc Reactor Perks',
                            value: '• +15% earnings\n• -25% cooldowns\n• +5% gambling luck\n• +500 daily bonus\n• +1% daily interest',
                            inline: false
                        });
                    }
                    
                    response = { embeds: [embed] };
                    break;
                }
                case 'tinker': {
                    telemetryMetadata.category = 'economy';
                    const tinkerSubcommand = interaction.options.getSubcommand();

                    switch (tinkerSubcommand) {
                        case 'craft': {
                             const recipeName = interaction.options.getString('recipe').toLowerCase();
                             const recipe = starkTinker.getRecipe(recipeName);
                             if (!recipe) {
                                 response = `❌ Unknown recipe: \`${recipeName}\`. Use \`/tinker recipes\` to see all recipes.`;
                                 break;
                             }
                             
                             const result = await starkEconomy.craftItem(interaction.user.id, recipeName, recipe);
                             if (!result.success) {
                                const materials = await starkEconomy.getMaterials(interaction.user.id);
                                const missing = Object.entries(recipe.ingredients)
                                    .filter(([mat, req]) => (materials[mat] || 0) < req)
                                    .map(([mat, req]) => `${req - (materials[mat] || 0)}x ${mat}`)
                                    .join(', ');
                                response = `❌ **Cannot craft ${recipe.name}**\n\nMissing: ${missing}\n\nCollect materials with \`/minigame hunt\`, \`/minigame fish\`, \`/minigame dig\``;
                                break;
                             }
                             
                             const rarityColors = { common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f };
                             const embed = new EmbedBuilder()
                                .setTitle('🔧 Item Crafted!')
                                .setDescription(`You crafted **${result.item}**!\n\n${recipe.description}`)
                                .setColor(rarityColors[result.rarity] || 0x95a5a6)
                                .addFields(
                                    { name: 'Rarity', value: result.rarity.toUpperCase(), inline: true },
                                    { name: 'Value', value: `${result.value} 💵`, inline: true }
                                )
                                .setFooter({ text: 'View with /inventory' });
                             response = { embeds: [embed] };
                             break;
                        }
                        case 'recipes': {
                            const rarity = interaction.options.getString('rarity');
                            let recipes = starkTinker.getAllRecipes();
                            if (rarity) {
                                recipes = recipes.filter(r => r.rarity === rarity);
                            }
                            if (recipes.length > 25) recipes = recipes.slice(0, 25);
                            
                            const recipeList = recipes.map(r => 
                                `**${r.name}** (${r.rarity}) [ID: \`${r.id}\`]\n> ${Object.entries(r.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}`
                            ).join('\n');
                            
                            const embed = new EmbedBuilder()
                                .setTitle(rarity ? `🔧 ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Recipes` : '🔧 Tinker Lab Recipes')
                                .setDescription(recipeList || 'No recipes found.')
                                .setColor(0xe74c3c)
                                .setFooter({ text: 'Use /tinker craft <id> to craft' });
                             response = { embeds: [embed] };
                             break;
                        }
                        case 'materials': {
                            const materials = await starkEconomy.getMaterials(interaction.user.id);
                            const entries = Object.entries(materials);
                            if (entries.length === 0) {
                                response = '📦 You have no materials yet!\n\nCollect them with `/minigame hunt`, `/minigame fish`, `/minigame dig`, `/minigame beg`';
                                break;
                            }
                            entries.sort((a, b) => b[1] - a[1]);
                            const materialList = entries.slice(0, 25).map(([name, qty]) => `${name}: **${qty}**`).join('\n');
                            
                            const embed = new EmbedBuilder()
                                .setTitle(`📦 ${interaction.user.username}'s Materials`)
                                .setDescription(materialList + (entries.length > 25 ? `\n\n*...and ${entries.length - 25} more*` : ''))
                                .setColor(0x3498db)
                                .setFooter({ text: `${entries.length} material types • Use /tinker craft` });
                             response = { embeds: [embed] };
                             break;
                        }
                        case 'sell': {
                             const itemInput = interaction.options.getString('item').toLowerCase();
                             const inventory = await starkEconomy.getInventory(interaction.user.id);
                             
                             // Find index
                             const index = inventory.findIndex(i => 
                                i.name.toLowerCase().includes(itemInput) || 
                                (i.id && i.id.toLowerCase() === itemInput)
                             );
                             
                             if (index === -1) {
                                 response = `❌ Could not find item "${itemInput}" in your inventory.`;
                                 break;
                             }
                             
                             const result = await starkEconomy.sellItem(interaction.user.id, index);
                             if (!result.success) {
                                 response = `❌ ${result.error}`;
                                 break;
                             }
                             
                             const embed = new EmbedBuilder()
                                .setTitle('💰 Item Sold')
                                .setDescription(`You sold **${result.item}** for **${result.value}** Stark Bucks!`)
                                .setColor(0x2ecc71)
                                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });
                             response = { embeds: [embed] };
                             break;
                        }
                    }
                    break;
                }
                // ============ BOSS BATTLE ============
                case 'boss': {
                    telemetryMetadata.category = 'game';
                    // Boss battles require a guild context
                    if (!interaction.guild) {
                        response = '❌ Boss battles can only be done in a server, not DMs!';
                        break;
                    }
                    const sub = interaction.options.getSubcommand();
                    if (sub === 'status') {
                        const boss = await starkEconomy.getBossData(interaction.guild.id);
                        if (!boss.active) { response = 'No active boss. Bosses spawn randomly!'; break; }
                        const hpPercent = Math.floor((boss.hp / boss.maxHp) * 100);
                        const bar = '🟥'.repeat(Math.floor(hpPercent / 10)) + '⬜'.repeat(10 - Math.floor(hpPercent / 10));
                        response = `👹 **${boss.name}** is attacking!\nHP: ${boss.hp}/${boss.maxHp} (${hpPercent}%)\n${bar}`;
                    } else if (sub === 'attack') {
                        const res = await starkEconomy.attackBoss(interaction.guild.id, interaction.user.id);
                        if (!res.success) { response = `❌ ${res.error}`; break; }
                        response = `⚔️ You dealt **${res.damage}** damage to **${res.bossName}**! Reward: ${res.reward} 💵`;
                    }
                    break;
                }
                // ============ SBX CRYPTO ============
                case 'sbx': {
                    telemetryMetadata.category = 'economy';
                    const sub = interaction.options.getSubcommand();
                    if (sub === 'market') {
                        const data = await starkEconomy.getSBXMarketData();
                        if (!data) { response = '❌ Market offline.'; break; }
                        const embed = new EmbedBuilder()
                            .setTitle('📈 SBX Market')
                            .setDescription(`Price: **${data.price}** Stark Bucks`)
                            .setColor(0x3498db)
                            .setFooter({ text: 'Invest in the future!' });
                        response = { embeds: [embed] };
                    } else if (sub === 'buy') {
                        const amount = interaction.options.getInteger('amount');
                        const res = await starkEconomy.buySBX(interaction.user.id, amount);
                        if (!res.success) { response = `❌ ${res.error}`; break; }
                        response = `✅ Bought **${amount} SBX** for **${res.cost}** Stark Bucks.`;
                    } else if (sub === 'sell') {
                        const amount = interaction.options.getInteger('amount');
                        const res = await starkEconomy.sellSBX(interaction.user.id, amount);
                        if (!res.success) { response = `❌ ${res.error}`; break; }
                        response = `✅ Sold **${amount} SBX** for **${res.earnings}** Stark Bucks.`;
                    } else if (sub === 'invest') {
                        const amount = interaction.options.getInteger('amount');
                        const res = await starkEconomy.investSBX(interaction.user.id, amount);
                        if (!res.success) { response = `❌ ${res.error}`; break; }
                        response = `💼 Invested **${amount} SBX**! Earning 0.5% daily.`;
                    } else if (sub === 'withdraw') {
                        const amount = interaction.options.getInteger('amount');
                        const res = await starkEconomy.withdrawInvestment(interaction.user.id, amount);
                        if (!res.success) { response = `❌ ${res.error}`; break; }
                        response = `🏧 Withdrew **${res.withdrawn} SBX** from investment.`;
                    }
                    break;
                }
                // ============ QUESTS ============
                case 'quests': {
                     telemetryMetadata.category = 'game';
                     const sub = interaction.options.getSubcommand();
                     if (sub === 'list') {
                         const quests = await starkEconomy.getAvailableQuests(interaction.user.id);
                         if (!quests.length) { response = 'No quests available.'; break; }
                         const list = quests.map(q => `**${q.name}** (${q.reward} 💵) [ID: ${q.id}]`).join('\n');
                         response = `📜 **Quests**\n${list}`;
                     } else if (sub === 'start') {
                         const id = interaction.options.getString('id');
                         const res = await starkEconomy.startQuest(interaction.user.id, id);
                         if (!res.success) { response = `❌ ${res.error}`; break; }
                         response = `⚔️ Quest **${res.quest.name}** started! Good luck.`;
                     }
                     break;
                }
                // ============ SOCIAL (Consolidated) ============
                case 'social': {
                    telemetryMetadata.category = 'fun';
                    const socialSubcommand = interaction.options.getSubcommand();
                    
                    switch (socialSubcommand) {
                        case 'ship': {
                            const person1 = interaction.options.getUser('person1');
                            const person2 = interaction.options.getUser('person2') || interaction.user;
                            let compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
                            // Easter egg ship pair (configured via env)
                            const herId = process.env.SHIP_EASTER_EGG_1 || '';
                            const himId = process.env.SHIP_EASTER_EGG_2 || '';
                            if (interaction.user.id === herId) {
                                const isTheShip = (person1.id === herId && person2.id === himId) || 
                                                  (person1.id === himId && person2.id === herId);
                                if (isTheShip) compatibility = 101;
                            }
                            const shipName = funFeatures.generateShipName(
                                person1.displayName || person1.username,
                                person2.displayName || person2.username
                            );
                            let emoji, description;
                            if (compatibility >= 90) { emoji = '💕'; description = 'SOULMATES! A match made in heaven!'; }
                            else if (compatibility >= 70) { emoji = '❤️'; description = 'Strong connection! Great potential!'; }
                            else if (compatibility >= 50) { emoji = '💛'; description = 'Decent vibes. Could work!'; }
                            else if (compatibility >= 30) { emoji = '🧡'; description = 'It\'s... complicated.'; }
                            else { emoji = '💔'; description = 'Not meant to be... sorry!'; }
                            const embed = new EmbedBuilder()
                                .setTitle(`${emoji} Ship: ${shipName}`)
                                .setColor(compatibility >= 50 ? 0xe91e63 : 0x95a5a6)
                                .addFields(
                                    { name: 'Compatibility', value: `**${compatibility}%**`, inline: true },
                                    { name: 'Verdict', value: description, inline: true }
                                )
                                .setDescription(`**${person1.username}** 💕 **${person2.username}**`)
                                .setFooter({ text: 'Ship Calculator™ - Results are 100% scientifically accurate' });
                            response = { embeds: [embed] };
                            break;
                        }
                        case 'howgay': {
                            const target = interaction.options.getUser('user') || interaction.user;
                            const percentage = funFeatures.randomInt(0, 100);
                            const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                            response = `🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`;
                            break;
                        }
                        case 'howbased': {
                            const target = interaction.options.getUser('user') || interaction.user;
                            const percentage = funFeatures.randomInt(0, 100);
                            const bar = '🗿'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                            response = `🗿 **${target.username}** is **${percentage}%** based\n${bar}`;
                            break;
                        }
                        case 'pickupline': {
                            const line = funFeatures.getPickupLine();
                            response = `💕 **Pickup Line**\n\n${line}`;
                            break;
                        }
                        case 'dadjoke': {
                            const joke = funFeatures.getDadJoke();
                            response = `👨 **Dad Joke**\n\n${joke}`;
                            break;
                        }
                        case 'fight': {
                            const opponent = interaction.options.getUser('opponent');
                            if (!opponent) {
                                response = 'You need to specify someone to fight! 👊';
                                break;
                            }
                            if (opponent.id === interaction.user.id) {
                                response = 'You can\'t fight yourself! ...or can you? 🤔';
                                break;
                            }
                            const fight = funFeatures.generateFight(
                                interaction.user.username,
                                opponent.username
                            );
                            const embed = new EmbedBuilder()
                                .setTitle('⚔️ FIGHT! ⚔️')
                                .setColor(0xe74c3c)
                                .setDescription(fight.moves.join('\n\n'))
                                .addFields(
                                    { name: `${interaction.user.username} HP`, value: `${fight.attackerHP}/100`, inline: true },
                                    { name: `${opponent.username} HP`, value: `${fight.defenderHP}/100`, inline: true }
                                )
                                .setFooter({ text: `🏆 Winner: ${fight.winner}` });
                            response = { embeds: [embed] };
                            if (fight.winner === interaction.user.username) {
                            }
                            break;
                        }
                        case 'hug': {
                            const target = interaction.options.getUser('user');
                            if (!target) {
                                response = 'You need to specify someone to hug! 🤗';
                                break;
                            }
                            const gif = funFeatures.getHugGif();
                            const embed = new EmbedBuilder()
                                .setDescription(`**${interaction.user.username}** hugs **${target.username}**! 🤗`)
                                .setColor(0xff69b4)
                                .setImage(gif);
                            response = { embeds: [embed] };
                            break;
                        }
                        case 'slap': {
                            const target = interaction.options.getUser('user');
                            if (!target) {
                                response = 'You need to specify someone to slap! 👋';
                                break;
                            }
                            const gif = funFeatures.getSlapGif();
                            const embed = new EmbedBuilder()
                                .setDescription(`**${interaction.user.username}** slaps **${target.username}**! 👋`)
                                .setColor(0xe74c3c)
                                .setImage(gif);
                            response = { embeds: [embed] };
                            break;
                        }
                        default:
                            response = '❌ Unknown social subcommand.';
                    }
                    break;
                }
                // ============ SOCIAL (Legacy - keeping for backwards compatibility) ============
                case 'ship': {
                    telemetryMetadata.category = 'fun';
                    const person1 = interaction.options.getUser('person1');
                    const person2 = interaction.options.getUser('person2') || interaction.user;
                    
                    let compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
                    // Easter egg ship pair (configured via env)
                    const herId = process.env.SHIP_EASTER_EGG_1 || '';
                    const himId = process.env.SHIP_EASTER_EGG_2 || '';
                    if (interaction.user.id === herId) {
                        const isTheShip = (person1.id === herId && person2.id === himId) || 
                                          (person1.id === himId && person2.id === herId);
                        if (isTheShip) compatibility = 101;
                    }
                    const shipName = funFeatures.generateShipName(
                        person1.displayName || person1.username,
                        person2.displayName || person2.username
                    );
                    
                    let emoji, description;
                    if (compatibility >= 90) { emoji = '💕'; description = 'SOULMATES! A match made in heaven!'; }
                    else if (compatibility >= 70) { emoji = '❤️'; description = 'Strong connection! Great potential!'; }
                    else if (compatibility >= 50) { emoji = '💛'; description = 'Decent vibes. Could work!'; }
                    else if (compatibility >= 30) { emoji = '🧡'; description = 'It\'s... complicated.'; }
                    else { emoji = '💔'; description = 'Not meant to be... sorry!'; }
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`${emoji} Ship: ${shipName}`)
                        .setColor(compatibility >= 50 ? 0xe91e63 : 0x95a5a6)
                        .addFields(
                            { name: 'Compatibility', value: `**${compatibility}%**`, inline: true },
                            { name: 'Verdict', value: description, inline: true }
                        )
                        .setDescription(`**${person1.username}** 💕 **${person2.username}**`)
                        .setFooter({ text: 'Ship Calculator™ - Results are 100% scientifically accurate' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'howgay': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`;
                    break;
                }
                case 'howbased': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🗿'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🗿 **${target.username}** is **${percentage}%** based\n${bar}`;
                    break;
                }
                case 'pickupline': {
                    telemetryMetadata.category = 'fun';
                    const line = funFeatures.getPickupLine();
                    response = `💕 **Pickup Line**\n\n${line}`;
                    break;
                }
                case 'dadjoke': {
                    telemetryMetadata.category = 'fun';
                    const joke = funFeatures.getDadJoke();
                    response = `👨 **Dad Joke**\n\n${joke}`;
                    break;
                }
                case 'fight': {
                    telemetryMetadata.category = 'fun';
                    const opponent = interaction.options.getUser('opponent');
                    if (!opponent) {
                        response = 'You need to specify someone to fight! 👊';
                        break;
                    }
                    if (opponent.id === interaction.user.id) {
                        response = 'You can\'t fight yourself! ...or can you? 🤔';
                        break;
                    }
                    
                    const fight = funFeatures.generateFight(
                        interaction.user.username,
                        opponent.username
                    );
                    
                    const embed = new EmbedBuilder()
                        .setTitle('⚔️ FIGHT! ⚔️')
                        .setColor(0xe74c3c)
                        .setDescription(fight.moves.join('\n\n'))
                        .addFields(
                            { name: `${interaction.user.username} HP`, value: `${fight.attackerHP}/100`, inline: true },
                            { name: `${opponent.username} HP`, value: `${fight.defenderHP}/100`, inline: true }
                        )
                        .setFooter({ text: `🏆 Winner: ${fight.winner}` });
                    response = { embeds: [embed] };
                    // Track fight win achievement
                    if (fight.winner === interaction.user.username) {
                    }
                    break;
                }
                case 'hug': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You need to specify someone to hug! 🤗';
                        break;
                    }
                    const gif = funFeatures.getHugGif();
                    const embed = new EmbedBuilder()
                        .setDescription(`**${interaction.user.username}** hugs **${target.username}**! 🤗`)
                        .setColor(0xff69b4)
                        .setImage(gif);
                    response = { embeds: [embed] };
                    break;
                }
                case 'slap': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You need to specify someone to slap! 👋';
                        break;
                    }
                    const gif = funFeatures.getSlapGif();
                    const embed = new EmbedBuilder()
                        .setDescription(`**${interaction.user.username}** slaps **${target.username}**! 👋`)
                        .setColor(0xe74c3c)
                        .setImage(gif);
                    response = { embeds: [embed] };
                    break;
                }
                case 'roll': {
                    telemetryMetadata.category = 'fun';
                    const diceNotation = interaction.options.getString('dice') || '1d6';
                    const result = funFeatures.rollDice(diceNotation);
                    
                    if (!result) {
                        response = '❌ Invalid dice notation! Use format like `2d6` or `1d20+5`';
                        break;
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🎲 Dice Roll')
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: 'Dice', value: result.notation, inline: true },
                            { name: 'Rolls', value: result.rolls.join(', '), inline: true },
                            { name: 'Total', value: `**${result.total}**`, inline: true }
                        );
                    response = { embeds: [embed] };
                    // Check for nat 20 or nat 1 on d20
                    if (diceNotation.includes('d20')) {
                    }
                    break;
                }
                case 'afk': {
                    telemetryMetadata.category = 'fun';
                    const reason = interaction.options.getString('reason') || 'AFK';
                    // Store AFK status (you can expand this with a proper storage system)
                    if (!this.afkUsers) {
                        this.afkUsers = new LRUCache({ max: DISCORD_AFK_USERS_MAX, ttl: DISCORD_AFK_USERS_TTL_MS });
                    }
                    this.afkUsers.set(interaction.user.id, { reason, since: Date.now() });
                    response = `💤 **${interaction.user.username}** is now AFK: ${reason}`;
                    break;
                }
                case 'rate': {
                    telemetryMetadata.category = 'fun';
                    const thing = interaction.options.getString('thing');
                    const rating = funFeatures.randomInt(0, 10);
                    const stars = '⭐'.repeat(rating) + '☆'.repeat(10 - rating);
                    response = `📊 **Rating for "${thing}":**\n${stars} **${rating}/10**`;
                    break;
                }
                case '8ball': {
                    telemetryMetadata.category = 'fun';
                    const question = interaction.options.getString('question');
                    const answer = funFeatures.get8BallResponse();
                    const embed = new EmbedBuilder()
                        .setTitle('🎱 Magic 8-Ball')
                        .setColor(0x000000)
                        .addFields(
                            { name: '❓ Question', value: question, inline: false },
                            { name: '🔮 Answer', value: answer, inline: false }
                        );
                    response = { embeds: [embed] };
                    // Track achievement
                    break;
                }
                // ============ STARK BUCKS ECONOMY (Consolidated) ============
                case 'economy': {
                    telemetryMetadata.category = 'economy';
                    const economySubcommand = interaction.options.getSubcommand();
                    
                    switch (economySubcommand) {
                        case 'balance': {
                            const stats = await starkEconomy.getUserStats(interaction.user.id);
                            
                            // Try to find rank in top 100
                            const lb = await starkEconomy.getLeaderboard(100); // No client needed
                            const rankIndex = lb.findIndex(u => u.userId === interaction.user.id);
                            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

                            // Generate Profile Image
                            const { AttachmentBuilder } = require('discord.js');
                            const imageGenerator = require('./image-generator');

                            const profileData = {
                                username: interaction.user.username,
                                avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                                balance: stats.balance,
                                totalEarned: stats.totalEarned || 0,
                                winRate: stats.winRate,
                                rank: rank
                            };

                            try {
                                const buffer = await imageGenerator.generateProfileImage(profileData);
                                const attachment = new AttachmentBuilder(buffer, { name: 'balance.png' });
                                response = { files: [attachment] };
                            } catch (err) {
                                console.error('[Balance] Image generation failed:', err);
                                response = `**${interaction.user.username}**\n💰 Balance: **${stats.balance.toLocaleString()}** SB`;
                            }
                            break;
                        }
                        case 'daily': {
                            const result = await starkEconomy.claimDaily(interaction.user.id, interaction.user.username);
                            if (!result.success) {
                                const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
                                const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
                                response = `⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`;
                                break;
                            }
                            const safeReward = Number.isFinite(Number(result.reward)) ? Math.floor(Number(result.reward)) : 0;
                            const safeBalance = Number.isFinite(Number(result.newBalance)) ? Math.floor(Number(result.newBalance)) : 0;
                            const safeStreak = Number.isFinite(Number(result.streak)) ? Math.floor(Number(result.streak)) : 0;
                            const safeStreakBonus = Number.isFinite(Number(result.streakBonus)) ? Math.floor(Number(result.streakBonus)) : 0;
                            const dailyEmbed = new EmbedBuilder()
                                .setTitle('💰 Daily Reward Claimed!')
                                .setDescription(`You received **${safeReward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}`)
                                .setColor(0x2ecc71)
                                .addFields(
                                    { name: '🔥 Streak', value: `${safeStreak} days (+${safeStreakBonus} bonus)`, inline: true },
                                    { name: '💰 Balance', value: `${safeBalance}`, inline: true }
                                )
                                .setFooter({ text: 'Come back tomorrow to keep your streak!' });
                            response = { embeds: [dailyEmbed] };
                            break;
                        }
                        case 'work': {
                            const result = await starkEconomy.work(interaction.user.id, interaction.user.username);
                            if (!result.success) {
                                const cooldownMs = result.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `⏰ You're tired, sir. Rest for ${timeStr} more.`;
                                break;
                            }
                            const workBoost = starkEconomy.getBoostText();
                            const workEmbed = new EmbedBuilder()
                                .setTitle('💼 Work Complete!')
                                .setDescription(`You ${result.job} and earned **${result.reward}** Stark Bucks!${workBoost}`)
                                .setColor(0x3498db)
                                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                                .setFooter({ text: 'Stark Industries HR Department' });
                            response = { embeds: [workEmbed] };
                            break;
                        }
                        case 'gamble': {
                            const amountInput = interaction.options.getString('amount');
                            let amount = parseFormattedNumber(amountInput);
                            if (amountInput.toLowerCase() === 'all') {
                                const bal = await starkEconomy.getBalance(interaction.user.id);
                                amount = bal || 0;
                            }
                            if (isNaN(amount) || amount < 1) {
                                response = '❌ Invalid amount. Use a number like 100, 5K, 1M, or "all"';
                                break;
                            }
                            const result = await starkEconomy.gamble(interaction.user.id, Math.floor(amount));
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            const gambleEmbed = new EmbedBuilder()
                                .setTitle(result.won ? '🎰 You Won!' : '🎰 You Lost!')
                                .setDescription(result.won 
                                    ? `Congratulations! You won **${formatNum(result.amount)}** Stark Bucks!`
                                    : `Better luck next time. You lost **${formatNum(result.amount)}** Stark Bucks.`)
                                .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                                .addFields({ name: '💰 Balance', value: `${formatNum(result.newBalance)}`, inline: true })
                                .setFooter({ text: `Win rate: ${result.winRate}%` });
                            selfhostFeatures.jarvisSoul.evolve(result.won ? 'helpful' : 'chaos', 'neutral');
                            response = { embeds: [gambleEmbed] };
                            break;
                        }
                        case 'slots': {
                            const betInput = interaction.options.getString('bet');
                            let bet = parseFormattedNumber(betInput);
                            if (betInput.toLowerCase() === 'all') {
                                const bal = await starkEconomy.getBalance(interaction.user.id);
                                bet = bal || 0;
                            }
                            if (isNaN(bet) || bet < 10) {
                                response = '❌ Invalid bet. Minimum 10. Use a number like 100, 5K, 1M, or "all"';
                                break;
                            }
                            const result = await starkEconomy.playSlots(interaction.user.id, Math.floor(bet));
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            const slotDisplay = result.results.join(' | ');
                            let resultText = '';
                            if (result.resultType === 'jackpot') resultText = '💎 JACKPOT! 💎';
                            else if (result.resultType === 'triple') resultText = '🎉 TRIPLE!';
                            else if (result.resultType === 'double') resultText = '✨ Double!';
                            else resultText = '😢 No match';
                            const slotsEmbed = new EmbedBuilder()
                                .setTitle('🎰 Slot Machine')
                                .setDescription(`**[ ${slotDisplay} ]**\n\n${resultText}`)
                                .setColor(result.change > 0 ? 0x2ecc71 : 0xe74c3c)
                                .addFields(
                                    { name: '💵 Bet', value: `${formatNum(result.bet)}`, inline: true },
                                    { name: '💰 Won', value: `${formatNum(result.winnings)}`, inline: true },
                                    { name: '🏦 Balance', value: `${formatNum(result.newBalance)}`, inline: true }
                                )
                                .setFooter({ text: `Multiplier: x${result.multiplier}` });
                            response = { embeds: [slotsEmbed] };
                            break;
                        }
                        case 'coinflip': {
                            const cfBetInput = interaction.options.getString('bet');
                            let cfBet = parseFormattedNumber(cfBetInput);
                            if (cfBetInput.toLowerCase() === 'all') {
                                const bal = await starkEconomy.getBalance(interaction.user.id);
                                cfBet = bal || 0;
                            }
                            if (isNaN(cfBet) || cfBet < 1) {
                                response = '❌ Invalid bet. Use a number like 100, 5K, 1M, or "all"';
                                break;
                            }
                            const choice = interaction.options.getString('choice');
                            const result = await starkEconomy.coinflip(interaction.user.id, Math.floor(cfBet), choice);
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            const coinEmoji = result.result === 'heads' ? '🪙' : '⭕';
                            const cfEmbed = new EmbedBuilder()
                                .setTitle(`${coinEmoji} Coinflip`)
                                .setDescription(`The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`)
                                .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                                .addFields({ name: '💰 Balance', value: `${formatNum(result.newBalance)}`, inline: true })
                                .setFooter({ text: '50/50 chance' });
                            response = { embeds: [cfEmbed] };
                            break;
                        }
                        case 'shop': {
                            const items = starkEconomy.getShopItems();
                            const itemList = items.map(item => 
                                `**${item.name}** - ${item.price} 💵\n> ${item.description}`
                            ).join('\n\n');
                            const shopEmbed = new EmbedBuilder()
                                .setTitle('🛒 Stark Industries Shop')
                                .setDescription(itemList)
                                .setColor(0x9b59b6)
                                .setFooter({ text: 'Use /economy buy <item> to purchase' });
                            response = { embeds: [shopEmbed] };
                            break;
                        }
                        case 'buy': {
                            const itemId = interaction.options.getString('item');
                            const result = await starkEconomy.buyItem(interaction.user.id, itemId);
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            const buyEmbed = new EmbedBuilder()
                                .setTitle('🛒 Purchase Successful!')
                                .setDescription(`You bought **${result.item.name}**!`)
                                .setColor(0x2ecc71)
                                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                                .setFooter({ text: 'Thank you for shopping at Stark Industries' });
                            response = { embeds: [buyEmbed] };
                            break;
                        }
                        case 'leaderboard': {
                            const lb = await starkEconomy.getLeaderboard(10, interaction.client);
                            if (!lb.length) {
                                response = 'No data yet, sir.';
                                break;
                            }
                            
                            // Generate Canvas Image Leaderboard
                            const { AttachmentBuilder } = require('discord.js');
                            const imageGenerator = require('./image-generator');
                            
                            const enrichedLb = await Promise.all(lb.map(async (u) => {
                                let avatarUrl = null;
                                let username = u.username || 'Unknown';
                                try {
                                    const user = await interaction.client.users.fetch(u.userId);
                                    avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                                    username = user.username; // UPDATE USERNAME FROM DISCORD
                                } catch (e) {}
                                return { ...u, avatar: avatarUrl, username };
                            }));

                            const buffer = await imageGenerator.generateLeaderboardImage(enrichedLb); // Static PNG
                            const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
                            
                            response = { files: [attachment] };
                            break;
                        }
                        case 'show': {
                            const showUser = await starkEconomy.loadUser(interaction.user.id, interaction.user.username);
                            const stats = await starkEconomy.getUserStats(interaction.user.id);
                            
                            // Try to find rank in top 100
                            const lb = await starkEconomy.getLeaderboard(100); // No client needed for just ID check
                            const rankIndex = lb.findIndex(u => u.userId === interaction.user.id);
                            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

                            // Generate Profile Image
                            const { AttachmentBuilder } = require('discord.js');
                            const imageGenerator = require('./image-generator');

                            const profileData = {
                                username: interaction.user.username,
                                avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                                balance: showUser.balance,
                                totalEarned: showUser.totalEarned || 0,
                                winRate: stats.winRate,
                                rank: rank
                            };

                            try {
                                const buffer = await imageGenerator.generateProfileImage(profileData);
                                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                                response = { files: [attachment] };
                            } catch (err) {
                                console.error('[Profile] Image generation failed:', err);
                                response = `**${interaction.user.username}**\n💰 Balance: **${showUser.balance.toLocaleString()}** SB`;
                            }
                            break;
                        }
                        case 'give': {
                            const targetUser = interaction.options.getUser('user');
                            const giveAmount = interaction.options.getInteger('amount');
                            if (targetUser.bot) {
                                response = '❌ Cannot give money to bots, sir.';
                                break;
                            }
                            const giveResult = await starkEconomy.give(
                                interaction.user.id, 
                                targetUser.id, 
                                giveAmount,
                                interaction.user.username,
                                targetUser.username
                            );
                            if (!giveResult.success) {
                                response = `❌ ${giveResult.error}`;
                                break;
                            }
                            const giveEmbed = new EmbedBuilder()
                                .setTitle('💸 Transfer Complete!')
                                .setDescription(`You gave **${giveResult.amount}** Stark Bucks to **${targetUser.username}**!`)
                                .setColor(0x2ecc71)
                                .addFields(
                                    { name: 'Your Balance', value: `${giveResult.fromBalance}`, inline: true },
                                    { name: `${targetUser.username}'s Balance`, value: `${giveResult.toBalance}`, inline: true }
                                )
                                .setFooter({ text: 'Generosity is a virtue!' });
                            response = { embeds: [giveEmbed] };
                            break;
                        }
                        case 'blackjack': {
                            const bet = interaction.options.getInteger('bet');
                            if (bet < 10) {
                                response = '❌ Minimum bet is 10 Stark Bucks.';
                                break;
                            }
                            const result = await starkEconomy.playBlackjack(interaction.user.id, bet);
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            
                            const playerHandStr = result.playerHand.map(c => c.display).join(' ');
                            const dealerHandStr = result.dealerHand.map(c => c.display).join(' ');
                            const color = result.winnings > 0 ? 0x2ecc71 : (result.winnings < 0 ? 0xe74c3c : 0xf1c40f);
                            
                            const embed = new EmbedBuilder()
                                .setTitle('🃏 Blackjack')
                                .setColor(color)
                                .addFields(
                                    { name: `Your Hand (${result.playerValue})`, value: playerHandStr, inline: true },
                                    { name: `Dealer (${result.dealerValue})`, value: dealerHandStr, inline: true },
                                    { name: 'Result', value: `${result.result}\n${result.winnings >= 0 ? '+' : ''}${result.winnings} Stark Bucks`, inline: false },
                                    { name: '💰 Balance', value: `${result.newBalance}`, inline: true }
                                );
                            response = { embeds: [embed] };
                            break;
                        }
                        case 'rob': {
                            const target = interaction.options.getUser('user');
                            const result = await starkEconomy.rob(interaction.user.id, target.id, interaction.user.username);
                            
                            if (result.cooldown) {
                                const remaining = Math.ceil(result.cooldown / 1000);
                                response = `👮 **POLICE ALERT!**\nYou are laying low. Try robbing again in ${remaining}s.`;
                                break;
                            }
                            
                            if (!result.success) {
                                response = `❌ ${result.error}`;
                                break;
                            }
                            
                            const embed = new EmbedBuilder()
                                .setTitle('🦹 Robbery')
                                .setColor(result.caught ? 0xe74c3c : 0x2ecc71)
                                .setDescription(result.message)
                                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                                .setFooter({ text: result.caught ? 'Busted!' : 'Clean getaway!' });
                             
                            response = { embeds: [embed] };
                            break;
                        }
                        case 'lottery': {
                            const buyTickets = interaction.options.getInteger('buy_tickets');
                            if (buyTickets) {
                                if (buyTickets < 1) {
                                    response = '❌ You must buy at least 1 ticket.';
                                    break;
                                }
                                const result = await starkEconomy.buyLotteryTickets(interaction.user.id, buyTickets);
                                if (!result.success) {
                                    response = `❌ ${result.error}`;
                                    break;
                                }
                                response = `🎟️ **Lottery:** Successfully purchased **${buyTickets}** tickets for **${result.cost}** Stark Bucks!\nYou now have ${result.totalTickets} tickets. Good luck!`;
                            } else {
                                const data = await starkEconomy.getLotteryData();
                                const timeRemaining = Math.max(0, Math.ceil((data.drawTime - Date.now()) / 1000 / 60));
                                const timeStr = timeRemaining > 60 
                                    ? `${Math.floor(timeRemaining/60)}h ${timeRemaining%60}m` 
                                    : `${timeRemaining}m`;
                                
                                const embed = new EmbedBuilder()
                                    .setTitle('🎰 Stark Lottery')
                                    .setColor(0x9b59b6)
                                    .setDescription(`**Jackpot:** ${data.jackpot.toLocaleString()} Stark Bucks\n**Ticket Price:** ${data.ticketPrice} each`)
                                    .addFields(
                                        { name: 'Entries', value: `${data.totalTickets} tickets sold`, inline: true },
                                        { name: 'Draw In', value: timeStr, inline: true },
                                        { name: 'Last Winner', value: data.lastWinner ? `<@${data.lastWinner}>` : 'None', inline: false }
                                    )
                                    .setFooter({ text: 'Use /economy lottery buy_tickets:N to play' });
                                response = { embeds: [embed] };
                            }
                            break;
                        }
                        default:
                            response = '❌ Unknown economy subcommand.';
                    }
                    break;
                }
                // ============ STARK BUCKS ECONOMY (Legacy - keeping for backwards compatibility) ============
                case 'balance': {
                    telemetryMetadata.category = 'economy';
                    const stats = await starkEconomy.getUserStats(interaction.user.id);
                    
                    // Try to find rank in top 100
                    const lb = await starkEconomy.getLeaderboard(100); // No client needed
                    const rankIndex = lb.findIndex(u => u.userId === interaction.user.id);
                    const rank = rankIndex !== -1 ? rankIndex + 1 : null;

                    // Generate Profile Image
                    const { AttachmentBuilder } = require('discord.js');
                    const imageGenerator = require('./image-generator');

                    const profileData = {
                        username: interaction.user.username,
                        avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                        balance: stats.balance,
                        totalEarned: stats.totalEarned || 0,
                        winRate: stats.winRate,
                        rank: rank
                    };

                    try {
                        const buffer = await imageGenerator.generateProfileImage(profileData);
                        const attachment = new AttachmentBuilder(buffer, { name: 'balance.png' });
                        response = { files: [attachment] };
                    } catch (err) {
                        console.error('[Balance] Image generation failed:', err);
                        response = `**${interaction.user.username}**\n💰 Balance: **${stats.balance.toLocaleString()}** SB`;
                    }
                    break;
                }
                case 'daily': {
                    telemetryMetadata.category = 'economy';
                    const result = await starkEconomy.claimDaily(interaction.user.id, interaction.user.username);
                    if (!result.success) {
                        const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
                        const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
                        response = `⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`;
                        break;
                    }

                    const safeReward = Number.isFinite(Number(result.reward)) ? Math.floor(Number(result.reward)) : 0;
                    const safeBalance = Number.isFinite(Number(result.newBalance)) ? Math.floor(Number(result.newBalance)) : 0;
                    const safeStreak = Number.isFinite(Number(result.streak)) ? Math.floor(Number(result.streak)) : 0;
                    const safeStreakBonus = Number.isFinite(Number(result.streakBonus)) ? Math.floor(Number(result.streakBonus)) : 0;

                    const dailyEmbed = new EmbedBuilder()
                        .setTitle('💰 Daily Reward Claimed!')
                        .setDescription(`You received **${safeReward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: '🔥 Streak', value: `${safeStreak} days (+${safeStreakBonus} bonus)`, inline: true },
                            { name: '💰 Balance', value: `${safeBalance}`, inline: true }
                        )
                        .setFooter({ text: 'Come back tomorrow to keep your streak!' });
                    response = { embeds: [dailyEmbed] };
                    break;
                }
                case 'work': {
                    telemetryMetadata.category = 'economy';
                    const result = await starkEconomy.work(interaction.user.id, interaction.user.username);
                    if (!result.success) {
                        const cooldownMs = result.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `⏰ You're tired, sir. Rest for ${timeStr} more.`;
                        break;
                    }
                    const workBoost = starkEconomy.getBoostText();
                    const workEmbed = new EmbedBuilder()
                        .setTitle('💼 Work Complete!')
                        .setDescription(`You ${result.job} and earned **${result.reward}** Stark Bucks!${workBoost}`)
                        .setColor(0x3498db)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: 'Stark Industries HR Department' });
                    response = { embeds: [workEmbed] };
                    break;
                }
                case 'gamble': {
                    telemetryMetadata.category = 'economy';
                    const amountInput = interaction.options.getString('amount');
                    let amount = parseFormattedNumber(amountInput);
                    if (amountInput.toLowerCase() === 'all') {
                        const bal = await starkEconomy.getBalance(interaction.user.id);
                        amount = bal || 0;
                    }
                    if (isNaN(amount) || amount < 1) {
                        response = '❌ Invalid amount. Use a number like 100, 5K, 1M, or "all"';
                        break;
                    }
                    const result = await starkEconomy.gamble(interaction.user.id, Math.floor(amount));
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const gambleEmbed = new EmbedBuilder()
                        .setTitle(result.won ? '🎰 You Won!' : '🎰 You Lost!')
                        .setDescription(result.won 
                            ? `Congratulations! You won **${formatNum(result.amount)}** Stark Bucks!`
                            : `Better luck next time. You lost **${formatNum(result.amount)}** Stark Bucks.`)
                        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                        .addFields({ name: '💰 Balance', value: `${formatNum(result.newBalance)}`, inline: true })
                        .setFooter({ text: `Win rate: ${result.winRate}%` });
                    selfhostFeatures.jarvisSoul.evolve(result.won ? 'helpful' : 'chaos', 'neutral');
                    response = { embeds: [gambleEmbed] };
                    break;
                }
                case 'slots': {
                    telemetryMetadata.category = 'economy';
                    const betInput = interaction.options.getString('bet');
                    let bet = parseFormattedNumber(betInput);
                    if (betInput.toLowerCase() === 'all') {
                        const bal = await starkEconomy.getBalance(interaction.user.id);
                        bet = bal || 0;
                    }
                    if (isNaN(bet) || bet < 10) {
                        response = '❌ Invalid bet. Minimum 10. Use a number like 100, 5K, 1M, or "all"';
                        break;
                    }
                    const result = await starkEconomy.playSlots(interaction.user.id, Math.floor(bet));
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const slotDisplay = result.results.join(' | ');
                    let resultText = '';
                    if (result.resultType === 'jackpot') resultText = '💎 JACKPOT! 💎';
                    else if (result.resultType === 'triple') resultText = '🎉 TRIPLE!';
                    else if (result.resultType === 'double') resultText = '✨ Double!';
                    else resultText = '😢 No match';
                    const slotsEmbed = new EmbedBuilder()
                        .setTitle('🎰 Slot Machine')
                        .setDescription(`**[ ${slotDisplay} ]**\n\n${resultText}`)
                        .setColor(result.change > 0 ? 0x2ecc71 : 0xe74c3c)
                        .addFields(
                            { name: '💵 Bet', value: `${formatNum(result.bet)}`, inline: true },
                            { name: '💰 Won', value: `${formatNum(result.winnings)}`, inline: true },
                            { name: '🏦 Balance', value: `${formatNum(result.newBalance)}`, inline: true }
                        )
                        .setFooter({ text: `Multiplier: x${result.multiplier}` });
                    response = { embeds: [slotsEmbed] };
                    break;
                }
                case 'coinflip': {
                    telemetryMetadata.category = 'economy';
                    const cfBetInput = interaction.options.getString('bet');
                    let cfBet = parseFormattedNumber(cfBetInput);
                    if (cfBetInput.toLowerCase() === 'all') {
                        const bal = await starkEconomy.getBalance(interaction.user.id);
                        cfBet = bal || 0;
                    }
                    if (isNaN(cfBet) || cfBet < 1) {
                        response = '❌ Invalid bet. Use a number like 100, 5K, 1M, or "all"';
                        break;
                    }
                    const choice = interaction.options.getString('choice');
                    const result = await starkEconomy.coinflip(interaction.user.id, Math.floor(cfBet), choice);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const coinEmoji = result.result === 'heads' ? '🪙' : '⭕';
                    const cfEmbed = new EmbedBuilder()
                        .setTitle(`${coinEmoji} Coinflip`)
                        .setDescription(`The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`)
                        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                        .addFields({ name: '💰 Balance', value: `${formatNum(result.newBalance)}`, inline: true })
                        .setFooter({ text: '50/50 chance' });
                    response = { embeds: [cfEmbed] };
                    break;
                }
                case 'shop': {
                    telemetryMetadata.category = 'economy';
                    const items = starkEconomy.getShopItems();
                    const itemList = items.map(item => 
                        `**${item.name}** - ${item.price} 💵\n> ${item.description}`
                    ).join('\n\n');
                    const shopEmbed = new EmbedBuilder()
                        .setTitle('🛒 Stark Industries Shop')
                        .setDescription(itemList)
                        .setColor(0x9b59b6)
                        .setFooter({ text: 'Use /buy <item> to purchase' });
                    response = { embeds: [shopEmbed] };
                    break;
                }
                case 'buy': {
                    telemetryMetadata.category = 'economy';
                    const itemId = interaction.options.getString('item');
                    const result = await starkEconomy.buyItem(interaction.user.id, itemId);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const buyEmbed = new EmbedBuilder()
                        .setTitle('🛒 Purchase Successful!')
                        .setDescription(`You bought **${result.item.name}**!`)
                        .setColor(0x2ecc71)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: 'Thank you for shopping at Stark Industries' });
                    response = { embeds: [buyEmbed] };
                    break;
                }
                case 'leaderboard': {
                    telemetryMetadata.category = 'economy';
                    const lb = await starkEconomy.getLeaderboard(10, interaction.client);
                    if (!lb.length) {
                        response = 'No data yet, sir.';
                        break;
                    }
                    
                    // Generate Canvas Image Leaderboard (NO FALLBACK)
                    const { AttachmentBuilder } = require('discord.js');
                    const imageGenerator = require('./image-generator');
                    
                    // Enrich with avatars
                    const enrichedLb = await Promise.all(lb.map(async (u) => {
                        let avatarUrl = null;
                        try {
                            const user = await interaction.client.users.fetch(u.userId);
                            avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                        } catch (e) {}
                        return { ...u, avatar: avatarUrl };
                    }));

                    const buffer = await imageGenerator.generateLeaderboardImage(enrichedLb); // Static PNG
                    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
                    
                    response = { files: [attachment] };
                    break;
                }
                // ============ MINIGAMES (Consolidated) ============
                case 'minigame': {
                    telemetryMetadata.category = 'economy';
                    const minigameSubcommand = interaction.options.getSubcommand();
                    
                    switch (minigameSubcommand) {
                        case 'hunt': {
                            const huntResult = await starkEconomy.hunt(interaction.user.id);
                            if (!huntResult.success) {
                                const cooldownMs = huntResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `🏹 You're tired from hunting. Rest for ${timeStr} more.`;
                                break;
                            }
                            const huntBoost = starkEconomy.getBoostText();
                            const huntEmbed = new EmbedBuilder()
                                .setTitle('🏹 Hunt Results')
                                .setDescription(huntResult.reward > 0 
                                    ? `You caught a **${huntResult.outcome}**!\n+**${huntResult.reward}** Stark Bucks${huntBoost}`
                                    : `${huntResult.outcome}... The animals got away!`)
                                .setColor(huntResult.reward > 0 ? 0x2ecc71 : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${huntResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Hunt again in 1 minute' });
                            response = { embeds: [huntEmbed] };
                            break;
                        }
                        case 'fish': {
                            const fishResult = await starkEconomy.fish(interaction.user.id);
                            if (!fishResult.success) {
                                const cooldownMs = fishResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `🎣 Your fishing rod needs to dry. Wait ${timeStr} more.`;
                                break;
                            }
                            const fishBoost = starkEconomy.getBoostText();
                            const fishEmbed = new EmbedBuilder()
                                .setTitle('🎣 Fishing Results')
                                .setDescription(fishResult.reward > 0 
                                    ? `You caught a **${fishResult.outcome}**!\n+**${fishResult.reward}** Stark Bucks${fishBoost}`
                                    : `${fishResult.outcome}... Nothing bit today!`)
                                .setColor(fishResult.reward > 0 ? 0x3498db : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${fishResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Fish again in 1 minute' });
                            response = { embeds: [fishEmbed] };
                            break;
                        }
                        case 'dig': {
                            const digResult = await starkEconomy.dig(interaction.user.id);
                            if (!digResult.success) {
                                const cooldownMs = digResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `⛏️ Your shovel is broken. Wait ${timeStr} more.`;
                                break;
                            }
                            const digBoost = starkEconomy.getBoostText();
                            const digEmbed = new EmbedBuilder()
                                .setTitle('⛏️ Dig Results')
                                .setDescription(digResult.reward > 0 
                                    ? `You found **${digResult.outcome}**!\n+**${digResult.reward}** Stark Bucks${digBoost}`
                                    : `${digResult.outcome}... Nothing but dirt!`)
                                .setColor(digResult.reward > 0 ? 0xf1c40f : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${digResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Dig again in 1 minute' });
                            response = { embeds: [digEmbed] };
                            break;
                        }
                        case 'beg': {
                            const begResult = await starkEconomy.beg(interaction.user.id);
                            if (!begResult.success) {
                                const cooldownMs = begResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `🙏 People are avoiding you. Try again in ${timeStr}.`;
                                break;
                            }
                            const begBoost = starkEconomy.getBoostText();
                            const begEmbed = new EmbedBuilder()
                                .setTitle('🙏 Begging Results')
                                .setDescription(begResult.reward > 0 
                                    ? `**${begResult.outcome}** **${begResult.reward}** Stark Bucks!${begBoost}`
                                    : `${begResult.outcome}... Better luck next time!`)
                                .setColor(begResult.reward > 0 ? 0x9b59b6 : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${begResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Beg again in 1 minute' });
                            response = { embeds: [begEmbed] };
                            break;
                        }
                        case 'crime': {
                            const crimeResult = await starkEconomy.crime(interaction.user.id);
                            if (!crimeResult.success) {
                                const cooldownMs = crimeResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `🚔 Laying low after your last crime. Wait ${timeStr} more.`;
                                break;
                            }
                            const crimeBoost = starkEconomy.getBoostText();
                            const crimeEmbed = new EmbedBuilder()
                                .setTitle('🔫 Crime Results')
                                .setDescription(crimeResult.reward >= 0 
                                    ? `**${crimeResult.outcome}**\n${crimeResult.reward > 0 ? `+**${crimeResult.reward}** Stark Bucks${crimeBoost}` : 'No reward this time...'}`
                                    : `**${crimeResult.outcome}**\n-**${Math.abs(crimeResult.reward)}** Stark Bucks`)
                                .setColor(crimeResult.reward > 0 ? 0x2ecc71 : crimeResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${crimeResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Crime doesn\'t always pay!' });
                            response = { embeds: [crimeEmbed] };
                            break;
                        }
                        case 'postmeme': {
                            const memeResult = await starkEconomy.postmeme(interaction.user.id);
                            if (!memeResult.success) {
                                const cooldownMs = memeResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `📱 Still waiting for engagement on your last post. Try again in ${timeStr}.`;
                                break;
                            }
                            const memeBoost = starkEconomy.getBoostText();
                            const memeEmbed = new EmbedBuilder()
                                .setTitle('📱 Meme Posted!')
                                .setDescription(memeResult.reward > 0 
                                    ? `**${memeResult.outcome}**\n+**${memeResult.reward}** Stark Bucks${memeBoost}`
                                    : `**${memeResult.outcome}**`)
                                .setColor(memeResult.reward > 100 ? 0xf1c40f : memeResult.reward > 0 ? 0x3498db : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${memeResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Quality content = Quality rewards' });
                            response = { embeds: [memeEmbed] };
                            break;
                        }
                        case 'search': {
                            const locationChoice = interaction.options.getString('location');
                            const locationIndex = locationChoice ? parseInt(locationChoice) : null;
                            const searchResult = await starkEconomy.search(interaction.user.id, locationIndex);
                            if (!searchResult.success) {
                                const cooldownMs = searchResult.cooldown;
                                const timeStr = cooldownMs < 60000 
                                    ? `${Math.floor(cooldownMs / 1000)} seconds`
                                    : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                response = `🔍 You're too tired to search. Rest for ${timeStr} more.`;
                                break;
                            }
                            const searchBoost = starkEconomy.getBoostText();
                            const searchEmbed = new EmbedBuilder()
                                .setTitle('🔍 Search Results')
                                .setDescription(`You searched **${searchResult.location}**...\n\n${searchResult.outcome}${searchResult.reward > 0 ? `\n+**${searchResult.reward}** Stark Bucks${searchBoost}` : searchResult.reward < 0 ? `\n-**${Math.abs(searchResult.reward)}** Stark Bucks` : ''}`)
                                .setColor(searchResult.reward > 0 ? 0x2ecc71 : searchResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                                .addFields({ name: '💰 Balance', value: `${searchResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Search again in 1 minute' });
                            response = { embeds: [searchEmbed] };
                            break;
                        }
                        case 'rob': {
                            const targetUser = interaction.options.getUser('target');
                            if (!targetUser) {
                                response = '❌ You must specify who to rob!';
                                break;
                            }
                            if (targetUser.id === interaction.user.id) {
                                response = '🤔 You can\'t rob yourself!';
                                break;
                            }
                            if (targetUser.bot) {
                                response = '🤖 You can\'t rob bots!';
                                break;
                            }
                            const robResult = await starkEconomy.rob(interaction.user.id, targetUser.id, interaction.user.username);
                            if (!robResult.success) {
                                if (robResult.cooldown) {
                                    const cooldownMs = robResult.cooldown;
                                    const timeStr = cooldownMs < 60000 
                                        ? `${Math.floor(cooldownMs / 1000)} seconds`
                                        : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                                    response = `🚔 Laying low after your last score. Wait ${timeStr} more.`;
                                } else {
                                    response = `❌ ${robResult.message}`;
                                }
                                break;
                            }
                            const robEmbed = new EmbedBuilder()
                                .setTitle(robResult.stolen > 0 ? '💰 Robbery Successful!' : '❌ Robbery Failed!')
                                .setDescription(robResult.stolen > 0 
                                    ? `You stole **${robResult.stolen}** Stark Bucks from ${targetUser}!`
                                    : `${robResult.message}`)
                                .setColor(robResult.stolen > 0 ? 0x2ecc71 : 0xe74c3c)
                                .addFields({ name: '💰 Your Balance', value: `${robResult.newBalance}`, inline: true })
                                .setFooter({ text: 'Crime doesn\'t always pay!' });
                            response = { embeds: [robEmbed] };
                            break;
                        }
                        default:
                            response = '❌ Unknown minigame subcommand.';
                    }
                    break;
                }
                // ============ MINIGAMES (Legacy - keeping for backwards compatibility) ============
                case 'hunt': {
                    telemetryMetadata.category = 'economy';
                    const huntResult = await starkEconomy.hunt(interaction.user.id);
                    if (!huntResult.success) {
                        const cooldownMs = huntResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🏹 You're tired from hunting. Rest for ${timeStr} more.`;
                        break;
                    }
                    const huntBoost = starkEconomy.getBoostText();
                    const huntEmbed = new EmbedBuilder()
                        .setTitle('🏹 Hunt Results')
                        .setDescription(huntResult.reward > 0 
                            ? `You caught a **${huntResult.outcome}**!\n+**${huntResult.reward}** Stark Bucks${huntBoost}`
                            : `${huntResult.outcome}... The animals got away!`)
                        .setColor(huntResult.reward > 0 ? 0x2ecc71 : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${huntResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Hunt again in 1 minute' });
                    response = { embeds: [huntEmbed] };
                    break;
                }
                case 'fish': {
                    telemetryMetadata.category = 'economy';
                    const fishResult = await starkEconomy.fish(interaction.user.id);
                    if (!fishResult.success) {
                        const cooldownMs = fishResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🎣 Your fishing rod needs to dry. Wait ${timeStr} more.`;
                        break;
                    }
                    const fishBoost = starkEconomy.getBoostText();
                    const fishEmbed = new EmbedBuilder()
                        .setTitle('🎣 Fishing Results')
                        .setDescription(fishResult.reward > 0 
                            ? `You caught a **${fishResult.outcome}**!\n+**${fishResult.reward}** Stark Bucks${fishBoost}`
                            : `${fishResult.outcome}... Nothing bit today!`)
                        .setColor(fishResult.reward > 0 ? 0x3498db : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${fishResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Fish again in 1 minute' });
                    response = { embeds: [fishEmbed] };
                    break;
                }
                case 'dig': {
                    telemetryMetadata.category = 'economy';
                    const digResult = await starkEconomy.dig(interaction.user.id);
                    if (!digResult.success) {
                        const cooldownMs = digResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `⛏️ Your shovel is broken. Wait ${timeStr} more.`;
                        break;
                    }
                    const digBoost = starkEconomy.getBoostText();
                    const digEmbed = new EmbedBuilder()
                        .setTitle('⛏️ Dig Results')
                        .setDescription(digResult.reward > 0 
                            ? `You found **${digResult.outcome}**!\n+**${digResult.reward}** Stark Bucks${digBoost}`
                            : `${digResult.outcome}... Nothing but dirt!`)
                        .setColor(digResult.reward > 0 ? 0xf1c40f : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${digResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Dig again in 1 minute' });
                    response = { embeds: [digEmbed] };
                    break;
                }
                case 'beg': {
                    telemetryMetadata.category = 'economy';
                    const begResult = await starkEconomy.beg(interaction.user.id);
                    if (!begResult.success) {
                        const cooldownMs = begResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🙏 People are avoiding you. Try again in ${timeStr}.`;
                        break;
                    }
                    const begBoost = starkEconomy.getBoostText();
                    const begEmbed = new EmbedBuilder()
                        .setTitle('🙏 Begging Results')
                        .setDescription(begResult.reward > 0 
                            ? `**${begResult.outcome}** **${begResult.reward}** Stark Bucks!${begBoost}`
                            : `${begResult.outcome}... Better luck next time!`)
                        .setColor(begResult.reward > 0 ? 0x9b59b6 : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${begResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Beg again in 1 minute' });
                    response = { embeds: [begEmbed] };
                    break;
                }
                case 'crime': {
                    telemetryMetadata.category = 'economy';
                    const crimeResult = await starkEconomy.crime(interaction.user.id);
                    if (!crimeResult.success) {
                        const cooldownMs = crimeResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🚔 Laying low after your last crime. Wait ${timeStr} more.`;
                        break;
                    }
                    const crimeBoost = starkEconomy.getBoostText();
                    const crimeEmbed = new EmbedBuilder()
                        .setTitle('🔫 Crime Results')
                        .setDescription(crimeResult.reward >= 0 
                            ? `**${crimeResult.outcome}**\n${crimeResult.reward > 0 ? `+**${crimeResult.reward}** Stark Bucks${crimeBoost}` : 'No reward this time...'}`
                            : `**${crimeResult.outcome}**\n-**${Math.abs(crimeResult.reward)}** Stark Bucks`)
                        .setColor(crimeResult.reward > 0 ? 0x2ecc71 : crimeResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${crimeResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Crime doesn\'t always pay!' });
                    response = { embeds: [crimeEmbed] };
                    break;
                }
                case 'postmeme': {
                    telemetryMetadata.category = 'economy';
                    const memeResult = await starkEconomy.postmeme(interaction.user.id);
                    if (!memeResult.success) {
                        const cooldownMs = memeResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `📱 Still waiting for engagement on your last post. Try again in ${timeStr}.`;
                        break;
                    }
                    const memeBoost = starkEconomy.getBoostText();
                    const memeEmbed = new EmbedBuilder()
                        .setTitle('📱 Meme Posted!')
                        .setDescription(memeResult.reward > 0 
                            ? `**${memeResult.outcome}**\n+**${memeResult.reward}** Stark Bucks${memeBoost}`
                            : `**${memeResult.outcome}**`)
                        .setColor(memeResult.reward > 100 ? 0xf1c40f : memeResult.reward > 0 ? 0x3498db : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${memeResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Quality content = Quality rewards' });
                    response = { embeds: [memeEmbed] };
                    break;
                }
                case 'searchlocation': {
                    telemetryMetadata.category = 'economy';
                    const locationChoice = interaction.options.getString('location');
                    const locationIndex = locationChoice ? parseInt(locationChoice) : null;
                    const searchResult = await starkEconomy.search(interaction.user.id, locationIndex);
                    if (!searchResult.success) {
                        const cooldownMs = searchResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🔍 You're too tired to search. Rest for ${timeStr} more.`;
                        break;
                    }
                    const searchBoost = starkEconomy.getBoostText();
                    const searchEmbed = new EmbedBuilder()
                        .setTitle('🔍 Search Results')
                        .setDescription(`You searched **${searchResult.location}**...\n\n${searchResult.outcome}${searchResult.reward > 0 ? `\n+**${searchResult.reward}** Stark Bucks${searchBoost}` : searchResult.reward < 0 ? `\n-**${Math.abs(searchResult.reward)}** Stark Bucks` : ''}`)
                        .setColor(searchResult.reward > 0 ? 0x2ecc71 : searchResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${searchResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Search again in 1 minute' });
                    response = { embeds: [searchEmbed] };
                    break;
                }
                case 'give': {
                    telemetryMetadata.category = 'economy';
                    const targetUser = interaction.options.getUser('user');
                    const giveAmount = interaction.options.getInteger('amount');
                    
                    if (targetUser.bot) {
                        response = '❌ Cannot give money to bots, sir.';
                        break;
                    }
                    
                    const giveResult = await starkEconomy.give(
                        interaction.user.id, 
                        targetUser.id, 
                        giveAmount,
                        interaction.user.username,
                        targetUser.username
                    );
                    
                    if (!giveResult.success) {
                        response = `❌ ${giveResult.error}`;
                        break;
                    }
                    
                    const giveEmbed = new EmbedBuilder()
                        .setTitle('💸 Transfer Complete!')
                        .setDescription(`You gave **${giveResult.amount}** Stark Bucks to **${targetUser.username}**!`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: 'Your Balance', value: `${giveResult.fromBalance}`, inline: true },
                            { name: `${targetUser.username}'s Balance`, value: `${giveResult.toBalance}`, inline: true }
                        )
                        .setFooter({ text: 'Generosity is a virtue!' });
                    response = { embeds: [giveEmbed] };
                    break;
                }
                case 'show': {
                    telemetryMetadata.category = 'economy';
                    const showUser = await starkEconomy.loadUser(interaction.user.id, interaction.user.username);
                    const multiplierStatus = starkEconomy.getMultiplierStatus();
                    
                    const showEmbed = new EmbedBuilder()
                        .setTitle(`💰 ${interaction.user.username}'s Stark Bucks`)
                        .setColor(0xf1c40f)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '💵 Balance', value: `**${showUser.balance.toLocaleString()}** Stark Bucks`, inline: true },
                            { name: '📈 Total Earned', value: `${(showUser.totalEarned || 0).toLocaleString()}`, inline: true },
                            { name: '🎮 Games Played', value: `${showUser.gamesPlayed || 0}`, inline: true },
                            { name: '🏆 Games Won', value: `${showUser.gamesWon || 0}`, inline: true },
                            { name: '🔥 Daily Streak', value: `${showUser.dailyStreak || 0} days`, inline: true }
                        );
                    
                    if (multiplierStatus.active) {
                        showEmbed.addFields({ 
                            name: '🎉 EVENT ACTIVE!', 
                            value: `**${multiplierStatus.multiplier}x MULTIPLIER (${multiplierStatus.multiplier * 100}%)!**`, 
                            inline: false 
                        });
                    }
                    
                    showEmbed.setFooter({ text: 'Flex those Stark Bucks!' });
                    response = { embeds: [showEmbed] };
                    break;
                }
                // ============ SELFHOST-ONLY COMMANDS (requires filesystem access) ============
                case 'selfmod': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'This feature requires selfhost mode (filesystem access), sir.';
                        break;
                    }

                    const subcommand = interaction.options.getSubcommand();

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
                    break;
                }
                case 'sentient': {
                    telemetryMetadata.category = 'experimental';
                    const { isOwner } = require('../utils/owner-check');
                    const isOwnerUser = isOwner(interaction.user.id);
                    const sentienceEnabled = isOwnerUser || (guild ? selfhostFeatures.isSentienceEnabled(guild.id) : false);
                    if (!sentienceEnabled) {
                        response = 'Sentient agent is only available in servers with sentience enabled, sir.';
                        break;
                    }

                    const subcommand = interaction.options.getSubcommand();
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
                            return '█'.repeat(filled) + '░'.repeat(empty) + ` ${val}%`;
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
                             response = `Indubitably peak, sir. 🏔️🔥`;
                             await interaction.editReply(response);
                             return response;
                        }
                        
                        // === QUEUE SYSTEM: Max 2 concurrent thinking per guild ===
                        if (!global.sentientThinkQueue) global.sentientThinkQueue = new Map();
                        // Prune stale zero-count entries periodically
                        if (global.sentientThinkQueue.size > 100) {
                            for (const [k, v] of global.sentientThinkQueue) {
                                if (v <= 0) global.sentientThinkQueue.delete(k);
                            }
                        }
                        const guildQueue = global.sentientThinkQueue;
                        const gId = guildId || 'dm';
                        const currentCount = guildQueue.get(gId) || 0;
                        
                        if (currentCount >= 2) {
                            response = `⏳ **Queue Full!** There are already 2 thinking sessions in progress. Please wait...`;
                            await interaction.editReply(response);
                            return response;
                        }
                        
                        // Add to queue
                        guildQueue.set(gId, currentCount + 1);
                        
                        // Cleanup helper
                        const releaseQueue = () => {
                            const curr = guildQueue.get(gId) || 0;
                            if (curr > 0) guildQueue.set(gId, curr - 1);
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
                        let loadingMsgIndex = 0;
                        const loadingInterval = setInterval(async () => {
                            const msg = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
                            await interaction.editReply(`${loadingEmoji} ${msg}`).catch(() => {});
                        }, 2500);

                        // Initial loading message
                        await interaction.editReply(`${loadingEmoji} Engaging consciousness matrix...`);

                        // Get AI manager for real AI responses
                        const aiManager = require('./ai-providers');
                        
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
                            const aiResponse = await aiManager.generateResponse(
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
                                await interaction.editReply(`**Thought for: 27 hours and 42 seconds**\n\nI don't really know.`);
                                
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
                                return elapsed > 1000 ? `${(elapsed/1000).toFixed(1)}s` : `${elapsed}ms`;
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
                                    
                                    await interaction.editReply(`${buildHeader(getTimeStr())}\n\n${casualResponse.content || '*crickets*'}`);
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
                                        await interaction.editReply(`${getRandomMsgWithEmoji()}${fullContent}`);
                                    } catch (e) { /* ignore */ }
                                    
                                    // Brief pause for visual feedback (only after first phase)
                                    if (i > 0) await new Promise(r => setTimeout(r, 1500));
                                    
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
                                    const newBlock = `\n\n**[Phase ${i+1}: ${phase.name}]**\n${phaseText}`;
                                    fullContent += newBlock;
                                    
                                    // Update with simple header
                                    try {
                                        // content limit safety 
                                        let msgContent = `${buildHeader(getTimeStr())}${fullContent}`;
                                        if (msgContent.length > 1990) {
                                            msgContent = msgContent.substring(0, 1990) + '...';
                                        }
                                        await interaction.editReply(msgContent);
                                    } catch (e) { 
                                        console.error('Edit failed:', e);
                                    }
                                }
                                
                                // Final update to ensure loading emoji is gone
                                try {
                                    let finalMsg = `${buildHeader(getTimeStr())}${fullContent}`;
                                    if (finalMsg.length > 1990) {
                                         finalMsg = finalMsg.substring(0, 1990) + '...';
                                    }
                                    await interaction.editReply(finalMsg);
                                } catch (e) {
                                    console.error('Final edit failed:', e);
                                }
                                
                                response = '__SENTIENT_HANDLED__';
                            }

                            // Silently run OODA loop and record success in soul
                            sentientAgent.process(prompt).catch(e => console.error('OODA:', e));
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
    // 1. Immediate Owner Check
    const { isOwner } = require('../utils/owner-check');
    if (!isOwner(interaction.user.id)) {
        response = '⛔ This command is restricted, sir.';
        await interaction.editReply(response); 
        return; // Stop execution here
    }

    // 2. Authorized logic
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
                    } else if (subcommand === 'autonomous') {
                        const enabled = interaction.options.getBoolean('enabled');

                        // Only allow admin to enable autonomous mode (check both config and env)
                        const adminId = config.admin?.userId || process.env.ADMIN_USER_ID;
                        if (enabled && adminId && interaction.user.id !== adminId) {
                            response = `⚠️ Only the bot administrator can enable autonomous mode, sir. (Your ID: ${interaction.user.id})`;
                            break;
                        }

                        sentientAgent.setAutonomousMode(enabled);

                        if (enabled) {
                            response = `⚠️ **AUTONOMOUS MODE ENABLED**\n\n*Jarvis can now perform up to 10 safe actions independently.*\n*Dangerous operations still require approval.*\n\n🔴 **Use with caution on isolated systems only!**`;
                        } else {
                            response = `✅ Autonomous mode disabled. All actions now require explicit commands.`;
                        }
                    } else if (subcommand === 'agis') {
                        const { getAGIS } = require('../core/agis');
                        const agis = getAGIS({ aiManager: require('./ai-providers') });
                        const goal = interaction.options.getString('goal');

                        if (!agis.enabled) {
                            response = 'A.G.I.S. is only available in selfhost mode, sir.';
                            break;
                        }

                        if (!goal) {
                            // Show AGIS status
                            const status = agis.getStatus();
                            const activePlans = Array.from(agis.plans.values())
                                .filter(p => p.status !== 'completed')
                                .slice(0, 3);

                            let planList = 'No active plans.';
                            if (activePlans.length > 0) {
                                planList = activePlans.map(p => {
                                    const done = p.steps.filter(s => s.status === 'completed').length;
                                    return `**${p.id}** — ${p.goal.substring(0, 60)}\n  ${done}/${p.steps.length} steps complete (${p.status})`;
                                }).join('\n\n');
                            }

                            const statusEmbed = new EmbedBuilder()
                                .setTitle('🧠 A.G.I.S. — System Status')
                                .setColor(status.activePlans > 0 ? 0x00bfff : 0x555555)
                                .addFields(
                                    { name: 'Status', value: status.enabled ? '🟢 Online' : '🔴 Offline', inline: true },
                                    { name: 'Active Plans', value: String(status.activePlans), inline: true },
                                    { name: 'Completed Plans', value: String(status.completedPlans), inline: true },
                                    { name: 'Active Goals', value: String(status.activeGoals), inline: true },
                                    { name: 'Uptime', value: `${status.uptime}s`, inline: true },
                                    { name: 'Recent Actions', value: String(status.context.recentActions), inline: true },
                                    { name: 'Plans', value: planList.substring(0, 1024) }
                                )
                                .setFooter({ text: 'Artificial General Intelligent System' })
                                .setTimestamp();

                            response = { embeds: [statusEmbed] };
                        } else {
                            // Decompose a goal into a plan
                            const plan = await agis.decompose(goal);

                            if (plan.error) {
                                response = `⚠️ ${plan.error}`;
                                break;
                            }

                            const stepsText = plan.steps.map((s, i) =>
                                `${i + 1}. ${s.description}`
                            ).join('\n');

                            const planEmbed = new EmbedBuilder()
                                .setTitle('🧠 A.G.I.S. — Plan Created')
                                .setColor(0x00bfff)
                                .setDescription(`**Goal:** ${goal}`)
                                .addFields(
                                    { name: 'Plan ID', value: `\`${plan.id}\``, inline: true },
                                    { name: 'Steps', value: String(plan.steps.length), inline: true },
                                    { name: 'Status', value: plan.status, inline: true },
                                    { name: 'Action Plan', value: stepsText.substring(0, 1024) }
                                )
                                .setFooter({ text: 'Use /sentient agis (no goal) to check plan progress' })
                                .setTimestamp();

                            response = { embeds: [planEmbed] };
                        }
                    }
                    break;
                }
                // ============ END SELFHOST-ONLY COMMANDS ============
                case 't': {
                    telemetryMetadata.category = 'utilities';
                    const query = (interaction.options.getString('query') || '').trim();

                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a search query, sir.';
                        break;
                    }

                    const allowedChannelIds = (config.commands?.whitelistedChannelIds || []).map((id) => String(id));
                    if (interaction.guild && !allowedChannelIds.includes(String(interaction.channelId))) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'channel-restricted';
                        response = 'This command is restricted to authorised channels, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleUtilityCommand(
                            `!t ${query}`,
                            interaction.user.username,
                            userId,
                            true,
                            interaction,
                            guildId
                        );
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Knowledge search command failed:', error);
                        response = 'Knowledge archives are unreachable right now, sir.';
                    }
                    break;
                }
                case 'yt': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a YouTube search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleYouTubeSearch(query);
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('YouTube search command failed:', error);
                        response = 'YouTube search failed, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'search': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a web search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleBraveSearch({
                            raw: query,
                            prepared: query,
                            invocation: query,
                            content: query,
                            rawMessage: query,
                            rawInvocation: query,
                            explicit: false
                        });
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Web search command failed:', error);
                        response = 'Web search is currently unavailable, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'math': {
                    telemetryMetadata.category = 'utilities';
                    const expression = (interaction.options.getString('expression') || '').trim();
                    if (!expression.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-expression';
                        response = 'Please provide something to calculate, sir.';
                        break;
                    }

                    try {
                        const result = await this.jarvis.handleMathCommand(expression);
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor(0x0078d4)
                            .setTitle('📐 Mathematics')
                            .addFields(
                                { name: 'Input', value: `\`\`\`${expression}\`\`\``, inline: false },
                                { name: 'Result', value: `\`\`\`${result}\`\`\``, inline: false }
                            )
                            .setFooter({ text: 'Jarvis Math Engine • Powered by Nerdamer' })
                            .setTimestamp();
                        response = { embeds: [embed] };
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Math command failed:', error);
                        response = 'Mathematics subsystem encountered an error, sir. Please verify the expression.';
                    }
                    break;
                }
                case 'jarvis': {
                    let prompt = interaction.options.getString('prompt') || '';

                    // Fuh Naw bypass
                    if (prompt && /\bis\s+this\s+tuff\b/i.test(prompt)) {
                         const emojiString = '<:wilted_rose:1462415423327703260>';
                         response = `Fuh naw, sir 💔 ${emojiString}`;
                         break;
                    }

                    // Peak bypass
                    if (prompt && /\bis\s+this\s+peak\b/i.test(prompt)) {
                         response = `Indubitably peak, sir. 🏔️🔥`;
                         break;
                    }

                    try {
                        const guild = interaction.guild || (interaction.guildId
                            ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null)
                            : null);

                        if (guild) {
                            const userIds = Array.from(prompt.matchAll(/<@!?(\d{17,20})>/g)).map(match => match[1]);
                            for (const mentionedUserId of new Set(userIds)) {
                                const member = guild.members.cache.get(mentionedUserId)
                                    || await guild.members.fetch(mentionedUserId).catch(() => null);
                                const displayName = member?.displayName
                                    || member?.user?.globalName
                                    || member?.user?.username
                                    || 'user';
                                prompt = prompt.replace(new RegExp(`<@!?${mentionedUserId}>`, 'g'), `@${displayName}`);
                            }

                            const roleIds = Array.from(prompt.matchAll(/<@&(\d{17,20})>/g)).map(match => match[1]);
                            for (const mentionedRoleId of new Set(roleIds)) {
                                const role = guild.roles.cache.get(mentionedRoleId)
                                    || await guild.roles.fetch(mentionedRoleId).catch(() => null);
                                const roleName = role?.name || 'role';
                                prompt = prompt.replace(new RegExp(`<@&${mentionedRoleId}>`, 'g'), `@${roleName}`);
                            }

                            const channelIds = Array.from(prompt.matchAll(/<#(\d{17,20})>/g)).map(match => match[1]);
                            for (const mentionedChannelId of new Set(channelIds)) {
                                const channel = guild.channels.cache.get(mentionedChannelId)
                                    || await guild.channels.fetch(mentionedChannelId).catch(() => null);
                                const channelName = channel?.name || 'channel';
                                prompt = prompt.replace(new RegExp(`<#${mentionedChannelId}>`, 'g'), `#${channelName}`);
                            }
                        }
                    } catch (error) {
                        console.warn('Failed to resolve mention display names for /jarvis prompt:', error);
                    }

                    try {
                        if (interaction.client?.user?.id) {
                            prompt = prompt.replace(new RegExp(`<@!?${interaction.client.user.id}>`, 'g'), '').trim();
                        }
                    } catch (_) {}

                    prompt = prompt
                        .replace(/@everyone/g, '')
                        .replace(/@here/g, '')
                        .trim();

                    if (!prompt) {
                        prompt = 'jarvis';
                    }

                    if (prompt.length > config.ai.maxSlashInputLength) {
                        const responses = [
                            "Rather verbose, sir. A concise version, perhaps?",
                            "Too many words, sir. Brevity, please.",
                            "TL;DR, sir.",
                            "Really, sir?",
                            "Saving your creativity for later, sir.",
                            `${config.ai.maxSlashInputLength} characters is the limit, sir.`,
                            "Stop yapping, sir.",
                            "Quite the novella, sir. Abridged edition?",
                            "Brevity is the soul of wit, sir.",
                        ];

                        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'prompt-too-long';
                        return;
                    }

                    if (prompt.length > config.ai.maxInputLength) {
                        prompt = `${prompt.substring(0, config.ai.maxInputLength)}...`;
                    }

                    // Extract image attachment if provided (for vision processing)
                    const imageAttachment = interaction.options.getAttachment('image');
                    const imageAttachments = [];
                    if (imageAttachment) {
                        const contentType = imageAttachment.contentType || '';
                        const ext = (imageAttachment.name || '').split('.').pop()?.toLowerCase();
                        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                        if (contentType.startsWith('image/') || imageExts.includes(ext)) {
                            imageAttachments.push({ url: imageAttachment.url, contentType: imageAttachment.contentType });
                        }
                    }

                    response = await this.jarvis.generateResponse(interaction, prompt, true, null, imageAttachments);
                    break;
                }
                case 'roll': {
                    const sides = interaction.options.getInteger('sides') || 6;
                    response = await this.jarvis.handleUtilityCommand(
                        `roll ${sides}`,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'time': {
                    response = await this.jarvis.handleUtilityCommand(
                        'time',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'reset': {
                    response = await this.jarvis.handleUtilityCommand(
                        'reset',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'help': {
                    response = await this.jarvis.handleUtilityCommand(
                        'help',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'profile': {
                    response = await this.jarvis.handleUtilityCommand(
                        'profile',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'history': {
                    response = await this.jarvis.handleUtilityCommand(
                        'history',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'recap': {
                    response = await this.jarvis.handleUtilityCommand(
                        'recap',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'digest': {
                    response = await this.jarvis.handleUtilityCommand(
                        'digest',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'encode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'encode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'decode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'decode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'pwdgen': {
                    telemetryMetadata.category = 'utilities';
                    try {
                        const crypto = require('crypto');
                        const lengthRaw = interaction.options.getInteger('length');
                        const length = Math.max(8, Math.min(64, Number.isFinite(lengthRaw) ? lengthRaw : 16));
                        const includeSymbols = interaction.options.getBoolean('symbols') !== false;

                        const lowers = 'abcdefghijklmnopqrstuvwxyz';
                        const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                        const digits = '0123456789';
                        const symbols = '!@#$%^&*()-_=+[]{};:,.?/';

                        let pool = lowers + uppers + digits;
                        if (includeSymbols) pool += symbols;

                        // Ensure at least one from each required class
                        const required = [
                            lowers[crypto.randomInt(lowers.length)],
                            uppers[crypto.randomInt(uppers.length)],
                            digits[crypto.randomInt(digits.length)],
                        ];
                        if (includeSymbols) {
                            required.push(symbols[crypto.randomInt(symbols.length)]);
                        }

                        if (length < required.length) {
                            response = 'Length too short for the selected character requirements, sir.';
                            break;
                        }

                        const chars = [...required];
                        while (chars.length < length) {
                            chars.push(pool[crypto.randomInt(pool.length)]);
                        }

                        // Fisher-Yates shuffle
                        for (let i = chars.length - 1; i > 0; i--) {
                            const j = crypto.randomInt(i + 1);
                            [chars[i], chars[j]] = [chars[j], chars[i]];
                        }

                        const password = chars.join('');
                        response = {
                            content: `Here is your generated password (keep it private), sir:\n\n\`\`\`${password}\`\`\``,
                        };
                    } catch (error) {
                        try {
                            const errorLogger = require('./error-logger');
                            await errorLogger.log({
                                error,
                                context: {
                                    location: 'slash:pwdgen',
                                    user: `${interaction.user.username} (${interaction.user.id})`,
                                    guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                                    channel: `${interaction.channelId}`,
                                    command: 'pwdgen'
                                }
                            });
                        } catch (_logErr) { /* error logger failed */ }
                        response = 'Password generator failed, sir.';
                    }
                    break;
                }
                case 'qrcode': {
                    telemetryMetadata.category = 'utilities';
                    try {
                        const { AttachmentBuilder } = require('discord.js');
                        const text = (interaction.options.getString('text') || '').trim();
                        if (!text.length) {
                            response = 'Provide text to encode, sir.';
                            break;
                        }

                        // Prefer local qrcode library if installed, fallback to a remote QR image endpoint.
                        let pngBuffer = null;
                        try {
                            const qrcode = require('qrcode');
                            pngBuffer = await qrcode.toBuffer(text, {
                                type: 'png',
                                errorCorrectionLevel: 'M',
                                margin: 2,
                                width: 512,
                            });
                        } catch {
                            const allowExternalFallback = String(process.env.ALLOW_QR_EXTERNAL_FALLBACK || '1').toLowerCase() === '1';
                            if (!allowExternalFallback) {
                                throw new Error('External QR fallback disabled');
                            }
                            const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`;
                            const res = await fetch(url);
                            if (!res.ok) {
                                throw new Error(`QR service failed: ${res.status}`);
                            }
                            const arr = await res.arrayBuffer();
                            pngBuffer = Buffer.from(arr);
                        }

                        const attachment = new AttachmentBuilder(pngBuffer, { name: 'qrcode.png' });
                        response = {
                            content: 'QR code generated, sir.',
                            files: [attachment]
                        };
                    } catch (error) {
                        try {
                            const errorLogger = require('./error-logger');
                            await errorLogger.log({
                                error,
                                context: {
                                    location: 'slash:qrcode',
                                    user: `${interaction.user.username} (${interaction.user.id})`,
                                    guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                                    channel: `${interaction.channelId}`,
                                    command: 'qrcode'
                                }
                            });
                        } catch (_logErr) { /* error logger failed */ }
                        response = 'QR code generation failed, sir.';
                    }
                    break;
                }
                // ============ MODERATION SLASH COMMANDS ============
                case 'ban': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const duration = interaction.options.getString('duration');
                    const reason = interaction.options.getString('reason') || `Banned by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }
                    // Self-targeting check
                    if (targetUser.id === interaction.user.id) {
                        response = '❌ You cannot ban yourself.';
                        break;
                    }
                    // Server owner check
                    if (targetUser.id === interaction.guild.ownerId) {
                        response = '❌ You cannot ban the server owner.';
                        break;
                    }
                    // Role hierarchy check (moderator vs target)
                    if (targetMember) {
                        const executor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                        if (executor && targetMember.roles.highest.position >= executor.roles.highest.position) {
                            response = '❌ You cannot ban members with equal or higher roles than you.';
                            break;
                        }
                    }
                    if (targetMember && !targetMember.bannable) {
                        response = '❌ I cannot ban that member (role hierarchy issue).';
                        break;
                    }
                    
                    // Parse duration using shared utility
                    const { parseDuration, formatDuration } = require('../utils/parse-duration');
                    let banDuration = null;
                    if (duration) {
                        banDuration = parseDuration(duration);
                    }
                    
                    try {
                        await interaction.guild.members.ban(targetUser.id, { reason, deleteMessageSeconds: 0 });
                        
                        let durationText = 'permanently';
                        if (banDuration) {
                            const mins = Math.floor(banDuration / 60000);
                            const hours = Math.floor(mins / 60);
                            const days = Math.floor(hours / 24);
                            if (days > 0) durationText = `for ${days} day(s)`;
                            else if (hours > 0) durationText = `for ${hours} hour(s)`;
                            else durationText = `for ${mins} minute(s)`;
                            
                            // Schedule unban
                            setTimeout(async () => {
                                try {
                                    await interaction.guild.members.unban(targetUser.id, 'Temporary ban expired');
                                } catch (_e) { console.warn('[ban] Auto-unban failed:', _e.message); }
                            }, banDuration);
                        }
                        
                        response = `🔨 **${targetUser.tag}** has been banned ${durationText}.`;
                        // Send GIF as followup so it embeds properly
                        setTimeout(() => {
                            interaction.followUp('https://c.tenor.com/9zCgefg___cAAAAC/tenor.gif').catch(() => {});
                        }, 500);
                    } catch (error) {
                        response = `❌ Ban failed: ${error.message}`;
                    }
                    break;
                }
                case 'unban': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const reason = interaction.options.getString('reason') || `Unbanned by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }
                    
                    try {
                        await interaction.guild.members.unban(targetUser.id, reason);
                        response = `🔓 **${targetUser.tag}** has been unbanned.`;
                    } catch (error) {
                        response = `❌ Unban failed: ${error.message}`;
                    }
                    break;
                }
                case 'kick': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const reason = interaction.options.getString('reason') || `Kicked by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }
                    if (!targetMember) { response = '❌ User not found in this server.'; break; }
                    // Self-targeting check
                    if (targetUser.id === interaction.user.id) {
                        response = '❌ You cannot kick yourself.';
                        break;
                    }
                    // Server owner check
                    if (targetUser.id === interaction.guild.ownerId) {
                        response = '❌ You cannot kick the server owner.';
                        break;
                    }
                    // Role hierarchy check (moderator vs target)
                    const kickExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                    if (kickExecutor && targetMember.roles.highest.position >= kickExecutor.roles.highest.position) {
                        response = '❌ You cannot kick members with equal or higher roles than you.';
                        break;
                    }
                    if (!targetMember.kickable) { response = '❌ I cannot kick that member.'; break; }
                    
                    try {
                        await targetMember.kick(reason);
                        response = `👢 **${targetUser.tag}** has been kicked.\nReason: ${reason}`;
                    } catch (error) {
                        response = `❌ Kick failed: ${error.message}`;
                    }
                    break;
                }
                case 'unmute': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const reason = interaction.options.getString('reason') || `Unmuted by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser || !targetMember) { response = `❌ ${resolveError || 'User not found in this server.'}`; break; }
                    if (!targetMember) { response = '❌ User not found in this server.'; break; }
                    
                    try {
                        // Remove timeout
                        await targetMember.timeout(null, reason);
                        response = `🔊 **${targetUser.tag}** has been unmuted.`;
                    } catch (error) {
                        response = `❌ Unmute failed: ${error.message}`;
                    }
                    break;
                }
                case 'mute': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const duration = interaction.options.getString('duration', true);
                    const reason = interaction.options.getString('reason') || `Muted by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser || !targetMember) { response = `❌ ${resolveError || 'User not found in this server.'}`; break; }
                    if (!targetMember) { response = '❌ User not found in this server.'; break; }
                    // Self-targeting check
                    if (targetUser.id === interaction.user.id) {
                        response = '❌ You cannot mute yourself.';
                        break;
                    }
                    // Server owner check
                    if (targetUser.id === interaction.guild.ownerId) {
                        response = '❌ You cannot mute the server owner.';
                        break;
                    }
                    // Role hierarchy check (moderator vs target)
                    const muteExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                    if (muteExecutor && targetMember.roles.highest.position >= muteExecutor.roles.highest.position) {
                        response = '❌ You cannot mute members with equal or higher roles than you.';
                        break;
                    }
                    if (!targetMember.moderatable) { response = '❌ I cannot mute that member.'; break; }
                    
                    // Parse duration using shared utility
                    const { parseDuration, MAX_TIMEOUT_MS } = require('../utils/parse-duration');
                    const durationMs = parseDuration(duration);
                    if (!durationMs) { response = '❌ Invalid duration. Use format like 10m, 1h, 1d'; break; }
                    
                    if (durationMs > 28 * 24 * 60 * 60 * 1000) { response = '❌ Maximum mute is 28 days.'; break; }
                    
                    try {
                        await targetMember.timeout(durationMs, reason);
                        response = `🔇 **${targetUser.tag}** has been muted for **${duration}**.\nReason: ${reason}`;
                    } catch (error) {
                        response = `❌ Mute failed: ${error.message}`;
                    }
                    break;
                }
                case 'warn': {
                    telemetryMetadata.category = 'moderation';
                    const userInput = interaction.options.getString('user', true);
                    const reason = interaction.options.getString('reason', true);
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const { resolveUser } = require('../utils/resolve-user');
                    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
                    if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }
                    
                    // Store warning in database
                    const guildId = interaction.guild.id;
                    const userId = targetUser.id;

                    let warningCount = 1;
                    try {
                        const warningDoc = {
                            guildId,
                            userId,
                            reason,
                            warnedBy: interaction.user.id,
                            timestamp: new Date()
                        };
                        if (database.isConnected) {
                            const col = database.db.collection('warnings');
                            await col.insertOne(warningDoc);
                            warningCount = await col.countDocuments({ guildId, userId });
                        }
                    } catch (dbErr) {
                        console.warn('[warn] Failed to persist warning:', dbErr.message);
                    }
                    const userWarnings = { length: warningCount };
                    
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ Warning Issued')
                        .setColor(0xf39c12)
                        .setDescription(`**${targetUser.tag}** has been warned.`)
                        .addFields(
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Total Warnings', value: `${userWarnings.length}`, inline: true }
                        )
                        .setFooter({ text: `Warned by ${interaction.user.tag}` })
                        .setTimestamp();
                    
                    // Try to DM user (may fail if DMs are closed)
                    try { await targetUser.send(`⚠️ You have been warned in **${interaction.guild.name}**\nReason: ${reason}`); } catch (_e) { /* DMs disabled */ }
                    
                    response = { embeds: [embed] };
                    break;
                }
                case 'purge': {
                    telemetryMetadata.category = 'moderation';
                    const count = interaction.options.getInteger('count', true);
                    const targetUser = interaction.options.getUser('user');
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    if (!interaction.channel) { response = '❌ Cannot access channel.'; break; }
                    
                    try {
                        let messages;
                        if (targetUser) {
                            // Fetch more messages to filter by user
                            const fetched = await interaction.channel.messages.fetch({ limit: 100 });
                            messages = fetched.filter(m => m.author.id === targetUser.id).first(count);
                        } else {
                            messages = await interaction.channel.messages.fetch({ limit: count });
                        }
                        
                        const deleted = await interaction.channel.bulkDelete(messages, true);
                        response = `🗑️ Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}.${targetUser ? ` (from ${targetUser.tag})` : ''}`;
                    } catch (error) {
                        response = `❌ Purge failed: ${error.message}`;
                    }
                    break;
                }
                case 'slowmode': {
                    telemetryMetadata.category = 'moderation';
                    const durationStr = interaction.options.getString('duration', true);
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    if (!interaction.channel || !interaction.channel.setRateLimitPerUser) {
                        response = '❌ Cannot modify this channel type.';
                        break;
                    }
                    
                    // Parse duration (0 to disable)
                    let seconds = 0;
                    if (durationStr !== '0' && durationStr !== 'off') {
                        const { parseDuration } = require('../utils/parse-duration');
                        const ms = parseDuration(durationStr);
                        if (!ms) {
                            response = '❌ Invalid duration. Use format like `5s`, `1m`, `0` to disable.';
                            break;
                        }
                        seconds = Math.floor(ms / 1000);
                        if (seconds > 21600) { // 6 hours max
                            response = '❌ Maximum slowmode is 6 hours (21600 seconds).';
                            break;
                        }
                    }
                    
                    try {
                        await interaction.channel.setRateLimitPerUser(seconds);
                        if (seconds === 0) {
                            response = '⚡ Slowmode disabled for this channel.';
                        } else {
                            response = `🐌 Slowmode set to **${durationStr}** for this channel.`;
                        }
                    } catch (error) {
                        response = `❌ Failed to set slowmode: ${error.message}`;
                    }
                    break;
                }
                case 'lockdown': {
                    telemetryMetadata.category = 'moderation';
                    const action = interaction.options.getString('action', true);
                    const reason = interaction.options.getString('reason') || `Channel ${action}ed by ${interaction.user.tag}`;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    if (!interaction.channel || !interaction.channel.permissionOverwrites) {
                        response = '❌ Cannot modify this channel type.';
                        break;
                    }
                    
                    try {
                        const everyone = interaction.guild.roles.everyone;
                        if (action === 'lock') {
                            await interaction.channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
                            response = `🔒 Channel locked.\nReason: ${reason}`;
                        } else {
                            await interaction.channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
                            response = `🔓 Channel unlocked.`;
                        }
                    } catch (error) {
                        response = `❌ Lockdown failed: ${error.message}`;
                    }
                    break;
                }
                case 'userinfo': {
                    telemetryMetadata.category = 'utility';
                    const targetUser = interaction.options.getUser('user') || interaction.user;
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                    
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`👤 ${targetUser.tag}`)
                        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
                        .setColor(member?.displayHexColor || 0x3498db)
                        .addFields(
                            { name: 'ID', value: targetUser.id, inline: true },
                            { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                            { name: 'Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }
                        );
                    
                    if (member) {
                        embed.addFields(
                            { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                            { name: 'Nickname', value: member.nickname || 'None', inline: true },
                            { name: 'Roles', value: member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'None', inline: true }
                        );
                        if (member.premiumSinceTimestamp) {
                            embed.addFields({ name: 'Boosting Since', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true });
                        }
                    }
                    
                    response = { embeds: [embed] };
                    break;
                }
                case 'serverinfo': {
                    telemetryMetadata.category = 'utility';
                    
                    if (!interaction.guild) { response = 'This command only works in servers.'; break; }
                    
                    const guild = interaction.guild;
                    const owner = await guild.fetchOwner().catch(() => null);
                    
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`🏰 ${guild.name}`)
                        .setThumbnail(guild.iconURL({ size: 256 }))
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: 'ID', value: guild.id, inline: true },
                            { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
                            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                            { name: 'Members', value: `${guild.memberCount.toLocaleString()}`, inline: true },
                            { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                            { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                            { name: 'Boost Level', value: `Tier ${guild.premiumTier}`, inline: true },
                            { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
                            { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true }
                        );
                    
                    if (guild.description) {
                        embed.setDescription(guild.description);
                    }
                    
                    response = { embeds: [embed] };
                    break;
                }
                default: {
                    response = await this.jarvis.handleUtilityCommand(
                        commandName,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                }
            }

            if (response === '__RAP_BATTLE_HANDLED__' || response === '__QUOTE_HANDLED__' || response === '__SENTIENT_HANDLED__') {
                // Rap battle handles its own responses, skip normal handling
                return;
            } else if (response === undefined || response === null) {
                console.warn('[/jarvis] Empty response received; commandName=' + commandName);
                try {
                    await interaction.editReply("Response circuits tangled, sir. Try again?");
                } catch (e) {
                    console.error('[/jarvis] Failed to editReply, trying followUp:', e.code, e.message);
                    await interaction.followUp("Response circuits tangled, sir. Try again?");
                }
                telemetryMetadata.reason = 'empty-response';
            } else if (typeof response === 'string') {
                // Strip [REACT:emoji] tag — slash commands can't react on the user's message
                let cleanedResponse = response;
                const slashReactMatch = response.match(/\[REACT:(.+?)\]\s*$/);
                if (slashReactMatch) {
                    cleanedResponse = response.replace(/\s*\[REACT:.+?\]\s*$/, '').trim();
                }
                const trimmed = cleanedResponse.trim();
                const safe = this.sanitizePings(trimmed);
                if (!safe.length) {
                    await interaction.editReply("Response circuits tangled, sir. Try again?");
                } else {
                    const chunks = splitMessage(safe);
                    try {
                        const sendPromise = interaction.editReply({ content: chunks[0], allowedMentions: { parse: [] } });
                        await Promise.race([
                            sendPromise,
                            new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                        ]);
                        for (let i = 1; i < chunks.length; i++) {
                            await interaction.followUp({ content: chunks[i], allowedMentions: { parse: [] } });
                        }
                    } catch (e) {
                        try {
                            await interaction.followUp({ content: chunks[0], allowedMentions: { parse: [] } });
                        } catch (followUpError) {
                            console.error('[/jarvis] Response send failed:', e.message, followUpError.message);
                        }
                    }
                }
            } else {
                try {
                    const payload = response && typeof response === 'object'
                        ? { ...response }
                        : { content: String(response || '') };
                    payload.allowedMentions = payload.allowedMentions || { parse: [] };
                    payload.allowedMentions.parse = Array.isArray(payload.allowedMentions.parse) ? payload.allowedMentions.parse : [];

                    const sendPromise = interaction.editReply(payload);
                    await Promise.race([
                        sendPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                    ]);
                } catch (e) {
                    try {
                        const payload = response && typeof response === 'object'
                            ? { ...response }
                            : { content: String(response || '') };
                        payload.allowedMentions = payload.allowedMentions || { parse: [] };
                        payload.allowedMentions.parse = Array.isArray(payload.allowedMentions.parse) ? payload.allowedMentions.parse : [];
                        await interaction.followUp(payload);
                    } catch (followUpError) {
                        console.error('[/jarvis] Embed send failed:', e.message, followUpError.message);
                    }
                }
            }
        } catch (error) {
            telemetryStatus = 'error';
            telemetryError = error;
            
            // Generate unique error code for debugging
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing interaction:`, error);

            // Report to error log channel for production triage
            try {
                const errorLogger = require('./error-logger');
                await errorLogger.log({
                    error,
                    errorId,
                    context: {
                        location: 'slash:handleSlashCommand',
                        user: `${interaction.user?.username || 'unknown'} (${interaction.user?.id || 'unknown'})`,
                        guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                        channel: `${interaction.channelId || 'unknown'}`,
                        command: `${interaction.commandName || 'unknown'}`,
                        extra: {
                            customId: interaction.customId,
                            options: interaction.options?._hoistedOptions || null
                        }
                    }
                });
            } catch {
                // ignore
            }
            
            try {
                const errorMessage = `Technical difficulties, sir. (${errorId}) Please try again shortly.`;
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply(errorMessage);
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply(errorMessage);
                }
            } catch (editError) {
                if (editError.code === 10062) {
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn(`[${errorId}] Ignored unknown interaction during error reply.`);
                } else {
                    console.error(`[${errorId}] Failed to send error reply:`, editError.code, editError.message);
                }
            }
            shouldSetCooldown = true;
        } finally {
            if (shouldSetCooldown) {
                this.setCooldown(userId, cooldownScope);
            }
            finalizeTelemetry();
        }
    }
