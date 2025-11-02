const database = require('../../database');

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_STREAK_WINDOW_MS = 48 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;
const CRATE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const BASE_DAILY_REWARD = 250;
const STREAK_BONUS_PER_DAY = 50;
const STREAK_BONUS_MAX = 5;

const WORK_REWARD_RANGE = [80, 140];
const CRATE_REWARD_RANGE = [120, 400];

const ERROR_CODES = {
    COOLDOWN: 'COOLDOWN',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    UNKNOWN_ITEM: 'UNKNOWN_ITEM'
};

function randomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
}

function msUntil(timestamp, cooldownMs) {
    if (!timestamp) return 0;
    const elapsed = Date.now() - new Date(timestamp).getTime();
    return Math.max(0, cooldownMs - elapsed);
}

function formatCooldown(ms) {
    const seconds = Math.ceil(ms / 1000);
    if (seconds <= 60) {
        return `${seconds}s`;
    }
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
}

class EconomyManager {
    async getProfile(guildId, userId) {
        return database.ensureEconomyProfile(guildId, userId);
    }

    async getBalance(guildId, userId) {
        return this.getProfile(guildId, userId);
    }

    async claimDaily(guildId, userId) {
        const profile = await this.getProfile(guildId, userId);
        const now = Date.now();

        const remaining = msUntil(profile.lastDailyAt, DAILY_COOLDOWN_MS);
        if (remaining > 0) {
            const error = new Error(`You can claim your next daily in ${formatCooldown(remaining)}.`);
            error.code = ERROR_CODES.COOLDOWN;
            throw error;
        }

        let streak = profile.streak || 0;
        if (profile.lastDailyAt) {
            const sinceLast = now - new Date(profile.lastDailyAt).getTime();
            if (sinceLast <= DAILY_STREAK_WINDOW_MS) {
                streak += 1;
            } else {
                streak = 1;
            }
        } else {
            streak = 1;
        }

        const bonus = Math.min(streak - 1, STREAK_BONUS_MAX) * STREAK_BONUS_PER_DAY;
        const reward = BASE_DAILY_REWARD + Math.max(0, bonus);

        await database.updateEconomyUser(guildId, userId, {
            streak,
            lastDailyAt: new Date()
        });

        const updated = await database.adjustEconomyBalance(guildId, userId, reward, {
            type: 'daily',
            reason: `Daily bonus (streak ${streak})`
        });

        return { reward, streak, profile: updated };
    }

    async doWork(guildId, userId) {
        const profile = await this.getProfile(guildId, userId);
        const remaining = msUntil(profile.lastWorkAt, WORK_COOLDOWN_MS);
        if (remaining > 0) {
            const error = new Error(`Clock back in after ${formatCooldown(remaining)}.`);
            error.code = ERROR_CODES.COOLDOWN;
            throw error;
        }

        const reward = randomInt(...WORK_REWARD_RANGE);

        await database.updateEconomyUser(guildId, userId, {
            lastWorkAt: new Date()
        });

        const updated = await database.adjustEconomyBalance(guildId, userId, reward, {
            type: 'work',
            reason: 'Completed a Stark Industries contract'
        });

        return { reward, profile: updated };
    }

    async openCrate(guildId, userId) {
        const profile = await this.getProfile(guildId, userId);
        const remaining = msUntil(profile.lastCrateAt, CRATE_COOLDOWN_MS);
        if (remaining > 0) {
            const error = new Error(`Jarvis is restocking crates. Try again in ${formatCooldown(remaining)}.`);
            error.code = ERROR_CODES.COOLDOWN;
            throw error;
        }

        const reward = randomInt(...CRATE_REWARD_RANGE);
        const bonusChance = Math.random();
        let message = 'You found a crate of StarkTokens.';

        if (bonusChance > 0.95) {
            const bonus = randomInt(200, 500);
            await database.adjustEconomyBalance(guildId, userId, bonus, {
                type: 'crate_bonus',
                reason: 'Crate bonus drop'
            });
            message = 'Lucky find! Bonus schematics included.';
        }

        await database.updateEconomyUser(guildId, userId, {
            lastCrateAt: new Date()
        });

        const updated = await database.adjustEconomyBalance(guildId, userId, reward, {
            type: 'crate',
            reason: 'Opened a Stark crate'
        });

        return { reward, profile: updated, message };
    }

    async coinflip(guildId, userId, amount, choice) {
        if (!Number.isFinite(amount) || amount <= 0) {
            const error = new Error('Wagers must be a positive number of StarkTokens.');
            error.code = ERROR_CODES.INSUFFICIENT_FUNDS;
            throw error;
        }

        const normalizedChoice = choice?.toLowerCase() === 'tails' ? 'tails' : 'heads';
        await this.getProfile(guildId, userId);

        const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
        const didWin = outcome === normalizedChoice;
        const delta = didWin ? amount : -amount;

        try {
            const updated = await database.adjustEconomyBalance(guildId, userId, delta, {
                type: didWin ? 'coinflip_win' : 'coinflip_loss',
                reason: `Coinflip landed ${outcome}`
            });

            return {
                outcome,
                didWin,
                amount,
                profile: updated
            };
        } catch (error) {
            if (error.code === 'INSUFFICIENT_FUNDS') {
                const err = new Error('Balance too low for that wager, sir.');
                err.code = ERROR_CODES.INSUFFICIENT_FUNDS;
                throw err;
            }
            throw error;
        }
    }

    async getLeaderboard(guildId, limit = 10) {
        return database.getEconomyLeaderboard(guildId, { limit });
    }

    async addShopItem(guildId, sku, item) {
        await database.upsertShopItem(guildId, sku, item);
        return database.getShopItem(guildId, sku);
    }

    async removeShopItem(guildId, sku) {
        const existing = await database.getShopItem(guildId, sku);
        if (!existing) {
            return null;
        }
        await database.removeShopItem(guildId, sku);
        return existing;
    }

    async listShopItems(guildId) {
        return database.listShopItems(guildId);
    }

    async buyItem({ guildId, userId, sku }) {
        const item = await database.getShopItem(guildId, sku);
        if (!item) {
            const error = new Error('That SKU does not exist.');
            error.code = ERROR_CODES.UNKNOWN_ITEM;
            throw error;
        }

        try {
            const profile = await database.adjustEconomyBalance(guildId, userId, -item.price, {
                type: 'shop_purchase',
                reason: `Purchased ${item.name || sku}`,
                metadata: { sku }
            });
            return { item, profile };
        } catch (error) {
            if (error.code === 'INSUFFICIENT_FUNDS') {
                const err = new Error('Balance too low to complete that purchase.');
                err.code = ERROR_CODES.INSUFFICIENT_FUNDS;
                throw err;
            }
            throw error;
        }
    }
}

const economyManager = new EconomyManager();
economyManager.ERROR_CODES = ERROR_CODES;

module.exports = economyManager;
