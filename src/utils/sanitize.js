function sanitizePings(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/@everyone/gi, '@\u200beveryone')
        .replace(/@here/gi, '@\u200bhere');
}

module.exports = { sanitizePings };
