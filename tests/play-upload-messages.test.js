'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const playCommand = require('../src/commands/music/play');
const { musicManager } = require('../src/core/musicManager');
const uploadQueue = require('../src/services/upload-queue');
const djSystem = require('../src/utils/dj-system');

test('single upload replies once with processing text and voice hint', async() => {
    const originalGet = musicManager.get;
    const originalAdd = uploadQueue.add;
    const originalCanControlMusic = djSystem.canControlMusic;

    let replyMessage = null;
    let followUpCalled = false;
    const queued = [];

    musicManager.get = () => ({ ready: true });
    uploadQueue.add = (...args) => {
        queued.push(args);
        return 1;
    };
    djSystem.canControlMusic = async() => true;

    try {
        await playCommand.execute({
            guild: {},
            guildId: 'guild-1',
            channel: { id: 'text-1' },
            member: {
                voice: {
                    channel: {
                        id: 'voice-1',
                        joinable: true,
                        speakable: true
                    }
                }
            },
            options: {
                getString() {
                    return null;
                },
                getAttachment(name) {
                    return name === 'file1'
                        ? { name: 'clip.ogg', size: 1024, url: 'https://cdn.example/clip.ogg' }
                        : null;
                }
            },
            async reply(message) {
                replyMessage = message;
            },
            async followUp() {
                followUpCalled = true;
            }
        });

        assert.equal(
            replyMessage,
            '📂 Processing upload: **clip.ogg**\nUse `/voice` too if you want to talk over music.'
        );
        assert.equal(followUpCalled, false);
        assert.equal(queued.length, 1);
    } finally {
        musicManager.get = originalGet;
        uploadQueue.add = originalAdd;
        djSystem.canControlMusic = originalCanControlMusic;
    }
});

test('multiple uploads keep the voice hint in the initial processing message', () => {
    const message = playCommand._test.buildUploadProcessingMessage([
        { name: 'one.ogg' },
        { name: 'two.ogg' }
    ]);

    assert.equal(
        message,
        '📂 Processing **2** uploads...\nUse `/voice` too if you want to talk over music.'
    );
});
