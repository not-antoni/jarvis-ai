'use strict';

function normalizeUptimeSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return 0;
    }
    return Math.floor(seconds);
}

function formatUptime(secondsLike) {
    const totalSeconds = normalizeUptimeSeconds(secondsLike);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }
    return `${hours}h ${minutes}m ${seconds}s`;
}

function getProcessUptimeSeconds() {
    return normalizeUptimeSeconds(process.uptime());
}

module.exports = {
    formatUptime,
    getProcessUptimeSeconds
};
