const { createCanvas, loadImage } = require('canvas');
const { PermissionsBitField } = require('discord.js');

const database = require('../../database');
const { isFeatureGloballyEnabled } = require('./feature-flags');

const MESSAGE_MIN_LENGTH = 6;
const MESSAGE_COOLDOWN_MS = 60 * 1000;
const MESSAGE_XP_RANGE = [15, 25];
const VOICE_XP_PER_MINUTE = 10;
const LEVEL_ROLE_CACHE_TTL_MS = 60 * 1000;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function randomIntInclusive(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

class LevelingManager {
    constructor() {
        this.levelRoleCache = new Map();
    }

    xpForLevel(level) {
        return 5 * Math.pow(level, 2) + 50 * level + 100;
    }

    totalXpForLevel(level) {
        let xp = 0;
        for (let current = 0; current < level; current += 1) {
            xp += this.xpForLevel(current);
        }
        return xp;
    }

    calculateLevelProgress(totalXp) {
        let level = 0;
        let xpRemaining = Math.max(0, totalXp);
        let xpForNext = this.xpForLevel(level);

        while (xpRemaining >= xpForNext) {
            xpRemaining -= xpForNext;
            level += 1;
            xpForNext = this.xpForLevel(level);
        }

        return {
            level,
            xpIntoLevel: xpRemaining,
            xpForNext,
            progress: xpForNext > 0 ? xpRemaining / xpForNext : 0
        };
    }

    async handleMessageActivity(message) {
        if (!message || !message.guild || !message.member) {
            return null;
        }

        const content = typeof message.content === 'string' ? message.content.trim() : '';
        if (content.length < MESSAGE_MIN_LENGTH) {
            return null;
        }

        const guildId = message.guild.id;
        const userId = message.author.id;
        const now = new Date();

        const existing = await database.getXpUser(guildId, userId);
        if (existing?.lastMsgAt) {
            const lastAt = new Date(existing.lastMsgAt).getTime();
            if (Number.isFinite(lastAt) && now.getTime() - lastAt < MESSAGE_COOLDOWN_MS) {
                return null;
            }
        }

        const xpGain = randomIntInclusive(MESSAGE_XP_RANGE[0], MESSAGE_XP_RANGE[1]);
        const updated = await database.incrementXpUser(guildId, userId, {
            xpDelta: xpGain,
            lastMessageAt: now
        });

        if (!updated) {
            return null;
        }

        const progress = this.calculateLevelProgress(updated.xp);

        if (progress.level !== updated.level) {
            await database.setUserLevel(guildId, userId, progress.level);
            updated.level = progress.level;
            await this.applyLevelRoles(message.guild, message.member, progress.level);
        }

        return {
            xpGain,
            document: updated,
            progress
        };
    }

    async setVoiceJoinedAt(guildId, userId, startedAt) {
        await database.setUserVoiceJoin(guildId, userId, startedAt);
    }

    async clearVoiceJoin(guildId, userId) {
        await database.clearUserVoiceJoin(guildId, userId);
    }

    async processVoiceSessionEnd(oldState) {
        if (!oldState?.guild || !oldState.member) {
            return;
        }

        const guild = oldState.guild;
        const member = oldState.member;
        const guildId = guild.id;
        const userId = member.id;

        const existing = await database.getXpUser(guildId, userId);
        if (!existing?.joinedVoiceAt) {
            await this.clearVoiceJoin(guildId, userId);
            return;
        }

        const joinedAt = new Date(existing.joinedVoiceAt).getTime();
        await this.clearVoiceJoin(guildId, userId);

        if (!Number.isFinite(joinedAt)) {
            return;
        }

        const now = Date.now();
        const durationMs = now - joinedAt;

        if (durationMs < 60 * 1000) {
            return;
        }

        const channel = oldState.channel;
        if (!channel) {
            return;
        }

        if (member.voice?.selfMute || member.voice?.selfDeaf || member.voice?.serverMute || member.voice?.serverDeaf) {
            return;
        }

        const eligibleOthers = channel.members.filter((voiceMember) => {
            if (!voiceMember || voiceMember.id === userId) {
                return false;
            }
            if (voiceMember.user.bot) {
                return false;
            }
            const voice = voiceMember.voice;
            if (!voice) {
                return false;
            }
            return !voice.selfMute && !voice.selfDeaf && !voice.serverMute && !voice.serverDeaf;
        });

        if (eligibleOthers.size < 1) {
            return;
        }

        const minutes = Math.floor(durationMs / 60000);
        const xpGain = clamp(minutes * VOICE_XP_PER_MINUTE, 0, 2000);

        if (xpGain <= 0) {
            return;
        }

        const updated = await database.incrementXpUser(guildId, userId, {
            xpDelta: xpGain,
            joinedVoiceAt: null
        });

        if (!updated) {
            return;
        }

        const progress = this.calculateLevelProgress(updated.xp);
        if (progress.level !== updated.level) {
            await database.setUserLevel(guildId, userId, progress.level);
            updated.level = progress.level;
            await this.applyLevelRoles(guild, member, progress.level);
        }
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const member = newState?.member || oldState?.member;
        if (!member || member.user.bot) {
            return;
        }

        const guild = member.guild;
        if (!guild) {
            return;
        }

        if (!oldState.channelId && newState.channelId) {
            await this.setVoiceJoinedAt(guild.id, member.id, new Date());
            return;
        }

        const movedChannels = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
        const leftChannel = oldState.channelId && !newState.channelId;

        if (movedChannels) {
            await this.processVoiceSessionEnd(oldState);
            await this.setVoiceJoinedAt(guild.id, member.id, new Date());
            return;
        }

        if (leftChannel) {
            await this.processVoiceSessionEnd(oldState);
        }
    }

    invalidateLevelRoleCache(guildId) {
        this.levelRoleCache.delete(guildId);
    }

    async getLevelRewards(guildId) {
        const cached = this.levelRoleCache.get(guildId);
        if (cached && Date.now() - cached.fetchedAt < LEVEL_ROLE_CACHE_TTL_MS) {
            return cached.roles;
        }

        const roles = await database.getLevelRoles(guildId);
        this.levelRoleCache.set(guildId, { roles, fetchedAt: Date.now() });
        return roles;
    }

    async applyLevelRoles(guild, member, level) {
        if (!guild || !member) {
            return;
        }

        if (!isFeatureGloballyEnabled('leveling')) {
            return;
        }

        const rewards = await this.getLevelRewards(guild.id);
        if (!rewards.length) {
            return;
        }

        const eligible = rewards.filter((reward) => Number.isInteger(reward.level) && reward.level <= level);
        if (!eligible.length) {
            return;
        }

        const botMember = guild.members.me || await guild.members.fetchMe();
        if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return;
        }

        for (const reward of eligible) {
            const roleId = reward.roleId;
            if (!roleId) {
                continue;
            }

            const role = guild.roles.cache.get(roleId) || null;
            if (!role) {
                continue;
            }

            if (member.roles.cache.has(roleId)) {
                continue;
            }

            if (botMember.roles.highest.comparePositionTo(role) <= 0) {
                continue;
            }

            try {
                await member.roles.add(roleId, `Level ${level} reward`);
            } catch (error) {
                console.error('Failed to assign level reward role:', error);
            }
        }
    }

    async getUserRank(guildId, userId) {
        const userDoc = await database.getXpUser(guildId, userId);
        if (!userDoc) {
            return null;
        }

        const higherCount = await database.countGuildXpUsersAbove(guildId, userDoc.xp);
        const rank = higherCount + 1;

        return {
            rank,
            document: userDoc,
            progress: this.calculateLevelProgress(userDoc.xp)
        };
    }

    async getLeaderboard(guildId, { page = 1, pageSize = 10 } = {}) {
        const safePage = Math.max(1, page);
        const limit = Math.max(1, Math.min(50, pageSize));
        const skip = (safePage - 1) * limit;

        const entries = await database.listGuildXpUsers(guildId, { skip, limit });
        const total = await database.countGuildXpUsers(guildId);

        return {
            entries,
            page: safePage,
            pageSize: limit,
            total
        };
    }

    async renderRankCard({ member, document, rank, progress }) {
        if (!member || !document) {
            return null;
        }

        const width = 800;
        const height = 220;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1f2933';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#111827';
        ctx.fillRect(20, 20, width - 40, height - 40);

        // Avatar
        const avatarSize = 140;
        const avatarX = 50;
        const avatarY = (height - avatarSize) / 2;

        try {
            const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarURL);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
        } catch (error) {
            console.warn('Failed to load avatar for rank card:', error);
        }

        const textX = avatarX + avatarSize + 40;

        ctx.fillStyle = '#f9fafb';
        ctx.font = 'bold 32px "Arial"';
        ctx.fillText(member.displayName || member.user.username, textX, avatarY + 40);

        ctx.fillStyle = '#9ca3af';
        ctx.font = '20px "Arial"';
        ctx.fillText(`Rank #${rank}`, textX, avatarY + 80);
        ctx.fillText(`Level ${progress.level}`, textX, avatarY + 110);

        const xpIntoLevel = Math.floor(progress.xpIntoLevel);
        const xpNeeded = Math.floor(progress.xpForNext);
        ctx.fillText(`XP ${document.xp.toLocaleString()} • ${xpIntoLevel.toLocaleString()} / ${xpNeeded.toLocaleString()} to next level`, textX, avatarY + 140);

        // Progress bar
        const barWidth = width - textX - 80;
        const barHeight = 24;
        const barX = textX;
        const barY = avatarY + avatarSize - barHeight;

        ctx.fillStyle = '#374151';
        drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 12);
        ctx.fill();

        const fillWidth = barWidth * clamp(progress.progress, 0, 1);
        ctx.fillStyle = '#2563eb';
        drawRoundedRect(ctx, barX, barY, fillWidth, barHeight, 12);
        ctx.fill();

        return canvas.toBuffer('image/png');
    }
}

module.exports = new LevelingManager();
