
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

        try {
            if (!word) {
                const currentWord = await userFeatures.getWakeWord(userId);
                if (currentWord) {
                    await interaction.editReply(`🎯 **Your Custom Wake Word:** "${currentWord}"\n\nUse \`/wakeword word:newword\` to change, or say "${currentWord}" to summon me.`);
                } else {
                    await interaction.editReply(`No custom wake word set, sir.\n\nUse \`/wakeword word:yourword\` to set one. I'll respond when you say it!`);
                }
                return;
            }

            const result = await userFeatures.setWakeWord(userId, word);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            await interaction.editReply(`✅ Custom wake word set to **"${result.wakeWord}"**\n\nNow you can summon me by saying "${result.wakeWord}" in any message!`);
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
