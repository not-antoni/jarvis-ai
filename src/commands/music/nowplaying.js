'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

const BAR_LENGTH = 22;
const FILLED = '█';
const EMPTY = '░';
const REFRESH_INTERVAL_MS = 6_000;
const MAX_REFRESHES = 10; // ~60 seconds of live updates

function parseDurationToSec(input) {
    if (typeof input === 'number' && Number.isFinite(input)) {return Math.max(0, input);}
    if (typeof input !== 'string') {return null;}
    const trimmed = input.trim();
    if (!trimmed) {return null;}
    const parts = trimmed.split(':').map(n => parseInt(n, 10));
    if (parts.some(n => !Number.isFinite(n))) {return null;}
    let total = 0;
    for (const part of parts) {
        total = total * 60 + part;
    }
    return total;
}

function formatSecs(total) {
    if (!Number.isFinite(total) || total < 0) {return '--:--';}
    const sec = Math.floor(total % 60).toString().padStart(2, '0');
    const totalMin = Math.floor(total / 60);
    if (totalMin < 60) {
        return `${totalMin}:${sec}`;
    }
    const hr = Math.floor(totalMin / 60);
    const min = (totalMin % 60).toString().padStart(2, '0');
    return `${hr}:${min}:${sec}`;
}

function renderBar(elapsedSec, totalSec) {
    if (!Number.isFinite(totalSec) || totalSec <= 0) {
        return `${FILLED.repeat(3)}${EMPTY.repeat(BAR_LENGTH - 3)}`;
    }
    const ratio = Math.max(0, Math.min(1, elapsedSec / totalSec));
    const filled = Math.round(ratio * BAR_LENGTH);
    return `${FILLED.repeat(filled)}${EMPTY.repeat(BAR_LENGTH - filled)}`;
}

function buildEmbed(snapshot) {
    const track = snapshot.track;
    const totalSec = parseDurationToSec(track.duration);
    const elapsedSec = snapshot.elapsedMs ? Math.floor(snapshot.elapsedMs / 1000) : 0;
    const bar = renderBar(elapsedSec, totalSec);
    const timing = totalSec
        ? `\`${formatSecs(elapsedSec)} ${bar} ${formatSecs(totalSec)}\``
        : `\`${formatSecs(elapsedSec)} ${bar} LIVE\``;
    const embed = new EmbedBuilder()
        .setColor(snapshot.paused ? 0x888888 : 0x1db954)
        .setTitle(snapshot.paused ? '⏸️ Paused' : '🎶 Now Playing')
        .setDescription(`**[${track.title}](${track.url})**\n${timing}`)
        .setFooter({
            text: [
                `Loop: ${snapshot.loopMode}`,
                `Queue: ${snapshot.queueLength}`,
                track.source ? `Source: ${track.source}` : null
            ].filter(Boolean).join('  ·  ')
        });
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing track with a live progress bar'),
    async execute(interaction) {
        if (!interaction.guild) {return;}
        const manager = musicManager.get();
        const snapshot = manager.getNowPlaying(interaction.guildId);
        if (!snapshot) {
            await interaction.reply({ content: '⚠️ Nothing is playing, sir.', flags: 64 });
            return;
        }

        await interaction.reply({ embeds: [buildEmbed(snapshot)] });
        const initialTrackStartedAt = snapshot.startedAt;
        const totalSec = parseDurationToSec(snapshot.track.duration);

        // Live-update loop. Stops early if track changes, finishes, or pauses.
        let refreshes = 0;
        const interval = setInterval(async() => {
            refreshes += 1;
            const latest = manager.getNowPlaying(interaction.guildId);
            // Track finished or changed - final flush then stop.
            if (!latest || latest.startedAt !== initialTrackStartedAt) {
                clearInterval(interval);
                try {
                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x555555)
                                .setTitle('✅ Track ended')
                                .setDescription(`**${snapshot.track.title}**`)
                        ]
                    });
                } catch { /* interaction expired or deleted */ }
                return;
            }
            // If elapsed exceeds duration by >2s, clean up
            if (totalSec && latest.elapsedMs && latest.elapsedMs / 1000 > totalSec + 2) {
                clearInterval(interval);
                return;
            }
            if (refreshes >= MAX_REFRESHES) {
                clearInterval(interval);
            }
            try {
                await interaction.editReply({ embeds: [buildEmbed(latest)] });
            } catch {
                clearInterval(interval);
            }
        }, REFRESH_INTERVAL_MS);
        // Safety: never let the interval outlive Discord's 15-minute window
        setTimeout(() => clearInterval(interval), 14 * 60_000).unref();
    },
    // Exported for tests
    _internals: { parseDurationToSec, formatSecs, renderBar, buildEmbed }
};
