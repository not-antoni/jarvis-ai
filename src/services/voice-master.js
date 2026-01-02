const { ChannelType, PermissionFlagsBits } = require('discord.js');

/**
 * VoiceMaster Service
 * Handles temporary voice channels.
 * 
 * Logic:
 * 1. User joins "Join to Create" channel.
 * 2. Bot creates a new Voice Channel.
 * 3. Bot moves user to new channel.
 * 4. Bot deletes channel when empty.
 */
class VoiceMaster {
    constructor() {
        // Map to track temp channels: channelId -> creatorId
        this.tempChannels = new Map();

        // Name of the trigger channel (case-insensitive)
        this.triggerChannelNames = ['➕ create voice', '➕ join to create', 'join to create'];
    }

    /**
     * Handle Voice State Update
     * @param {import('discord.js').VoiceState} oldState 
     * @param {import('discord.js').VoiceState} newState 
     */
    async handleVoiceStateUpdate(oldState, newState) {
        // Check if user joined a channel
        if (newState.channelId) {
            await this.checkJoin(newState);
        }

        // Check if user left a channel (or moved)
        if (oldState.channelId) {
            await this.checkLeave(oldState);
        }
    }

    /**
     * Logic when a user joins a voice channel
     */
    async checkJoin(state) {
        const channel = state.channel;
        const member = state.member;

        // Check if joined channel is a trigger channel
        if (this.triggerChannelNames.includes(channel.name.toLowerCase())) {
            try {
                // Create new channel
                const guild = channel.guild;
                const parent = channel.parent; // Category
                const channelName = `${member.user.username}'s Channel`;

                const newChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    parent: parent, // Put in same category
                    permissionOverwrites: [
                        {
                            id: member.id,
                            allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect],
                        },
                        {
                            id: guild.id,
                            allow: [PermissionFlagsBits.Connect],
                        }
                    ]
                });

                // Track it
                this.tempChannels.set(newChannel.id, member.id);

                // Move member to new channel
                await member.voice.setChannel(newChannel);
                console.log(`[VoiceMaster] Created temp channel "${channelName}" for ${member.user.tag}`);

            } catch (error) {
                console.error('[VoiceMaster] Failed to create temp channel:', error);
            }
        }
    }

    /**
     * Logic when a user leaves a voice channel
     */
    async checkLeave(state) {
        const channel = state.channel;

        // Check if this was a tracked temp channel
        // OR checks if it "looks like" a temp channel (if bot restarted and lost memory map)
        // Heuristic: If it has 0 members and isn't a trigger channel.
        if (channel.members.size === 0) {
            if (this.tempChannels.has(channel.id) || !this.triggerChannelNames.includes(channel.name.toLowerCase())) {

                // Double check it's not a trigger channel before deleting if utilizing the weak check
                if (this.triggerChannelNames.includes(channel.name.toLowerCase())) return;

                // If strictly tracked or using heuristic for "User's Channel" pattern
                const isTracked = this.tempChannels.has(channel.id);
                const isUserChannel = channel.name.includes("'s Channel");

                if (isTracked || isUserChannel) {
                    try {
                        await channel.delete();
                        this.tempChannels.delete(channel.id);
                        console.log(`[VoiceMaster] Deleted empty temp channel "${channel.name}"`);
                    } catch (error) {
                        // Ignore if already deleted/perms issue
                    }
                }
            }
        }
    }
}

module.exports = new VoiceMaster();
