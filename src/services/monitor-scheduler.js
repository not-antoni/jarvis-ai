'use strict';

const { EmbedBuilder } = require('discord.js');
const database = require('./database');
const subscriptions = require('./monitor-subscriptions');
const monitorUtils = require('./monitor-utils');

const DEFAULT_TICK_MS = 7 * 60 * 1000;

const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);

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
    const payload = currentStatus && typeof currentStatus === 'object' ? currentStatus : null;
    const current = payload?.status != null ? String(payload.status) : String(currentStatus);

    const wentUp = current === '200' && previous !== '200';
    const wentDown = previous === '200' && current !== '200';

    const title = wentUp
        ? '✅ Website recovered'
        : wentDown
          ? '🚨 Website down'
          : '🌐 Website status changed';

    const color = wentUp ? 0x2ecc71 : wentDown ? 0xe74c3c : 0xf1c40f;

    const currentValueParts = [current];
    if (payload?.statusText) {
        currentValueParts.push(String(payload.statusText));
    }
    if (Number.isFinite(payload?.responseTime)) {
        currentValueParts.push(`(${Number(payload.responseTime)}ms)`);
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setURL(url)
        .addFields(
            { name: 'Previous', value: previous, inline: true },
            { name: 'Current', value: currentValueParts.join(' '), inline: true }
        )
        .setTimestamp();

    if (payload?.error) {
        embed.addFields({ name: 'Error', value: String(payload.error).slice(0, 1024), inline: false });
    }

    const server = payload?.headers?.server ? String(payload.headers.server) : null;
    const contentType = payload?.headers?.contentType ? String(payload.headers.contentType) : null;
    if (server) {
        embed.addFields({ name: 'Server', value: server.slice(0, 1024), inline: true });
    }
    if (contentType) {
        embed.addFields({ name: 'Content-Type', value: contentType.slice(0, 1024), inline: true });
    }

    return embed;
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

function getIndicatorColor(indicator) {
    const normalized = String(indicator || '').toLowerCase();
    if (normalized === 'none' || normalized === 'operational') {
        return 0x2ecc71;
    }
    if (normalized === 'minor' || normalized === 'degraded_performance') {
        return 0xf1c40f;
    }
    return 0xe74c3c;
}

// Cloudflare "Cloudflare Sites and Services" group ID - these are the important core services
const CLOUDFLARE_CORE_SERVICES_GROUP_ID = '1km35smx8p41';

// Filter to only include important Cloudflare components (core services, not locations)
function filterImportantCloudflareComponents(componentsList) {
    if (!Array.isArray(componentsList)) return [];
    
    return componentsList.filter(c => {
        // Include components that belong to the core services group
        if (c.group_id === CLOUDFLARE_CORE_SERVICES_GROUP_ID) {
            return true;
        }
        // Also include the main group headers (group: true) but not region groups
        if (c.group === true && c.id === CLOUDFLARE_CORE_SERVICES_GROUP_ID) {
            return true;
        }
        return false;
    });
}

function truncateFieldValue(value, max = 1024) {
    const str = value == null ? '' : String(value);
    if (str.length <= max) {
        return str;
    }
    return str.slice(0, Math.max(0, max - 1)).concat('…');
}

function cleanText(text) {
    const str = text == null ? '' : String(text);
    return str.replace(/\s+/g, ' ').trim();
}

function formatRelativeTime(iso) {
    if (!iso) {
        return null;
    }
    const ms = new Date(String(iso)).getTime();
    if (!Number.isFinite(ms)) {
        return null;
    }
    return `<t:${Math.floor(ms / 1000)}:R>`;
}

function formatNameList(names, { maxItems = 18, maxLength = 700 } = {}) {
    const list = Array.isArray(names) ? names.map(n => String(n)).filter(Boolean) : [];
    const kept = [];
    let len = 0;
    for (const name of list) {
        if (kept.length >= maxItems) {
            break;
        }
        const chunk = (kept.length ? ', ' : '') + name;
        if (len + chunk.length > maxLength) {
            break;
        }
        kept.push(name);
        len += chunk.length;
    }
    const remaining = list.length - kept.length;
    let joined = kept.join(', ');
    if (remaining > 0) {
        joined = joined ? `${joined} … (+${remaining} more)` : `(+${remaining} more)`;
    }
    return joined || '—';
}

function buildCloudflareSnapshot(status) {
    if (!status || !status.success) {
        return null;
    }

    const overall = status.overall?.status ? String(status.overall.status) : 'unknown';
    
    // Only track important components (core services, not locations)
    const importantComponents = filterImportantCloudflareComponents(status.componentsList);
    const components = importantComponents
        .map(c => ({
            id: c?.id ? String(c.id) : c?.name ? String(c.name) : '',
            name: c?.name ? String(c.name) : '',
            status: c?.status ? String(c.status) : 'unknown'
        }))
        .filter(c => c.id);
    components.sort((a, b) => a.id.localeCompare(b.id));

    const incidents = Array.isArray(status.incidents)
        ? status.incidents
              .map(i => ({
                  id: i?.id ? String(i.id) : i?.name ? String(i.name) : '',
                  status: i?.status ? String(i.status) : 'unknown',
                  impact: i?.impact ? String(i.impact) : 'unknown',
                  updatedAt: i?.updatedAt ? String(i.updatedAt) : ''
              }))
              .filter(i => i.id)
        : [];
    incidents.sort((a, b) => a.id.localeCompare(b.id));

    return JSON.stringify({ overall, components, incidents });
}

function buildStatusPageSnapshot(status) {
    if (!status || !status.success) {
        return null;
    }

    const overall = status.overall?.status ? String(status.overall.status) : 'unknown';
    const components = Array.isArray(status.components)
        ? status.components
              .map(c => ({
                  id: c?.id ? String(c.id) : c?.name ? String(c.name) : '',
                  status: c?.status ? String(c.status) : 'unknown'
              }))
              .filter(c => c.id)
        : [];
    components.sort((a, b) => a.id.localeCompare(b.id));

    const incidents = Array.isArray(status.incidents)
        ? status.incidents
              .map(i => ({
                  id: i?.id ? String(i.id) : i?.name ? String(i.name) : '',
                  status: i?.status ? String(i.status) : 'unknown',
                  impact: i?.impact ? String(i.impact) : 'unknown',
                  updatedAt: i?.updatedAt ? String(i.updatedAt) : ''
              }))
              .filter(i => i.id)
        : [];
    incidents.sort((a, b) => a.id.localeCompare(b.id));

    return JSON.stringify({ overall, components, incidents });
}

function buildCloudflareEmbed(status, { isResolved = false, affectedServices = [] } = {}) {
    const overallIndicator = status?.overall?.status || 'unknown';
    const overallDescription = status?.overall?.description || 'Unknown';
    const overallEmoji = status?.overall?.emoji || monitorUtils.getStatusEmoji(overallIndicator);

    // Different title and color for resolved vs issue
    const title = isResolved ? '✅ Cloudflare Services Restored' : '☁️ Cloudflare Status Update';
    const color = isResolved ? 0x2ecc71 : getIndicatorColor(overallIndicator);

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`${overallEmoji} **${overallDescription}**`)
        .setTimestamp()
        .setFooter({ text: 'cloudflarestatus.com' });

    // Filter to only show important services (core services, not locations)
    const importantComponents = filterImportantCloudflareComponents(status.componentsList || []);
    const impactedServices = importantComponents.filter(
        c => c.status && c.status !== 'operational'
    );
    
    if (isResolved && affectedServices.length > 0) {
        // Show which services were restored
        embed.addFields({
            name: '🔧 Services Restored',
            value: truncateFieldValue(affectedServices.join(', ') || 'All services'),
            inline: false
        });
    } else if (impactedServices.length > 0) {
        // Group by status type
        const degraded = impactedServices.filter(c => c.status === 'degraded_performance').map(c => c.name);
        const partial = impactedServices.filter(c => c.status === 'partial_outage').map(c => c.name);
        const major = impactedServices.filter(c => c.status === 'major_outage').map(c => c.name);
        const maintenance = impactedServices.filter(c => c.status === 'under_maintenance').map(c => c.name);

        const compSummary = [];
        if (major.length > 0) {
            compSummary.push(`🔴 **Major Outage:** ${formatNameList(major)}`);
        }
        if (partial.length > 0) {
            compSummary.push(`🟠 **Partial Outage:** ${formatNameList(partial)}`);
        }
        if (degraded.length > 0) {
            compSummary.push(`⚠️ **Degraded:** ${formatNameList(degraded)}`);
        }
        if (maintenance.length > 0) {
            compSummary.push(`🛠️ **Maintenance:** ${formatNameList(maintenance)}`);
        }

        embed.addFields({
            name: '⚠️ Affected Services',
            value: truncateFieldValue(compSummary.join('\n') || 'Some services affected'),
            inline: false
        });
    } else {
        embed.addFields({
            name: 'Services',
            value: '✅ All core services operational',
            inline: false
        });
    }

    const incidents = Array.isArray(status?.incidents) ? status.incidents : [];
    if (incidents.length > 0 && !isResolved) {
        const incidentList = incidents
            .slice(0, 3)
            .map(i => {
                const impact =
                    i.impact === 'critical'
                        ? '🚨'
                        : i.impact === 'major'
                          ? '🔴'
                          : i.impact === 'minor'
                            ? '⚠️'
                            : '📋';
                const details = i.shortlink ? ` | [Details](${i.shortlink})` : '';
                const when = formatRelativeTime(i.updatedAt || i.createdAt);
                const updates = Array.isArray(i.updates) ? i.updates : [];
                const updateText = updates.length > 0 ? cleanText(updates[0].body) : '';
                const updateSnippet = updateText ? `\n> ${updateText}` : '';
                return `${impact} **${i.name}**\n> Status: ${i.status}${when ? ` (${when})` : ''}${details}${updateSnippet}`;
            })
            .join('\n\n');
        embed.addFields({
            name: '🚧 Incidents',
            value: truncateFieldValue(incidentList || 'No incident details'),
            inline: false
        });
    }

    return embed;
}

function buildStatusPageEmbed({ url, status }) {
    const overallIndicator = status?.overall?.status || 'unknown';
    const overallDescription = status?.overall?.description || 'Unknown';
    const overallEmoji = status?.overall?.emoji || monitorUtils.getStatusEmoji(overallIndicator);

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${status?.pageName || 'Status Page'} Update`)
        .setColor(getIndicatorColor(overallIndicator))
        .setDescription(`${overallEmoji} **${overallDescription}**`)
        .setTimestamp();

    if (url) {
        embed.setURL(url);
    }

    const components = Array.isArray(status?.components) ? status.components : [];
    const totalComponents = components.length;
    const impactedComponents = components.filter(
        c => c && c.status && String(c.status).toLowerCase() !== 'operational'
    );

    if (totalComponents > 0) {
        if (impactedComponents.length === 0) {
            embed.addFields({
                name: 'Components',
                value: truncateFieldValue(`✅ All operational (${totalComponents})`),
                inline: false
            });
        } else {
            const compLines = impactedComponents
                .slice(0, 10)
                .map(c => {
                    const statusLabel = c.status ? String(c.status).replace(/_/g, ' ') : 'unknown';
                    const emoji = c.emoji || monitorUtils.getStatusEmoji(c.status);
                    return `${emoji} ${c.name} (${statusLabel})`;
                })
                .join('\n');
            const header = `⚠️ Impacted: **${impactedComponents.length}/${totalComponents}**\n`;
            embed.addFields({
                name: 'Components',
                value: truncateFieldValue(header + compLines),
                inline: false
            });
        }
    }

    const incidents = Array.isArray(status?.incidents) ? status.incidents : [];
    if (incidents.length > 0) {
        const incList = incidents
            .slice(0, 3)
            .map(i => {
                const impact =
                    i.impact === 'critical'
                        ? '🚨'
                        : i.impact === 'major'
                          ? '🔴'
                          : i.impact === 'minor'
                            ? '⚠️'
                            : '📋';
                const details = i.shortlink ? ` | [Details](${i.shortlink})` : '';
                const when = formatRelativeTime(i.updatedAt || i.createdAt);
                const updates = Array.isArray(i.updates) ? i.updates : [];
                const updateText = updates.length > 0 ? cleanText(updates[0].body) : '';
                const updateSnippet = updateText ? `\n> ${updateText}` : '';
                return `${impact} **${i.name}**\n> Status: ${i.status}${when ? ` (${when})` : ''}${details}${updateSnippet}`;
            })
            .join('\n\n');
        embed.addFields({
            name: '🚧 Incidents',
            value: truncateFieldValue(incList || 'No incident details'),
            inline: false
        });
    } else {
        embed.addFields({ name: '🚧 Incidents', value: 'No recent incidents', inline: false });
    }

    return embed;
}

async function safeSendMessage(channel, payload) {
    const { safeSend } = require('../utils/discord-safe-send');
    return await safeSend(channel, payload, schedulerState.client);
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

            const sent = await safeSendMessage(channel, { embeds: [embed] });
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

            const sent = await safeSendMessage(channel, { embeds: [embed] });
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
                currentStatus: status
            });

            const sent = await safeSendMessage(channel, { embeds: [embed] });
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

                const sent = await safeSendMessage(channel, { embeds: [embed] });
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
        return;
    }

    if (type === 'cloudflare') {
        const status = await monitorUtils.fetchCloudflareStatus().catch(() => null);
        if (!status?.success) {
            return;
        }

        const currentSnapshot = buildCloudflareSnapshot(status);
        if (!currentSnapshot) {
            return;
        }
        const previousSnapshot = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!previousSnapshot) {
            await subscriptions
                .update_last_seen_data({ id: String(sub.id), last_seen_data: currentSnapshot })
                .catch(() => null);
            return;
        }

        if (currentSnapshot !== previousSnapshot) {
            // Parse snapshots to detect resolved vs new issues
            let previousData = null;
            let currentData = null;
            try {
                previousData = JSON.parse(previousSnapshot);
                currentData = JSON.parse(currentSnapshot);
            } catch {
                previousData = null;
                currentData = null;
            }

            // Determine if this is a resolution or new/ongoing issue
            let isResolved = false;
            let affectedServices = [];

            if (previousData && currentData) {
                const prevImpacted = (previousData.components || []).filter(
                    c => c.status && c.status !== 'operational'
                );
                const currImpacted = (currentData.components || []).filter(
                    c => c.status && c.status !== 'operational'
                );
                const prevIncidents = previousData.incidents || [];
                const currIncidents = currentData.incidents || [];

                // Check if previous had issues but current is all clear
                const hadIssues = prevImpacted.length > 0 || prevIncidents.length > 0;
                const nowClear = currImpacted.length === 0 && currIncidents.length === 0;

                if (hadIssues && nowClear) {
                    isResolved = true;
                    affectedServices = prevImpacted.map(c => c.name).filter(Boolean);
                }

                // Only notify if there are actual important changes:
                // 1. Issues resolved (hadIssues && nowClear)
                // 2. New issues appeared (currImpacted.length > 0 || currIncidents.length > 0)
                // 3. Incident updates
                const hasCurrentIssues = currImpacted.length > 0 || currIncidents.length > 0;
                
                if (!isResolved && !hasCurrentIssues) {
                    // No important change to announce - just update the snapshot silently
                    await subscriptions
                        .update_last_seen_data({ id: String(sub.id), last_seen_data: currentSnapshot })
                        .catch(() => null);
                    return;
                }
            }

            const embed = buildCloudflareEmbed(status, { isResolved, affectedServices });
            const sent = await safeSendMessage(channel, { embeds: [embed] });
            if (!sent.ok) {
                console.warn('[Monitor] Failed to send Cloudflare notification:', sent.error?.message || sent.error);
                await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                return;
            }

            await subscriptions
                .update_last_seen_data({ id: String(sub.id), last_seen_data: currentSnapshot })
                .catch(() => null);
        }
        return;
    }

    if (type === 'statuspage') {
        const baseUrl = String(sub.source_id);
        const status = await monitorUtils.fetchStatusPageStatus(baseUrl).catch(() => null);
        if (!status?.success) {
            return;
        }

        const currentSnapshot = buildStatusPageSnapshot(status);
        if (!currentSnapshot) {
            return;
        }
        const previousSnapshot = sub.last_seen_data != null ? String(sub.last_seen_data) : null;

        if (!previousSnapshot) {
            await subscriptions
                .update_last_seen_data({ id: String(sub.id), last_seen_data: currentSnapshot })
                .catch(() => null);
            return;
        }

        if (currentSnapshot !== previousSnapshot) {
            const embed = buildStatusPageEmbed({ url: baseUrl, status });
            const sent = await safeSendMessage(channel, { embeds: [embed] });
            if (!sent.ok) {
                console.warn('[Monitor] Failed to send status page notification:', sent.error?.message || sent.error);
                await subscriptions.remove_subscription_by_id({ id: String(sub.id) }).catch(() => null);
                return;
            }

            await subscriptions
                .update_last_seen_data({ id: String(sub.id), last_seen_data: currentSnapshot })
                .catch(() => null);
        }
        return;
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

        if (IS_RENDER && !schedulerState.database?.isConnected) {
            if (!schedulerState.warnedNotConnected) {
                schedulerState.warnedNotConnected = true;
                console.warn('[Monitor] Database not connected; skipping polling on Render');
            }
            return;
        }

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

function stop() {
    if (!schedulerState.started) {
        return;
    }
    
    if (schedulerState.tickHandle) {
        clearInterval(schedulerState.tickHandle);
        schedulerState.tickHandle = null;
    }
    
    schedulerState.started = false;
    schedulerState.running = false;
    console.log('[Monitor] Scheduler stopped');
}

function isRunning() {
    return schedulerState.started;
}

function getStatus() {
    return {
        started: Boolean(schedulerState.started),
        running: Boolean(schedulerState.running),
        tickMs: Number(schedulerState.tickMs) || DEFAULT_TICK_MS,
        hasClient: Boolean(schedulerState.client),
        tickHandleActive: Boolean(schedulerState.tickHandle),
        warnedNotConnected: Boolean(schedulerState.warnedNotConnected),
        lastConnectAttemptAt: Number(schedulerState.lastConnectAttemptAt) || 0,
        dbConnected: Boolean(schedulerState.database && schedulerState.database.isConnected),
        isRender: Boolean(IS_RENDER)
    };
}

module.exports = {
    init,
    runOnce,
    getStatus
};
