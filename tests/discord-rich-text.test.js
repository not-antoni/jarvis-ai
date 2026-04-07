'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveDiscordRichText } = require('../src/utils/discord-rich-text');

function buildMentions() {
    return {
        members: new Map([
            ['111111111111111111', { displayName: 'YamiShiro', user: { username: 'YamiShiro' } }]
        ]),
        users: new Map([
            ['111111111111111111', { username: 'YamiShiro' }]
        ]),
        roles: new Map([
            ['222222222222222222', { name: 'Quasar Mod' }]
        ]),
        channels: new Map([
            ['333333333333333333', { name: 'rules' }]
        ])
    };
}

test('resolveDiscordRichText styles user, role, and channel mentions', async() => {
    const text = 'Hello <@111111111111111111> check <#333333333333333333> and ping <@&222222222222222222>';
    const resolved = await resolveDiscordRichText(text, {
        mentions: buildMentions(),
        style: true
    });

    assert.equal(
        resolved,
        'Hello \u0001@YamiShiro\u0002 check \u0001#rules\u0002 and ping \u0001@Quasar Mod\u0002'
    );
});

test('resolveDiscordRichText styles Discord channel links', async() => {
    const mentions = buildMentions();
    const text = 'Please read [the rules](https://discord.com/channels/999999999999999999/333333333333333333/444444444444444444) and https://discord.com/channels/999999999999999999/333333333333333333/555555555555555555';
    const resolved = await resolveDiscordRichText(text, {
        mentions,
        style: true
    });

    assert.equal(
        resolved,
        'Please read \u0001#rules\u0002 and \u0001#rules\u0002'
    );
});
