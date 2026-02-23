'use strict';

/**
 * Economy Minigames - hunt, fish, dig, beg, crime, postmeme, search
 * Factory module: receives dependencies from stark-economy.js
 */

module.exports = function createMinigames({
    loadUser,
    saveUser,
    checkCooldown,
    getArcReactorPerks,
    isMultiplierActive,
    ECONOMY_CONFIG,
    MINIGAME_REWARDS
}) {
    async function playMinigame(userId, gameType) {
        const game = MINIGAME_REWARDS[gameType];
        if (!game) {return { success: false, error: 'Unknown game type' };}

        // Apply Arc Reactor cooldown reduction
        const arcPerks = await getArcReactorPerks(userId);
        const cooldown = checkCooldown(userId, gameType, game.cooldown * arcPerks.cooldownMultiplier);
        if (cooldown.onCooldown) {
            return { success: false, cooldown: cooldown.remaining };
        }

        // Pick random outcome uniformly from all outcomes
        const outcome = game.outcomes[Math.floor(Math.random() * game.outcomes.length)];

        // Apply Arc Reactor earnings bonus
        let { reward } = outcome;
        if (reward > 0) {
            reward = Math.floor(reward * arcPerks.earningsMultiplier);
        }

        // Apply multiplier bonus if event active (only to positive rewards)
        if (reward > 0 && isMultiplierActive()) {
            reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
        }

        const user = await loadUser(userId);
        user.balance = Math.max(0, user.balance + reward);
        if (reward > 0) {
            user.totalEarned = (user.totalEarned || 0) + reward;
        } else if (reward < 0) {
            user.totalLost = (user.totalLost || 0) + Math.abs(reward);
        }

        // Track material collection for tinker system
        if (outcome.reward > 0) {
            user.materials = user.materials || {};
            const materialName = outcome.name;
            user.materials[materialName] = (user.materials[materialName] || 0) + 1;
        }

        await saveUser(userId, user);

        return {
            success: true,
            item: outcome.name,
            outcome: outcome.name,
            reward: reward,
            newBalance: user.balance,
            message: outcome.name
        };
    }

    async function hunt(userId) {
        return playMinigame(userId, 'hunt');
    }

    async function fish(userId) {
        return playMinigame(userId, 'fish');
    }

    async function dig(userId) {
        return playMinigame(userId, 'dig');
    }

    async function beg(userId) {
        return playMinigame(userId, 'beg');
    }

    async function crime(userId) {
        return playMinigame(userId, 'crime');
    }

    async function postmeme(userId) {
        return playMinigame(userId, 'postmeme');
    }

    async function search(userId, locationIndex = null) {
        const game = MINIGAME_REWARDS.search;

        const cooldown = checkCooldown(userId, 'search', game.cooldown);
        if (cooldown.onCooldown) {
            return { success: false, cooldown: cooldown.remaining };
        }

        const location =
            locationIndex !== null && game.locations[locationIndex]
                ? game.locations[locationIndex]
                : game.locations[Math.floor(Math.random() * game.locations.length)];

        const roll = Math.random();
        let cumulative = 0;
        let outcome = location.outcomes[location.outcomes.length - 1];

        for (const o of location.outcomes) {
            cumulative += o.chance;
            if (roll < cumulative) {
                outcome = o;
                break;
            }
        }

        let { reward } = outcome;
        if (reward > 0 && isMultiplierActive()) {
            reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
        }

        const user = await loadUser(userId);
        user.balance = Math.max(0, user.balance + reward);
        if (reward > 0) {
            user.totalEarned = (user.totalEarned || 0) + reward;
        } else if (reward < 0) {
            user.totalLost = (user.totalLost || 0) + Math.abs(reward);
        }
        await saveUser(userId, user);

        return {
            success: true,
            location: location.name,
            outcome: outcome.result,
            reward: reward,
            newBalance: user.balance
        };
    }

    function getSearchLocations() {
        return MINIGAME_REWARDS.search.locations.map((l, i) => ({
            index: i,
            name: l.name
        }));
    }

    return { playMinigame, hunt, fish, dig, beg, crime, postmeme, search, getSearchLocations };
};
