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

function measure(width, text) {
    const padding = Math.max(16, Math.round(width * 0.04));
    const fontSize = Math.max(24, Math.round(width / 18));
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    const words = text.split(/\s+/).filter(Boolean);
    const maxWidth = Math.max(10, width - padding * 2);
    let lines = [];
    let line = '';
    for (const w of words) {
        const c = line ? `${line} ${w}` : w;
        if (ctx.measureText(c).width <= maxWidth || !line) line = c;
        else {
            lines.push(line);
            line = w;
        }
    }
    if (line) lines.push(line);
    const lineHeight = Math.round(fontSize * 1.15);
    const boxHeight = Math.round(lines.length * lineHeight + padding * 2);
    return { fontSize, padding, lines, lineHeight, boxHeight };
}

function renderOverlay(width, text) {
    const t = normalize(text);
    if (!t) throw new Error('Caption text is required');
    const { fontSize, padding, lines, lineHeight, boxHeight } = measure(width, t);
    const canvas = createCanvas(width, boxHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, boxHeight);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    ctx.fillStyle = '#000000';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const w = ctx.measureText(line).width;
        const x = Math.round((width - w) / 2);
        const y = Math.round(padding + i * lineHeight);
        ctx.fillText(line, x, y);
    }
    return canvas.toBuffer('png');
}

async function run(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        const ps = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
        let stderr = '';
        ps.stderr.on('data', d => (stderr += d.toString()));
        ps.on('error', reject);
        ps.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(stderr || `ffmpeg exited ${code}`));
        });
    });
}

async function captionToMp4({ inputBuffer, captionText }) {
    const { ffmpegPath } = await ensureFfmpeg();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vid-'));
    const inPath = path.join(tmp, 'in.bin');
    fs.writeFileSync(inPath, inputBuffer);

    let width = 480;
    try {
        const meta = await sharp(inputBuffer, { pages: 1 }).metadata();
        if (meta?.width) width = meta.width;
    } catch {}
    if (width > 720) width = 720;
    const overlayBuf = renderOverlay(width, captionText);
    const ovPath = path.join(tmp, 'overlay.png');
    fs.writeFileSync(ovPath, overlayBuf);

    const outPath = path.join(tmp, 'out.mp4');
    const args = [
        '-y',
        '-i',
        inPath,
        '-loop',
        '1',
        '-i',
        ovPath,
        '-filter_complex',
        // Scale/cap FPS for input, then stack overlay vertically
        '[0:v]fps=20,scale=if(gte(iw,720),720,iw):-2:flags=fast_bilinear,setsar=1,setpts=PTS-STARTPTS[vid];' +
            '[1:v]format=rgba,setsar=1,setpts=PTS-STARTPTS[ov];' +
            '[ov][vid]vstack=inputs=2:shortest=1[v]',
        '-map',
        '[v]',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath
    ];

    await run(ffmpegPath, args);
    const out = fs.readFileSync(outPath);
    try {
        fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
    return out;
}

module.exports = { captionToMp4 };
