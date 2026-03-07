const { EmbedBuilder, AuditLogEvent, Colors, PermissionFlagsBits } = require('discord.js');

// Load guild->channel mapping from env: LOG_CHANNELS=guildId:channelId,guildId:channelId
const LOG_CONFIG = {};
(process.env.LOG_CHANNELS || '').split(',').filter(Boolean).forEach(pair => {
    const [gId, cId] = pair.split(':').map(s => s.trim());
    if (gId && cId) {LOG_CONFIG[gId] = cId;}
});

class ServerLogger {

    getLogChannel(guild) {
        if (!guild) {return null;}
        const channelId = LOG_CONFIG[guild.id];
        if (!channelId) {return null;}
        return guild.channels.cache.get(channelId);
    }

    async sendLog(guild, embed) {
        const channel = this.getLogChannel(guild);
        if (!channel) {return;}
        try {
            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(`[ServerLogger] Failed to send log to ${guild.name}:`, error.message);
        }
    }

    async getExecutor(guild, type, targetId) {
        try {
            // Check permissions first to avoid error spam
            if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                return null;
            }

            // Wait a moment for audit log to populate
            await new Promise(resolve => setTimeout(resolve, 1500));

            const logs = await guild.fetchAuditLogs({
                limit: 1,
                type: type
            });
            const entry = logs.entries.first();

            // Check if entry exists, matches target, and is recent (within 10 seconds)
            if (entry && entry.target.id === targetId && (Date.now() - entry.createdTimestamp) < 10000) {
                return entry.executor;
            }
            return null;
        } catch (e) {
            // Suppress missing permissions error, log others
            if (e.code !== 50013 && e.message !== 'Missing Permissions') {
                console.warn('[ServerLogger] Failed to fetch audit logs:', e.message);
            }
            return null;
        }
    }

    async logMessageDelete(message) {
        if (!message.guild || !message.author || message.author.bot) {return;} // Ignore bots or uncached messages

        // Audit Log check for "Message Delete" by generic mod (not author)
        // This is tricky because if author deletes, no audit log entry is typically created for "Self" delete?
        // Actually, bot deletes create entries, mods deleting others create entries.
        // We'll check if a moderator did it.

        let executor = message.author; // Default to author deleting their own message
        const auditExecutor = await this.getExecutor(message.guild, AuditLogEvent.MessageDelete, message.author.id);

        // Note: Audit log for message delete target is the *author* of the message, not the message ID (usually)
        // Warning: High traffic channels make correlating difficult.
        // If we found an executor recently deleting messages from this user, blame them.
        if (auditExecutor) {executor = auditExecutor;}

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${message.author.tag} (ID: ${message.author.id})`, iconURL: message.author.displayAvatarURL() })
            .setTitle('🗑️ Message Deleted')
            .setDescription(`**Channel:** ${message.channel}\n**Content:**\n${message.content || '[No Text Content / Image / Embed]'}`)
            .addFields({ name: 'Deleted By', value: `${executor} ${executor.id !== message.author.id ? '(Moderator)' : '(Self)'}`, inline: true })
            .setColor(Colors.Red)
            .setTimestamp();

        if (message.attachments.size > 0) {
            embed.addFields({ name: 'Attachments', value: `${message.attachments.size} files (not shown)` });
        }

        await this.sendLog(message.guild, embed);
    }

    async logMessageUpdate(oldMessage, newMessage) {
        if (!oldMessage.guild || !oldMessage.author || oldMessage.author.bot) {return;}
        if (oldMessage.content === newMessage.content) {return;} // Ignore embed updates/non-content changes

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${newMessage.author.tag}`, iconURL: newMessage.author.displayAvatarURL() })
            .setTitle('✏️ Message Edited')
            .setDescription(`**Channel:** ${newMessage.channel} [Jump to Message](${newMessage.url})`)
            .addFields(
                { name: 'Before', value: oldMessage.content.slice(0, 1024) || '[Empty]' },
                { name: 'After', value: newMessage.content.slice(0, 1024) || '[Empty]' }
            )
            .setColor(Colors.Yellow)
            .setTimestamp();

        await this.sendLog(newMessage.guild, embed);
    }

    async logMemberJoin(member) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
            .setTitle('📥 Member Joined')
            .setDescription(`${member} has joined the server.`)
            .addFields(
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setColor(Colors.Green)
            .setTimestamp();

        await this.sendLog(member.guild, embed);
    }

    async logMemberLeave(member) {
        // Check if it was a Kick
        const kicker = await this.getExecutor(member.guild, AuditLogEvent.MemberKick, member.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

        if (kicker) {
            embed.setTitle('👢 Member Kicked')
                .setDescription(`${member.user.tag} was kicked by ${kicker}.`)
                .setColor(Colors.Orange);
        } else {
            embed.setTitle('📤 Member Left')
                .setDescription(`${member.user.tag} has left the server.`)
                .setColor(Colors.Red);
        }

        embed.addFields({ name: 'Roles', value: member.roles.cache.map(r => r.name).join(', ').slice(0, 1024) || 'None' });

        await this.sendLog(member.guild, embed);
    }

    async logBan(ban) {
        const executor = await this.getExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${ban.user.tag}`, iconURL: ban.user.displayAvatarURL() })
            .setTitle('🔨 Member Banned')
            .setDescription(`**User:** ${ban.user} (${ban.user.id})\n**Executor:** ${executor ? executor : 'Unknown'}`)
            .setColor(Colors.DarkRed)
            .setTimestamp();

        await this.sendLog(ban.guild, embed);
    }

    async logUnban(ban) {
        const executor = await this.getExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${ban.user.tag}`, iconURL: ban.user.displayAvatarURL() })
            .setTitle('🔓 Member Unbanned')
            .setDescription(`**User:** ${ban.user} (${ban.user.id})\n**Executor:** ${executor ? executor : 'Unknown'}`)
            .setColor(Colors.Green)
            .setTimestamp();

        await this.sendLog(ban.guild, embed);
    }

    async logMemberUpdate(oldMember, newMember) {
        // Nickname Change
        if (oldMember.nickname !== newMember.nickname) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${newMember.user.tag}`, iconURL: newMember.user.displayAvatarURL() })
                .setTitle('🏷️ Nickname Changed')
                .addFields(
                    { name: 'Old Nickname', value: oldMember.nickname || 'None', inline: true },
                    { name: 'New Nickname', value: newMember.nickname || 'None', inline: true }
                )
                .setColor(Colors.Blue)
                .setTimestamp();
            await this.sendLog(newMember.guild, embed);
        }

        // Role Changes
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        if (oldRoles.size !== newRoles.size) {
            // Find added roles
            const added = newRoles.filter(r => !oldRoles.has(r.id));
            // Find removed roles
            const removed = oldRoles.filter(r => !newRoles.has(r.id));

            // Try to find who changed roles
            const executor = await this.getExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);

            if (added.size > 0) {
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${newMember.user.tag}`, iconURL: newMember.user.displayAvatarURL() })
                    .setTitle('➕ Roles Added')
                    .setDescription(`**User:** ${newMember}\n**Added:** ${added.map(r => r).join(', ')}\n**By:** ${executor || 'Unknown'}`)
                    .setColor(Colors.Green)
                    .setTimestamp();
                await this.sendLog(newMember.guild, embed);
            }

            if (removed.size > 0) {
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${newMember.user.tag}`, iconURL: newMember.user.displayAvatarURL() })
                    .setTitle('➖ Roles Removed')
                    .setDescription(`**User:** ${newMember}\n**Removed:** ${removed.map(r => r).join(', ')}\n**By:** ${executor || 'Unknown'}`)
                    .setColor(Colors.Red)
                    .setTimestamp();
                await this.sendLog(newMember.guild, embed);
            }
        }
    }

    async logRoleCreate(role) {
        const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Role Created')
            .setDescription(`**Role:** ${role} (${role.name})\n**ID:** ${role.id}\n**Created By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Green)
            .setTimestamp();
        await this.sendLog(role.guild, embed);
    }

    async logRoleDelete(role) {
        const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Role Deleted')
            .setDescription(`**Role:** ${role.name}\n**ID:** ${role.id}\n**Deleted By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Red)
            .setTimestamp();
        await this.sendLog(role.guild, embed);
    }

    async logRoleUpdate(oldRole, newRole) {
        if (oldRole.name === newRole.name && oldRole.color === newRole.color && oldRole.permissions.bitfield === newRole.permissions.bitfield) {return;}

        const executor = await this.getExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        const embed = new EmbedBuilder()
            .setTitle('🛠️ Role Updated')
            .setDescription(`**Role:** ${newRole} (${newRole.name})\n**Updated By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Yellow)
            .setTimestamp();

        if (oldRole.name !== newRole.name) {
            embed.addFields({ name: 'Name Change', value: `${oldRole.name} ➡️ ${newRole.name}` });
        }

        await this.sendLog(newRole.guild, embed);
    }


    async logChannelCreate(channel) {
        if (!channel.guild) {return;}
        const executor = await this.getExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        const embed = new EmbedBuilder()
            .setTitle('📺 Channel Created')
            .setDescription(`**Name:** ${channel.name} (${channel.toString()})\n**Type:** ${this.getChannelTypeName(channel.type)}\n**Category:** ${channel.parent ? channel.parent.name : 'None'}\n**Created By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Green)
            .setFooter({ text: `ID: ${channel.id}` })
            .setTimestamp();
        await this.sendLog(channel.guild, embed);
    }

    async logChannelDelete(channel) {
        if (!channel.guild) {return;}
        const executor = await this.getExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Channel Deleted')
            .setDescription(`**Name:** ${channel.name}\n**Type:** ${this.getChannelTypeName(channel.type)}\n**Deleted By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Red)
            .setFooter({ text: `ID: ${channel.id}` })
            .setTimestamp();
        await this.sendLog(channel.guild, embed);
    }

    async logChannelUpdate(oldChannel, newChannel) {
        if (!newChannel.guild) {return;}
        // Ignore permission overwrites for now to reduce spam, or just checking name/topic
        if (oldChannel.name === newChannel.name && oldChannel.topic === newChannel.topic && oldChannel.nsfw === newChannel.nsfw) {return;}

        const executor = await this.getExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        const embed = new EmbedBuilder()
            .setTitle('🔧 Channel Updated')
            .setDescription(`**Channel:** ${newChannel} (${newChannel.name})\n**Updated By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Yellow)
            .setTimestamp();

        if (oldChannel.name !== newChannel.name) {embed.addFields({ name: 'Name', value: `${oldChannel.name} ➡️ ${newChannel.name}` });}
        if (oldChannel.topic !== newChannel.topic) {embed.addFields({ name: 'Topic', value: 'Changed (See details in channel)' });}
        if (oldChannel.nsfw !== newChannel.nsfw) {embed.addFields({ name: 'NSFW', value: `${oldChannel.nsfw} ➡️ ${newChannel.nsfw}` });}

        await this.sendLog(newChannel.guild, embed);
    }

    async logVoiceStateUpdate(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member || !member.guild) {return;}

        const embed = new EmbedBuilder()
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .setTimestamp();

        // Join
        if (!oldState.channelId && newState.channelId) {
            embed.setTitle('🎤 Joined Voice')
                .setDescription(`${member} joined **${newState.channel.name}**`)
                .setColor(Colors.Green);
            await this.sendLog(member.guild, embed);
        }
        // Leave
        else if (oldState.channelId && !newState.channelId) {
            embed.setTitle('👋 Left Voice')
                .setDescription(`${member} left **${oldState.channel.name}**`)
                .setColor(Colors.Red);
            await this.sendLog(member.guild, embed);
        }
        // Move
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            embed.setTitle('↔️ Switched Voice')
                .setDescription(`${member} moved from **${oldState.channel.name}** to **${newState.channel.name}**`)
                .setColor(Colors.Blue);
            await this.sendLog(member.guild, embed);
        }
    }

    async logEmojiCreate(emoji) {
        const executor = await this.getExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
        const embed = new EmbedBuilder()
            .setTitle('😀 Emoji Created')
            .setDescription(`**Emoji:** ${emoji} \`:${emoji.name}:\`\n**Created By:** ${executor || 'Unknown'}`)
            .setThumbnail(emoji.url)
            .setColor(Colors.Green)
            .setTimestamp();
        await this.sendLog(emoji.guild, embed);
    }

    async logEmojiDelete(emoji) {
        const executor = await this.getExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Emoji Deleted')
            .setDescription(`**Name:** \`:${emoji.name}:\`\n**Deleted By:** ${executor || 'Unknown'}`)
            .setThumbnail(emoji.url)
            .setColor(Colors.Red)
            .setTimestamp();
        await this.sendLog(emoji.guild, embed);
    }

    async logEmojiUpdate(oldEmoji, newEmoji) {
        if (oldEmoji.name === newEmoji.name) {return;}
        const executor = await this.getExecutor(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
        const embed = new EmbedBuilder()
            .setTitle('📝 Emoji Renamed')
            .setDescription(`**Emoji:** ${newEmoji}\n**Old Name:** \`:${oldEmoji.name}:\`\n**New Name:** \`:${newEmoji.name}:\`\n**Updated By:** ${executor || 'Unknown'}`)
            .setThumbnail(newEmoji.url)
            .setColor(Colors.Yellow)
            .setTimestamp();
        await this.sendLog(newEmoji.guild, embed);
    }

    async logGuildUpdate(oldGuild, newGuild) {
        if (oldGuild.name === newGuild.name && oldGuild.icon === newGuild.icon && oldGuild.banner === newGuild.banner) {return;}

        const executor = await this.getExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
        const embed = new EmbedBuilder()
            .setTitle('🏰 Server Updated')
            .setDescription(`Changes detected to server settings.\n**Executor:** ${executor || 'Unknown'}`)
            .setColor(Colors.Blue)
            .setTimestamp();

        if (oldGuild.name !== newGuild.name) {
            embed.addFields({ name: 'Name', value: `${oldGuild.name} ➡️ ${newGuild.name}` });
        }

        if (oldGuild.icon !== newGuild.icon) {
            embed.addFields({ name: 'Icon', value: '[Changed] (Check Audit Log)' });
            embed.setThumbnail(newGuild.iconURL());
        }

        await this.sendLog(newGuild, embed);
    }

    getChannelTypeName(type) {
        // Simple mapping, can be expanded
        const types = {
            0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum'
        };
        return types[type] || 'Unknown';
    }
    async logBulkDelete(messages, channel) {
        if (!channel.guild) {return;}
        
        const count = messages.size;
        const authors = [...new Set(messages.map(m => m.author?.tag || 'Unknown'))].slice(0, 5);
        
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Bulk Message Delete (Purge)')
            .setDescription(`**${count}** messages deleted in ${channel}`)
            .addFields(
                { name: 'Channel', value: `${channel} (${channel.id})`, inline: true },
                { name: 'Authors', value: authors.join(', ') || 'Unknown', inline: true }
            )
            .setColor(Colors.Orange)
            .setTimestamp();
        
        await this.sendLog(channel.guild, embed);
    }
}

module.exports = new ServerLogger();
