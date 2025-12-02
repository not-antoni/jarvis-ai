/**
 * Top.gg Voting System
 * Handles vote webhooks, rewards, and reminders
 */

const config = require('../../config');
const starkEconomy = require('./stark-economy');

// Vote reward configuration - MORE GENEROUS than other bots!
const VOTE_CONFIG = {
    baseReward: 200,           // Base Stark Bucks per vote
    weekendMultiplier: 2,      // 2x on weekends
    streakBonus: 25,           // Extra per vote streak
    maxStreak: 10,             // Cap at 10 streak
    cooldownMs: 12 * 60 * 60 * 1000,  // 12 hours between votes
    reminderDelayMs: 12 * 60 * 60 * 1000, // Remind after 12 hours
    boostDurationMs: 12 * 60 * 60 * 1000, // Voting boost lasts 12 hours
    boostMultiplier: 1.25,     // 25% boost to all earnings
};

// In-memory vote tracking (also persisted to MongoDB)
const voteCache = new Map(); // odbc -> { lastVote, streak, reminderScheduled }
const pendingReminders = new Map(); // odbc -> timeout

/**
 * Get top.gg vote URL
 */
function getVoteUrl() {
    const botId = config.discord?.clientId || process.env.DISCORD_CLIENT_ID;
    return `https://top.gg/bot/${botId}/vote`;
}

/**
 * Check if it's a weekend (2x rewards)
 */
function isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Get user's vote data from cache or database
 */
async function getVoteData(userId) {
    if (voteCache.has(userId)) {
        return voteCache.get(userId);
    }

    // Try to load from user's economy data
    const user = await starkEconomy.loadUser(userId);
    const voteData = {
        lastVote: user.lastVote || 0,
        streak: user.voteStreak || 0,
        totalVotes: user.totalVotes || 0
    };
    
    voteCache.set(userId, voteData);
    return voteData;
}

/**
 * Check if user can vote (12 hour cooldown passed)
 */
async function canVote(userId) {
    const voteData = await getVoteData(userId);
    const now = Date.now();
    const timeSinceLastVote = now - voteData.lastVote;
    
    return {
        canVote: timeSinceLastVote >= VOTE_CONFIG.cooldownMs,
        timeRemaining: Math.max(0, VOTE_CONFIG.cooldownMs - timeSinceLastVote),
        lastVote: voteData.lastVote,
        streak: voteData.streak
    };
}

/**
 * Check if user has active voting boost
 */
async function hasVotingBoost(userId) {
    const voteData = await getVoteData(userId);
    const now = Date.now();
    const timeSinceLastVote = now - voteData.lastVote;
    
    return timeSinceLastVote < VOTE_CONFIG.boostDurationMs;
}

/**
 * Get voting boost multiplier for user
 */
async function getVoteBoostMultiplier(userId) {
    const hasBoost = await hasVotingBoost(userId);
    return hasBoost ? VOTE_CONFIG.boostMultiplier : 1.0;
}

/**
 * Process a vote and give rewards
 */
async function processVote(userId, username, isTest = false) {
    const now = Date.now();
    const voteData = await getVoteData(userId);
    
    // Check if vote is within streak window (24 hours)
    const wasRecent = (now - voteData.lastVote) < (24 * 60 * 60 * 1000);
    
    // Update streak
    let newStreak = wasRecent ? Math.min(voteData.streak + 1, VOTE_CONFIG.maxStreak) : 1;
    
    // Calculate reward
    let reward = VOTE_CONFIG.baseReward;
    
    // Weekend bonus
    if (isWeekend()) {
        reward *= VOTE_CONFIG.weekendMultiplier;
    }
    
    // Streak bonus
    reward += (newStreak - 1) * VOTE_CONFIG.streakBonus;
    
    // Update vote data
    const newVoteData = {
        lastVote: now,
        streak: newStreak,
        totalVotes: (voteData.totalVotes || 0) + 1
    };
    voteCache.set(userId, newVoteData);
    
    // Save to database via economy system
    try {
        const user = await starkEconomy.loadUser(userId, username);
        user.lastVote = now;
        user.voteStreak = newStreak;
        user.totalVotes = (user.totalVotes || 0) + 1;
        user.balance += reward;
        user.totalEarned = (user.totalEarned || 0) + reward;
        
        // Save directly to DB
        const database = require('./database');
        await database.connect();
        await database.db.collection('starkEconomy').updateOne(
            { userId: userId },
            { $set: user },
            { upsert: true }
        );
    } catch (error) {
        console.error('[TopGG] Failed to save vote data:', error);
    }
    
    // Schedule reminder
    scheduleReminder(userId);
    
    console.log(`[TopGG] Vote processed for ${username} (${userId}): +${reward} Stark Bucks (streak: ${newStreak})`);
    
    return {
        reward,
        streak: newStreak,
        isWeekend: isWeekend(),
        totalVotes: newVoteData.totalVotes,
        isTest
    };
}

/**
 * Schedule a vote reminder
 */
function scheduleReminder(userId) {
    // Cancel existing reminder
    if (pendingReminders.has(userId)) {
        clearTimeout(pendingReminders.get(userId));
    }
    
    // Schedule new reminder
    const timeout = setTimeout(async () => {
        pendingReminders.delete(userId);
        // The actual reminder sending would be handled by the bot
        // We just mark that they can vote again
        console.log(`[TopGG] Vote reminder ready for user ${userId}`);
    }, VOTE_CONFIG.reminderDelayMs);
    
    pendingReminders.set(userId, timeout);
}

/**
 * Create Express middleware for top.gg webhook
 */
function createWebhookMiddleware() {
    const authorization = process.env.TOPGG_WEBHOOK_AUTH || process.env.TOPGG_TOKEN;
    
    return async (req, res) => {
        // Verify authorization
        const providedAuth = req.headers.authorization;
        if (authorization && providedAuth !== authorization) {
            console.warn('[TopGG] Webhook received with invalid authorization');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { user, type, isWeekend: topggWeekend, query } = req.body;
        
        if (!user) {
            return res.status(400).json({ error: 'Missing user ID' });
        }
        
        console.log(`[TopGG] Webhook received: type=${type}, user=${user}, weekend=${topggWeekend}`);
        
        // Process the vote
        if (type === 'upvote' || type === 'test') {
            try {
                const result = await processVote(user, 'Voter', type === 'test');
                
                // Try to DM the user
                try {
                    const client = global.discordClient;
                    if (client) {
                        const discordUser = await client.users.fetch(user);
                        const { EmbedBuilder } = require('discord.js');
                        
                        const embed = new EmbedBuilder()
                            .setTitle('🎉 Thanks for Voting!')
                            .setDescription(`You received **${result.reward}** Stark Bucks!`)
                            .setColor(0x2ecc71)
                            .addFields(
                                { name: '🔥 Vote Streak', value: `${result.streak} votes`, inline: true },
                                { name: '📊 Total Votes', value: `${result.totalVotes}`, inline: true },
                                { name: '⚡ Boost Active', value: '25% bonus for 12 hours!', inline: true }
                            );
                        
                        if (result.isWeekend) {
                            embed.addFields({ name: '🎊 Weekend Bonus', value: '2x rewards!', inline: false });
                        }
                        
                        embed.setFooter({ text: 'Vote again in 12 hours for more rewards!' });
                        
                        await discordUser.send({ embeds: [embed] });
                    }
                } catch (dmError) {
                    console.log(`[TopGG] Could not DM user ${user}:`, dmError.message);
                }
                
                res.status(200).json({ success: true, reward: result.reward });
            } catch (error) {
                console.error('[TopGG] Error processing vote:', error);
                res.status(500).json({ error: 'Failed to process vote' });
            }
        } else {
            res.status(200).json({ success: true, type });
        }
    };
}

/**
 * Get vote status for display
 */
async function getVoteStatus(userId) {
    const voteData = await getVoteData(userId);
    const canVoteNow = await canVote(userId);
    const hasBoost = await hasVotingBoost(userId);
    
    return {
        canVote: canVoteNow.canVote,
        timeRemaining: canVoteNow.timeRemaining,
        streak: voteData.streak,
        totalVotes: voteData.totalVotes || 0,
        hasBoost,
        boostMultiplier: hasBoost ? VOTE_CONFIG.boostMultiplier : 1.0,
        voteUrl: getVoteUrl(),
        rewards: {
            base: VOTE_CONFIG.baseReward,
            streakBonus: voteData.streak * VOTE_CONFIG.streakBonus,
            weekendMultiplier: isWeekend() ? VOTE_CONFIG.weekendMultiplier : 1,
            estimated: calculateEstimatedReward(voteData.streak)
        }
    };
}

/**
 * Calculate estimated reward for next vote
 */
function calculateEstimatedReward(currentStreak) {
    let reward = VOTE_CONFIG.baseReward;
    if (isWeekend()) reward *= VOTE_CONFIG.weekendMultiplier;
    reward += Math.min(currentStreak, VOTE_CONFIG.maxStreak - 1) * VOTE_CONFIG.streakBonus;
    return reward;
}

module.exports = {
    VOTE_CONFIG,
    getVoteUrl,
    canVote,
    hasVotingBoost,
    getVoteBoostMultiplier,
    processVote,
    getVoteStatus,
    createWebhookMiddleware,
    isWeekend
};
