'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const { MusicManager } = require('../src/core/musicManager');
const loopCommand = require('../src/commands/music/loop');
const stopCommand = require('../src/commands/music/stop');
const { musicManager } = require('../src/core/musicManager');
const djSystem = require('../src/utils/dj-system');

test('stop resets loop mode even when staying connected', () => {
    const manager = new MusicManager(null);
    let stopCalls = 0;

    manager.queues.set('guild-1', {
        queue: [{ title: 'Next track' }],
        currentVideo: { title: 'Current track', url: 'https://example.com/current' },
        currentRelease: null,
        pendingVideoId: null,
        skipInProgress: false,
        timeout: null,
        textChannel: null,
        voiceChannelId: 'voice-1',
        loopMode: 'song',
        player: {
            stop(force) {
                stopCalls += force ? 1 : 0;
            }
        },
        connection: {
            destroy() {}
        }
    });

    const message = manager.stop('guild-1', { disconnect: false });
    const state = manager.getState('guild-1');

    assert.equal(message, '⏹️ Stopped music and cleared queue. Staying connected.');
    assert.equal(stopCalls, 1);
    assert.equal(state.loopMode, 'off');
    assert.deepEqual(state.queue, []);
    assert.equal(state.currentVideo, null);
    assert.equal(state.pendingVideoId, null);
});

test('loop command replies publicly', async() => {
    const originalGet = musicManager.get;
    const originalCanControlMusic = djSystem.canControlMusic;
    let replyPayload = null;

    musicManager.get = () => ({
        setLoopMode(guildId, mode) {
            assert.equal(guildId, 'guild-1');
            assert.equal(mode, 'song');
            return 'song';
        },
        cycleLoopMode() {
            throw new Error('cycleLoopMode should not be used when a mode is provided');
        }
    });
    djSystem.canControlMusic = async() => true;

    try {
        await loopCommand.execute({
            guild: {},
            guildId: 'guild-1',
            options: {
                getString(name) {
                    assert.equal(name, 'mode');
                    return 'song';
                }
            },
            async reply(payload) {
                replyPayload = payload;
            }
        });

        assert.deepEqual(replyPayload, { content: '🔄 Loop mode: **🔂 Song**' });
        assert.equal('flags' in replyPayload, false);
    } finally {
        musicManager.get = originalGet;
        djSystem.canControlMusic = originalCanControlMusic;
    }
});

test('stop command replies publicly', async() => {
    const originalGet = musicManager.get;
    const originalCanControlMusic = djSystem.canControlMusic;
    let replyPayload = null;

    musicManager.get = () => ({
        getState(guildId) {
            assert.equal(guildId, 'guild-2');
            return {
                currentVideo: { title: 'Track' },
                pendingVideoId: null,
                queue: []
            };
        },
        stop(guildId, options) {
            assert.equal(guildId, 'guild-2');
            assert.deepEqual(options, { disconnect: false });
            return '⏹️ Stopped music and cleared queue. Staying connected.';
        }
    });
    djSystem.canControlMusic = async() => true;

    try {
        await stopCommand.execute({
            guild: {},
            guildId: 'guild-2',
            async reply(payload) {
                replyPayload = payload;
            }
        });

        assert.deepEqual(replyPayload, { content: '⏹️ Stopped music and cleared queue. Staying connected.' });
        assert.equal('flags' in replyPayload, false);
    } finally {
        musicManager.get = originalGet;
        djSystem.canControlMusic = originalCanControlMusic;
    }
});
