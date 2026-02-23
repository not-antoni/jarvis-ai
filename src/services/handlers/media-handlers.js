'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../../../config');

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

async function fetchAttachmentBuffer(_handler, attachment) {
    if (!attachment?.url) {
        throw new Error('Attachment missing URL');
    }

    const res = await fetch(attachment.url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function fetchImageFromUrl(_handler, rawUrl, { maxBytes } = {}) {
    if (!rawUrl) {throw new Error('URL required');}
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) {throw new Error('Unsupported protocol');}

    let res = await fetch(url.toString(), { method: 'HEAD' });
    if (res.ok) {
        const ctype = (res.headers.get('content-type') || '').toLowerCase();
        const clen = Number(res.headers.get('content-length') || 0);
        if (maxBytes && clen && clen > maxBytes) {
            return { tooLarge: true, contentType: ctype, sourceUrl: url.toString() };
        }
    }
    res = await fetch(url.toString(), { redirect: 'follow' });
    if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('image/')) {
        if (maxBytes && res.body) {
            let received = 0;
            const chunks = [];
            await new Promise((resolve, reject) => {
                res.body.on('data', (chunk) => {
                    received += chunk.length;
                    if (received > maxBytes) {
                        res.body.destroy();
                        resolve();
                    } else {
                        chunks.push(chunk);
                    }
                });
                res.body.on('end', resolve);
                res.body.on('error', reject);
            });
            if (received > maxBytes) {
                return { tooLarge: true, contentType, sourceUrl: url.toString() };
            }
            return { buffer: Buffer.concat(chunks), contentType, sourceUrl: url.toString() };
        } 
        const buf = Buffer.from(await res.arrayBuffer());
        return { buffer: buf, contentType, sourceUrl: url.toString() };
        
    }

    if (contentType.includes('text/html')) {
        const html = await res.text();
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
            const resolved = new URL(media, url).toString();
            const head = await fetch(resolved, { method: 'HEAD' });
            const headType = (head.headers.get('content-type') || '').toLowerCase();
            const headLen = Number(head.headers.get('content-length') || 0);
            if (maxBytes && headLen && headLen > maxBytes) {
                return { tooLarge: true, contentType: headType, sourceUrl: resolved };
            }
            res = await fetch(resolved, { redirect: 'follow' });
            if (!res.ok) {throw new Error(`Media HTTP ${res.status}`);}
            const ctype = (res.headers.get('content-type') || '').toLowerCase();
            if (maxBytes && res.body) {
                let received = 0;
                const chunks = [];
                await new Promise((resolve, reject) => {
                    res.body.on('data', (chunk) => {
                        received += chunk.length;
                        if (received > maxBytes) {
                            res.body.destroy();
                            resolve();
                        } else {
                            chunks.push(chunk);
                        }
                    });
                    res.body.on('end', resolve);
                    res.body.on('error', reject);
                });
                if (received > maxBytes) {
                    return { tooLarge: true, contentType: ctype, sourceUrl: resolved };
                }
                return { buffer: Buffer.concat(chunks), contentType: ctype, sourceUrl: resolved };
            } 
            const buf = Buffer.from(await res.arrayBuffer());
            return { buffer: buf, contentType: ctype, sourceUrl: resolved };
            
        }
    }
    throw new Error('No image found at URL');
}

async function handleCaptionCommand(handler, interaction) {
    const { guild } = interaction;
    if (guild && !(await handler.isFeatureActive('memeTools', guild))) {
        await interaction.editReply('Meme systems are disabled for this server, sir.');
        return;
    }

    const text = interaction.options.getString('text', true).trim();
    const attachment = interaction.options.getAttachment('image', false);
    const urlOpt = (interaction.options.getString('url') || '').trim();

    if (!text.length) {
        await interaction.editReply('Please provide a caption, sir.');
        return;
    }

    if (text.length > 200) {
        await interaction.editReply('Caption must be 200 characters or fewer, sir.');
        return;
    }

    try {
        let buffer;
        let contentType = null;
        if (attachment) {
            contentType = (attachment.contentType || '').toLowerCase();
            if (!contentType.startsWith('image/')) {
                await interaction.editReply('That file does not appear to be an image, sir.');
                return;
            }
            if (Number(attachment.size || 0) > handler.maxInputBytes) {
                await interaction.editReply("MY poor CPU can't handle that, sir.");
                return;
            }
            buffer = await handler.fetchAttachmentBuffer(attachment);
        } else if (urlOpt) {
            const fetched = await handler.fetchImageFromUrl(urlOpt, { maxBytes: handler.maxInputBytes });
            if (fetched.tooLarge) {
                await interaction.editReply("MY poor CPU can't handle that, sir.");
                return;
            }
            const { buffer: buf, contentType: ct } = fetched;
            buffer = buf;
            contentType = (ct || '').toLowerCase();
        } else {
            await interaction.editReply('Provide an image attachment or a URL, sir.');
            return;
        }
        if (contentType && (contentType.includes('gif') || contentType.includes('video/'))) {
            try {
                const isRender = (config?.deployment?.target || 'render').toLowerCase() === 'render';
                if (isRender) {
                    const { captionToMp4 } = require('../../utils/video-caption');
                    const out = await captionToMp4({ inputBuffer: buffer, captionText: text });
                    await handler.sendBufferOrLink(interaction, out, 'caption.mp4');
                } else {
                    const { captionAnimated } = require('../../utils/gif-caption');
                    const out = await captionAnimated({ inputBuffer: buffer, captionText: text });
                    await handler.sendBufferOrLink(interaction, out, 'caption.gif');
                }
            } catch (err) {
                console.warn('Animated caption failed, falling back to PNG:', err?.message || err);
                const rendered = await memeCanvas.createCaptionImage(buffer, text);
                await handler.sendBufferOrLink(interaction, rendered, 'caption.png');
            }
        } else {
            const rendered = await memeCanvas.createCaptionImage(buffer, text);
            await handler.sendBufferOrLink(interaction, rendered, 'caption.png');
        }
    } catch (error) {
        console.error('Caption command failed:', error);
        await interaction.editReply('Caption generator misfired, sir. Try another image.');
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
            buffer = await handler.fetchAttachmentBuffer(attachment);
        } else if (urlOpt) {
            const fetched = await handler.fetchImageFromUrl(urlOpt, { maxBytes: handler.maxInputBytes });
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
    handleMemeCommand
};
