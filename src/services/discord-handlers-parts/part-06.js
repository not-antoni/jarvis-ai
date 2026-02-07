
    async handleRemindCommand(interaction) {
        const userFeatures = require('./user-features');
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const channelId = interaction.channelId;

        try {
            if (subcommand === 'set') {
                const message = interaction.options.getString('message');
                const timeInput = interaction.options.getString('time');
                
                const result = await userFeatures.createReminder(userId, channelId, message, timeInput);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply(
                    `⏰ Reminder set, sir.\n**Message:** ${message}\n**When:** ${result.formattedTime}\n**ID:** \`${result.reminder.id}\``
                );
            } else if (subcommand === 'list') {
                const reminders = await userFeatures.getUserReminders(userId);
                
                if (reminders.length === 0) {
                    await interaction.editReply('No pending reminders, sir. Use `/remind set` to create one.');
                    return;
                }
                
                const lines = await Promise.all(reminders.map(async (r, i) => {
                    const time = await userFeatures.formatTimeForUser(userId, new Date(r.scheduledFor));
                    return `${i + 1}. **${r.message}**\n   ⏰ ${time} | ID: \`${r.id}\``;
                }));
                
                await interaction.editReply(`📋 **Your Reminders:**\n\n${lines.join('\n\n')}`);
            } else if (subcommand === 'cancel') {
                const reminderId = interaction.options.getString('id');
                const result = await userFeatures.cancelReminder(userId, reminderId);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply('✅ Reminder cancelled, sir.');
            }
        } catch (error) {
            console.error('[/remind] Error:', error);
            await interaction.editReply('Failed to process reminder command, sir.');
        }
    }

    async handleTimezoneCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const zone = interaction.options.getString('zone');

        try {
            if (!zone) {
                const currentZone = await userFeatures.getTimezone(userId);
                const currentTime = await userFeatures.formatTimeForUser(userId);
                await interaction.editReply(
                    `🌍 **Your Timezone:** ${currentZone}\n🕐 **Current Time:** ${currentTime}\n\nUse \`/timezone zone:America/New_York\` to change.`
                );
                return;
            }

            const result = await userFeatures.setTimezone(userId, zone);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            const currentTime = await userFeatures.formatTimeForUser(userId);
            await interaction.editReply(`✅ Timezone set to **${result.timezone}**\n🕐 Current time: ${currentTime}`);
        } catch (error) {
            console.error('[/timezone] Error:', error);
            await interaction.editReply('Failed to update timezone, sir.');
        }
    }

    async handleWakewordCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const word = interaction.options.getString('word');
        const scope = interaction.options.getString('scope') || 'personal';
        const clear = interaction.options.getBoolean('clear') || false;

        try {
            // Server scope — requires admin/manage guild
            if (scope === 'server') {
                if (!interaction.guild) {
                    await interaction.editReply('Server wake words can only be set in a server, sir.');
                    return;
                }

                const member = interaction.member;
                const isAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                    member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                    member.id === interaction.guild.ownerId;

                if (!isAdmin) {
                    await interaction.editReply('Only server admins can set a server-wide wake word.');
                    return;
                }

                const guildId = interaction.guild.id;

                if (clear) {
                    await userFeatures.removeGuildWakeWord(guildId);
                    // Flush handler-level cache so the change takes effect immediately
                    this.guildConfigCache.delete(guildId);
                    const guildConfigDiskCache = require('./guild-config-cache');
                    guildConfigDiskCache.invalidate(guildId);
                    await interaction.editReply('Server wake word removed. I\'ll respond to the default triggers ("jarvis" / "garmin") and personal wake words now.');
                    return;
                }

                if (!word) {
                    const currentGuildWord = await userFeatures.getGuildWakeWord(guildId);
                    if (currentGuildWord) {
                        await interaction.editReply(`🏠 **Server Wake Word:** "${currentGuildWord}"\n\nAnyone in this server can say "${currentGuildWord}" to summon me.\nUse \`/wakeword word:newword scope:Server\` to change, or \`/wakeword scope:Server clear:True\` to remove.`);
                    } else {
                        await interaction.editReply('No server wake word set.\n\nUse `/wakeword word:yourword scope:Server` to set one for the whole server.');
                    }
                    return;
                }

                const result = await userFeatures.setGuildWakeWord(guildId, word);
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }

                // Flush handler-level cache so the change takes effect immediately
                this.guildConfigCache.delete(guildId);
                const guildConfigDiskCache = require('./guild-config-cache');
                guildConfigDiskCache.invalidate(guildId);

                await interaction.editReply(`Server wake word set to **"${result.wakeWord}"**\n\nAnyone in this server can now summon me by saying "${result.wakeWord}". Default triggers ("jarvis" / "garmin") are now disabled for this server.`);
                return;
            }

            // Personal scope
            if (clear) {
                await userFeatures.clearWakeWord(userId);
                await interaction.editReply('Your personal wake word has been removed.');
                return;
            }

            if (!word) {
                const currentWord = await userFeatures.getWakeWord(userId);
                const lines = [];
                if (currentWord) {
                    lines.push(`🎯 **Your Custom Wake Word:** "${currentWord}"`);
                    lines.push(`\nUse \`/wakeword word:newword\` to change, or say "${currentWord}" to summon me.`);
                } else {
                    lines.push('No personal wake word set, sir.');
                    lines.push('\nUse `/wakeword word:yourword` to set one. I\'ll respond when you say it!');
                }

                // Show server wake word too if in a guild
                if (interaction.guild) {
                    const guildWord = await userFeatures.getGuildWakeWord(interaction.guild.id);
                    if (guildWord) {
                        lines.push(`\n🏠 **Server Wake Word:** "${guildWord}"`);
                    }
                }

                await interaction.editReply(lines.join(''));
                return;
            }

            const result = await userFeatures.setWakeWord(userId, word);

            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            await interaction.editReply(`Custom wake word set to **"${result.wakeWord}"**\n\nNow you can summon me by saying "${result.wakeWord}" in any message!`);
        } catch (error) {
            console.error('[/wakeword] Error:', error);
            await interaction.editReply('Failed to update wake word, sir.');
        }
    }

    async handleMyStatsCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;

        try {
            const stats = await userFeatures.getUserStats(userId);
            const timezone = await userFeatures.getTimezone(userId);
            const wakeWord = await userFeatures.getWakeWord(userId);
            
            const firstDate = new Date(stats.firstInteraction);
            const daysSince = Math.floor((Date.now() - stats.firstInteraction) / (1000 * 60 * 60 * 24));
            
            const embed = {
                color: 0x3498db,
                title: `📊 ${interaction.user.username}'s Jarvis Stats`,
                fields: [
                    { name: '💬 Messages', value: `${stats.messageCount || 0}`, inline: true },
                    { name: '🔍 Searches', value: `${stats.searchesPerformed || 0}`, inline: true },
                    { name: '⚡ Commands', value: `${stats.commandsUsed || 0}`, inline: true },
                    { name: '⏰ Reminders Created', value: `${stats.remindersCreated || 0}`, inline: true },
                    { name: '🌍 Timezone', value: timezone, inline: true },
                    { name: '🎯 Wake Word', value: wakeWord || 'None set', inline: true },
                    { name: '📅 First Interaction', value: `${firstDate.toLocaleDateString()} (${daysSince} days ago)`, inline: false },
                ],
                footer: { text: 'Stats are approximate and may reset periodically' },
                timestamp: new Date().toISOString()
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[/mystats] Error:', error);
            await interaction.editReply('Failed to retrieve stats, sir.');
        }
    }
}

module.exports = new DiscordHandlers();
