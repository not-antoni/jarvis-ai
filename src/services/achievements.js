/**
 * Achievements System for JARVIS Discord Bot
 * Tracks user achievements with MongoDB or local file storage
 */

const fs = require('fs');
const path = require('path');

// Achievement definitions with unlock logic
const ACHIEVEMENTS = {
    // ============ GETTING STARTED (50) ============
    first_message: {
        name: 'First Words',
        description: 'Send your first message',
        emoji: '💬',
        points: 5,
        category: 'Getting Started'
    },
    first_command: {
        name: 'Command Novice',
        description: 'Use your first slash command',
        emoji: '⌨️',
        points: 5,
        category: 'Getting Started'
    },
    first_rapbattle: {
        name: 'Rookie Rapper',
        description: 'Start your first rap battle',
        emoji: '🎤',
        points: 10,
        category: 'Getting Started'
    },
    first_roast: {
        name: 'Burned',
        description: 'Get roasted for the first time',
        emoji: '🔥',
        points: 5,
        category: 'Getting Started'
    },
    first_compliment: {
        name: 'Blessed',
        description: 'Receive a blessing instead of roast',
        emoji: '😇',
        points: 10,
        category: 'Getting Started'
    },
    first_vibe_check: {
        name: 'Vibes Checked',
        description: 'Get your vibes checked',
        emoji: '✨',
        points: 5,
        category: 'Getting Started'
    },
    first_wiki: {
        name: 'Wikipedia Star',
        description: 'Get a fake Wikipedia article',
        emoji: '📚',
        points: 5,
        category: 'Getting Started'
    },
    first_prophecy: {
        name: 'Fortune Told',
        description: 'Receive your first prophecy',
        emoji: '🔮',
        points: 5,
        category: 'Getting Started'
    },
    first_trial: {
        name: 'Court Appearance',
        description: 'Be put on trial',
        emoji: '⚖️',
        points: 5,
        category: 'Getting Started'
    },
    first_fight: {
        name: 'Fighter',
        description: 'Start your first fight',
        emoji: '👊',
        points: 5,
        category: 'Getting Started'
    },

    // ============ RAP BATTLE (50) ============
    rap_win: {
        name: 'Rap Winner',
        description: 'Win a rap battle',
        emoji: '🏆',
        points: 25,
        category: 'Rap Battle'
    },
    rap_5_wins: {
        name: 'Rap Master',
        description: 'Win 5 rap battles',
        emoji: '🎤',
        points: 50,
        category: 'Rap Battle'
    },
    rap_10_wins: {
        name: 'Rap Legend',
        description: 'Win 10 rap battles',
        emoji: '👑',
        points: 100,
        category: 'Rap Battle'
    },
    rap_25_wins: {
        name: 'Rap God',
        description: 'Win 25 rap battles',
        emoji: '🐐',
        points: 250,
        category: 'Rap Battle'
    },
    rap_survive_thunder: {
        name: 'Thunder Survivor',
        description: 'Survive thunder mode',
        emoji: '⚡',
        points: 50,
        category: 'Rap Battle'
    },
    rap_perfect_round: {
        name: 'Perfect Flow',
        description: 'Get a perfect score in a round',
        emoji: '💯',
        points: 75,
        category: 'Rap Battle'
    },
    rap_comeback: {
        name: 'Comeback King',
        description: 'Win after being behind',
        emoji: '🔄',
        points: 50,
        category: 'Rap Battle'
    },
    rap_speed_demon: {
        name: 'Speed Demon',
        description: 'Reply in under 2 seconds',
        emoji: '⚡',
        points: 30,
        category: 'Rap Battle'
    },
    rap_marathon: {
        name: 'Rap Marathon',
        description: 'Complete a full 2-minute battle',
        emoji: '🏃',
        points: 25,
        category: 'Rap Battle'
    },
    rap_lose_gracefully: {
        name: 'Good Sport',
        description: 'Lose a rap battle gracefully',
        emoji: '🤝',
        points: 10,
        category: 'Rap Battle'
    },

    // ============ ECONOMY (50) ============
    first_daily: {
        name: 'Daily Dose',
        description: 'Claim your first daily',
        emoji: '📅',
        points: 5,
        category: 'Economy'
    },
    streak_7: {
        name: 'Week Warrior',
        description: 'Maintain a 7-day streak',
        emoji: '🔥',
        points: 50,
        category: 'Economy'
    },
    streak_30: {
        name: 'Month Master',
        description: 'Maintain a 30-day streak',
        emoji: '📆',
        points: 200,
        category: 'Economy'
    },
    streak_100: {
        name: 'Century Club',
        description: 'Maintain a 100-day streak',
        emoji: '💯',
        points: 500,
        category: 'Economy'
    },
    earn_1000: {
        name: 'Thousandaire',
        description: 'Earn 1,000 Stark Bucks total',
        emoji: '💰',
        points: 25,
        category: 'Economy'
    },
    earn_10000: {
        name: 'Big Spender',
        description: 'Earn 10,000 Stark Bucks total',
        emoji: '💎',
        points: 100,
        category: 'Economy'
    },
    earn_100000: {
        name: 'Stark Rich',
        description: 'Earn 100,000 Stark Bucks total',
        emoji: '🏦',
        points: 500,
        category: 'Economy'
    },
    gamble_win: {
        name: 'Lucky Roll',
        description: 'Win a gamble',
        emoji: '🎰',
        points: 10,
        category: 'Economy'
    },
    gamble_5_streak: {
        name: 'Hot Streak',
        description: 'Win 5 gambles in a row',
        emoji: '🔥',
        points: 100,
        category: 'Economy'
    },
    gamble_lose_1000: {
        name: 'Risk Taker',
        description: 'Lose 1,000 in one gamble',
        emoji: '💸',
        points: 50,
        category: 'Economy'
    },
    slots_jackpot: {
        name: 'Jackpot!',
        description: 'Hit the slots jackpot',
        emoji: '🎰',
        points: 200,
        category: 'Economy'
    },
    buy_first_item: {
        name: 'First Purchase',
        description: 'Buy your first shop item',
        emoji: '🛒',
        points: 10,
        category: 'Economy'
    },
    buy_arc_reactor: {
        name: 'Arc Reactor Owner',
        description: 'Buy the Arc Reactor',
        emoji: '💠',
        points: 500,
        category: 'Economy'
    },

    // ============ SOCIAL (50) ============
    ship_100: {
        name: 'Perfect Match',
        description: 'Get 100% ship compatibility',
        emoji: '💕',
        points: 50,
        category: 'Social'
    },
    ship_0: {
        name: 'Not Meant To Be',
        description: 'Get 0% ship compatibility',
        emoji: '💔',
        points: 25,
        category: 'Social'
    },
    hug_10: {
        name: 'Hugger',
        description: 'Give 10 hugs',
        emoji: '🤗',
        points: 20,
        category: 'Social'
    },
    slap_10: {
        name: 'Slapper',
        description: 'Slap 10 people',
        emoji: '👋',
        points: 20,
        category: 'Social'
    },
    fight_win: {
        name: 'Victor',
        description: 'Win a fight',
        emoji: '🏆',
        points: 15,
        category: 'Social'
    },
    fight_10_wins: {
        name: 'Champion',
        description: 'Win 10 fights',
        emoji: '🥊',
        points: 75,
        category: 'Social'
    },
    trial_innocent: {
        name: 'Acquitted',
        description: 'Be found innocent',
        emoji: '✅',
        points: 15,
        category: 'Social'
    },
    trial_guilty_5: {
        name: 'Repeat Offender',
        description: 'Be found guilty 5 times',
        emoji: '⚖️',
        points: 30,
        category: 'Social'
    },
    howgay_100: {
        name: 'Full Rainbow',
        description: 'Get 100% on howgay',
        emoji: '🏳️‍🌈',
        points: 25,
        category: 'Social'
    },
    howbased_100: {
        name: 'Maximum Based',
        description: 'Get 100% on howbased',
        emoji: '🗿',
        points: 25,
        category: 'Social'
    },

    // ============ FUN COMMANDS (50) ============
    dadjoke_10: {
        name: 'Dad Mode',
        description: 'Request 10 dad jokes',
        emoji: '👨',
        points: 20,
        category: 'Fun'
    },
    pickupline_10: {
        name: 'Smooth Talker',
        description: 'Request 10 pickup lines',
        emoji: '💋',
        points: 20,
        category: 'Fun'
    },
    '8ball_10': {
        name: 'Fortune Seeker',
        description: 'Ask the 8-ball 10 times',
        emoji: '🎱',
        points: 20,
        category: 'Fun'
    },
    roll_nat20: {
        name: 'Natural 20!',
        description: 'Roll a natural 20',
        emoji: '🎲',
        points: 50,
        category: 'Fun'
    },
    roll_nat1: {
        name: 'Critical Fail',
        description: 'Roll a natural 1',
        emoji: '💀',
        points: 25,
        category: 'Fun'
    },
    typerace_win: {
        name: 'Speed Typer',
        description: 'Win a typerace',
        emoji: '⌨️',
        points: 30,
        category: 'Fun'
    },
    typerace_10: {
        name: 'Keyboard Warrior',
        description: 'Win 10 typeraces',
        emoji: '🏆',
        points: 100,
        category: 'Fun'
    },
    wyr_50: {
        name: 'Decision Maker',
        description: 'Answer 50 Would You Rather',
        emoji: '🤔',
        points: 50,
        category: 'Fun'
    },
    conspiracy_10: {
        name: 'Conspiracy Theorist',
        description: 'Generate 10 conspiracies',
        emoji: '🕵️',
        points: 20,
        category: 'Fun'
    },
    fakequote_10: {
        name: 'Quotable',
        description: 'Generate 10 fake quotes',
        emoji: '📜',
        points: 20,
        category: 'Fun'
    },

    // ============ ACTIVITY (50) ============
    messages_100: {
        name: 'Chatterbox',
        description: 'Send 100 messages',
        emoji: '💬',
        points: 25,
        category: 'Activity'
    },
    messages_1000: {
        name: 'Talkative',
        description: 'Send 1,000 messages',
        emoji: '📢',
        points: 100,
        category: 'Activity'
    },
    messages_10000: {
        name: 'Motor Mouth',
        description: 'Send 10,000 messages',
        emoji: '🗣️',
        points: 500,
        category: 'Activity'
    },
    commands_50: {
        name: 'Power User',
        description: 'Use 50 commands',
        emoji: '⚡',
        points: 50,
        category: 'Activity'
    },
    commands_500: {
        name: 'Command Master',
        description: 'Use 500 commands',
        emoji: '🎮',
        points: 250,
        category: 'Activity'
    },
    night_owl: {
        name: 'Night Owl',
        description: 'Be active between 2-5 AM',
        emoji: '🦉',
        points: 25,
        category: 'Activity'
    },
    early_bird: {
        name: 'Early Bird',
        description: 'Be active between 5-7 AM',
        emoji: '🐦',
        points: 25,
        category: 'Activity'
    },
    weekend_warrior: {
        name: 'Weekend Warrior',
        description: 'Be active every weekend for a month',
        emoji: '🎉',
        points: 75,
        category: 'Activity'
    },
    active_30_days: {
        name: 'Dedicated',
        description: 'Be active 30 days in a row',
        emoji: '📅',
        points: 200,
        category: 'Activity'
    },
    veteran: {
        name: 'Veteran',
        description: 'Be a member for 1 year',
        emoji: '🎖️',
        points: 500,
        category: 'Activity'
    },

    // ============ SPECIAL (50) ============
    jarvis_birthday: {
        name: 'Birthday Party',
        description: 'Be active on JARVIS birthday',
        emoji: '🎂',
        points: 100,
        category: 'Special'
    },
    new_years: {
        name: 'New Year!',
        description: 'Be active on New Years',
        emoji: '🎆',
        points: 50,
        category: 'Special'
    },
    halloween: {
        name: 'Spooky',
        description: 'Be active on Halloween',
        emoji: '🎃',
        points: 50,
        category: 'Special'
    },
    christmas: {
        name: 'Holiday Spirit',
        description: 'Be active on Christmas',
        emoji: '🎄',
        points: 50,
        category: 'Special'
    },
    april_fools: {
        name: 'Fooled',
        description: 'Be active on April Fools',
        emoji: '🃏',
        points: 50,
        category: 'Special'
    },
    secret_command: {
        name: 'Secret Finder',
        description: 'Find a secret command',
        emoji: '🔍',
        points: 100,
        category: 'Special'
    },
    easter_egg: {
        name: 'Easter Egg Hunter',
        description: 'Find an easter egg',
        emoji: '🥚',
        points: 150,
        category: 'Special'
    },
    bug_reporter: {
        name: 'Bug Hunter',
        description: 'Report a bug that gets fixed',
        emoji: '🐛',
        points: 200,
        category: 'Special'
    },
    suggestion_accepted: {
        name: 'Visionary',
        description: 'Have a suggestion implemented',
        emoji: '💡',
        points: 300,
        category: 'Special'
    },
    og_member: {
        name: 'OG',
        description: 'Be one of the first 100 users',
        emoji: '👴',
        points: 500,
        category: 'Special'
    },

    // ============ MILESTONES (50) ============
    achievement_10: {
        name: 'Collector',
        description: 'Unlock 10 achievements',
        emoji: '🏅',
        points: 50,
        category: 'Milestones'
    },
    achievement_25: {
        name: 'Achiever',
        description: 'Unlock 25 achievements',
        emoji: '🥈',
        points: 100,
        category: 'Milestones'
    },
    achievement_50: {
        name: 'Completionist',
        description: 'Unlock 50 achievements',
        emoji: '🥇',
        points: 250,
        category: 'Milestones'
    },
    achievement_100: {
        name: 'Master Achiever',
        description: 'Unlock 100 achievements',
        emoji: '🏆',
        points: 500,
        category: 'Milestones'
    },
    points_500: {
        name: 'Half K',
        description: 'Earn 500 achievement points',
        emoji: '⭐',
        points: 25,
        category: 'Milestones'
    },
    points_1000: {
        name: 'Thousand Points',
        description: 'Earn 1,000 achievement points',
        emoji: '🌟',
        points: 50,
        category: 'Milestones'
    },
    points_5000: {
        name: 'Five Thousand',
        description: 'Earn 5,000 achievement points',
        emoji: '💫',
        points: 100,
        category: 'Milestones'
    },
    all_categories: {
        name: 'Well Rounded',
        description: 'Get at least 1 achievement in each category',
        emoji: '🎯',
        points: 200,
        category: 'Milestones'
    },
    speedrunner: {
        name: 'Speedrunner',
        description: 'Unlock 10 achievements in one day',
        emoji: '⏱️',
        points: 150,
        category: 'Milestones'
    },
    perfectionist: {
        name: 'Perfectionist',
        description: 'Unlock all achievements in a category',
        emoji: '💎',
        points: 500,
        category: 'Milestones'
    }
};

class AchievementsSystem {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data');
        this.achievementsFile = path.join(this.dataDir, 'achievements.json');
        this.userStats = new Map();
        this.db = null;
        this.isMongoMode = false;

        this.ensureDataDir();
        this.loadLocalData();
    }

    setDatabase(db) {
        this.db = db;
        this.isMongoMode = !!db;
    }

    ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    loadLocalData() {
        try {
            if (fs.existsSync(this.achievementsFile)) {
                const data = JSON.parse(fs.readFileSync(this.achievementsFile, 'utf8'));
                this.userStats = new Map(Object.entries(data));
            }
        } catch (error) {
            console.error('Error loading achievements data:', error);
        }
    }

    saveLocalData() {
        try {
            const data = Object.fromEntries(this.userStats);
            fs.writeFileSync(this.achievementsFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving achievements data:', error);
        }
    }

    async getUserData(userId) {
        if (this.isMongoMode && this.db) {
            try {
                const collection = this.db.collection('achievements');
                let userData = await collection.findOne({ userId: userId });
                if (!userData) {
                    userData = this.getDefaultUserData(userId);
                    await collection.insertOne(userData);
                }
                return userData;
            } catch (error) {
                console.error('MongoDB error, falling back to local:', error);
            }
        }

        if (!this.userStats.has(userId)) {
            this.userStats.set(userId, this.getDefaultUserData(userId));
            this.saveLocalData();
        }
        return this.userStats.get(userId);
    }

    getDefaultUserData(userId) {
        return {
            userId: userId,
            unlockedAchievements: [],
            stats: {
                messages: 0,
                commands: 0,
                rapBattles: { total: 0, wins: 0, thunderSurvived: 0 },
                economy: { totalEarned: 0, dailyStreak: 0, gambleWins: 0, gambleLosses: 0 },
                social: { hugs: 0, slaps: 0, fightWins: 0, shipChecks: 0 },
                fun: { dadJokes: 0, pickupLines: 0, eightBall: 0, typeraceWins: 0, rolls: [] },
                trials: { guilty: 0, innocent: 0 },
                firstActive: Date.now(),
                lastActive: Date.now()
            },
            totalPoints: 0
        };
    }

    async saveUserData(userId, userData) {
        if (this.isMongoMode && this.db) {
            try {
                const collection = this.db.collection('achievements');
                await collection.updateOne(
                    { userId: userId },
                    { $set: userData },
                    { upsert: true }
                );
            } catch (error) {
                console.error('MongoDB save error:', error);
            }
        }

        this.userStats.set(userId, userData);
        this.saveLocalData();
    }

    async unlock(userId, achievementId) {
        const achievement = ACHIEVEMENTS[achievementId];
        if (!achievement) return null;

        const userData = await this.getUserData(userId);

        if (userData.unlockedAchievements.includes(achievementId)) {
            return null; // Already unlocked
        }

        userData.unlockedAchievements.push(achievementId);
        userData.totalPoints += achievement.points;

        await this.saveUserData(userId, userData);

        // Check for meta achievements
        await this.checkMetaAchievements(userId, userData);

        return {
            id: achievementId,
            ...achievement,
            totalPoints: userData.totalPoints,
            totalUnlocked: userData.unlockedAchievements.length
        };
    }

    async checkMetaAchievements(userId, userData) {
        const count = userData.unlockedAchievements.length;

        if (count >= 10 && !userData.unlockedAchievements.includes('achievement_10')) {
            await this.unlock(userId, 'achievement_10');
        }
        if (count >= 25 && !userData.unlockedAchievements.includes('achievement_25')) {
            await this.unlock(userId, 'achievement_25');
        }
        if (count >= 50 && !userData.unlockedAchievements.includes('achievement_50')) {
            await this.unlock(userId, 'achievement_50');
        }
        if (count >= 100 && !userData.unlockedAchievements.includes('achievement_100')) {
            await this.unlock(userId, 'achievement_100');
        }
    }

    async incrementStat(userId, statPath, amount = 1) {
        const userData = await this.getUserData(userId);
        const paths = statPath.split('.');
        let current = userData.stats;

        for (let i = 0; i < paths.length - 1; i++) {
            current = current[paths[i]];
        }

        const lastKey = paths[paths.length - 1];
        current[lastKey] = (current[lastKey] || 0) + amount;
        userData.stats.lastActive = Date.now();

        await this.saveUserData(userId, userData);

        // Check for stat-based achievements
        return await this.checkStatAchievements(userId, userData);
    }

    async checkStatAchievements(userId, userData) {
        const unlocked = [];
        const stats = userData.stats;

        // Message achievements
        if (stats.messages >= 100) unlocked.push(await this.unlock(userId, 'messages_100'));
        if (stats.messages >= 1000) unlocked.push(await this.unlock(userId, 'messages_1000'));
        if (stats.messages >= 10000) unlocked.push(await this.unlock(userId, 'messages_10000'));

        // Command achievements
        if (stats.commands >= 50) unlocked.push(await this.unlock(userId, 'commands_50'));
        if (stats.commands >= 500) unlocked.push(await this.unlock(userId, 'commands_500'));

        // Economy achievements
        if (stats.economy.totalEarned >= 1000)
            unlocked.push(await this.unlock(userId, 'earn_1000'));
        if (stats.economy.totalEarned >= 10000)
            unlocked.push(await this.unlock(userId, 'earn_10000'));
        if (stats.economy.totalEarned >= 100000)
            unlocked.push(await this.unlock(userId, 'earn_100000'));
        if (stats.economy.dailyStreak >= 7) unlocked.push(await this.unlock(userId, 'streak_7'));
        if (stats.economy.dailyStreak >= 30) unlocked.push(await this.unlock(userId, 'streak_30'));
        if (stats.economy.dailyStreak >= 100)
            unlocked.push(await this.unlock(userId, 'streak_100'));

        // Rap battle achievements
        if (stats.rapBattles.wins >= 1) unlocked.push(await this.unlock(userId, 'rap_win'));
        if (stats.rapBattles.wins >= 5) unlocked.push(await this.unlock(userId, 'rap_5_wins'));
        if (stats.rapBattles.wins >= 10) unlocked.push(await this.unlock(userId, 'rap_10_wins'));
        if (stats.rapBattles.wins >= 25) unlocked.push(await this.unlock(userId, 'rap_25_wins'));

        // Social achievements
        if (stats.social.hugs >= 10) unlocked.push(await this.unlock(userId, 'hug_10'));
        if (stats.social.slaps >= 10) unlocked.push(await this.unlock(userId, 'slap_10'));
        if (stats.social.fightWins >= 1) unlocked.push(await this.unlock(userId, 'fight_win'));
        if (stats.social.fightWins >= 10) unlocked.push(await this.unlock(userId, 'fight_10_wins'));

        // Fun achievements
        if (stats.fun.dadJokes >= 10) unlocked.push(await this.unlock(userId, 'dadjoke_10'));
        if (stats.fun.pickupLines >= 10) unlocked.push(await this.unlock(userId, 'pickupline_10'));
        if (stats.fun.eightBall >= 10) unlocked.push(await this.unlock(userId, '8ball_10'));
        if (stats.fun.typeraceWins >= 1) unlocked.push(await this.unlock(userId, 'typerace_win'));
        if (stats.fun.typeraceWins >= 10) unlocked.push(await this.unlock(userId, 'typerace_10'));

        // Trial achievements
        if (stats.trials.innocent >= 1) unlocked.push(await this.unlock(userId, 'trial_innocent'));
        if (stats.trials.guilty >= 5) unlocked.push(await this.unlock(userId, 'trial_guilty_5'));

        return unlocked.filter(a => a !== null);
    }

    async getProfile(userId) {
        const userData = await this.getUserData(userId);
        const unlockedCount = userData.unlockedAchievements.length;
        const totalCount = Object.keys(ACHIEVEMENTS).length;
        const percentage = Math.round((unlockedCount / totalCount) * 100);

        // Get recent achievements
        const recent = userData.unlockedAchievements.slice(-5).map(id => ({
            id,
            ...ACHIEVEMENTS[id]
        }));

        // Get achievement counts by category
        const categories = {};
        for (const [id, achievement] of Object.entries(ACHIEVEMENTS)) {
            if (!categories[achievement.category]) {
                categories[achievement.category] = { total: 0, unlocked: 0 };
            }
            categories[achievement.category].total++;
            if (userData.unlockedAchievements.includes(id)) {
                categories[achievement.category].unlocked++;
            }
        }

        return {
            totalPoints: userData.totalPoints,
            unlockedCount,
            totalCount,
            percentage,
            recent,
            categories,
            stats: userData.stats
        };
    }

    getAchievementsByCategory(category, userData) {
        return Object.entries(ACHIEVEMENTS)
            .filter(([id, a]) => a.category === category)
            .map(([id, a]) => ({
                id,
                ...a,
                unlocked: userData.unlockedAchievements.includes(id)
            }));
    }

    getAllCategories() {
        const categories = new Set();
        for (const achievement of Object.values(ACHIEVEMENTS)) {
            categories.add(achievement.category);
        }
        return Array.from(categories);
    }
}

module.exports = {
    AchievementsSystem,
    ACHIEVEMENTS
};
