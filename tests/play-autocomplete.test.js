'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const playCommand = require('../src/commands/music/play');

test('soundcloud autocomplete stores long URLs as short tokens and resolves them back', () => {
    const longUrl = 'https://soundcloud.com/some-really-long-artist-name/this-is-a-ridiculously-long-track-name-that-would-blow-past-discords-autocomplete-value-limit';
    const choice = playCommand._test.buildSoundCloudChoice({
        title: 'Very Long SoundCloud Track Title',
        uploader: 'Very Long Artist Name',
        duration: '3:33',
        url: longUrl
    });

    assert.ok(choice);
    assert.ok(choice.value.startsWith('ac:soundcloud:'));
    assert.ok(choice.value.length <= 100);
    assert.equal(playCommand._test.resolveAutocompleteSelection(choice.value), longUrl);
});

test('youtube autocomplete keeps short URLs directly', () => {
    const shortUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const choice = playCommand._test.buildYouTubeChoice({
        title: 'Never Gonna Give You Up',
        channel: 'Rick Astley',
        url: shortUrl
    });

    assert.ok(choice);
    assert.equal(choice.value, shortUrl);
    assert.equal(playCommand._test.resolveAutocompleteSelection(choice.value), shortUrl);
});

test('expired autocomplete tokens no longer resolve to stale URLs', () => {
    const longUrl = 'https://soundcloud.com/artist/another-extremely-long-track-url-that-needs-a-token-because-the-value-will-not-fit-cleanly-inside-discord';
    const token = playCommand._test.rememberAutocompleteSelection(longUrl, 'soundcloud');

    const entry = playCommand._test.autocompleteSelectionCache.get(token);
    assert.ok(entry);
    entry.expiresAt = Date.now() - 1;
    playCommand._test.pruneAutocompleteSelections();

    assert.equal(playCommand._test.resolveAutocompleteSelection(token), token);
});
