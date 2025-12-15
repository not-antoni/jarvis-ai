'use strict';

const { EmbedBuilder } = require('discord.js');
const database = require('./database');
const subscriptions = require('./monitor-subscriptions');
const monitorUtils = require('./monitor-utils');

const DEFAULT_TICK_MS = 7 * 60 * 1000;

let schedulerState = {
    started: false,
    tickHandle: null,
    client: null,
    database: null,
    lastConnectAttemptAt: 0,
    warnedNotConnected: false,
    running: false,
    tickMs: DEFAULT_TICK_MS
};

function canOperate() {
    if (!schedulerState.client) {
        return false;
    }

    const subsAvailable = subscriptions && typeof subscriptions.get_all_subscriptions === 'function';
    if (!subsAvailable) {
        return false;
    }

    return true;
}

async function ensureDatabaseConnection() {
    if (!schedulerState.database || typeof schedulerState.database.connect !== 'function') {
        return;
    }

    if (schedulerState.database.isConnected) {
        return;
    }

    const now = Date.now();
    if (schedulerState.lastConnectAttemptAt && now - schedulerState.lastConnectAttemptAt < 30 * 1000) {
        return;
    }

    schedulerState.lastConnectAttemptAt = now;
    await schedulerState.database.connect().catch(() => {});
}

function buildRssEmbed({ title, link, source }) {
    const embed = new EmbedBuilder()
        .setTitle(title || 'New feed item')
        .setColor(0x2ecc71)
        .setTimestamp();

    if (link) {
        embed.setURL(link);
    }

    if (source) {
        embed.setFooter({ text: source });
    }

    return embed;
}

function buildYoutubeEmbed({ title, link, source }) {
    const embed = new EmbedBuilder()
        .setTitle(title || 'New YouTube upload')
        .setColor(0xff0000)
        .setTimestamp();

    if (link) {
        embed.setURL(link);
    }

    if (source) {
        embed.setFooter({ text: source });
    }

    return embed;
}

function buildWebsiteEmbed({ url, previousStatus, currentStatus }) {
    const previous = String(previousStatus);
    const current = String(currentStatus);

    const wentUp = current === '200' && previous !== '200';
    const wentDown = previous === '200' && current !== '200';

    const title = wentUp
        ? '✅ Website recovered'
        : wentDown
          ? '🚨 Website down'
          : '🌐 Website status changed';

    const color = wentUp ? 0x2ecc71 : wentDown ? 0xe74c3c : 0xf1c40f;

    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setURL(url)
        .addFields(
            { name: 'Previous', value: previous, inline: true },
            { name: 'Current', value: current, inline: true }
        )
        .setTimestamp();
}

function buildTwitchEmbed({ username, user, stream }) {
    const displayName = user?.display_name || username;
    const login = user?.login || username;
    const url = `https://twitch.tv/${encodeURIComponent(login)}`;

    const embed = new EmbedBuilder()
        .setTitle(`${displayName} is LIVE on Twitch`)
        .setColor(0x9146ff)
        .setURL(url)
        .setTimestamp();

    if (stream?.title) {
        embed.setDescription(String(stream.title));
    }

    if (user?.profile_image_url) {
        embed.setThumbnail(String(user.profile_image_url));
    }

    const game = stream?.game_name ? String(stream.game_name) : null;
    const viewers = Number.isFinite(stream?.viewer_count) ? String(stream.viewer_count) : null;

    const fields = [];
    if (game) {
        fields.push({ name: 'Game', value: game, inline: true });
    }
    if (viewers) {
        fields.push({ name: 'Viewers', value: viewers, inline: true });
    }
    if (fields.length) {
        embed.addFields(fields);
    }

    const thumb = stream?.thumbnail_url ? String(stream.thumbnail_url) : null;
    if (thumb) {
        const imageUrl = thumb
            .replace('{width}', '1280')
            .replace('{height}', '720')
            .concat(`?t=${Date.now()}`);
        embed.setImage(imageUrl);
    }

    return embed;
}

async function safeSend(channel, payload) {
    try {
        await channel.send(payload);
        return { ok: true };
    } catch (error) {
        return { ok: false, error };
    }
}

async function processSubscription(sub) {
    if (!sub || !sub.id || !sub.monitor_type || !sub.source_id || !sub.channel_id) {
        return;
    }

    const channel = await schedulerState.client.channels.fetch(String(sub.channel_id)).catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
        await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
        return;
    }

    const type = String(sub.monitor_type);

    if (type === 'rss') {
        const latest = await monitorUtils.fetchFeedLatest(String(sub.source_id)).catch(() => null);
        const currentId = latest?.id ? String(latest.id) : null;
        const previousId = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!currentId) {
            return;
        }

        if (!previousId) {
            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentId }).catch(
                () => null
            );
            return;
        }

        if (currentId !== previousId) {
            const embed = buildRssEmbed({
                title: latest?.title,
                link: latest?.link,
                source: String(sub.source_id)
            });

            const sent = await safeSend(channel, { embeds: [embed] });
            if (!sent.ok) {
                console.warn('[Monitor] Failed to send RSS notification:', sent.error?.message || sent.error);
                await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                return;
            }

            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentId }).catch(
                () => null
            );
        }
        return;
    }

    if (type === 'youtube') {
        const latest = await monitorUtils.fetchYoutubeLatest(String(sub.source_id)).catch(() => null);
        const currentId = latest?.id ? String(latest.id) : null;
        const previousId = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!currentId) {
            return;
        }

        if (!previousId) {
            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentId }).catch(
                () => null
            );
            return;
        }

        if (currentId !== previousId) {
            const embed = buildYoutubeEmbed({
                title: latest?.title,
                link: latest?.link,
                source: `YouTube ${sub.source_id}`
            });

            const sent = await safeSend(channel, { embeds: [embed] });
            if (!sent.ok) {
                console.warn('[Monitor] Failed to send YouTube notification:', sent.error?.message || sent.error);
                await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                return;
            }

            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentId }).catch(
                () => null
            );
        }
        return;
    }

    if (type === 'website') {
        const status = await monitorUtils.fetchWebsiteStatus(String(sub.source_id)).catch(() => null);
        const currentStatus = status?.status != null ? String(status.status) : null;
        const previousStatus = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!currentStatus) {
            return;
        }

        if (!previousStatus) {
            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentStatus }).catch(
                () => null
            );
            return;
        }

        if (currentStatus !== previousStatus) {
            const embed = buildWebsiteEmbed({
                url: String(sub.source_id),
                previousStatus,
                currentStatus
            });

            const sent = await safeSend(channel, { embeds: [embed] });
            if (!sent.ok) {
                console.warn('[Monitor] Failed to send website notification:', sent.error?.message || sent.error);
                await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                return;
            }

            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentStatus }).catch(
                () => null
            );
        }
        return;
    }

    if (type === 'twitch') {
        const result = await monitorUtils.fetchTwitchUserAndStream(String(sub.source_id)).catch(() => null);
        const currentStatus = result?.status ? String(result.status) : 'offline';
        const previousStatus = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!previousStatus) {
            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentStatus }).catch(
                () => null
            );
            return;
        }

        if (currentStatus !== previousStatus) {
            const shouldNotify = previousStatus === 'offline' && currentStatus === 'live';

            if (shouldNotify) {
                const embed = buildTwitchEmbed({
                    username: String(sub.source_id),
                    user: result?.user,
                    stream: result?.stream
                });

                const sent = await safeSend(channel, { embeds: [embed] });
                if (!sent.ok) {
                    console.warn('[Monitor] Failed to send Twitch notification:', sent.error?.message || sent.error);
                    await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                    return;
                }
            }

            await subscriptions.update_last_seen_data({ id: String(sub.id), last_seen_data: currentStatus }).catch(
                () => null
            );
        }
    }
}

async function tick() {
    if (!canOperate()) {
        return;
    }

    if (schedulerState.running) {
        return;
    }

    schedulerState.running = true;
    try {
        await ensureDatabaseConnection();

        const all = await subscriptions.get_all_subscriptions().catch(() => []);
        if (!Array.isArray(all) || !all.length) {
            return;
        }

        for (const sub of all) {
            await processSubscription(sub).catch(error => {
                console.warn('[Monitor] Subscription processing failed:', error?.message || error);
            });
        }
    } finally {
        schedulerState.running = false;
    }
}

function init({ client, tickMs = DEFAULT_TICK_MS } = {}) {
    if (schedulerState.started) {
        return;
    }

    schedulerState.client = client || null;
    schedulerState.database = database || null;

    const parsed = Number(tickMs);
    schedulerState.tickMs = Math.max(60 * 1000, Number.isFinite(parsed) ? parsed : DEFAULT_TICK_MS);

    schedulerState.tickHandle = setInterval(() => {
        tick().catch(error => {
            console.warn('[Monitor] Tick failed:', error?.message || error);
        });
    }, schedulerState.tickMs);

    schedulerState.started = true;
    console.log('[Monitor] Scheduler started');
}

async function runOnce() {
    return tick();
}

module.exports = {
    init,
    runOnce
};
