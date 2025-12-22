/**
 * Clanker GIF processor - overlays user avatar onto clanker.gif
 */

const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');

const CLANKER_GIF_PATH = path.join(__dirname, '../..', 'clanker.gif');

// Avatar overlay position (small square area)
const AVATAR_X = 411;
const AVATAR_Y = 368;
const AVATAR_SIZE = 48; // Small square

/**
 * Check if message contains "clanker" (case-insensitive, any variation)
 * @param {string} content - Message content to check
 * @returns {boolean}
 */
function containsClanker(content) {
    if (!content || typeof content !== 'string') return false;
    return /clanker/i.test(content);
}

/**
 * Fetch user avatar as a buffer
 * @param {string} avatarUrl - URL of the user's avatar
 * @returns {Promise<Buffer>}
 */
async function fetchAvatar(avatarUrl) {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch avatar: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Process clanker.gif with user's avatar overlay
 * @param {string} avatarUrl - URL of the user's avatar (from Discord)
 * @returns {Promise<Buffer>} - Processed GIF buffer
 */
async function processClankerGif(avatarUrl) {
    // Fetch and resize avatar to fit the overlay area
    const avatarBuffer = await fetchAvatar(avatarUrl);
    const resizedAvatar = await sharp(avatarBuffer)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
        .png()
        .toBuffer();

    // Load the clanker GIF
    const gifBuffer = await sharp(CLANKER_GIF_PATH, { animated: true })
        .toBuffer();

    // Get GIF metadata
    const metadata = await sharp(CLANKER_GIF_PATH, { animated: true }).metadata();
    const frameCount = metadata.pages || 1;
    const frameWidth = metadata.width;
    const frameHeight = metadata.pageHeight || metadata.height;
    const delay = metadata.delay || Array(frameCount).fill(100);

    if (frameCount === 1) {
        // Static image - simple composite
        const result = await sharp(CLANKER_GIF_PATH)
            .composite([{
                input: resizedAvatar,
                left: AVATAR_X,
                top: AVATAR_Y
            }])
            .gif()
            .toBuffer();
        return result;
    }

    // For animated GIFs, extract frames, composite, and reassemble
    const frames = [];
    
    for (let i = 0; i < frameCount; i++) {
        // Extract single frame
        const frame = await sharp(CLANKER_GIF_PATH, { animated: true, page: i })
            .toBuffer();
        
        // Composite avatar onto frame
        const composited = await sharp(frame)
            .composite([{
                input: resizedAvatar,
                left: AVATAR_X,
                top: AVATAR_Y
            }])
            .png()
            .toBuffer();
        
        frames.push(composited);
    }

    // Reassemble frames into animated GIF
    // Stack frames vertically for sharp's gif animation
    const stackedHeight = frameHeight * frameCount;
    
    // Create a tall image with all frames stacked
    const stackedFrames = await sharp({
        create: {
            width: frameWidth,
            height: stackedHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(frames.map((frame, i) => ({
            input: frame,
            left: 0,
            top: i * frameHeight
        })))
        .png()
        .toBuffer();

    // Convert stacked image to animated GIF
    const result = await sharp(stackedFrames, { animated: true })
        .gif({
            loop: 0,
            delay: Array.isArray(delay) ? delay : Array(frameCount).fill(delay)
        })
        .toBuffer();

    return result;
}

/**
 * Process clanker GIF with avatar overlay - frame by frame approach
 * @param {string} avatarUrl - URL of the user's avatar
 * @returns {Promise<Buffer>} - Processed GIF buffer
 */
async function processClankerGifFast(avatarUrl) {
    // Fetch and resize avatar
    const avatarBuffer = await fetchAvatar(avatarUrl);
    
    // Get GIF metadata first
    const metadata = await sharp(CLANKER_GIF_PATH, { animated: true }).metadata();
    const frameCount = metadata.pages || 1;
    const originalWidth = metadata.width || 800;
    const targetWidth = 400; // Smaller for Discord limit
    const scale = targetWidth / originalWidth;
    
    // Scale avatar size and position
    const scaledAvatarSize = Math.round(AVATAR_SIZE * scale);
    const scaledX = Math.round(AVATAR_X * scale);
    const scaledY = Math.round(AVATAR_Y * scale);
    
    const resizedAvatar = await sharp(avatarBuffer)
        .resize(scaledAvatarSize, scaledAvatarSize, { fit: 'cover' })
        .png()
        .toBuffer();

    // Process each frame individually
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        const frame = await sharp(CLANKER_GIF_PATH, { animated: true, page: i })
            .resize(targetWidth, null, { withoutEnlargement: true })
            .composite([{
                input: resizedAvatar,
                left: scaledX,
                top: scaledY
            }])
            .png()
            .toBuffer();
        frames.push(frame);
    }

    // Get frame height after resize
    const firstFrameMeta = await sharp(frames[0]).metadata();
    const frameHeight = firstFrameMeta.height;

    // Stack frames vertically
    const stackedHeight = frameHeight * frameCount;
    const compositeInputs = frames.map((frame, i) => ({
        input: frame,
        left: 0,
        top: i * frameHeight
    }));

    const stacked = await sharp({
        create: {
            width: targetWidth,
            height: stackedHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(compositeInputs)
        .png()
        .toBuffer();

    // Convert to animated GIF
    const delay = metadata.delay || Array(frameCount).fill(100);
    const result = await sharp(stacked, { 
        raw: {
            width: targetWidth,
            height: stackedHeight,
            channels: 4
        }
    })
        .gif({
            loop: 0,
            delay: Array.isArray(delay) ? delay : Array(frameCount).fill(100),
            force: true
        })
        .toBuffer();

    return result;
}

module.exports = {
    containsClanker,
    processClankerGif,
    processClankerGifFast,
    CLANKER_GIF_PATH,
    AVATAR_X,
    AVATAR_Y,
    AVATAR_SIZE
};
