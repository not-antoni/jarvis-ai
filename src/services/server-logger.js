/**
 * Server Logger Service
 * Handles comprehensive moderation logging (bans, kicks, edits, deletions, role changes)
 * Targeted for specific guild/channel configuration.
 */

const { EmbedBuilder, AuditLogEvent, Colors } = require('discord.js');

const LOG_CONFIG = {
    // Guild ID -> Log Channel ID mapping
    // You mentioned Guild ID 1403664986089324606 -> Channel 1430282888435339466
    '1403664986089324606': '1430282888435339466'
};

class ServerLogger {

    /**
     * Get the log channel for a guild if configured
     */
    getLogChannel(guild) {
        if (!guild) return null;
        const channelId = LOG_CONFIG[guild.id];
        if (!channelId) return null;
        return guild.channels.cache.get(channelId);
    }

    /**
     * Helper to send log embed
     */
    async sendLog(guild, embed) {
        const channel = this.getLogChannel(guild);
        if (!channel) return;
        try {
            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(`[ServerLogger] Failed to send log to ${guild.name}:`, error.message);
        }
    }

    /**
     * Fetch the executor of an action from audit logs
     */
    async getExecutor(guild, type, targetId) {
        try {
            // Wait a moment for audit log to populate
            await new Promise(resolve => setTimeout(resolve, 1500));

            const logs = await guild.fetchAuditLogs({
                limit: 1,
                type: type,
            });
            const entry = logs.entries.first();

            // Check if entry exists, matches target, and is recent (within 10 seconds)
            if (entry && entry.target.id === targetId && (Date.now() - entry.createdTimestamp) < 10000) {
                return entry.executor;
            }
            return null;
        } catch (e) {
            console.warn('[ServerLogger] Failed to fetch audit logs:', e.message);
            return null;
        }
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    /**
     * Log Message Delete
     */
    async logMessageDelete(message) {
        if (!message.guild || message.author.bot) return; // Ignore bots

        // Audit Log check for "Message Delete" by generic mod (not author)
        // This is tricky because if author deletes, no audit log entry is typically created for "Self" delete?
        // Actually, bot deletes create entries, mods deleting others create entries.
        // We'll check if a moderator did it.

        let executor = message.author; // Default to author deleting their own message
        const auditExecutor = await this.getExecutor(message.guild, AuditLogEvent.MessageDelete, message.author.id);

        // Note: Audit log for message delete target is the *author* of the message, not the message ID (usually)
        // Warning: High traffic channels make correlating difficult.
        // If we found an executor recently deleting messages from this user, blame them.
        if (auditExecutor) executor = auditExecutor;

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

    /**
     * Log Message Edit
     */
    async logMessageUpdate(oldMessage, newMessage) {
        if (!oldMessage.guild || oldMessage.author.bot) return;
        if (oldMessage.content === newMessage.content) return; // Ignore embed updates/non-content changes

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

    /**
     * Log Guild Member Join
     */
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

    /**
     * Log Guild Member Leave / Kick
     */
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

    /**
     * Log Ban
     */
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

    /**
     * Log Unban
     */
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

    /**
     * Log Member Update (Nickname, Roles)
     */
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

    /**
     * Log Role Create
     */
    async logRoleCreate(role) {
        const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Role Created')
            .setDescription(`**Role:** ${role} (${role.name})\n**ID:** ${role.id}\n**Created By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Green)
            .setTimestamp();
        await this.sendLog(role.guild, embed);
    }

    /**
     * Log Role Delete
     */
    async logRoleDelete(role) {
        const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Role Deleted')
            .setDescription(`**Role:** ${role.name}\n**ID:** ${role.id}\n**Deleted By:** ${executor || 'Unknown'}`)
            .setColor(Colors.Red)
            .setTimestamp();
        await this.sendLog(role.guild, embed);
    }

    /**
     * Log Role Update
     */
    async logRoleUpdate(oldRole, newRole) {
        if (oldRole.name === newRole.name && oldRole.color === newRole.color && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;

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
}

module.exports = new ServerLogger();
