const sharp = require('sharp');

const clamp = (value, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return min;
    }
    return Math.min(Math.max(num, min), max);
};

const ensurePng = (pipeline) => pipeline.png({ progressive: false }).toBuffer();

const createSvgBuffer = (svg) => Buffer.from(svg);

async function applyInvert(buffer) {
    return ensurePng(sharp(buffer).ensureAlpha().negate({ alpha: false }));
}

async function applyGrayscale(buffer) {
    return ensurePng(sharp(buffer).ensureAlpha().grayscale());
}

async function applySepia(buffer) {
    const sepiaMatrix = [
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131]
    ];
    return ensurePng(sharp(buffer).ensureAlpha().recomb(sepiaMatrix));
}

async function applyPixelate(buffer, options = {}) {
    const blockSize = clamp(options.intensity ?? 18, 4, 80);
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 512;
    const height = metadata.height || 512;
    const downscaleWidth = Math.max(1, Math.round(width / blockSize));
    const downscaleHeight = Math.max(1, Math.round(height / blockSize));

    return ensurePng(
        sharp(buffer)
            .ensureAlpha()
            .resize(downscaleWidth, downscaleHeight, { fit: 'fill' })
            .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    );
}

async function applyBlur(buffer, options = {}) {
    const radius = clamp(options.intensity ?? 4, 0.3, 25);
    return ensurePng(sharp(buffer).ensureAlpha().blur(radius));
}

async function applyDeepfry(buffer, options = {}) {
    const passes = clamp(options.intensity ?? 2, 1, 5);
    let working = buffer;

    for (let index = 0; index < passes; index += 1) {
        const quality = Math.max(5, 60 - index * 10);
        working = await sharp(working)
            .modulate({
                saturation: 1.5 + index * 0.1,
                brightness: 1.05
            })
            .linear(1.1 + index * 0.1, -15)
            .jpeg({ quality })
            .toBuffer();
    }

    return ensurePng(
        sharp(working)
            .sharpen(passes * 2, 1.5, 0.8)
            .modulate({ saturation: 1.6, brightness: 1.05 })
    );
}

async function applyHue(buffer, options = {}) {
    const degrees = clamp(options.intensity ?? 90, -180, 180);
    return ensurePng(sharp(buffer).ensureAlpha().modulate({ hue: degrees }));
}

async function applySaturate(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 5, 1, 20) / 5;
    return ensurePng(sharp(buffer).ensureAlpha().modulate({ saturation: factor }));
}

async function applyDesaturate(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 5, 1, 20);
    const saturation = Math.max(0.05, 1 - factor / 10);
    return ensurePng(sharp(buffer).ensureAlpha().modulate({ saturation }));
}

async function applyBrightness(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 5, 1, 20);
    const brightness = clamp(1 + (factor - 5) / 10, 0.2, 3);
    return ensurePng(sharp(buffer).ensureAlpha().modulate({ brightness }));
}

async function applyContrast(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 5, 1, 20);
    const slope = clamp(1 + (factor - 5) / 5, 0.2, 5);
    const intercept = -(128 * (slope - 1));
    return ensurePng(sharp(buffer).ensureAlpha().linear(slope, intercept));
}

async function applySharpen(buffer, options = {}) {
    const sigma = clamp(options.intensity ?? 3, 0.1, 10);
    return ensurePng(sharp(buffer).ensureAlpha().sharpen(sigma, 1.5, 0.8));
}

async function applyEmboss(buffer, options = {}) {
    const strength = clamp(options.intensity ?? 3, 1, 10);
    const kernel = [
        [-2, -1, 0],
        [-1, 1, 1],
        [0, 1, 2]
    ].map((row) => row.map((value) => value * strength * 0.2));

    return ensurePng(
        sharp(buffer)
            .ensureAlpha()
            .convolve({
                width: 3,
                height: 3,
                kernel: kernel.flat()
            })
            .linear(1, 15)
    );
}

async function applyCircle(buffer) {
    const metadata = await sharp(buffer).metadata();
    const size = Math.min(metadata.width || 512, metadata.height || 512);

    const svg = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`;

    return sharp(buffer)
        .ensureAlpha()
        .resize(size, size, { fit: 'cover' })
        .composite([{ input: createSvgBuffer(svg), blend: 'dest-in' }])
        .png({ progressive: false })
        .toBuffer();
}

async function applyResizeRatio(buffer, axis, factor) {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 512;
    const height = metadata.height || 512;

    if (axis === 'width') {
        const newWidth = Math.max(1, Math.round(width * factor));
        return ensurePng(sharp(buffer).ensureAlpha().resize(newWidth, height, { fit: 'fill' }));
    }

    const newHeight = Math.max(1, Math.round(height * factor));
    return ensurePng(sharp(buffer).ensureAlpha().resize(width, newHeight, { fit: 'fill' }));
}

async function applyWiden(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 12, 5, 30) / 10;
    return applyResizeRatio(buffer, 'width', factor);
}

async function applyStretch(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 12, 5, 30) / 10;
    return applyResizeRatio(buffer, 'height', factor);
}

async function applySquish(buffer, options = {}) {
    const factor = clamp(options.intensity ?? 5, 2, 10) / 10;
    return applyResizeRatio(buffer, 'width', factor);
}

async function applyFlip(buffer) {
    return ensurePng(sharp(buffer).ensureAlpha().flip());
}

async function applyMirror(buffer) {
    return ensurePng(sharp(buffer).ensureAlpha().flop());
}

async function applyRotate(buffer, options = {}) {
    const degrees = clamp(options.intensity ?? 25, -180, 180);
    return ensurePng(sharp(buffer).ensureAlpha().rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } }));
}

async function applyJpegCrunch(buffer, options = {}) {
    const quality = clamp(options.intensity ?? 20, 5, 80);
    const crunchy = await sharp(buffer).jpeg({ quality }).toBuffer();
    return ensurePng(sharp(crunchy).ensureAlpha());
}

const EFFECT_DEFINITIONS = {
    invert: {
        label: 'Invert Colors',
        description: 'Flip the palette into its negative.',
        supportsIntensity: false,
        handler: applyInvert
    },
    grayscale: {
        label: 'Noir Grayscale',
        description: 'Drain the color for a cinematic noir look.',
        supportsIntensity: false,
        handler: applyGrayscale
    },
    sepia: {
        label: 'Sepia Film',
        description: 'Apply warm film tones inspired by vintage reels.',
        supportsIntensity: false,
        handler: applySepia
    },
    pixelate: {
        label: 'Pixelate',
        description: 'Crunch the image into chunky pixels.',
        supportsIntensity: true,
        handler: applyPixelate
    },
    blur: {
        label: 'Soft Blur',
        description: 'Diffuse the frame into a dreamy blur.',
        supportsIntensity: true,
        handler: applyBlur
    },
    deepfry: {
        label: 'Deep Fry',
        description: 'Over-saturate, oversharpen, and compress for meme chaos.',
        supportsIntensity: true,
        handler: applyDeepfry
    },
    hue: {
        label: 'Hue Shift',
        description: 'Rotate the color wheel for neon vibes.',
        supportsIntensity: true,
        handler: applyHue
    },
    saturate: {
        label: 'Saturation Boost',
        description: 'Dial color intensity way past factory settings.',
        supportsIntensity: true,
        handler: applySaturate
    },
    desaturate: {
        label: 'Bleach',
        description: 'Wash the palette down to pale tones.',
        supportsIntensity: true,
        handler: applyDesaturate
    },
    brighten: {
        label: 'Solar Glow',
        description: 'Lighten the frame for polished highlights.',
        supportsIntensity: true,
        handler: applyBrightness
    },
    contrast: {
        label: 'Contrast Punch',
        description: 'Tighten shadows and highlights.',
        supportsIntensity: true,
        handler: applyContrast
    },
    sharpen: {
        label: 'Edge Sharpen',
        description: 'Accentuate lines and details.',
        supportsIntensity: true,
        handler: applySharpen
    },
    emboss: {
        label: 'Metal Emboss',
        description: 'Carve relief-style grooves into the image.',
        supportsIntensity: true,
        handler: applyEmboss
    },
    circle: {
        label: 'Circle Crop',
        description: 'Trim the image into a perfect profile circle.',
        supportsIntensity: false,
        handler: applyCircle
    },
    widen: {
        label: 'Ultra Wide',
        description: 'Stretch width for cinematic desks.',
        supportsIntensity: true,
        handler: applyWiden
    },
    stretch: {
        label: 'Tall Stretch',
        description: 'Pull the canvas vertically.',
        supportsIntensity: true,
        handler: applyStretch
    },
    squish: {
        label: 'Squish',
        description: 'Compress width for comedic effect.',
        supportsIntensity: true,
        handler: applySquish
    },
    flip: {
        label: 'Flip Vertical',
        description: 'Mirror along the horizontal axis.',
        supportsIntensity: false,
        handler: applyFlip
    },
    mirror: {
        label: 'Mirror Horizontal',
        description: 'Reflect across the vertical axis.',
        supportsIntensity: false,
        handler: applyMirror
    },
    rotate: {
        label: 'Tilt Rotate',
        description: 'Rotate the scene left or right.',
        supportsIntensity: true,
        handler: applyRotate
    },
    jpeg: {
        label: 'JPEG Crunch',
        description: 'Re-encode at low quality for vintage memes.',
        supportsIntensity: true,
        handler: applyJpegCrunch
    }
};

async function applyEffect(effectName, buffer, options = {}) {
    const definition = EFFECT_DEFINITIONS[effectName];
    if (!definition) {
        throw new Error(`Unknown filter effect: ${effectName}`);
    }
    return definition.handler(buffer, options);
}

function listEffects() {
    return Object.entries(EFFECT_DEFINITIONS)
        .map(([key, definition]) => ({
            key,
            label: definition.label,
            description: definition.description,
            supportsIntensity: Boolean(definition.supportsIntensity)
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function getEffectDefinition(effectName) {
    return EFFECT_DEFINITIONS[effectName] || null;
}

module.exports = {
    applyEffect,
    listEffects,
    getEffectDefinition
};
