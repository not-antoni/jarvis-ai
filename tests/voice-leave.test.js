'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const voiceChat = require('../src/services/voice-chat-service');
const { musicManager } = require('../src/core/musicManager');

test('leave is silently ignored in the farming guild', () => {
    assert.equal(voiceChat.shouldSilentlyIgnoreLeave('858444090374881301'), true);
    assert.equal(voiceChat.shouldSilentlyIgnoreLeave('123456789012345678'), false);
});

test('leave cleans up both music and voice session state', () => {
    const originalMusicGet = musicManager.get;
    const originalDestroy = voiceChat._destroy;
    const originalGetVoiceConnection = voiceChat._getVoiceConnection;
    const originalSessions = voiceChat.sessions;

    const calls = [];

    musicManager.get = () => ({
        getState(guildId) {
            return guildId === 'guild-1' ? { active: true } : null;
        },
        cleanup(guildId) {
            calls.push(['music.cleanup', guildId]);
        }
    });
    voiceChat.sessions = new Map([['guild-1', { guildId: 'guild-1' }]]);
    voiceChat._destroy = guildId => {
        calls.push(['voice.destroy', guildId]);
    };
    voiceChat._getVoiceConnection = guildId => {
        calls.push(['voice.connection.lookup', guildId]);
        return null;
    };

    try {
        const message = voiceChat.leave('guild-1');

        assert.equal(message, 'Disconnected from voice, sir.');
        assert.deepEqual(calls, [
            ['music.cleanup', 'guild-1'],
            ['voice.destroy', 'guild-1']
        ]);
    } finally {
        musicManager.get = originalMusicGet;
        voiceChat._destroy = originalDestroy;
        voiceChat._getVoiceConnection = originalGetVoiceConnection;
        voiceChat.sessions = originalSessions;
    }
});

test('leave destroys an unmanaged raw voice connection when no session exists', () => {
    const originalMusicGet = musicManager.get;
    const originalDestroy = voiceChat._destroy;
    const originalGetVoiceConnection = voiceChat._getVoiceConnection;
    const originalSessions = voiceChat.sessions;

    let destroyed = false;

    musicManager.get = () => ({
        getState() {
            return null;
        },
        cleanup() {
            throw new Error('cleanup should not run without music state');
        }
    });
    voiceChat.sessions = new Map();
    voiceChat._destroy = () => {
        throw new Error('_destroy should not run without a session');
    };
    voiceChat._getVoiceConnection = guildId => ({
        guildId,
        destroy() {
            destroyed = true;
        }
    });

    try {
        const message = voiceChat.leave('guild-2');

        assert.equal(message, 'Disconnected from voice, sir.');
        assert.equal(destroyed, true);
    } finally {
        musicManager.get = originalMusicGet;
        voiceChat._destroy = originalDestroy;
        voiceChat._getVoiceConnection = originalGetVoiceConnection;
        voiceChat.sessions = originalSessions;
    }
});
