'use strict';

/**
 * Cloudflare Status Notifier
 * Checks Cloudflare status and sends updates ONLY to guilds with /monitor cloudflare subscription
 */

const { EmbedBuilder } = require('discord.js');

const CLOUDFLARE_STATUS_URL = 'https://www.cloudflarestatus.com/api/v2/summary.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

let discordClient = null;
let subscriptionsService = null;
let lastStatus = null;
const lastIncidentIds = new Set();
const lastMaintenanceIds = new Set();
let checkInterval = null;

/**
 * Initialize the notifier with Discord client
 */
function init(client) {
    discordClient = client;
    
    // Load subscriptions service
    try {
        subscriptionsService = require('./monitor-subscriptions');
    } catch (e) {
        console.warn('[CloudflareStatus] Could not load subscriptions service:', e.message);
    }
    
    console.log('[CloudflareStatus] Notifier initialized (subscription-based)');
    
    // Start checking after a delay to allow subscriptions to load
    setTimeout(() => {
        checkCloudflareStatus();
        checkInterval = setInterval(checkCloudflareStatus, CHECK_INTERVAL_MS);
    }, 10000); // Wait 10 seconds before first check
}

/**
 * Stop the notifier
 */
function stop() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

/**
 * Get Cloudflare subscriptions from the database
 */
async function getCloudflareSubscriptions() {
    if (!subscriptionsService || typeof subscriptionsService.get_all_subscriptions !== 'function') {
        return [];
    }
    
    try {
        const allSubs = await subscriptionsService.get_all_subscriptions();
        // Filter only cloudflare subscriptions
        return (allSubs || []).filter(sub => sub.monitor_type === 'cloudflare');
    } catch (e) {
        console.error('[CloudflareStatus] Failed to get subscriptions:', e.message);
        return [];
    }
}

/**
 * Build embed for status change
 */
function buildStatusEmbed(status, description) {
    const colors = {
        none: 0x00ff88,      // Green - operational
        minor: 0xffaa00,     // Yellow - minor issues
        major: 0xff6600,     // Orange - major issues
        critical: 0xff4444   // Red - critical
    };
    
    const icons = {
        none: '✅',
        minor: '⚠️',
        major: '🔶',
        critical: '🚨'
    };
    
    return new EmbedBuilder()
        .setTitle(`${icons[status] || '📡'} Cloudflare Status Update`)
        .setDescription(description)
        .setColor(colors[status] || 0x00d4ff)
        .setTimestamp()
        .setFooter({ text: 'Cloudflare Status • cloudflarestatus.com' });
}

/**
 * Build embed for incident
 */
function buildIncidentEmbed(incident, isNew = true) {
    const statusColors = {
        investigating: 0xff4444,
        identified: 0xff6600,
        monitoring: 0xffaa00,
        resolved: 0x00ff88
    };
    
    const latestUpdate = incident.incident_updates?.[0];
    const status = latestUpdate?.status || 'investigating';
    
    const embed = new EmbedBuilder()
        .setTitle(`${isNew ? '🚨 New Incident' : '📋 Incident Update'}: ${incident.name}`)
        .setColor(statusColors[status] || 0xff4444)
        .setTimestamp(new Date(incident.updated_at))
        .setFooter({ text: 'Cloudflare Status' });
    
    if (latestUpdate) {
        embed.setDescription(latestUpdate.body);
        embed.addFields({ name: 'Status', value: status.charAt(0).toUpperCase() + status.slice(1), inline: true });
    }
    
    if (incident.shortlink) {
        embed.setURL(incident.shortlink);
    }
    
    return embed;
}

/**
 * Build embed for scheduled maintenance
 */
function buildMaintenanceEmbed(maintenance, isNew = true) {
    const embed = new EmbedBuilder()
        .setTitle(`${isNew ? '🔧 Scheduled Maintenance' : '📋 Maintenance Update'}: ${maintenance.name}`)
        .setColor(0x8a2be2)
        .setTimestamp(new Date(maintenance.scheduled_for))
        .setFooter({ text: 'Cloudflare Status' });
    
    const latestUpdate = maintenance.incident_updates?.[0];
    if (latestUpdate) {
        embed.setDescription(latestUpdate.body);
    }
    
    embed.addFields(
        { name: 'Scheduled For', value: new Date(maintenance.scheduled_for).toLocaleString(), inline: true },
        { name: 'Status', value: maintenance.status || 'scheduled', inline: true }
    );
    
    if (maintenance.shortlink) {
        embed.setURL(maintenance.shortlink);
    }
    
    return embed;
}

/**
 * Send notification ONLY to guilds with Cloudflare subscription
 */
async function sendToSubscribedChannels(embed) {
    if (!discordClient || !discordClient.isReady()) {
        return;
    }
    
    // Get only guilds that have subscribed to Cloudflare status via /monitor
    const subscriptions = await getCloudflareSubscriptions();
    
    if (subscriptions.length === 0) {
        console.log('[CloudflareStatus] No Cloudflare subscriptions found, skipping notification');
        return;
    }
    
    let sent = 0;
    
    for (const sub of subscriptions) {
        try {
            // Get the specific channel from the subscription
            const channel = await discordClient.channels.fetch(sub.channel_id).catch(() => null);
            
            if (channel && channel.isTextBased()) {
                await channel.send({ embeds: [embed] });
                sent++;
            }
        } catch (err) {
            // Silently fail for individual channels
            console.warn(`[CloudflareStatus] Failed to send to channel ${sub.channel_id}:`, err.message);
        }
    }
    
    if (sent > 0) {
        console.log(`[CloudflareStatus] Sent notification to ${sent} subscribed channels`);
    }
}

/**
 * Check Cloudflare status and send notifications
 */
async function checkCloudflareStatus() {
    try {
        const response = await fetch(CLOUDFLARE_STATUS_URL);
        if (!response.ok) {
            return;
        }
        
        const data = await response.json();
        
        // Check for overall status change
        const currentStatus = data.status?.indicator || 'none';
        const currentDescription = data.status?.description || 'All Systems Operational';
        
        if (lastStatus !== null && lastStatus !== currentStatus) {
            // Status changed - send notification
            const embed = buildStatusEmbed(currentStatus, currentDescription);
            await sendToSubscribedChannels(embed);
            console.log(`[CloudflareStatus] Status changed: ${lastStatus} -> ${currentStatus}`);
        }
        lastStatus = currentStatus;
        
        // Check for new incidents
        if (data.incidents) {
            for (const incident of data.incidents) {
                if (!lastIncidentIds.has(incident.id)) {
                    // New incident
                    const embed = buildIncidentEmbed(incident, true);
                    await sendToSubscribedChannels(embed);
                    lastIncidentIds.add(incident.id);
                    console.log(`[CloudflareStatus] New incident: ${incident.name}`);
                }
            }
            
            // Clean up old incidents
            const currentIncidentIds = new Set(data.incidents.map(i => i.id));
            for (const id of lastIncidentIds) {
                if (!currentIncidentIds.has(id)) {
                    lastIncidentIds.delete(id);
                }
            }
        }
        
        // Check for new scheduled maintenances
        if (data.scheduled_maintenances) {
            for (const maintenance of data.scheduled_maintenances) {
                if (!lastMaintenanceIds.has(maintenance.id)) {
                    // New maintenance
                    const embed = buildMaintenanceEmbed(maintenance, true);
                    await sendToSubscribedChannels(embed);
                    lastMaintenanceIds.add(maintenance.id);
                    console.log(`[CloudflareStatus] New maintenance: ${maintenance.name}`);
                }
            }
            
            // Clean up old maintenances
            const currentMaintenanceIds = new Set(data.scheduled_maintenances.map(m => m.id));
            for (const id of lastMaintenanceIds) {
                if (!currentMaintenanceIds.has(id)) {
                    lastMaintenanceIds.delete(id);
                }
            }
        }
        
    } catch (err) {
        console.error('[CloudflareStatus] Error checking status:', err.message);
    }
}

/**
 * Get current status (for API)
 */
async function getCurrentStatus() {
    try {
        const response = await fetch(CLOUDFLARE_STATUS_URL);
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (err) {
        return null;
    }
}

module.exports = {
    init,
    stop,
    checkCloudflareStatus,
    getCurrentStatus
};
