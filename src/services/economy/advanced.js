'use strict';

/**
 * Economy Advanced Features - daily challenges, prestige, bosses, lottery, quests, tournaments, SBX
 * Factory module: receives dependencies from stark-economy.js
 */

const DAILY_CHALLENGES = [
    { id: 'work_5', name: 'Hard Worker', task: 'Work 5 times', target: 5, reward: 500 },
    { id: 'gamble_3', name: 'Risk Taker', task: 'Gamble 3 times', target: 3, reward: 300 },
    { id: 'hunt_3', name: 'Hunter', task: 'Hunt 3 times', target: 3, reward: 400 },
    { id: 'fish_3', name: 'Fisherman', task: 'Fish 3 times', target: 3, reward: 400 },
    { id: 'dig_3', name: 'Treasure Hunter', task: 'Dig 3 times', target: 3, reward: 400 },
    { id: 'win_gamble', name: 'Lucky', task: 'Win a gamble', target: 1, reward: 600 },
    { id: 'earn_1000', name: 'Money Maker', task: 'Earn 1000 Stark Bucks', target: 1000, reward: 800 },
    { id: 'craft_item', name: 'Crafter', task: 'Craft an item', target: 1, reward: 700 }
];

const QUESTS = [
    { id: 'iron_collector', name: 'Iron Collector', shortDesc: 'Collect iron materials', description: 'Tony needs scrap metal for a new suit.', difficulty: 'Easy', objectives: ['Dig 5 times', 'Collect 3 Iron Ore'], reward: 1000, xp: 50 },
    { id: 'sea_hunter', name: 'Sea Hunter', shortDesc: 'Master the seas', description: 'Prove yourself as a fisherman.', difficulty: 'Easy', objectives: ['Fish 10 times', 'Catch a rare fish'], reward: 1500, xp: 75 },
    { id: 'risk_taker', name: 'Risk Taker', shortDesc: 'Test your luck', description: 'Gamble your way to glory.', difficulty: 'Medium', objectives: ['Win 5 gambles', 'Win 1000 total'], reward: 3000, xp: 150 },
    { id: 'master_crafter', name: 'Master Crafter', shortDesc: 'Craft MCU items', description: 'Create legendary Stark tech.', difficulty: 'Hard', objectives: ['Craft 5 items', 'Craft a rare+ item'], reward: 5000, xp: 250 },
    { id: 'stark_employee', name: 'Stark Employee', shortDesc: 'Work at Stark Industries', description: 'Prove your worth to Tony.', difficulty: 'Easy', objectives: ['Work 10 times', 'Earn 500 from work'], reward: 1200, xp: 60 }
];

const BOSSES = [
    { name: 'Ultron Prime', description: 'The rogue AI returns!', maxHp: 50000, rewardPool: 25000 },
    { name: 'Thanos', description: 'The Mad Titan seeks the stones.', maxHp: 100000, rewardPool: 50000 },
    { name: 'Dormammu', description: 'The Dark Dimension threatens reality.', maxHp: 75000, rewardPool: 35000 },
    { name: 'Galactus', description: 'The Devourer of Worlds approaches!', maxHp: 150000, rewardPool: 75000 }
];

module.exports = function createAdvanced({
    loadUser,
    saveUser,
    modifyBalance,
    checkCooldown,
    getStarkbucks,
    ECONOMY_CONFIG
}) {
    // In-memory storage for boss/tournament/lottery
    const activeBosses = new Map();
    const activeTournaments = new Map();
    let lotteryData = {
        jackpot: 10000,
        ticketPrice: 100,
        tickets: new Map(),
        lastWinner: null,
        drawTime: Date.now() + 7 * 24 * 60 * 60 * 1000
    };

    // ─── Daily Challenges ────────────────────────────────────────────────────

    async function getDailyChallenges(userId) {
        const user = await loadUser(userId);
        const today = new Date().toDateString();

        if (user.challengeDate !== today) {
            const shuffled = [...DAILY_CHALLENGES].sort(() => Math.random() - 0.5);
            user.dailyChallenges = shuffled.slice(0, 3).map(c => ({
                ...c,
                progress: 0,
                completed: false
            }));
            user.challengeDate = today;
            await saveUser(userId, user);
        }

        return user.dailyChallenges || [];
    }

    async function updateChallengeProgress(userId, challengeType, amount = 1) {
        const user = await loadUser(userId);
        if (!user.dailyChallenges) return;

        for (const challenge of user.dailyChallenges) {
            if (challenge.id.startsWith(challengeType) && !challenge.completed) {
                challenge.progress += amount;
                if (challenge.progress >= challenge.target) {
                    challenge.completed = true;
                    user.balance += challenge.reward;
                    user.totalEarned = (user.totalEarned || 0) + challenge.reward;
                }
            }
        }
        await saveUser(userId, user);
    }

    // ─── Prestige ────────────────────────────────────────────────────────────

    async function getPrestigeData(userId) {
        const user = await loadUser(userId);
        return {
            level: user.prestigeLevel || 0,
            bonus: (user.prestigeLevel || 0) * 5
        };
    }

    async function prestige(userId) {
        const user = await loadUser(userId);
        const newLevel = (user.prestigeLevel || 0) + 1;

        user.prestigeLevel = newLevel;
        user.balance = ECONOMY_CONFIG.startingBalance;
        user.totalEarned = 0;
        user.totalLost = 0;

        await saveUser(userId, user);

        return {
            success: true,
            newLevel,
            bonusPercent: newLevel * 5,
            newBalance: user.balance
        };
    }

    // ─── Boss Battles ────────────────────────────────────────────────────────

    async function getBossData(guildId) {
        if (!activeBosses.has(guildId)) {
            const bossDef = BOSSES[Math.floor(Math.random() * BOSSES.length)];
            activeBosses.set(guildId, {
                ...bossDef,
                hp: bossDef.maxHp,
                attackers: 0,
                damageDealt: new Map(),
                spawnTime: Date.now()
            });
        }

        const boss = activeBosses.get(guildId);
        return {
            name: boss.name,
            description: boss.description,
            hp: boss.hp,
            maxHp: boss.maxHp,
            attackers: boss.attackers,
            rewardPool: boss.rewardPool,
            resetTime: (24 * 60 * 60 * 1000) - (Date.now() - boss.spawnTime)
        };
    }

    async function attackBoss(guildId, userId) {
        const boss = activeBosses.get(guildId);

        if (!boss) {
            return { success: false, error: 'No boss available!' };
        }

        const cooldown = checkCooldown(userId, 'boss_attack', 30000);
        if (cooldown.onCooldown) {
            return { success: false, error: `Wait ${Math.ceil(cooldown.remaining / 1000)}s!` };
        }

        const damage = Math.floor(50 + Math.random() * 200);
        boss.hp -= damage;
        boss.attackers++;

        const userDamage = (boss.damageDealt.get(userId) || 0) + damage;
        boss.damageDealt.set(userId, userDamage);

        const result = {
            success: true,
            damage,
            remainingHp: Math.max(0, boss.hp),
            userTotalDamage: userDamage,
            bossDefeated: boss.hp <= 0
        };

        if (boss.hp <= 0) {
            const totalDamage = Array.from(boss.damageDealt.values()).reduce((a, b) => a + b, 0);
            const userShare = userDamage / totalDamage;
            const reward = Math.floor(boss.rewardPool * userShare);

            await modifyBalance(userId, reward, 'boss_kill');
            result.reward = reward;

            activeBosses.delete(guildId);
        }

        return result;
    }

    // ─── Lottery ─────────────────────────────────────────────────────────────

    async function getLotteryData(userId = null) {
        const timeUntilDraw = lotteryData.drawTime - Date.now();
        const days = Math.floor(timeUntilDraw / (24 * 60 * 60 * 1000));
        const hours = Math.floor((timeUntilDraw % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

        return {
            jackpot: lotteryData.jackpot,
            ticketPrice: lotteryData.ticketPrice,
            totalTickets: Array.from(lotteryData.tickets.values()).reduce((a, b) => a + b, 0),
            userTickets: userId ? (lotteryData.tickets.get(userId) || 0) : 0,
            timeUntilDraw: `${days}d ${hours}h`,
            lastWinner: lotteryData.lastWinner
        };
    }

    async function buyLotteryTickets(userId, count) {
        const cost = count * lotteryData.ticketPrice;
        const user = await loadUser(userId);

        if (user.balance < cost) {
            return { success: false, error: 'Insufficient funds!' };
        }

        user.balance -= cost;
        await saveUser(userId, user);

        const currentTickets = lotteryData.tickets.get(userId) || 0;
        lotteryData.tickets.set(userId, currentTickets + count);
        lotteryData.jackpot += cost;

        return {
            success: true,
            cost,
            userTickets: currentTickets + count,
            jackpot: lotteryData.jackpot
        };
    }

    // ─── Quests ──────────────────────────────────────────────────────────────

    async function getQuestData(userId) {
        const user = await loadUser(userId);
        return {
            activeQuest: user.activeQuest || null,
            completedQuests: user.completedQuests || []
        };
    }

    async function getAvailableQuests() {
        return QUESTS;
    }

    async function startQuest(userId, questId) {
        const user = await loadUser(userId);

        if (user.activeQuest) {
            return { success: false, error: 'You already have an active quest! Complete it first.' };
        }

        const quest = QUESTS.find(q => q.id === questId) || QUESTS[Math.floor(Math.random() * QUESTS.length)];

        user.activeQuest = {
            ...quest,
            progress: new Array(quest.objectives.length).fill(false),
            startedAt: Date.now()
        };

        await saveUser(userId, user);

        return { success: true, quest: user.activeQuest };
    }

    async function completeQuest(userId) {
        const user = await loadUser(userId);

        if (!user.activeQuest) {
            return { success: false, error: 'No active quest!' };
        }

        const quest = user.activeQuest;

        user.balance += quest.reward;
        user.totalEarned = (user.totalEarned || 0) + quest.reward;
        user.completedQuests = user.completedQuests || [];
        user.completedQuests.push(quest.id);
        user.activeQuest = null;

        await saveUser(userId, user);

        return { success: true, quest, reward: quest.reward, xp: quest.xp };
    }

    // ─── Tournaments ─────────────────────────────────────────────────────────

    async function getTournamentData(guildId) {
        if (!activeTournaments.has(guildId)) {
            const types = ['Fishing', 'Hunting', 'Gambling', 'Mining'];
            activeTournaments.set(guildId, {
                type: types[Math.floor(Math.random() * types.length)],
                description: 'Compete for the highest score!',
                participants: 0,
                prizePool: 10000,
                leaderboard: [],
                endsIn: '2h',
                endTime: Date.now() + 2 * 60 * 60 * 1000
            });
        }

        return activeTournaments.get(guildId);
    }

    async function joinTournament(guildId, userId) {
        const tournament = activeTournaments.get(guildId);

        if (!tournament) {
            return { success: false, error: 'No active tournament!' };
        }

        if (tournament.leaderboard.some(p => p.id === userId)) {
            return { success: false, error: 'Already in tournament!' };
        }

        tournament.participants++;
        tournament.leaderboard.push({ id: userId, score: 0 });

        return { success: true };
    }

    // ─── SBX Wrappers ───────────────────────────────────────────────────────

    async function investSBX(userId, amount) {
        const sbx = getStarkbucks();
        if (!sbx) return { success: false, error: 'SBX System offline' };
        return sbx.investSBX(userId, amount);
    }

    async function withdrawInvestment(userId, amount) {
        const sbx = getStarkbucks();
        if (!sbx) return { success: false, error: 'SBX System offline' };
        return sbx.withdrawInvestment(userId, amount);
    }

    async function getSBXMarketData() {
        const sbx = getStarkbucks();
        if (!sbx) return null;
        return sbx.getMarketData();
    }

    async function buySBX(userId, amount) {
        const sbx = getStarkbucks();
        if (!sbx) return { success: false, error: 'SBX System offline' };

        const price = sbx.getCurrentPrice();
        const cost = Math.floor(amount * 100 * price * 1.02);
        if (!cost || cost <= 0) return { success: false, error: 'Price error' };

        const user = await loadUser(userId);
        if (user.balance < cost) return { success: false, error: `Insufficient Stark Bucks. Need ${cost}, have ${user.balance}` };

        user.balance -= cost;
        await saveUser(userId, user);

        await sbx.updateWallet(userId, amount, 'Bought with Stark Bucks');

        return { success: true, cost, amount, newBalance: user.balance };
    }

    async function sellSBX(userId, amount) {
        const sbx = getStarkbucks();
        if (!sbx) return { success: false, error: 'SBX System offline' };

        const wallet = await sbx.getWallet(userId);
        if (wallet.balance < amount) return { success: false, error: `Insufficient SBX. Have ${wallet.balance}` };

        const result = await sbx.convertToStarkBucks(userId, amount);
        if (!result.success) return { success: false, error: result.error || 'Conversion failed' };

        const user = await loadUser(userId);

        return { success: true, earnings: result.starkBucksReceived, amount, newBalance: user.balance };
    }

    async function getSBXBalance(userId) {
        const sbx = getStarkbucks();
        if (!sbx) return 0;
        const w = await sbx.getWallet(userId);
        return w.balance;
    }

    return {
        getDailyChallenges, updateChallengeProgress,
        getPrestigeData, prestige,
        getBossData, attackBoss,
        getLotteryData, buyLotteryTickets,
        getQuestData, getAvailableQuests, startQuest, completeQuest,
        getTournamentData, joinTournament,
        investSBX, withdrawInvestment, getSBXMarketData, buySBX, sellSBX, getSBXBalance
    };
};
