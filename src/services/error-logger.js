const { EmbedBuilder, ButtonBuilder, ActionRowBuilder } = require('discord.js');

const ERROR_LOG_CHANNEL_ID = process.env.ERROR_LOG_CHANNEL_ID || '1437020146689507449';

const STATUS = {
    pending: { label: 'Pending', color: 0xfacc15 },
    solved: { label: 'Solved', color: 0x22c55e },
    unsolved: { label: 'Unsolved', color: 0xef4444 },
};

function truncate(text, max = 1000) {
    if (typeof text !== 'string') return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '…';
}

function safeStringify(value, max = 1000) {
    try {
        return truncate(JSON.stringify(value, null, 2), max);
    } catch {
        return truncate(String(value), max);
    }
}

function createErrorId() {
    return `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

class ErrorLogger {
    constructor() {
        this.client = null;
        this.pendingQueue = [];
    }

    setClient(client) {
        this.client = client;
        this.flush().catch(() => {});
    }

    async flush() {
        if (!this.client || this.pendingQueue.length === 0) return;
        const queued = [...this.pendingQueue];
        this.pendingQueue = [];
        for (const item of queued) {
            await this.log(item).catch(() => {});
        }
    }

    buildComponents(errorId, statusKey = 'pending') {
        const pendingButton = new ButtonBuilder()
            .setCustomId(`errlog:${errorId}:pending`)
            .setLabel('Mark Pending')
            .setStyle(STATUS.pending ? 1 : 1);

        const solvedButton = new ButtonBuilder()
            .setCustomId(`errlog:${errorId}:solved`)
            .setLabel('Mark Solved')
            .setStyle(3);

        const unsolvedButton = new ButtonBuilder()
            .setCustomId(`errlog:${errorId}:unsolved`)
            .setLabel('Mark Unsolved')
            .setStyle(4);

        const row = new ActionRowBuilder().addComponents(pendingButton, solvedButton, unsolvedButton);
        return [row];
    }

    async log({ error, context = {}, errorId = null }) {
        const resolvedId = errorId || createErrorId();

        if (!this.client) {
            this.pendingQueue.push({ error, context, errorId: resolvedId });
            return resolvedId;
        }

        const channel = await this.client.channels.fetch(ERROR_LOG_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            this.pendingQueue.push({ error, context, errorId: resolvedId });
            return resolvedId;
        }

        const errorText = error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);

        const stack = error instanceof Error ? error.stack : null;

        const embed = new EmbedBuilder()
            .setTitle('Jarvis Error Report')
            .setColor(STATUS.pending.color)
            .setDescription(`**Status:** ${STATUS.pending.label}`)
            .addFields(
                { name: 'Error ID', value: `\`${resolvedId}\``, inline: true },
                { name: 'Location', value: truncate(context.location || 'unknown', 256), inline: true },
                { name: 'User', value: truncate(context.user || 'unknown', 256), inline: true },
                { name: 'Guild', value: truncate(context.guild || 'DM/unknown', 256), inline: true },
                { name: 'Channel', value: truncate(context.channel || 'unknown', 256), inline: true },
                { name: 'Command', value: truncate(context.command || 'unknown', 256), inline: true },
                { name: 'Error', value: `\`\`\`${truncate(errorText, 900)}\`\`\`` },
            )
            .setFooter({ text: `errlog:${resolvedId}` })
            .setTimestamp();

        if (stack) {
            embed.addFields({ name: 'Stack', value: `\`\`\`${truncate(stack, 900)}\`\`\`` });
        }

        if (context.extra) {
            embed.addFields({ name: 'Context', value: `\`\`\`${safeStringify(context.extra, 900)}\`\`\`` });
        }

        const components = this.buildComponents(resolvedId);
        await channel.send({ embeds: [embed], components }).catch(() => null);

        return resolvedId;
    }

    parseButtonCustomId(customId) {
        const match = typeof customId === 'string' ? customId.match(/^errlog:([^:]+):(pending|solved|unsolved)$/) : null;
        if (!match) return null;
        return { errorId: match[1], status: match[2] };
    }

    async handleStatusButton(interaction) {
        const parsed = this.parseButtonCustomId(interaction.customId);
        if (!parsed) return false;

        const status = STATUS[parsed.status];
        if (!status) return false;

        const embed = interaction.message?.embeds?.[0];
        if (!embed) {
            await interaction.reply({ content: 'No embed found to update.', ephemeral: true });
            return true;
        }

        const newEmbed = EmbedBuilder.from(embed)
            .setColor(status.color)
            .setDescription(`**Status:** ${status.label}`);

        const components = this.buildComponents(parsed.errorId, parsed.status);

        await interaction.update({ embeds: [newEmbed], components }).catch(async () => {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Failed to update error status.', ephemeral: true });
            }
        });

        return true;
    }
}

module.exports = new ErrorLogger();
module.exports.createErrorId = createErrorId;
module.exports.ERROR_LOG_CHANNEL_ID = ERROR_LOG_CHANNEL_ID;
