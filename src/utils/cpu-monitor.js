'use strict';

const fs = require('node:fs');

const CPU_FREQ_PATH = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
const MIN_FREQ_MHZ = 800; // below this, ffmpeg + STT pipeline is unusably slow

function getCpuFreqMHz() {
    try {
        const khz = parseInt(fs.readFileSync(CPU_FREQ_PATH, 'utf8').trim(), 10);
        return Math.round(khz / 1000);
    } catch {
        return null; // sysfs not available (container, VM, etc.)
    }
}

function isCpuThrottled() {
    const mhz = getCpuFreqMHz();
    return mhz !== null && mhz < MIN_FREQ_MHZ;
}

module.exports = { getCpuFreqMHz, isCpuThrottled, MIN_FREQ_MHZ };
