const sharp = require('sharp');

const clamp = (value, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return min;
    }
    return Math.min(Math.max(num, min), max);
};

const ensurePng = (pipeline) => pipeline.png({ progressive: false }).toBuffer();

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
    return Object.entries(EFFECT_DEFINITIONS).map(([key, definition]) => ({
        key,
        label: definition.label,
        description: definition.description,
        supportsIntensity: Boolean(definition.supportsIntensity)
    }));
}

function getEffectDefinition(effectName) {
    return EFFECT_DEFINITIONS[effectName] || null;
}

module.exports = {
    applyEffect,
    listEffects,
    getEffectDefinition
};
