'use strict';

const { PermissionsBitField, EmbedBuilder } = require('discord.js');

async function handleMonitorCommand(interaction) {
    const monitorSubscriptions = require('./monitor-subscriptions');
    const monitorUtils = require('./monitor-utils');

    const { guildId } = interaction;
    const userId = interaction.user.id;

    if (!guildId) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({
                content: 'Monitoring is only available in servers, sir.',
                ephemeral: true
            });
        } else {
            await interaction.editReply('Monitoring is only available in servers, sir.');
        }
        return;
    }

    const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
    const memberPermissions = interaction.memberPermissions || interaction.member?.permissions;
    const isOwner = Boolean(guild && guild.ownerId === userId);
    const hasManageChannels = Boolean(memberPermissions?.has(PermissionsBitField.Flags.ManageChannels));
    if (!isOwner && !hasManageChannels) {
        const msg = "❌ You must be the Server Owner or have the 'Manage Channels' permission to use this command.";
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: msg, ephemeral: true });
        } else {
            await interaction.editReply(msg);
        }
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    const resolveAlertChannel = () => {
        const provided = interaction.options.getChannel('channel');
        if (provided) {return provided;}
        return interaction.channel;
    };

    const ensureSendPermissions = async(channel) => {
        const guildRef = guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
        const botMember = guildRef?.members?.me || await guildRef?.members?.fetchMe?.().catch(() => null);
        const perms = channel?.permissionsFor?.(botMember || guildRef?.client?.user);
        if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
            return { ok: false, error: 'I require permission to view and speak in that channel, sir.' };
        }

        if (typeof channel.isThread === 'function' && channel.isThread()) {
            if (!perms?.has(PermissionsBitField.Flags.SendMessagesInThreads)) {
                return { ok: false, error: 'I require permission to speak in that thread, sir.' };
            }
        }

        return { ok: true };
    };

    const truncateFieldValue = (value, max = 1024) => {
        const str = value == null ? '' : String(value);
        if (str.length <= max) {return str;}
        return str.slice(0, Math.max(0, max - 1)).concat('…');
    };

    const cleanText = (text) => {
        const str = text == null ? '' : String(text);
        return str.replace(/\s+/g, ' ').trim();
    };

    const formatRelativeTime = (iso) => {
        if (!iso) {return null;}
        const ms = new Date(String(iso)).getTime();
        if (!Number.isFinite(ms)) {return null;}
        return `<t:${Math.floor(ms / 1000)}:R>`;
    };

    const formatNameList = (names, { maxItems = 18, maxLength = 700 } = {}) => {
        const list = Array.isArray(names) ? names.map(n => String(n)).filter(Boolean) : [];
        const kept = [];
        let len = 0;
        for (const name of list) {
            if (kept.length >= maxItems) {break;}
            const chunk = (kept.length ? ', ' : '') + name;
            if (len + chunk.length > maxLength) {break;}
            kept.push(name);
            len += chunk.length;
        }
        const remaining = list.length - kept.length;
        let joined = kept.join(', ');
        if (remaining > 0) {
            joined = joined ? `${joined} … (+${remaining} more)` : `(+${remaining} more)`;
        }
        return joined || '—';
    };

    try {
        if (subcommand === 'remove') {
            const sourceRaw = String(interaction.options.getString('source', true) || '').trim();
            const source = sourceRaw;

            const result = await monitorSubscriptions.remove_subscription({
                guild_id: guildId,
                source_id: source
            });
            const result2 = source.toLowerCase() !== source
                ? await monitorSubscriptions.remove_subscription({
                    guild_id: guildId,
                    source_id: source.toLowerCase()
                })
                : { ok: true, removed: 0 };

            const removed = (Number(result?.removed) || 0) + (Number(result2?.removed) || 0);
            await interaction.editReply(
                removed > 0
                    ? `🗑️ Removed ${removed} monitor(s), sir.`
                    : 'No monitors matched that source, sir.'
            );
            return;
        }

        if (subcommand === 'rss') {
            const url = String(interaction.options.getString('url', true) || '').trim();
            const channel = resolveAlertChannel();
            if (!channel) {
                await interaction.editReply('Please provide an alert channel, sir.');
                return;
            }

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const latest = await monitorUtils.fetchFeedLatest(url);
            const initial = latest?.id ? String(latest.id) : null;
            if (!initial) {
                await interaction.editReply('I could not find a valid latest item for that feed, sir.');
                return;
            }

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'rss',
                source_id: url,
                last_seen_data: initial
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            await interaction.editReply(
                `✅ RSS monitor added, sir.\n**ID:** \`${doc.id}\`\n**Feed:** ${url}\n**Alerts:** <#${doc.channel_id}>`
            );
            return;
        }

        if (subcommand === 'website') {
            const url = String(interaction.options.getString('url', true) || '').trim();
            const channel = resolveAlertChannel();
            if (!channel) {
                await interaction.editReply('Please provide an alert channel, sir.');
                return;
            }

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const status = await monitorUtils.fetchWebsiteStatus(url);
            const initial = status?.status != null ? String(status.status) : null;
            if (!initial) {
                await interaction.editReply('I could not retrieve an HTTP status for that URL, sir.');
                return;
            }

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'website',
                source_id: url,
                last_seen_data: initial
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            await interaction.editReply(
                `✅ Website monitor added, sir.\n**ID:** \`${doc.id}\`\n**URL:** ${url}\n**Initial:** ${initial}\n**Alerts:** <#${doc.channel_id}>`
            );
            return;
        }

        if (subcommand === 'youtube') {
            const channelId = String(interaction.options.getString('channel_id', true) || '').trim();
            const channel = interaction.options.getChannel('channel', true);

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const latest = await monitorUtils.fetchYoutubeLatest(channelId);
            const initial = latest?.id ? String(latest.id) : null;
            if (!initial) {
                await interaction.editReply('I could not find a latest video for that channel ID, sir.');
                return;
            }

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'youtube',
                source_id: channelId,
                last_seen_data: initial
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            await interaction.editReply(
                `✅ YouTube monitor added, sir.\n**ID:** \`${doc.id}\`\n**Channel ID:** ${channelId}\n**Alerts:** <#${doc.channel_id}>`
            );
            return;
        }

        if (subcommand === 'twitch') {
            const username = String(interaction.options.getString('username', true) || '').trim();
            const normalized = username.toLowerCase();
            const channel = interaction.options.getChannel('channel', true);

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const current = await monitorUtils.fetchTwitchUserAndStream(normalized);
            if (!current?.user) {
                await interaction.editReply('I could not find that Twitch user, sir.');
                return;
            }

            const initial = current?.status ? String(current.status) : 'offline';

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'twitch',
                source_id: normalized,
                last_seen_data: initial
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            await interaction.editReply(
                `✅ Twitch monitor added, sir.\n**ID:** \`${doc.id}\`\n**Username:** ${normalized}\n**Initial:** ${initial}\n**Alerts:** <#${doc.channel_id}>`
            );
            return;
        }

        if (subcommand === 'cloudflare') {
            const channel = resolveAlertChannel();
            if (!channel) {
                await interaction.editReply('Please provide an alert channel, sir.');
                return;
            }

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const status = await monitorUtils.fetchCloudflareStatus();

            if (!status.success) {
                await interaction.editReply(`❌ Failed to fetch Cloudflare status: ${status.error}`);
                return;
            }

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'cloudflare',
                source_id: 'cloudflare'
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('☁️ Cloudflare Status')
                .setColor(status.overall.status === 'none' ? 0x2ecc71 : status.overall.status === 'minor' ? 0xf1c40f : 0xe74c3c)
                .setDescription(`${status.overall.emoji} **${status.overall.description}**`)
                .setTimestamp()
                .setFooter({ text: 'cloudflarestatus.com' });

            // Components summary
            const compSummary = [];
            const total = Number(status?.components?.total) || 0;
            const operational = Number(status?.components?.operational) || 0;
            if (total > 0) {
                compSummary.push(`✅ **${operational}/${total}** operational`);
            } else {
                compSummary.push('✅ All operational');
            }

            const degraded = Array.isArray(status?.components?.degraded) ? status.components.degraded : [];
            const partial = Array.isArray(status?.components?.partialOutage) ? status.components.partialOutage : [];
            const major = Array.isArray(status?.components?.majorOutage) ? status.components.majorOutage : [];
            if (degraded.length > 0) {
                compSummary.push(`⚠️ Degraded (${degraded.length}): ${formatNameList(degraded)}`);
            }
            if (partial.length > 0) {
                compSummary.push(`🟠 Partial (${partial.length}): ${formatNameList(partial)}`);
            }
            if (major.length > 0) {
                compSummary.push(`🔴 Major (${major.length}): ${formatNameList(major)}`);
            }

            embed.addFields({
                name: 'Components',
                value: truncateFieldValue(compSummary.join('\n') || 'All operational'),
                inline: false
            });

            // Active incidents
            const incidents = Array.isArray(status?.incidents) ? status.incidents : [];
            if (incidents.length > 0) {
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
            } else {
                embed.addFields({ name: '🚧 Incidents', value: 'No active incidents', inline: false });
            }

            await interaction.editReply({
                content: `✅ Cloudflare monitor added, sir.\n**ID:** \`${doc.id}\`\n**Alerts:** <#${doc.channel_id}>`,
                embeds: [embed]
            });
            return;
        }

        if (subcommand === 'statuspage') {
            const rawUrl = String(interaction.options.getString('url', true) || '').trim();
            const url = rawUrl.replace(/\/$/, '');
            const channel = resolveAlertChannel();
            if (!channel) {
                await interaction.editReply('Please provide an alert channel, sir.');
                return;
            }

            const permsCheck = await ensureSendPermissions(channel);
            if (!permsCheck.ok) {
                await interaction.editReply(permsCheck.error);
                return;
            }

            const status = await monitorUtils.fetchStatusPageStatus(url);

            if (!status.success) {
                await interaction.editReply(`❌ Failed to fetch status page: ${status.error}\n\nMake sure the URL is a Statuspage.io compatible page (e.g., https://status.example.com)`);
                return;
            }

            const doc = await monitorSubscriptions.add_subscription({
                guild_id: guildId,
                channel_id: channel.id,
                monitor_type: 'statuspage',
                source_id: url
            });

            if (!doc) {
                await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${status.pageName}`)
                .setColor(status.overall.status === 'none' ? 0x2ecc71 : status.overall.status === 'minor' ? 0xf1c40f : 0xe74c3c)
                .setDescription(`${status.overall.emoji} **${status.overall.description}**`)
                .setURL(url)
                .setTimestamp();

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

            await interaction.editReply({
                content: `✅ Status page monitor added, sir.\n**ID:** \`${doc.id}\`\n**URL:** ${url}\n**Alerts:** <#${doc.channel_id}>`,
                embeds: [embed]
            });
            return;
        }

        if (subcommand === 'status') {
            const monitorScheduler = require('./monitor-scheduler');
            const schedulerStatus =
                monitorScheduler && typeof monitorScheduler.getStatus === 'function'
                    ? monitorScheduler.getStatus()
                    : null;

            const subs = await monitorSubscriptions.get_subscriptions_for_guild(guildId);
            const counts = {};
            const list = Array.isArray(subs) ? subs : [];
            for (const sub of list) {
                const t = sub && sub.monitor_type ? String(sub.monitor_type) : 'unknown';
                counts[t] = (counts[t] || 0) + 1;
            }

            const tickMs = Number(schedulerStatus?.tickMs) || 0;
            const tickLabel = tickMs ? `${Math.round((tickMs / 60000) * 10) / 10}m` : 'n/a';
            const lastConnectAt = Number(schedulerStatus?.lastConnectAttemptAt) || 0;
            const lastConnect = lastConnectAt ? `<t:${Math.floor(lastConnectAt / 1000)}:R>` : 'never';

            const schedulerLines = [
                `Started: ${schedulerStatus?.started ? '✅' : '⛔'}`,
                `Running: ${schedulerStatus?.running ? '🟢' : '⚪'}`,
                `Tick: ${tickLabel}`,
                `DB connected: ${schedulerStatus?.dbConnected ? '✅' : '⛔'}`,
                `Last DB connect attempt: ${lastConnect}`
            ];
            if (schedulerStatus?.warnedNotConnected) {
                schedulerLines.push('⚠️ DB warning active');
            }

            const typeEmojis = {
                rss: '📰',
                website: '🌐',
                youtube: '🎬',
                twitch: '🎮',
                cloudflare: '☁️',
                statuspage: '📊'
            };
            const order = ['rss', 'website', 'youtube', 'twitch', 'cloudflare', 'statuspage'];
            const monitorLines = order.map(type => {
                const emoji = typeEmojis[type] || '📋';
                const n = Number(counts[type]) || 0;
                return `${emoji} ${type}: **${n}**`;
            });
            const total = list.length;

            const embed = new EmbedBuilder()
                .setTitle('📡 Monitor Status')
                .setColor(0x3498db)
                .setTimestamp();

            embed.addFields(
                { name: 'Scheduler', value: schedulerLines.join('\n').slice(0, 1024), inline: false },
                {
                    name: `Monitors in this server (${total})`,
                    value: monitorLines.join('\n').slice(0, 1024),
                    inline: false
                }
            );

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'list') {
            const subs = await monitorSubscriptions.get_subscriptions_for_guild(guildId);

            if (!subs || subs.length === 0) {
                await interaction.editReply('No monitors configured for this server, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('📡 Active Monitors')
                .setColor(0x3498db)
                .setTimestamp();

            const typeEmojis = { rss: '📰', website: '🌐', youtube: '🎬', twitch: '🎮', cloudflare: '☁️', statuspage: '📊' };
            const monitorList = subs.slice(0, 15).map(s => {
                const emoji = typeEmojis[s.monitor_type] || '📋';
                const source = s.source_id.length > 40 ? `${s.source_id.substring(0, 37)  }...` : s.source_id;
                return `${emoji} **${s.monitor_type}**: \`${source}\`\n> Channel: <#${s.channel_id}> | ID: \`${s.id}\``;
            }).join('\n\n');

            embed.setDescription(monitorList || 'No monitors found');
            if (subs.length > 15) {
                embed.setFooter({ text: `Showing 15 of ${subs.length} monitors` });
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        await interaction.editReply('Unknown monitor action, sir.');
    } catch (error) {
        console.error('[/monitor] Error:', error);
        const msg = error?.isFriendly ? error.message : 'Monitoring command failed internally, sir.';
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: msg, ephemeral: true });
            } else {
                await interaction.editReply(msg);
            }
        } catch (_) {}
    }
}

module.exports = { handleMonitorCommand };
