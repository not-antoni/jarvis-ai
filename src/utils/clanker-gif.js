/**
 * Clanker GIF processor - overlays user avatar onto clanker.gif
 */

const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');

// Use optimized GIF (320x320, 75 frames instead of 640x640, 223 frames)
const CLANKER_GIF_PATH = path.join(__dirname, '../..', 'clanker-optimized.gif');

// Avatar overlay position - scaled for 320x320 (original was 640x640)
// Original coords: x:411, y:368 → scaled by 0.5
const AVATAR_X = 196;
const AVATAR_Y = 174;
const AVATAR_SIZE = 80; // Bigger avatar

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
 * Process animated GIF with avatar overlay using ffmpeg (most reliable)
 * @param {string} avatarUrl - URL of the user's avatar
 * @returns {Promise<Buffer>} - Processed animated GIF buffer
 */
async function processClankerGifFast(avatarUrl) {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const ffmpegPath = require('ffmpeg-static'); // Use static binary path for reliability

    // Create temp files
    const tempDir = os.tmpdir();
    const avatarPath = path.join(tempDir, `avatar-${Date.now()}.png`);
    const outputPath = path.join(tempDir, `clanker-${Date.now()}.gif`);

    try {
        // Fetch and save avatar
        const avatarBuffer = await fetchAvatar(avatarUrl);
        const resizedAvatar = await sharp(avatarBuffer)
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
            .png()
            .toBuffer();
        fs.writeFileSync(avatarPath, resizedAvatar);

        // Use ffmpeg to overlay avatar on animated GIF with smooth output
        // fps=15 for smoother playback, split/palettegen for better quality
        const cmd = `"${ffmpegPath}" -y -i "${CLANKER_GIF_PATH}" -i "${avatarPath}" -filter_complex "[0:v]fps=15[gif];[gif][1:v]overlay=${AVATAR_X}:${AVATAR_Y}:format=auto,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "${outputPath}"`;

        execSync(cmd, { stdio: 'pipe', timeout: 30000 });

        // Read result
        const result = fs.readFileSync(outputPath);

        // Cleanup
        fs.unlinkSync(avatarPath);
        fs.unlinkSync(outputPath);

        return result;
    } catch (error) {
        // Cleanup on error
        try { fs.unlinkSync(avatarPath); } catch (_) { }
        try { fs.unlinkSync(outputPath); } catch (_) { }
        throw error;
    }
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
