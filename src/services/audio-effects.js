/**
 * Audio Effects for Music Playback
 * 
 * FFmpeg audio filter presets for the native music stack.
 * Add effects like bass boost, nightcore, slowed, etc.
 */

/**
 * Available audio effect presets
 */
const EFFECTS = {
    // Bass enhancement
    bassboost: {
        name: 'Bass Boost',
        emoji: '🔊',
        description: 'Enhance low frequencies',
        filter: 'bass=g=10,dynaudnorm=f=200'
    },

    bassboost_heavy: {
        name: 'Heavy Bass',
        emoji: '💥',
        description: 'Maximum bass boost',
        filter: 'bass=g=20,dynaudnorm=f=150'
    },

    // Speed/pitch effects
    nightcore: {
        name: 'Nightcore',
        emoji: '🌙',
        description: 'Speed up + pitch up',
        filter: 'asetrate=48000*1.25,aresample=48000,atempo=1.06'
    },

    slowed: {
        name: 'Slowed',
        emoji: '🐌',
        description: 'Slow + lower pitch',
        filter: 'asetrate=48000*0.8,aresample=48000'
    },

    vaporwave: {
        name: 'Vaporwave',
        emoji: '🌴',
        description: 'Slow + reverb aesthetic',
        filter: 'asetrate=48000*0.85,aresample=48000,aecho=0.8:0.9:40:0.3'
    },

    // Vocal effects
    karaoke: {
        name: 'Karaoke',
        emoji: '🎤',
        description: 'Remove vocals (center)',
        filter: 'stereotools=mlev=0.015625'
    },

    vocals: {
        name: 'Vocals Only',
        emoji: '🗣️',
        description: 'Isolate center channel',
        filter: 'pan=stereo|c0=c0-c1|c1=c1-c0'
    },

    // Spatial effects
    '3d': {
        name: '3D Audio',
        emoji: '🎧',
        description: 'Widened stereo',
        filter: 'apulsator=hz=0.125'
    },

    surround: {
        name: 'Surround',
        emoji: '🔈',
        description: 'Simulated surround',
        filter: 'surround'
    },

    earrape: {
        name: 'Earrape',
        emoji: '💀',
        description: 'Distorted loud (warning!)',
        filter: 'acrusher=level_in=4:level_out=8:bits=16:mode=log:aa=1'
    },

    // EQ presets
    treble: {
        name: 'Treble Boost',
        emoji: '🔔',
        description: 'Enhance high frequencies',
        filter: 'treble=g=5'
    },

    soft: {
        name: 'Soft',
        emoji: '☁️',
        description: 'Gentle, muted sound',
        filter: 'lowpass=f=3000,volume=0.8'
    },

    loud: {
        name: 'Loud',
        emoji: '📢',
        description: 'Normalized loud',
        filter: 'dynaudnorm=f=150:g=15'
    },

    // Reset
    none: {
        name: 'No Effect',
        emoji: '❌',
        description: 'Remove all effects',
        filter: null
    }
};

/**
 * Get an effect preset by name
 * @param {string} name - Effect name (case-insensitive)
 * @returns {Object|null}
 */
function getEffect(name) {
    const key = name.toLowerCase().replace(/[\s-]/g, '');
    return EFFECTS[key] || null;
}

/**
 * Get all available effects
 * @returns {Array<{ key: string, ...effect }>}
 */
function getAllEffects() {
    return Object.entries(EFFECTS).map(([key, effect]) => ({
        key,
        ...effect
    }));
}

/**
 * Build FFmpeg filter string for multiple effects
 * @param {string[]} effectNames - Array of effect names
 * @returns {string|null}
 */
function buildFilterChain(effectNames) {
    const filters = effectNames
        .map(name => getEffect(name)?.filter)
        .filter(Boolean);

    if (filters.length === 0) {return null;}
    return filters.join(',');
}

/**
 * Get effect for Discord embed display
 * @param {string} effectName 
 * @returns {string}
 */
function formatEffectDisplay(effectName) {
    const effect = getEffect(effectName);
    if (!effect) {return '❓ Unknown Effect';}
    return `${effect.emoji} ${effect.name}`;
}

/**
 * Apply effect metadata to queue filters
 * Note: This modifies the queue's ffmpeg args
 * @param {Object} queue - Active queue state
 * @param {string} effectName - Effect name
 * @returns {{ success: boolean, effect?: Object, error?: string }}
 */
function applyEffectToQueue(queue, effectName) {
    const effect = getEffect(effectName);

    if (!effect) {
        return {
            success: false,
            error: `Unknown effect: ${effectName}. Use \`/effects list\` to see available effects.`
        };
    }

    if (!queue) {
        return { success: false, error: 'No active queue.' };
    }

    // Store current effect on queue for reference
    queue.currentEffect = effectName === 'none' ? null : effectName;

    return { success: true, effect };
}

/**
 * Get FFmpeg output args with effect applied
 * @param {string|null} effectFilter - FFmpeg filter string
 * @param {Object} baseArgs - Base output args
 * @returns {Object}
 */
function getOutputArgsWithEffect(effectFilter, baseArgs = {}) {
    const args = { ...baseArgs };

    if (effectFilter) {
        // Combine with existing af filter if present
        if (args.af) {
            args.af = `${args.af},${effectFilter}`;
        } else {
            args.af = effectFilter;
        }
    }

    return args;
}

module.exports = {
    EFFECTS,
    getEffect,
    getAllEffects,
    buildFilterChain,
    formatEffectDisplay,
    applyEffectToQueue,
    getOutputArgsWithEffect
};
