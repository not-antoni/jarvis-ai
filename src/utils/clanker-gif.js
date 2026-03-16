/**
 * Clanker GIF processor - overlays user avatar onto clanker.gif using ffmpeg
 */

const sharp = require('sharp');
const path = require('path');
const fetch = require('node-fetch');

const CLANKER_GIF_PATH = path.join(__dirname, '../..', 'clanker-optimized.gif');
const AVATAR_X = 196;
const AVATAR_Y = 174;
const AVATAR_SIZE = 80;

async function fetchAvatar(avatarUrl) {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch avatar: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function processClankerGifFast(avatarUrl) {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const ffmpegPath = require('ffmpeg-static');

    const tempDir = os.tmpdir();
    const avatarPath = path.join(tempDir, `avatar-${Date.now()}.png`);
    const outputPath = path.join(tempDir, `clanker-${Date.now()}.gif`);

    try {
        const avatarBuffer = await fetchAvatar(avatarUrl);
        const resizedAvatar = await sharp(avatarBuffer)
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
            .png()
            .toBuffer();
        fs.writeFileSync(avatarPath, resizedAvatar);

        const cmd = `"${ffmpegPath}" -y -i "${CLANKER_GIF_PATH}" -i "${avatarPath}" -filter_complex "[0:v]fps=15[gif];[gif][1:v]overlay=${AVATAR_X}:${AVATAR_Y}:format=auto,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "${outputPath}"`;

        execSync(cmd, { stdio: 'pipe', timeout: 30000 });

        const result = fs.readFileSync(outputPath);

        fs.unlinkSync(avatarPath);
        fs.unlinkSync(outputPath);

        return result;
    } catch (error) {
        try { fs.unlinkSync(avatarPath); } catch (_) { }
        try { fs.unlinkSync(outputPath); } catch (_) { }
        throw error;
    }
}

module.exports = {
    processClankerGifFast
};
