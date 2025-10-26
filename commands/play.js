const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("play")
        .setDescription("Play a YouTube song in your voice channel.")
        .addStringOption(option =>
            option
                .setName("query")
                .setDescription("Search or paste a YouTube link")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async execute(interaction, client) {
        const member = interaction.member;
        if (!member.voice.channel) {
            return interaction.reply({ content: "❌ Join a voice channel first!", ephemeral: true });
        }

        const query = interaction.options.getString("query");

        let player = client.manager.players.get(interaction.guild.id);
        if (!player) {
            player = client.manager.create({
                guild: interaction.guild.id,
                voiceChannel: member.voice.channel.id,
                textChannel: interaction.channel.id
            });
            player.connect();
        }

        const res = await client.manager.search(query, interaction.user);
        if (!res.tracks.length) {
            return interaction.reply({ content: "❌ No results found.", ephemeral: true });
        }

        const track = res.tracks[0];
        player.queue.add(track);
        if (!player.playing && !player.paused && !player.queue.size) player.play();

        return interaction.reply(`🎶 Now playing **${track.title}**`);
    }
};
