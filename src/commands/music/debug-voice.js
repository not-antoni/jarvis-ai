const { SlashCommandBuilder } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const generateDependencyReport = require('@discordjs/voice').generateDependencyReport;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug-voice')
        .setDescription('Test voice connection without Distube'),
    async execute(interaction) {
        await interaction.deferReply();
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.editReply('❌ You must be in a voice channel!');
        }

        try {
            interaction.editReply(`🔍 Attempting raw connection to ${voiceChannel.name}...\n\`\`\`\n${generateDependencyReport()}\n\`\`\``);

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
                debug: true
            });

            connection.on(VoiceConnectionStatus.Signalling, () => {
                console.log('[DebugVoice] Connection Entering Signalling');
            });

            connection.on(VoiceConnectionStatus.Connecting, () => {
                console.log('[DebugVoice] Connection Entering Connecting');
            });

            connection.on('stateChange', (oldState, newState) => {
                console.log(`[DebugVoice] Connection transitioned from ${oldState.status} to ${newState.status}`);
            });

            connection.on('error', (error) => {
                console.error('[DebugVoice] Connection Error:', error);
                interaction.followUp(`❌ Connection Error: ${error.message}`);
            });

            // Wait for connection
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

            await interaction.followUp('✅ **Connection READY!** The issue is likely Distube configuration.');

            // Cleanup
            setTimeout(() => {
                connection.destroy();
                interaction.followUp('🔌 Disconnected debug session.');
            }, 5000);

        } catch (error) {
            console.error('[DebugVoice] Handshake failed:', error);
            await interaction.followUp(`❌ **Connection FAILED**: ${error.message}\n\nThis confirms a **Network/Firewall Issue** (UDP blocked).`);
        }
    }
};
