'use strict';

/**
 * Voice timer guard
 *
 * @discordjs/voice occasionally schedules `setTimeout` with negative delays
 * during audio frame preparation (clock drift from the Opus resampler). Node
 * 22 clamps those to 0 but emits a warning; our own code paths should never
 * produce negative delays. This guard:
 *
 *   1. Clamps any negative delay to 0 (matches Node's default behaviour).
 *   2. Silently accepts the known-benign drift inside prepareNextAudioFrame.
 *   3. Logs a stack trace ONCE per unique caller for anything else, so real
 *      bugs are surfaced without spamming the console.
 *
 * Install by calling `installVoiceTimerGuard()` exactly once during startup.
 */

const _negativeTimeoutTraces = new Set();
const _nativeSetTimeout = global.setTimeout;
let _installed = false;

function isKnownVoiceTimerDrift(stack) {
    return (
        typeof stack === 'string' &&
        stack.includes('@discordjs/voice/dist/index.js') &&
        stack.includes('prepareNextAudioFrame')
    );
}

function installVoiceTimerGuard({ logger = console } = {}) {
    if (_installed) {
        return;
    }
    _installed = true;

    global.setTimeout = function tracedSetTimeout(callback, delay, ...args) {
        const numericDelay = Number(delay);
        if (Number.isFinite(numericDelay) && numericDelay < 0) {
            const trace =
                new Error(`[TimerTrace] Negative setTimeout delay detected: ${numericDelay}ms`)
                    .stack || '';
            if (!isKnownVoiceTimerDrift(trace)) {
                const signature = trace.split('\n').slice(1, 4).join('\n');
                if (!_negativeTimeoutTraces.has(signature)) {
                    _negativeTimeoutTraces.add(signature);
                    (logger.warn || logger.log || console.warn).call(logger, trace);
                }
            }
            return _nativeSetTimeout.call(this, callback, 0, ...args);
        }
        return _nativeSetTimeout.call(this, callback, delay, ...args);
    };
}

module.exports = {
    installVoiceTimerGuard,
    // Exported for unit tests only
    _internals: { isKnownVoiceTimerDrift }
};
