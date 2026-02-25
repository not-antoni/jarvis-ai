'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MusicManager } = require('../../src/core/musicManager');

test('buildNowPlayingAnnouncement returns string payload for normal tracks', () => {
    const manager = new MusicManager(null);
    const payload = manager.buildNowPlayingAnnouncement({
        title: 'Regular Track',
        url: 'https://example.com/audio.mp3'
    });

    assert.strictEqual(typeof payload, 'string');
    assert(payload.includes('Regular Track'));
    assert(payload.includes('https://example.com/audio.mp3'));
});

test('buildNowPlayingAnnouncement returns attachment payload for uploads', () => {
    const manager = new MusicManager(null);
    const payload = manager.buildNowPlayingAnnouncement({
        title: 'Upload Track',
        url: 'https://cdn.discordapp.com/attachments/example.mp3',
        isUpload: true,
        uploadPreviewUrl: 'https://cdn.discordapp.com/attachments/example.mp3',
        filename: 'Upload Track.mp3'
    });

    assert.strictEqual(typeof payload, 'object');
    assert.strictEqual(payload.content, '🎶 Now playing: **Upload Track**');
    assert(Array.isArray(payload.files));
    assert.strictEqual(payload.files.length, 1);
});
