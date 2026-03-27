'use strict';

function parseBooleanEnv(value, fallback = false) {
    if (value == null) return Boolean(fallback);
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return Boolean(fallback);
}

module.exports = { parseBooleanEnv };
