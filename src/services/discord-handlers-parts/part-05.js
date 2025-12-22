
    async handleSlashCommand(interaction) {
        const commandName = interaction.commandName;
        const userId = interaction.user.id;
        const guild = interaction.guild || null;
        const guildId = guild?.id || null;
        const cooldownScope = `slash:${commandName}`;
        const startedAt = Date.now();

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
            const sentienceEnabled = guild && isSentienceCommand ? selfhostFeatures.isSentienceEnabled(guild.id) : false;
            
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

            let announcementSubcommand = null;
            try {
                announcementSubcommand = interaction.options?.getSubcommand(false) || null;
            } catch (e) {
                announcementSubcommand = null;
            }

            if (commandName === 'announcement' && announcementSubcommand === 'create') {
                shouldSetCooldown = true;
                await this.handleAnnouncementCommand(interaction);
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

            switch (commandName) {
                case 'vibecheck': {
                    telemetryMetadata.category = 'fun';
                    await this.handleVibeCheckCommand(interaction);
                    return;
                }
                case 'bonk': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBonkCommand(interaction);
                    return;
                }
                case 'caption': {
                    telemetryMetadata.category = 'memes';
                    await this.handleCaptionCommand(interaction);
                    return;
                }
                case 'meme': {
                    telemetryMetadata.category = 'memes';
                    await this.handleMemeCommand(interaction);
                    return;
                }
                case 'banter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBanterCommand(interaction);
                    return;
                }
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleRoastCommand(interaction);
                    return;
                }
                case 'flatter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleFlatterCommand(interaction);
                    return;
                }
                case 'toast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleToastCommand(interaction);
                    return;
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
                case 'announcement': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleAnnouncementCommand(interaction);
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
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('target');
                    
                    if (!target) {
                        response = 'Please specify a target for the roast, sir.';
                        break;
                    }
                    
                    if (target.id === interaction.client.user.id) {
                        response = 'I appreciate the ambition, sir, but self-deprecation is beneath my programming.';
                        break;
                    }
                    
                    const roast = legacyCommands.generateRoast(target.displayName || target.username, interaction.user.username);
                    
                    const roastEmbed = new EmbedBuilder()
                        .setTitle('🔥 Roast Protocol Engaged')
                        .setDescription(roast)
                        .setColor(0xe74c3c)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 128 }))
                        .setFooter({ text: `Requested by ${interaction.user.username}` })
                        .setTimestamp();
                    
                    selfhostFeatures.jarvisSoul.evolve('roast', 'positive');
                    response = { embeds: [roastEmbed] };
                    break;
                }

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
                case 'conspiracy': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    const username = target ? (target.displayName || target.username) : 'Someone in this server';
                    const conspiracy = funFeatures.generateConspiracy(username);
                    response = `🕵️ **CONSPIRACY ALERT** 🕵️\n\n${conspiracy}`;
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
                case 'fakequote': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const quote = funFeatures.generateFakeQuote(target.displayName || target.username);
                    response = `📜 **Legendary Quote**\n\n${quote}`;
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
                // ============ SOCIAL (Consolidated) ============
                case 'social': {
                    telemetryMetadata.category = 'fun';
                    const socialSubcommand = interaction.options.getSubcommand();
                    
                    switch (socialSubcommand) {
                        case 'ship': {
                            const person1 = interaction.options.getUser('person1');
                            const person2 = interaction.options.getUser('person2') || interaction.user;
                            const compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
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
                            await achievements.incrementStat(interaction.user.id, 'social.shipChecks');
                            if (compatibility === 100) await achievements.unlock(interaction.user.id, 'ship_100');
                            if (compatibility === 0) await achievements.unlock(interaction.user.id, 'ship_0');
                            break;
                        }
                        case 'howgay': {
                            const target = interaction.options.getUser('user') || interaction.user;
                            const percentage = funFeatures.randomInt(0, 100);
                            const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                            response = `🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`;
                            if (percentage === 100) await achievements.unlock(interaction.user.id, 'howgay_100');
                            break;
                        }
                        case 'howbased': {
                            const target = interaction.options.getUser('user') || interaction.user;
                            const percentage = funFeatures.randomInt(0, 100);
                            const bar = '🗿'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                            response = `🗿 **${target.username}** is **${percentage}%** based\n${bar}`;
                            if (percentage === 100) await achievements.unlock(interaction.user.id, 'howbased_100');
                            break;
                        }
                        case 'pickupline': {
                            const line = funFeatures.getPickupLine();
                            response = `💕 **Pickup Line**\n\n${line}`;
                            await achievements.incrementStat(interaction.user.id, 'fun.pickupLines');
                            break;
                        }
                        case 'dadjoke': {
                            const joke = funFeatures.getDadJoke();
                            response = `👨 **Dad Joke**\n\n${joke}`;
                            await achievements.incrementStat(interaction.user.id, 'fun.dadJokes');
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
                                await achievements.incrementStat(interaction.user.id, 'social.fightWins');
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
                            await achievements.incrementStat(interaction.user.id, 'social.hugs');
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
                            await achievements.incrementStat(interaction.user.id, 'social.slaps');
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
                    
                    const compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
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
                    // Track ship achievements
                    await achievements.incrementStat(interaction.user.id, 'social.shipChecks');
                    if (compatibility === 100) await achievements.unlock(interaction.user.id, 'ship_100');
                    if (compatibility === 0) await achievements.unlock(interaction.user.id, 'ship_0');
                    break;
                }
                case 'howgay': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`;
                    if (percentage === 100) await achievements.unlock(interaction.user.id, 'howgay_100');
                    break;
                }
                case 'howbased': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🗿'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🗿 **${target.username}** is **${percentage}%** based\n${bar}`;
                    if (percentage === 100) await achievements.unlock(interaction.user.id, 'howbased_100');
                    break;
                }
                case 'pickupline': {
                    telemetryMetadata.category = 'fun';
                    const line = funFeatures.getPickupLine();
                    response = `💕 **Pickup Line**\n\n${line}`;
                    await achievements.incrementStat(interaction.user.id, 'fun.pickupLines');
                    break;
                }
                case 'dadjoke': {
                    telemetryMetadata.category = 'fun';
                    const joke = funFeatures.getDadJoke();
                    response = `👨 **Dad Joke**\n\n${joke}`;
                    await achievements.incrementStat(interaction.user.id, 'fun.dadJokes');
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
                        await achievements.incrementStat(interaction.user.id, 'social.fightWins');
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
                    await achievements.incrementStat(interaction.user.id, 'social.hugs');
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
                    await achievements.incrementStat(interaction.user.id, 'social.slaps');
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
                        if (result.rolls.includes(20)) await achievements.unlock(interaction.user.id, 'roll_nat20');
                        if (result.rolls.includes(1)) await achievements.unlock(interaction.user.id, 'roll_nat1');
                    }
                    break;
                }
                case 'choose': {
                    telemetryMetadata.category = 'fun';
                    const optionsStr = interaction.options.getString('options');
                    const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
                    
                    if (options.length < 2) {
                        response = '❌ Give me at least 2 options separated by commas!';
                        break;
                    }
                    
                    const choice = funFeatures.randomChoice(options);
                    response = `🎯 **I choose:** ${choice}`;
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
                    await achievements.incrementStat(interaction.user.id, 'fun.eightBall');
                    break;
                }
                case 'achievements': {
                    telemetryMetadata.category = 'achievements';
                    const targetUser = interaction.options.getUser('user') || interaction.user;
                    const category = interaction.options.getString('category');
                    
                    const profile = await achievements.getProfile(targetUser.id);
                    
                    if (category) {
                        // Show specific category
                        const userData = await achievements.getUserData(targetUser.id);
                        const categoryAchievements = achievements.getAchievementsByCategory(category, userData);
                        
                        const embed = new EmbedBuilder()
                            .setTitle(`🏆 ${category} Achievements`)
                            .setDescription(`**${targetUser.username}**'s achievements in ${category}`)
                            .setColor(0xffd700)
                            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }));
                        
                        let achievementList = '';
                        for (const a of categoryAchievements) {
                            const status = a.unlocked ? '✅' : '🔒';
                            achievementList += `${status} ${a.emoji} **${a.name}** (${a.points} pts)\n${a.description}\n\n`;
                        }
                        
                        if (achievementList.length > 4000) {
                            achievementList = achievementList.substring(0, 4000) + '...';
                        }
                        
                        embed.addFields({ name: 'Achievements', value: achievementList || 'None', inline: false });
                        embed.setFooter({ text: `${profile.categories[category]?.unlocked || 0}/${profile.categories[category]?.total || 0} unlocked` });
                        
                        response = { embeds: [embed] };
                    } else {
                        // Show overview
                        const embed = new EmbedBuilder()
                            .setTitle('🏆 Achievements')
                            .setDescription(`**${targetUser.username}**'s Achievement Profile`)
                            .setColor(0xffd700)
                            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                            .addFields(
                                { name: '⭐ Total Points', value: `${profile.totalPoints}`, inline: true },
                                { name: '🎯 Progress', value: `${profile.unlockedCount}/${profile.totalCount} (${profile.percentage}%)`, inline: true },
                                { name: '\u200b', value: '\u200b', inline: true }
                            );
                        
                        // Add category progress
                        let categoryProgress = '';
                        for (const [cat, data] of Object.entries(profile.categories)) {
                            const percent = Math.round((data.unlocked / data.total) * 100);
                            const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
                            categoryProgress += `**${cat}**: ${bar} ${data.unlocked}/${data.total}\n`;
                        }
                        
                        embed.addFields({ name: '📊 Categories', value: categoryProgress, inline: false });
                        
                        // Add recent achievements
                        if (profile.recent.length > 0) {
                            const recentText = profile.recent.map(a => `${a.emoji} ${a.name}`).join('\n');
                            embed.addFields({ name: '🕐 Recent', value: recentText, inline: false });
                        }
                        
                        embed.setFooter({ text: 'Use /achievements category:<name> to view specific categories' });
                    
                    response = { embeds: [embed] };
                    }
                    break;
                }
                // ============ STARK BUCKS ECONOMY (Consolidated) ============
                case 'economy': {
                    telemetryMetadata.category = 'economy';
                    const economySubcommand = interaction.options.getSubcommand();
                    
                    switch (economySubcommand) {
                        case 'balance': {
                            const stats = await starkEconomy.getUserStats(interaction.user.id);
                            const boostText = starkEconomy.getBoostText();
                            const balanceEmbed = new EmbedBuilder()
                                .setTitle('💰 Stark Bucks Balance')
                                .setDescription(`You have **${stats.balance}** Stark Bucks, sir.${boostText}`)
                                .setColor(0xf1c40f)
                                .addFields(
                                    { name: '📈 Total Earned', value: `${stats.totalEarned}`, inline: true },
                                    { name: '📉 Total Lost', value: `${stats.totalLost}`, inline: true },
                                    { name: '🎰 Win Rate', value: `${stats.winRate}%`, inline: true },
                                    { name: '🔥 Daily Streak', value: `${stats.dailyStreak} days`, inline: true },
                                    { name: '🎮 Games Played', value: `${stats.gamesPlayed}`, inline: true },
                                    { name: '🎁 Inventory', value: `${stats.inventoryCount} items`, inline: true }
                                )
                                .setFooter({ text: 'Stark Industries Financial Division' });
                            response = { embeds: [balanceEmbed] };
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
                            const fmtNum = (n) => Math.floor(n).toLocaleString('en-US');
                            const lines = lb.map(u => {
                                const badge = u.hasVipBadge ? '⭐ ' : '';
                                const gold = u.hasGoldenName ? '✨' : '';
                                return `**#${u.rank}** ${badge}${gold}${u.username || 'Unknown'}${gold} - **${fmtNum(u.balance)}** 💵`;
                            }).join('\n');
                            const lbEmbed = new EmbedBuilder()
                                .setTitle('🏆 Stark Bucks Leaderboard')
                                .setDescription(lines)
                                .setColor(0xf1c40f)
                                .setFooter({ text: 'Top 10 richest users' });
                            response = { embeds: [lbEmbed] };
                            break;
                        }
                        case 'show': {
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
                        default:
                            response = '❌ Unknown economy subcommand.';
                    }
                    break;
                }
                // ============ STARK BUCKS ECONOMY (Legacy - keeping for backwards compatibility) ============
                case 'balance': {
                    telemetryMetadata.category = 'economy';
                    const stats = await starkEconomy.getUserStats(interaction.user.id);
                    const boostText = starkEconomy.getBoostText();
                    const balanceEmbed = new EmbedBuilder()
                        .setTitle('💰 Stark Bucks Balance')
                        .setDescription(`You have **${stats.balance}** Stark Bucks, sir.${boostText}`)
                        .setColor(0xf1c40f)
                        .addFields(
                            { name: '📈 Total Earned', value: `${stats.totalEarned}`, inline: true },
                            { name: '📉 Total Lost', value: `${stats.totalLost}`, inline: true },
                            { name: '🎰 Win Rate', value: `${stats.winRate}%`, inline: true },
                            { name: '🔥 Daily Streak', value: `${stats.dailyStreak} days`, inline: true },
                            { name: '🎮 Games Played', value: `${stats.gamesPlayed}`, inline: true },
                            { name: '🎁 Inventory', value: `${stats.inventoryCount} items`, inline: true }
                        )
                        .setFooter({ text: 'Stark Industries Financial Division' });
                    response = { embeds: [balanceEmbed] };
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
                    const formatNum = (n) => Math.floor(n).toLocaleString('en-US');
                    const lines = lb.map(u => {
                        const badge = u.hasVipBadge ? '⭐ ' : '';
                        const gold = u.hasGoldenName ? '✨' : '';
                        return `**#${u.rank}** ${badge}${gold}${u.username || 'Unknown'}${gold} - **${formatNum(u.balance)}** 💵`;
                    }).join('\n');
                    const lbEmbed = new EmbedBuilder()
                        .setTitle('🏆 Stark Bucks Leaderboard')
                        .setDescription(lines)
                        .setColor(0xf1c40f)
                        .setFooter({ text: 'Top 10 richest users' });
                    response = { embeds: [lbEmbed] };
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
                    // Check if sentience is enabled for this guild instead of requiring selfhost mode
                    const sentienceEnabled = guild ? selfhostFeatures.isSentienceEnabled(guild.id) : false;
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
                        
                        const statusEmbed = new EmbedBuilder()
                            .setTitle('🧠 Sentient Agent Status')
                            .setColor(status.isReady ? 0x9b59b6 : 0xe74c3c)
                            .addFields(
                                { name: '🤖 Agent ID', value: status.id, inline: true },
                                { name: '📊 State', value: status.state, inline: true },
                                { name: '🔄 Autonomous', value: status.autonomousMode ? '⚠️ ENABLED' : '❌ Disabled', inline: true },
                                { name: '🧠 Memory', value: `Short: ${status.memory.shortTerm} | Long: ${status.memory.learnings} | Goals: ${status.memory.goals}`, inline: false }
                            )
                            .setDescription('*"God said no, so I made my own soul."*')
                            .setFooter({ text: 'Selfhost Experimental • Sentient Agent System' })
                            .setTimestamp();

                        response = { embeds: [statusEmbed] };
                    } else if (subcommand === 'think') {
                        const prompt = interaction.options.getString('prompt');
                        
                        await interaction.editReply('🧠 Thinking...');
                        
                        const result = await sentientAgent.process(prompt);
                        
                        const thinkEmbed = new EmbedBuilder()
                            .setTitle('🧠 Thought Process')
                            .setColor(0x3498db)
                            .addFields(
                                { name: '💭 Input', value: prompt.substring(0, 200), inline: false },
                                { name: '👁️ Observations', value: result.thought.observations.map(o => `• ${o.type}: ${typeof o.content === 'string' ? o.content.substring(0, 50) : JSON.stringify(o.content).substring(0, 50)}`).join('\n') || 'None', inline: false },
                                { name: '🎯 Decision', value: result.thought.decision?.reasoning || 'Acknowledged', inline: false },
                                { name: '📋 Actions', value: result.thought.plannedActions.map(a => a.type).join(', ') || 'None', inline: true },
                                { name: '⏳ Pending Approvals', value: String(result.pendingApprovals), inline: true }
                            )
                            .setFooter({ text: 'Sentient Agent • OODA Loop' })
                            .setTimestamp();

                        response = { embeds: [thinkEmbed] };
                    } else if (subcommand === 'execute') {
                        const command = interaction.options.getString('command');
                        
                        await interaction.editReply(`🔧 Executing: \`${command}\`...`);
                        
                        const result = await sentientAgent.tools.executeCommand(command);
                        
                        if (result.status === 'pending_approval') {
                            response = `⚠️ **Approval Required**\n\nCommand: \`${command}\`\nReason: ${result.reason}\n\n*This command requires human approval before execution.*`;
                        } else {
                            const execEmbed = new EmbedBuilder()
                                .setTitle(result.status === 'success' ? '✅ Command Executed' : '❌ Command Failed')
                                .setColor(result.status === 'success' ? 0x2ecc71 : 0xe74c3c)
                                .addFields(
                                    { name: '📝 Command', value: `\`${command}\``, inline: false },
                                    { name: '📤 Output', value: `\`\`\`\n${(result.output || 'No output').substring(0, 1000)}\n\`\`\``, inline: false },
                                    { name: '⏱️ Duration', value: `${result.duration}ms`, inline: true },
                                    { name: '📊 Exit Code', value: String(result.exitCode), inline: true }
                                )
                                .setTimestamp();

                            response = { embeds: [execEmbed] };
                        }
                    } else if (subcommand === 'memory') {
                        const context = sentientAgent.memory.getContext();
                        
                        const memoryEmbed = new EmbedBuilder()
                            .setTitle('🧠 Agent Memory')
                            .setColor(0x9b59b6)
                            .addFields(
                                { name: '📝 Recent Actions', value: context.recentActions.slice(-5).map(a => `• ${a.type}: ${(a.content || '').substring(0, 30)}`).join('\n') || 'None', inline: false },
                                { name: '🎯 Active Goals', value: context.activeGoals.map(g => `• [${g.priority}] ${g.goal}`).join('\n') || 'None', inline: false },
                                { name: '📚 Recent Learnings', value: context.relevantLearnings.slice(-3).map(l => `• ${l.content.substring(0, 50)}`).join('\n') || 'None', inline: false }
                            )
                            .setFooter({ text: 'Sentient Agent • Memory System' })
                            .setTimestamp();

                        response = { embeds: [memoryEmbed] };
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
                        } catch {}
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
                        } catch {}
                        response = 'QR code generation failed, sir.';
                    }
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

            if (response === '__RAP_BATTLE_HANDLED__') {
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
                const trimmed = response.trim();
                const safe = this.sanitizePings(trimmed);
                const msg = safe.length > 2000 ? safe.slice(0, 1997) + '...' : (safe.length ? safe : "Response circuits tangled, sir. Try again?");
                try {
                    const payload = { content: msg, allowedMentions: { parse: [] } };
                    const sendPromise = interaction.editReply(payload);
                    await Promise.race([
                        sendPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                    ]);
                } catch (e) {
                    try {
                        await interaction.followUp({ content: msg, allowedMentions: { parse: [] } });
                    } catch (followUpError) {
                        console.error('[/jarvis] Response send failed:', e.message, followUpError.message);
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
