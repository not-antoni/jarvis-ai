const assert = require('node:assert/strict');
const test = require('node:test');

const { _internals } = require('../src/utils/ytDlp');

function withEnv(patch, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(patch)) {
        previous[key] = process.env[key];
        if (value === null || typeof value === 'undefined') {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === null || typeof value === 'undefined') {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test('YouTube format selector prefers audio before video fallbacks', () => {
    withEnv({ YTDLP_FORMAT: null, YTDLP_YOUTUBE_FORMAT: null }, () => {
        const resolved = _internals.resolveSource('youtube', 'https://www.youtube.com/watch?v=pSQ-71WNDE4');
        const selector = _internals.buildFormatSelector(resolved);

        assert.match(selector, /^bestaudio/);
        assert.match(selector, /worst\[acodec!=none\]/);
        assert.ok(selector.indexOf('bestaudio') < selector.indexOf('worst[acodec!=none]'));
        assert.ok(selector.indexOf('worst[acodec!=none]') < selector.indexOf('best[acodec!=none]'));
    });
});

test('YouTube format selector supports a source-specific override', () => {
    withEnv({ YTDLP_FORMAT: 'bestaudio/best', YTDLP_YOUTUBE_FORMAT: '140/251' }, () => {
        const resolved = _internals.resolveSource('youtube', 'https://youtu.be/pSQ-71WNDE4');

        assert.equal(_internals.buildFormatSelector(resolved), '140/251');
    });
});

test('non-YouTube format selector keeps the generic audio-first default', () => {
    withEnv({ YTDLP_FORMAT: null, YTDLP_YOUTUBE_FORMAT: '140/251' }, () => {
        const resolved = _internals.resolveSource(
            'soundcloud',
            'https://soundcloud.com/adam-muller-664242654/br-br-patapim'
        );

        assert.equal(_internals.buildFormatSelector(resolved), 'bestaudio/best');
    });
});
