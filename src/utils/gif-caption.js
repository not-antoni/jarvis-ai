const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { createCanvas } = require('canvas');
const { ensureFfmpeg } = require('./ffmpeg');

function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function measureCaptionBox(width, text) {
    const padding = Math.max(16, Math.round(width * 0.04));
    const maxWidth = Math.max(10, width - padding * 2);
    const fontSize = Math.max(32, Math.round(width / 14));
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;

    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (ctx.measureText(candidate).width <= maxWidth || !line) {
            line = candidate;
        } else {
            lines.push(line);
            line = w;
        }
    }
    if (line) lines.push(line);

    const lineHeight = Math.round(fontSize * 1.15);
    const boxHeight = Math.round(lines.length * lineHeight + padding * 2);
    return { fontSize, padding, maxWidth, lines, lineHeight, boxHeight };
}

function renderCaptionOverlay(width, text) {
    const norm = normalize(text);
    if (!norm) throw new Error('Caption text is required');
    const { fontSize, padding, maxWidth, lines, lineHeight, boxHeight } = measureCaptionBox(width, norm);
    const canvas = createCanvas(width, boxHeight);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, boxHeight);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    ctx.fillStyle = '#000';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const w = ctx.measureText(line).width;
        const x = Math.round((width - w) / 2);
        const y = Math.round(padding + i * lineHeight);
        ctx.fillText(line, x, y);
    }
    return canvas.toBuffer('image/png');
}

async function run(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        const ps = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
        let stderr = '';
        ps.stderr.on('data', (d) => (stderr += d.toString()));
        ps.on('error', reject);
        ps.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        });
    });
}

async function captionAnimated({ inputBuffer, captionText }) {
    if (!Buffer.isBuffer(inputBuffer)) throw new Error('inputBuffer required');
    const { ffmpegPath } = await ensureFfmpeg();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-gif-'));
    const inPath = path.join(tmpDir, 'in.bin');
    fs.writeFileSync(inPath, inputBuffer);

    // Probe width using sharp (first frame)
    let width = 512;
    try {
        const meta = await sharp(inputBuffer, { pages: 1 }).metadata();
        if (meta?.width) width = meta.width;
    } catch {}

    const overlayPng = renderCaptionOverlay(width, captionText);
    const overlayPath = path.join(tmpDir, 'overlay.png');
    fs.writeFileSync(overlayPath, overlayPng);

    const outPath = path.join(tmpDir, 'out.gif');

    const args = [
        '-y',
        '-loop', '1', '-i', overlayPath,
        '-i', inPath,
        '-filter_complex',
        '[1:v]setpts=PTS-STARTPTS,setsar=1[gif];' +
        '[0:v]setpts=PTS-STARTPTS,format=rgba,setsar=1[ov];' +
        '[ov][gif]vstack=inputs=2:shortest=1,split[v0][v1];' +
        '[v0]palettegen=stats_mode=single[pal];' +
        '[v1][pal]paletteuse=dither=sierra2_4a',
        '-gifflags', '-offsetting',
        outPath
    ];

    await run(ffmpegPath, args);
    const out = fs.readFileSync(outPath);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return out;
}

module.exports = { captionAnimated };
