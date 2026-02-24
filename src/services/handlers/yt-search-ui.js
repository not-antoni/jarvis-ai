'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 250;
const sessions = new Map();

function randomId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function pruneSessions() {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (session.expiresAt <= now) {
            sessions.delete(id);
        }
    }

    if (sessions.size <= MAX_SESSIONS) {
        return;
    }

    const oldest = [...sessions.entries()]
        .sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, sessions.size - MAX_SESSIONS);
    for (const [id] of oldest) {
        sessions.delete(id);
    }
}

function getSession(sessionId) {
    if (!sessionId) {
        return null;
    }
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }
    if (session.expiresAt <= Date.now()) {
        sessions.delete(sessionId);
        return null;
    }
    return session;
}

function touchSession(session) {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
}

function buildButtons(sessionId, index, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ytsearch:back:${sessionId}`)
            .setLabel('Back')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index <= 0),
        new ButtonBuilder()
            .setCustomId(`ytsearch:fwd:${sessionId}`)
            .setLabel('Forward')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index >= total - 1),
        new ButtonBuilder()
            .setCustomId(`ytsearch:jump:${sessionId}`)
            .setLabel('Jump')
            .setEmoji('🔢')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ytsearch:delete:${sessionId}`)
            .setLabel('Delete')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );
}

function buildEmbed(query, video) {
    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({ name: 'YouTube' })
        .setTitle(video.title || 'Untitled Video')
        .setURL(video.url || null)
        .setDescription(video.channel ? `**${video.channel}**` : '**Unknown channel**');

    if (video.thumbnail) {
        embed.setImage(video.thumbnail);
    }
    if (query) {
        embed.setFooter({ text: `Search: ${query}` });
    }
    return embed;
}

function buildPayload(sessionId, session) {
    const index = session.index;
    const total = session.results.length;
    const video = session.results[index];

    const content = [
        `Page ${index + 1} of ${total}`,
        `▶ **${video.title || 'Untitled Video'}**`,
        `Uploaded by **${video.channel || 'Unknown channel'}**`,
        video.url || 'No URL available'
    ].join('\n');

    return {
        content,
        embeds: [buildEmbed(session.query, video)],
        components: [buildButtons(sessionId, index, total)],
        allowedMentions: { parse: [] }
    };
}

function createSession(ownerId, query, results) {
    pruneSessions();
    const sessionId = randomId();
    sessions.set(sessionId, {
        ownerId,
        query,
        results,
        index: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
        messageId: null,
        channelId: null
    });
    return sessionId;
}

function buildInitialResponse({ ownerId, query, results }) {
    const sessionId = createSession(ownerId, query, results);
    return buildPayload(sessionId, sessions.get(sessionId));
}

async function replyNotOwner(interaction) {
    const payload = { content: "This isn't your interaction, sir.", ephemeral: true };
    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(payload).catch(() => {});
    } else {
        await interaction.followUp(payload).catch(() => {});
    }
}

async function replyExpired(interaction) {
    const payload = { content: 'That YouTube search session expired, sir. Run `/yt` again.', ephemeral: true };
    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(payload).catch(() => {});
    } else {
        await interaction.followUp(payload).catch(() => {});
    }
}

async function resolveMessageForSession(interaction, session) {
    if (interaction.message) {
        return interaction.message;
    }
    if (!session.channelId || !session.messageId) {
        return null;
    }
    const channel = interaction.channel || await interaction.client.channels.fetch(session.channelId).catch(() => null);
    if (!channel?.messages?.fetch) {
        return null;
    }
    return channel.messages.fetch(session.messageId).catch(() => null);
}

async function handleButton(interaction, action, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        await replyExpired(interaction);
        return true;
    }

    if (interaction.user.id !== session.ownerId) {
        await replyNotOwner(interaction);
        return true;
    }

    touchSession(session);
    session.messageId = interaction.message?.id || session.messageId;
    session.channelId = interaction.channelId || session.channelId;

    if (action === 'delete') {
        sessions.delete(sessionId);
        try {
            await interaction.message.delete();
        } catch {
            await interaction.update({
                content: 'Search panel removed, sir.',
                embeds: [],
                components: [],
                allowedMentions: { parse: [] }
            }).catch(() => {});
        }
        return true;
    }

    if (action === 'back') {
        session.index = Math.max(0, session.index - 1);
        await interaction.update(buildPayload(sessionId, session)).catch(() => {});
        return true;
    }

    if (action === 'fwd') {
        session.index = Math.min(session.results.length - 1, session.index + 1);
        await interaction.update(buildPayload(sessionId, session)).catch(() => {});
        return true;
    }

    if (action === 'jump') {
        const modal = new ModalBuilder()
            .setCustomId(`ytsearch:jumpmodal:${sessionId}`)
            .setTitle('Jump to Page');
        const input = new TextInputBuilder()
            .setCustomId('ytsearch_page')
            .setLabel(`Enter page number (1-${session.results.length})`)
            .setPlaceholder(String(session.index + 1))
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal).catch(() => {});
        return true;
    }

    return false;
}

async function handleJumpModal(interaction, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        await replyExpired(interaction);
        return true;
    }

    if (interaction.user.id !== session.ownerId) {
        await replyNotOwner(interaction);
        return true;
    }

    touchSession(session);

    const rawInput = interaction.fields.getTextInputValue('ytsearch_page');
    const pageNumber = Number.parseInt(rawInput, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > session.results.length) {
        await interaction.reply({
            content: `Invalid page. Enter a number from 1 to ${session.results.length}, sir.`,
            ephemeral: true
        }).catch(() => {});
        return true;
    }

    session.index = pageNumber - 1;

    const message = await resolveMessageForSession(interaction, session);
    if (message) {
        await message.edit(buildPayload(sessionId, session)).catch(() => {});
    }

    await interaction.reply({
        content: `Jumped to page ${pageNumber} of ${session.results.length}, sir.`,
        ephemeral: true
    }).catch(() => {});
    return true;
}

async function handleInteraction(interaction) {
    pruneSessions();

    if (interaction.isButton()) {
        const match = interaction.customId.match(/^ytsearch:(back|fwd|jump|delete):([a-z0-9]+)$/i);
        if (!match) {
            return false;
        }
        const action = match[1].toLowerCase();
        const sessionId = match[2];
        return handleButton(interaction, action, sessionId);
    }

    if (interaction.isModalSubmit()) {
        const match = interaction.customId.match(/^ytsearch:jumpmodal:([a-z0-9]+)$/i);
        if (!match) {
            return false;
        }
        return handleJumpModal(interaction, match[1]);
    }

    return false;
}

module.exports = {
    buildInitialResponse,
    handleInteraction
};
