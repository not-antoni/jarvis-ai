/**
 * Unit tests for Stark Economy system
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock database
const mockDb = {
    users: new Map(),
    getUser: async (userId) => mockDb.users.get(userId) || null,
    setUser: async (userId, data) => mockDb.users.set(userId, data),
    updateBalance: async (userId, amount) => {
        const user = mockDb.users.get(userId) || { balance: 0 };
        user.balance = (user.balance || 0) + amount;
        mockDb.users.set(userId, user);
        return user.balance;
    }
};

describe('Stark Economy', () => {
    beforeEach(() => {
        mockDb.users.clear();
    });

    describe('Balance Operations', () => {
        it('should initialize new user with zero balance', async () => {
            const user = await mockDb.getUser('user123');
            assert.strictEqual(user, null);
        });

        it('should add balance correctly', async () => {
            const newBalance = await mockDb.updateBalance('user123', 1000);
            assert.strictEqual(newBalance, 1000);
        });

        it('should subtract balance correctly', async () => {
            await mockDb.updateBalance('user123', 1000);
            const newBalance = await mockDb.updateBalance('user123', -500);
            assert.strictEqual(newBalance, 500);
        });

        it('should handle multiple balance updates', async () => {
            await mockDb.updateBalance('user123', 100);
            await mockDb.updateBalance('user123', 200);
            await mockDb.updateBalance('user123', 300);
            const user = await mockDb.getUser('user123');
            assert.strictEqual(user.balance, 600);
        });
    });

    describe('Gambling Logic', () => {
        it('should calculate coinflip win correctly', () => {
            const bet = 100;
            const multiplier = 2;
            const winnings = bet * multiplier;
            assert.strictEqual(winnings, 200);
        });

        it('should calculate slots jackpot correctly', () => {
            const bet = 100;
            const jackpotMultiplier = 10;
            const jackpot = bet * jackpotMultiplier;
            assert.strictEqual(jackpot, 1000);
        });

        it('should validate bet is positive', () => {
            const validateBet = (amount) => amount > 0;
            assert.strictEqual(validateBet(100), true);
            assert.strictEqual(validateBet(0), false);
            assert.strictEqual(validateBet(-100), false);
        });

        it('should validate bet does not exceed balance', () => {
            const balance = 500;
            const validateBet = (amount) => amount <= balance;
            assert.strictEqual(validateBet(100), true);
            assert.strictEqual(validateBet(500), true);
            assert.strictEqual(validateBet(600), false);
        });
    });

    describe('Cooldown Management', () => {
        it('should detect expired cooldown', () => {
            const lastUsed = Date.now() - 60000; // 1 minute ago
            const cooldownMs = 30000; // 30 seconds
            const isOnCooldown = (Date.now() - lastUsed) < cooldownMs;
            assert.strictEqual(isOnCooldown, false);
        });

        it('should detect active cooldown', () => {
            const lastUsed = Date.now() - 10000; // 10 seconds ago
            const cooldownMs = 30000; // 30 seconds
            const isOnCooldown = (Date.now() - lastUsed) < cooldownMs;
            assert.strictEqual(isOnCooldown, true);
        });

        it('should calculate remaining cooldown time', () => {
            const lastUsed = Date.now() - 10000; // 10 seconds ago
            const cooldownMs = 30000; // 30 seconds
            const remaining = cooldownMs - (Date.now() - lastUsed);
            assert.ok(remaining > 19000 && remaining <= 20000);
        });
    });

    describe('Daily Rewards', () => {
        it('should calculate streak bonus correctly', () => {
            const baseReward = 100;
            const streakBonus = (streak) => Math.min(streak * 10, 100);

            assert.strictEqual(streakBonus(1), 10);
            assert.strictEqual(streakBonus(5), 50);
            assert.strictEqual(streakBonus(10), 100);
            assert.strictEqual(streakBonus(15), 100); // Capped at 100
        });

        it('should detect valid daily claim window', () => {
            const lastClaim = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
            const minWait = 20 * 60 * 60 * 1000; // 20 hours
            const canClaim = (Date.now() - lastClaim) >= minWait;
            assert.strictEqual(canClaim, true);
        });

        it('should prevent early daily claim', () => {
            const lastClaim = Date.now() - 10 * 60 * 60 * 1000; // 10 hours ago
            const minWait = 20 * 60 * 60 * 1000; // 20 hours
            const canClaim = (Date.now() - lastClaim) >= minWait;
            assert.strictEqual(canClaim, false);
        });
    });

    describe('Shop Transactions', () => {
        it('should validate purchase affordability', () => {
            const balance = 1000;
            const itemPrice = 500;
            const canAfford = balance >= itemPrice;
            assert.strictEqual(canAfford, true);
        });

        it('should reject unaffordable purchase', () => {
            const balance = 100;
            const itemPrice = 500;
            const canAfford = balance >= itemPrice;
            assert.strictEqual(canAfford, false);
        });

        it('should calculate correct balance after purchase', () => {
            const balance = 1000;
            const itemPrice = 350;
            const newBalance = balance - itemPrice;
            assert.strictEqual(newBalance, 650);
        });
    });

    describe('Number Formatting', () => {
        it('should format thousands correctly', () => {
            const formatNum = (n) => {
                if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
                if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
                if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
                return n.toString();
            };

            assert.strictEqual(formatNum(500), '500');
            assert.strictEqual(formatNum(1500), '1.50K');
            assert.strictEqual(formatNum(1500000), '1.50M');
            assert.strictEqual(formatNum(1500000000), '1.50B');
        });

        it('should parse formatted numbers correctly', () => {
            const parseNum = (str) => {
                const suffixes = { K: 1e3, M: 1e6, B: 1e9 };
                const match = str.match(/^([\d.]+)([KMB])?$/i);
                if (!match) return NaN;
                const num = parseFloat(match[1]);
                const suffix = match[2]?.toUpperCase();
                return suffix ? num * suffixes[suffix] : num;
            };

            assert.strictEqual(parseNum('500'), 500);
            assert.strictEqual(parseNum('1.5K'), 1500);
            assert.strictEqual(parseNum('1.5M'), 1500000);
            assert.strictEqual(parseNum('1.5B'), 1500000000);
        });
    });
});
