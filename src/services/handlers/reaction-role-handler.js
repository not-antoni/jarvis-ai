'use strict';

const { EmbedBuilder, PermissionsBitField, ChannelType, parseEmoji } = require('discord.js');
const database = require('../../services/database');

async function handleReactionRoleCommand(handler, interaction) {
    if (!interaction.guild) {
        await interaction.editReply('This command is only available within a server, sir.');
        return;
    }

    if (!database.isConnected) {
        await interaction.editReply('My database uplink is offline, sir. Reaction roles are unavailable at the moment.');
        return;
    }

    const guild = interaction.guild;
    const member = interaction.member;
    const subcommand = interaction.options.getSubcommand();
    const guildConfig = await handler.getGuildConfig(guild);

    if (subcommand === 'setmods') {
        const isOwner = member.id === guild.ownerId;
        const hasAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator);
        if (!isOwner && !hasAdmin) {
            await interaction.editReply('Only the server owner or administrators may adjust moderator roles, sir.');
            return;
        }
    } else {
        const isModerator = await handler.isGuildModerator(member, guildConfig);
        if (!isModerator) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }
    }

    if (subcommand === 'create') {
        const channel = interaction.options.getChannel('channel');
        const pairsInput = interaction.options.getString('pairs');
        const title = interaction.options.getString('title') || 'Select your roles';
        const description = interaction.options.getString('description') || 'React with the options below to toggle roles, sir.';

        if (!channel || channel.guildId !== guild.id) {
            await interaction.editReply('I could not access that channel, sir.');
            return;
        }

        const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        if (!channel.isTextBased() || !allowedTypes.has(channel.type)) {
            await interaction.editReply('Reaction roles require a standard text channel or announcement channel, sir.');
            return;
        }

        const me = guild.members.me || await guild.members.fetchMe();
        if (!me) {
            await interaction.editReply('I could not verify my permissions in that server, sir.');
            return;
        }

        if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.editReply('I require the "Manage Roles" permission to do that, sir.');
            return;
        }

        const channelPermissions = channel.permissionsFor(me);
        if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !channelPermissions.has(PermissionsBitField.Flags.SendMessages) || !channelPermissions.has(PermissionsBitField.Flags.AddReactions) || !channelPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
            await interaction.editReply('I need permission to send messages, add reactions, and embed links in that channel, sir.');
            return;
        }

        let options;
        try {
            options = await handler.parseReactionRolePairs(pairsInput, guild);
        } catch (error) {
            await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
            return;
        }

        const unusableRole = options.find(option => {
            const role = guild.roles.cache.get(option.roleId);
            if (!role) {
                return false;
            }
            return me.roles.highest.comparePositionTo(role) <= 0;
        });

        if (unusableRole) {
            await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
            return;
        }

        const optionLines = options.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
        const embedDescription = description ? `${description}\n\n${optionLines}` : optionLines;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(embedDescription)
            .setColor(0x5865f2)
            .setFooter({ text: 'React to add or remove roles.' });

        let sentMessage;
        try {
            sentMessage = await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to send reaction role message:', error);
            await interaction.editReply('I could not send the panel to that channel, sir.');
            return;
        }

        try {
            for (const option of options) {
                await sentMessage.react(option.rawEmoji);
            }
        } catch (error) {
            console.error('Failed to add reactions for reaction role panel:', error);
            await interaction.editReply('One of those emojis could not be used, sir. I removed the panel.');
            try {
                await sentMessage.delete();
            } catch (deleteError) {
                console.warn('Failed to delete reaction role message after reaction failure:', deleteError);
            }
            return;
        }

        try {
            await database.saveReactionRoleMessage({
                guildId: guild.id,
                channelId: channel.id,
                messageId: sentMessage.id,
                options,
                createdBy: interaction.user.id,
                title,
                description,
                createdAt: new Date()
            });
        } catch (error) {
            console.error('Failed to persist reaction role configuration:', error);
            await interaction.editReply('I could not save that configuration, sir.');
            try {
                await sentMessage.delete();
            } catch (cleanupError) {
                console.warn('Failed to delete reaction role panel after persistence failure:', cleanupError);
            }
            return;
        }

        const messageUrl = sentMessage.url || `https://discord.com/channels/${guild.id}/${channel.id}/${sentMessage.id}`;
        await interaction.editReply(`Reaction role panel deployed in ${channel}, sir. [Jump to message](${messageUrl}).`);
        return;
    }

    if (subcommand === 'remove') {
        const messageInput = interaction.options.getString('message');
        const idMatch = messageInput?.match(/(\d{17,20})$/);
        const messageId = idMatch ? idMatch[1] : messageInput;

        if (!messageId) {
            await interaction.editReply('Please provide a valid message ID or link, sir.');
            return;
        }

        let record;
        try {
            record = await database.getReactionRole(messageId);
        } catch (error) {
            console.error('Failed to load reaction role message:', error);
        }

        if (!record || record.guildId !== guild.id) {
            await interaction.editReply('I do not have a reaction role panel for that message, sir.');
            return;
        }

        try {
            await database.deleteReactionRole(record.messageId);
        } catch (error) {
            console.error('Failed to delete reaction role configuration:', error);
            await interaction.editReply('I could not remove that configuration from the database, sir.');
            return;
        }

        let messageDeleted = false;
        try {
            const targetChannel = await guild.channels.fetch(record.channelId);
            const me = guild.members.me || await guild.members.fetchMe();
            if (targetChannel?.isTextBased() && me) {
                const channelPerms = targetChannel.permissionsFor(me);
                if (channelPerms?.has(PermissionsBitField.Flags.ManageMessages)) {
                    const panelMessage = await targetChannel.messages.fetch(record.messageId);
                    await panelMessage.delete();
                    messageDeleted = true;
                }
            }
        } catch (error) {
            console.warn('Failed to delete reaction role message:', error);
        }

        await interaction.editReply(messageDeleted
            ? 'Reaction role panel removed and the message deleted, sir.'
            : 'Reaction role panel removed from my registry, sir.');
        return;
    }

    if (subcommand === 'edit') {
        const messageInput = interaction.options.getString('message');
        const idMatch = messageInput?.match(/(\d{17,20})$/);
        const messageId = idMatch ? idMatch[1] : messageInput;
        const newPairsInput = interaction.options.getString('add_pairs');
        const removePairsInput = interaction.options.getString('remove_pairs');
        const newTitle = interaction.options.getString('title');
        const newDescription = interaction.options.getString('description');

        if (!messageId) {
            await interaction.editReply('Please provide a valid message ID or link, sir.');
            return;
        }

        // Check if at least one edit option is provided
        if (!newPairsInput && !removePairsInput && !newTitle && !newDescription) {
            await interaction.editReply('Please provide at least one thing to edit: add_pairs, remove_pairs, title, or description, sir.');
            return;
        }

        let record;
        try {
            record = await database.getReactionRole(messageId);
        } catch (error) {
            console.error('Failed to load reaction role message:', error);
        }

        if (!record || record.guildId !== guild.id) {
            await interaction.editReply('I do not have a reaction role panel for that message, sir.');
            return;
        }

        // Fetch the original message
        let targetChannel, panelMessage;
        try {
            targetChannel = await guild.channels.fetch(record.channelId);
            if (!targetChannel?.isTextBased()) {
                await interaction.editReply('The channel for that panel no longer exists or is inaccessible, sir.');
                return;
            }
            panelMessage = await targetChannel.messages.fetch(record.messageId);
        } catch (error) {
            console.error('Failed to fetch reaction role message:', error);
            await interaction.editReply('I could not find that panel message, sir. It may have been deleted.');
            return;
        }

        const me = guild.members.me || await guild.members.fetchMe();
        if (!me) {
            await interaction.editReply('I could not verify my permissions in that server, sir.');
            return;
        }

        // Parse new pairs if provided
        let newOptions = [];
        if (newPairsInput) {
            try {
                newOptions = await handler.parseReactionRolePairs(newPairsInput, guild);
            } catch (error) {
                await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
                return;
            }

            // Check for duplicate emojis with existing options
            const existingKeys = new Set(record.options.map(o => o.matchKey));
            const duplicates = newOptions.filter(o => existingKeys.has(o.matchKey));
            if (duplicates.length > 0) {
                await interaction.editReply(`These emojis are already on the panel: ${duplicates.map(d => d.display).join(', ')}. Please use different emojis, sir.`);
                return;
            }

            // Check total limit (20 reactions max)
            if (record.options.length + newOptions.length > 20) {
                await interaction.editReply(`Adding ${newOptions.length} roles would exceed the 20-reaction limit (current: ${record.options.length}), sir.`);
                return;
            }

            // Check role hierarchy
            const unusableRole = newOptions.find(option => {
                const role = guild.roles.cache.get(option.roleId);
                if (!role) return false;
                return me.roles.highest.comparePositionTo(role) <= 0;
            });

            if (unusableRole) {
                await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
                return;
            }
        }

        // Process removals if provided
        let removedOptions = [];
        let usersAffected = 0;
        if (removePairsInput) {
            // Parse emojis to remove
            const emojisToRemove = removePairsInput.split(/[,\s]+/).map(e => e.trim()).filter(Boolean);
            const removeKeys = new Set();

            for (const emojiInput of emojisToRemove) {
                const parsedEmoji = parseEmoji(emojiInput);
                if (parsedEmoji) {
                    const key = parsedEmoji.id || parsedEmoji.name;
                    if (key) removeKeys.add(key);
                }
            }

            if (removeKeys.size > 0) {
                // Find options to remove
                removedOptions = record.options.filter(o => removeKeys.has(o.matchKey));

                if (removedOptions.length === 0) {
                    await interaction.editReply('None of those emojis are currently on the panel, sir.');
                    return;
                }

                // Remove roles from users who have them
                for (const removedOption of removedOptions) {
                    try {
                        const role = guild.roles.cache.get(removedOption.roleId);
                        if (role && me.roles.highest.comparePositionTo(role) > 0) {
                            // Fetch reaction users and remove their roles
                            const reaction = panelMessage.reactions.cache.find(r => {
                                const key = r.emoji.id || r.emoji.name;
                                return key === removedOption.matchKey;
                            });

                            if (reaction) {
                                // Fetch all users who reacted
                                const users = await reaction.users.fetch();
                                for (const [userId, user] of users) {
                                    if (user.bot) continue;
                                    try {
                                        const member = await guild.members.fetch(userId);
                                        if (member && member.roles.cache.has(removedOption.roleId)) {
                                            await member.roles.remove(removedOption.roleId);
                                            usersAffected++;
                                        }
                                    } catch (memberError) {
                                        // User may have left the server
                                    }
                                }

                                // Remove the reaction from the message
                                try {
                                    await reaction.remove();
                                } catch (reactionError) {
                                    console.warn('Failed to remove reaction:', reactionError);
                                }
                            }
                        }
                    } catch (roleError) {
                        console.error('Error removing role from users:', roleError);
                    }
                }

                // Filter out removed options from record
                record.options = record.options.filter(o => !removeKeys.has(o.matchKey));
            }
        }

        // Build updated record
        const updatedTitle = newTitle || record.title || 'Select your roles';
        const updatedDescription = newDescription || record.description || 'React with the options below to toggle roles, sir.';
        const updatedOptions = [...record.options, ...newOptions];

        // Build updated embed
        const optionLines = updatedOptions.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
        const embedDescription = updatedDescription ? `${updatedDescription}\n\n${optionLines}` : optionLines;

        const embed = new EmbedBuilder()
            .setTitle(updatedTitle)
            .setDescription(embedDescription)
            .setColor(0x5865f2)
            .setFooter({ text: 'React to add or remove roles.' });

        // Update the message
        try {
            await panelMessage.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to edit reaction role message:', error);
            await interaction.editReply('I could not edit that panel message, sir. Check my permissions.');
            return;
        }

        // Add new reactions if new pairs were added
        if (newOptions.length > 0) {
            try {
                for (const option of newOptions) {
                    await panelMessage.react(option.rawEmoji);
                }
            } catch (error) {
                console.error('Failed to add new reactions:', error);
                await interaction.editReply('The panel was updated but I could not add some of the new reactions, sir.');
                // Continue to save the database update anyway
            }
        }

        // Update database
        try {
            await database.saveReactionRoleMessage({
                ...record,
                options: updatedOptions,
                title: updatedTitle,
                description: updatedDescription,
                updatedBy: interaction.user.id
            });
        } catch (error) {
            console.error('Failed to update reaction role configuration:', error);
            await interaction.editReply('I updated the panel but could not save the configuration, sir.');
            return;
        }

        const changes = [];
        if (newTitle) changes.push('title');
        if (newDescription) changes.push('description');
        if (newOptions.length > 0) changes.push(`${newOptions.length} new role(s)`);
        if (removedOptions.length > 0) changes.push(`removed ${removedOptions.length} role(s)${usersAffected > 0 ? ` from ${usersAffected} user(s)` : ''}`);

        const messageUrl = panelMessage.url || `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
        await interaction.editReply(`Panel updated (${changes.join(', ')}), sir. [Jump to message](${messageUrl})`);
        return;
    }

    if (subcommand === 'list') {
        let records = [];
        try {
            records = await database.getReactionRolesForGuild(guild.id);
        } catch (error) {
            console.error('Failed to list reaction roles:', error);
            await interaction.editReply('I could not retrieve the current configurations, sir.');
            return;
        }

        if (!records || records.length === 0) {
            await interaction.editReply('No reaction role panels are currently configured, sir.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('Active reaction role panels')
            .setColor(0x5865f2);

        const limitedRecords = records.slice(0, 25);
        for (let index = 0; index < limitedRecords.length; index++) {
            const record = limitedRecords[index];
            const url = `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
            const roleLines = (record.options || [])
                .map(option => `${option.display} → <@&${option.roleId}>`)
                .join('\n') || 'No roles recorded.';

            const value = `${guild.channels.cache.get(record.channelId) ? `<#${record.channelId}>` : 'Channel missing'} • [Jump to message](${url})\n${roleLines}`;

            embed.addFields({
                name: `Panel ${index + 1}`,
                value: value.length > 1024 ? `${value.slice(0, 1019)}...` : value
            });
        }

        if (records.length > limitedRecords.length) {
            embed.setFooter({ text: `Showing ${limitedRecords.length} of ${records.length} panels.` });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    if (subcommand === 'setmods') {
        const shouldClear = interaction.options.getBoolean('clear') || false;
        const roleIds = [];
        for (let index = 1; index <= 5; index++) {
            const role = interaction.options.getRole(`role${index}`);
            if (role && !roleIds.includes(role.id)) {
                roleIds.push(role.id);
            }
        }

        if (!shouldClear && roleIds.length === 0) {
            await interaction.editReply('Please provide at least one role or enable the clear option, sir.');
            return;
        }

        try {
            const updated = await database.setGuildModeratorRoles(guild.id, shouldClear ? [] : roleIds, guild.ownerId);
            const summary = updated?.moderatorRoleIds?.length
                ? updated.moderatorRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
                : 'Only the server owner may configure reaction roles.';

            await interaction.editReply(shouldClear
                ? 'Moderator roles cleared, sir. Only the owner retains access.'
                : `Moderator roles updated, sir: ${summary}`);
        } catch (error) {
            console.error('Failed to update moderator roles:', error);
            await interaction.editReply('I could not adjust the moderator roles, sir.');
        }
        return;
    }

    await interaction.editReply('I do not recognize that subcommand, sir.');
}

async function handleReactionAdd(handler, reaction, user) {
    if (!database.isConnected || !reaction || !user || user.bot) {
        return;
    }

    try {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.warn('Failed to fetch partial reaction (add):', error);
            }
        }

        if (reaction.message?.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.warn('Failed to fetch partial message for reaction add:', error);
            }
        }

        const context = await handler.resolveReactionRoleContext(reaction, user);
        if (!context) {
            return;
        }

        if (context.member.roles.cache.has(context.role.id)) {
            return;
        }

        await context.member.roles.add(context.role, 'Reaction role assignment');
    } catch (error) {
        console.error('Failed to handle reaction role assignment:', error);
    }
}

async function handleReactionRemove(handler, reaction, user) {
    if (!database.isConnected || !reaction || !user || user.bot) {
        return;
    }

    try {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.warn('Failed to fetch partial reaction (remove):', error);
            }
        }

        if (reaction.message?.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.warn('Failed to fetch partial message for reaction remove:', error);
            }
        }

        const context = await handler.resolveReactionRoleContext(reaction, user);
        if (!context) {
            return;
        }

        if (!context.member.roles.cache.has(context.role.id)) {
            return;
        }

        await context.member.roles.remove(context.role, 'Reaction role removal');
    } catch (error) {
        console.error('Failed to handle reaction role removal:', error);
    }
}

async function handleTrackedMessageDelete(handler, message) {
    if (!database.isConnected || !message?.id) {
        return;
    }

    try {
        const record = await database.getReactionRole(message.id);
        if (!record) {
            return;
        }

        await database.deleteReactionRole(message.id);
    } catch (error) {
        console.error('Failed to clean up deleted reaction role message:', error);
    }
}

module.exports = {
    handleReactionRoleCommand,
    handleReactionAdd,
    handleReactionRemove,
    handleTrackedMessageDelete
};
