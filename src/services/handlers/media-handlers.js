'use strict';

const cheerio = require('cheerio');
const { fetchBuffer } = require('../../utils/net-guard');

const TEN_MB = 10 * 1024 * 1024;
const NITRO_LIMIT_MESSAGE = "sir, please understand that I don't have nitro and therefore I can only process files up to 10mb.";
const MEDIA_REQUIRED_MESSAGE = 'Sir, either provide an attachment or let me drink my coffee.';

let memeCanvas;
try {
    memeCanvas = require('../../utils/meme-canvas');
} catch (_) {
    memeCanvas = null;
}

async function handleSlashCommandClip(handler, interaction) {
    try {
        await interaction.deferReply({ ephemeral: false });

        const messageId = interaction.options.getString('message_id');

        if (!messageId) {
            await interaction.editReply('Please provide a message ID, sir.');
            return true;
        }

        const targetMessage = await handler.findMessageAcrossChannels(interaction, messageId);
        if (!targetMessage) {
            await interaction.editReply('Could not find that message, sir. I searched this channel and others I can access.');
            return true;
        }

        console.log('Slash command timestamp debug:', {
            slashCommandTime: interaction.createdAt.toLocaleTimeString(),
            targetMessageTime: targetMessage.createdAt.toLocaleTimeString(),
            targetMessageTimestamp: targetMessage.createdTimestamp,
            interactionTimestamp: interaction.createdTimestamp
        });

        const avatarUrl = targetMessage.member?.avatarURL({
            extension: 'png',
            size: 128,
            forceStatic: false
        }) || targetMessage.author.displayAvatarURL({
            extension: 'png',
            size: 128,
            forceStatic: false
        });

        let roleColor = '#ff6b6b';
        try {
            if (interaction.guild && targetMessage.member) {
                roleColor = handler.getUserRoleColor(targetMessage.member);
            }
        } catch (error) {
            console.warn('Failed to get role color for slash command:', error);
        }

        const displayName = handler.getSafeDisplayName(targetMessage.member, targetMessage.author);

        const imageBuffer = await handler.createClipImage(
            targetMessage.content,
            displayName,
            avatarUrl,
            targetMessage.author.bot,
            roleColor,
            interaction.guild,
            interaction.client,
            targetMessage,
            targetMessage.author,
            targetMessage.attachments
        );

        await handler.sendBufferOrLink(interaction, imageBuffer, 'clipped.png');

        return true;
    } catch (error) {
        console.error('Error handling slash clip command:', error);
        try {
            await interaction.editReply('Failed to clip message, sir. Technical difficulties.');
        } catch (editError) {
            console.error('Failed to send error reply:', editError);
        }
        return true;
    }
}

async function fetchAttachmentBuffer(attachment, { maxBytes } = {}) {
    if (!attachment?.url) {
        throw new Error('Attachment missing URL');
    }
    const fetched = await fetchBuffer(
        attachment.url,
        { method: 'GET' },
        { maxBytes }
    );
    if (fetched.tooLarge) {
        throw new Error('Attachment too large');
    }
    return fetched.buffer;
}

async function fetchImageFromUrl(rawUrl, { maxBytes } = {}) {
    if (!rawUrl) {throw new Error('URL required');}
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) {throw new Error('Unsupported protocol');}

    const fetched = await fetchBuffer(url.toString(), { method: 'GET' }, { maxBytes });
    if (fetched.tooLarge) {
        return { tooLarge: true, contentType: fetched.contentType, sourceUrl: fetched.url };
    }
    const contentType = (fetched.contentType || '').toLowerCase();
    if (contentType.startsWith('image/')) {
        return { buffer: fetched.buffer, contentType, sourceUrl: fetched.url };
    }

    if (contentType.includes('text/html')) {
        const html = fetched.buffer.toString('utf8');
        const $ = cheerio.load(html);
        let media = $('meta[property="og:image"]').attr('content')
            || $('meta[name="twitter:image"]').attr('content')
            || $('meta[property="og:video"]').attr('content');
        if (!media) {
            const ld = $('script[type="application/ld+json"]').first().text();
            try {
                const obj = JSON.parse(ld);
                media = obj?.contentUrl || obj?.image?.[0] || obj?.image;
            } catch (_) {}
        }
        if (media) {
            const resolved = new URL(media, fetched.url || url).toString();
            const mediaFetch = await fetchBuffer(resolved, { method: 'GET' }, { maxBytes });
            if (mediaFetch.tooLarge) {
                return { tooLarge: true, contentType: mediaFetch.contentType, sourceUrl: mediaFetch.url };
            }
            const ctype = (mediaFetch.contentType || '').toLowerCase();
            return { buffer: mediaFetch.buffer, contentType: ctype, sourceUrl: mediaFetch.url };
        }
    }
    throw new Error('No image found at URL');
}

async function resolveSlashMediaInput(handler, interaction, { maxBytes = TEN_MB } = {}) {
    const attachment = interaction.options.getAttachment('image', false);
    const urlOpt = (interaction.options.getString('url') || '').trim();

    if (attachment) {
        const contentType = (attachment.contentType || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            await interaction.editReply('That file does not appear to be an image, sir.');
            return null;
        }
        if (Number(attachment.size || 0) > maxBytes) {
            await interaction.editReply(NITRO_LIMIT_MESSAGE);
            return null;
        }
        const buffer = await fetchAttachmentBuffer(attachment, { maxBytes });
        if (buffer.length > maxBytes) {
            await interaction.editReply(NITRO_LIMIT_MESSAGE);
            return null;
        }
        return { buffer, contentType };
    }

    if (urlOpt) {
        const fetched = await fetchImageFromUrl(urlOpt, { maxBytes });
        if (fetched.tooLarge) {
            await interaction.editReply(NITRO_LIMIT_MESSAGE);
            return null;
        }
        const contentType = (fetched.contentType || '').toLowerCase();
        if (contentType && !contentType.startsWith('image/')) {
            await interaction.editReply('That file does not appear to be an image, sir.');
            return null;
        }
        if (!fetched.buffer || fetched.buffer.length > maxBytes) {
            await interaction.editReply(NITRO_LIMIT_MESSAGE);
            return null;
        }
        return { buffer: fetched.buffer, contentType };
    }

    await interaction.editReply(MEDIA_REQUIRED_MESSAGE);
    return null;
}

async function handleCaptionCommand(handler, interaction) {
    const { guild } = interaction;
    if (guild && !(await handler.isFeatureActive('memeTools', guild))) {
        await interaction.editReply('Meme systems are disabled for this server, sir.');
        return;
    }

    const text = interaction.options.getString('text', true).trim();

    if (!text.length) {
        await interaction.editReply('Please provide a caption, sir.');
        return;
    }

    if (text.length > 200) {
        await interaction.editReply('Caption must be 200 characters or fewer, sir.');
        return;
    }

    try {
        const mediaInput = await resolveSlashMediaInput(handler, interaction, { maxBytes: TEN_MB });
        if (!mediaInput) {
            return;
        }

        const { buffer, contentType } = mediaInput;
        const uploadPolicy = {
            maxUploadBytes: TEN_MB,
            allowTempLink: false,
            tooLargeMessage: NITRO_LIMIT_MESSAGE
        };

        if (contentType && contentType.includes('gif')) {
            try {
                const { captionAnimated } = require('../../utils/gif-caption');
                const out = await captionAnimated({ inputBuffer: buffer, captionText: text });
                await handler.sendBufferOrLink(interaction, out, 'caption.gif', uploadPolicy);
            } catch (err) {
                console.warn('Animated caption failed, falling back to PNG:', err?.message || err);
                const rendered = await memeCanvas.createCaptionImage(buffer, text);
                await handler.sendBufferOrLink(interaction, rendered, 'caption.png', uploadPolicy);
            }
        } else {
            const rendered = await memeCanvas.createCaptionImage(buffer, text);
            await handler.sendBufferOrLink(interaction, rendered, 'caption.png', uploadPolicy);
        }
    } catch (error) {
        console.error('Caption command failed:', error);
        await interaction.editReply('Caption generator misfired, sir. Try another image.');
    }
}

async function handleGifCommand(handler, interaction) {
    const { guild } = interaction;
    if (guild && !(await handler.isFeatureActive('memeTools', guild))) {
        await interaction.editReply('Meme systems are disabled for this server, sir.');
        return;
    }

    try {
        const mediaInput = await resolveSlashMediaInput(handler, interaction, { maxBytes: TEN_MB });
        if (!mediaInput) {
            return;
        }

        const sharp = require('sharp');
        const { buffer } = mediaInput;
        let rendered;
        try {
            rendered = await sharp(buffer, { animated: true, pages: -1 })
                .gif({ effort: 3 })
                .toBuffer();
        } catch (_firstError) {
            rendered = await sharp(buffer)
                .gif({ effort: 3 })
                .toBuffer();
        }

        await handler.sendBufferOrLink(interaction, rendered, 'converted.gif', {
            maxUploadBytes: TEN_MB,
            allowTempLink: false,
            tooLargeMessage: NITRO_LIMIT_MESSAGE
        });
    } catch (error) {
        console.error('GIF command failed:', error);
        await interaction.editReply('GIF conversion failed, sir. Try another image.');
    }
}

async function handleMemeCommand(handler, interaction) {
    const { guild } = interaction;
    if (guild && !(await handler.isFeatureActive('memeTools', guild))) {
        await interaction.editReply('Meme systems are disabled for this server, sir.');
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'impact') {
        await interaction.editReply('I have not memorised that meme pattern yet, sir.');
        return;
    }

    const attachment = interaction.options.getAttachment('image', false);
    const urlOpt = (interaction.options.getString('url') || '').trim();
    const top = (interaction.options.getString('top') || '').trim();
    const bottom = (interaction.options.getString('bottom') || '').trim();

    if (top.length > 120 || bottom.length > 120) {
        await interaction.editReply('Each text block must be 120 characters or fewer, sir.');
        return;
    }

    try {
        let buffer;
        if (attachment) {
            const contentType = (attachment.contentType || '').toLowerCase();
            if (!contentType.startsWith('image/')) {
                await interaction.editReply('That file does not appear to be an image, sir.');
                return;
            }
            if (Number(attachment.size || 0) > handler.maxInputBytes) {
                await interaction.editReply("MY poor CPU can't handle that, sir.");
                return;
            }
            buffer = await fetchAttachmentBuffer(attachment);
        } else if (urlOpt) {
            const fetched = await fetchImageFromUrl(urlOpt, { maxBytes: handler.maxInputBytes });
            if (fetched.tooLarge) {
                await interaction.editReply("MY poor CPU can't handle that, sir.");
                return;
            }
            buffer = fetched.buffer;
        } else {
            await interaction.editReply('Provide an image attachment or a URL, sir.');
            return;
        }
        const rendered = await memeCanvas.createImpactMemeImage(buffer, top, bottom);
        await handler.sendBufferOrLink(interaction, rendered, 'meme.png');
    } catch (error) {
        console.error('Impact meme command failed:', error);
        await interaction.editReply('Impact meme generators overheated, sir. Try again shortly.');
    }
}

module.exports = {
    handleSlashCommandClip,
    fetchAttachmentBuffer,
    fetchImageFromUrl,
    handleCaptionCommand,
    handleGifCommand,
    handleMemeCommand
};
