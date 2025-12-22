/**
 * Stark Bucks Economy System
 * A robust economy with persistence, shop, games, and leaderboards
 *
 * Features:
 * - MongoDB persistence (auto-saves)
 * - Shop system with items
 * - Multiple games (gamble, slots, coinflip, blackjack)
 * - Daily rewards with streaks
 * - Leaderboards
 * - Auto-cleanup of old session data (keeps user balances)
 */

const database = require('./database');
const config = require('../../config');

// Lazy-load starkbucks to avoid circular dependency
let _starkbucks = null;
function getStarkbucks() {
    if (!_starkbucks) {
        try {
            _starkbucks = require('./starkbucks-exchange');
        } catch (e) {
            _starkbucks = null;
        }
    }
    return _starkbucks;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const ECONOMY_CONFIG = {
    startingBalance: 100,
    dailyReward: 150,
    dailyStreakBonus: 25,
    maxDailyStreak: 30,
    workReward: { min: 40, max: 100 },
    workCooldown: 45 * 1000, // 45 seconds (was 1 min)
    dailyCooldown: 24 * 60 * 60 * 1000, // 24 hours
    robChance: 0.4,
    robCooldown: 60 * 1000, // 1 minute
    cleanupInterval: 60 * 60 * 1000, // 1 hour
    maxBalance: 1000000000, // 1 billion cap
    gamblingWinRate: 0.45, // 45% base win rate for gambling
    // Multiplier event settings
    multiplierInterval: 3 * 60 * 60 * 1000, // Every 3 hours
    multiplierDuration: 7 * 60 * 60 * 1000, // Lasts 7 hours
    multiplierBonus: 6, // 600% = 6x
    slotsMultipliers: {
        double: 2,
        triple: 3,
        jackpot: 10
    },
    // Arc Reactor perks
    arcReactorPerks: {
        earningsBonus: 0.15,      // +15% on all earnings
        cooldownReduction: 0.25,  // -25% cooldowns
        gamblingBonus: 0.05,      // +5% gambling win rate
        dailyInterestRate: 0.01,  // +1% daily interest
        dailyBonusFlat: 500,      // +500 daily reward
        minigameCooldown: 30 * 1000 // 30 sec cooldown with reactor (vs 45)
    }
};

// ============================================================================
// SHOP ITEMS
// ============================================================================

const SHOP_ITEMS = {
    // Cosmetic roles/badges
    vip_badge: {
        id: 'vip_badge',
        name: '⭐ VIP Badge',
        description: 'Show off your wealth with a VIP badge',
        price: 500,
        type: 'cosmetic',
        oneTime: true
    },
    golden_name: {
        id: 'golden_name',
        name: '✨ Golden Name',
        description: 'Your name shines gold in the leaderboard',
        price: 1000,
        type: 'cosmetic',
        oneTime: true
    },
    // Boosters
    lucky_charm: {
        id: 'lucky_charm',
        name: '🍀 Lucky Charm',
        description: '+5% gambling win rate for 1 hour',
        price: 200,
        type: 'booster',
        duration: 60 * 60 * 1000,
        effect: { gamblingBonus: 0.05 }
    },
    double_daily: {
        id: 'double_daily',
        name: '2️⃣ Double Daily',
        description: 'Double your next daily reward',
        price: 150,
        type: 'consumable',
        uses: 1
    },
    // Protection
    shield: {
        id: 'shield',
        name: '🛡️ Shield',
        description: 'Protect against robbery for 2 hours',
        price: 300,
        type: 'protection',
        duration: 2 * 60 * 60 * 1000
    },
    // Fun items
    stark_coffee: {
        id: 'stark_coffee',
        name: '☕ Stark Coffee',
        description: 'Reduce work cooldown by 50% for 1 hour',
        price: 100,
        type: 'booster',
        duration: 60 * 60 * 1000,
        effect: { workCooldownReduction: 0.5 }
    },
    arc_reactor: {
        id: 'arc_reactor',
        name: '💠 Mini Arc Reactor',
        description: "Legendary collector item - proves you're a true Stark fan",
        price: 10000,
        type: 'legendary',
        oneTime: true
    }
};

// Slot machine symbols
const SLOT_SYMBOLS = ['💎', '7️⃣', '🍒', '🍋', '⭐', '🔔'];

// Hunt/Fish/Dig rewards
// NOTE: The 'chance' field in outcomes is vestigial - selection uses uniform random distribution.
// All outcomes have equal probability regardless of the chance value.
const MINIGAME_REWARDS = {
    hunt: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦌 Deer', reward: 80, chance: 0.02 },
            { name: '🐗 Boar', reward: 60, chance: 0.02 },
            { name: '🐰 Rabbit', reward: 30, chance: 0.02 },
            { name: '💨 Nothing', reward: 0, chance: 0.02 },
            { name: '🦅 Eagle', reward: 90, chance: 0.02 },
            { name: '🐻 Bear', reward: 120, chance: 0.02 },
            { name: '🦊 Fox', reward: 40, chance: 0.02 },
            { name: '🐺 Wolf', reward: 100, chance: 0.02 },
            { name: '🦃 Turkey', reward: 25, chance: 0.02 },
            { name: '🦆 Duck', reward: 20, chance: 0.02 },
            { name: '🐿️ Squirrel', reward: 5, chance: 0.02 },
            { name: '🦔 Hedgehog', reward: 15, chance: 0.02 },
            { name: '🦝 Raccoon', reward: 35, chance: 0.02 },
            { name: '🐍 Snake', reward: 45, chance: 0.02 },
            { name: '🦎 Lizard', reward: 10, chance: 0.02 },
            { name: '🐢 Turtle', reward: 8, chance: 0.02 },
            { name: '🐸 Frog', reward: 3, chance: 0.02 },
            { name: '🦋 Butterfly', reward: 1, chance: 0.02 },
            { name: '🐝 Bee', reward: 2, chance: 0.02 },
            { name: '🦗 Cricket', reward: 1, chance: 0.02 },
            { name: '🦂 Scorpion', reward: 50, chance: 0.02 },
            { name: '🕷️ Spider', reward: 12, chance: 0.02 },
            { name: '🦐 Shrimp', reward: 7, chance: 0.02 },
            { name: '🦞 Lobster', reward: 55, chance: 0.02 },
            { name: '🦀 Crab', reward: 18, chance: 0.02 },
            { name: '🐙 Octopus', reward: 65, chance: 0.02 },
            { name: '🦑 Squid', reward: 38, chance: 0.02 },
            { name: '🐟 Fish', reward: 22, chance: 0.02 },
            { name: '🐠 Tropical Fish', reward: 28, chance: 0.02 },
            { name: '🐡 Pufferfish', reward: 32, chance: 0.02 },
            { name: '🦈 Shark', reward: 150, chance: 0.02 },
            { name: '🐋 Whale', reward: 200, chance: 0.02 },
            { name: '🐬 Dolphin', reward: 110, chance: 0.02 },
            { name: '🦭 Seal', reward: 75, chance: 0.02 },
            { name: '🐧 Penguin', reward: 42, chance: 0.02 },
            { name: '🦢 Swan', reward: 48, chance: 0.02 },
            { name: '🦩 Flamingo', reward: 52, chance: 0.02 },
            { name: '🦜 Parrot', reward: 58, chance: 0.02 },
            { name: '🦉 Owl', reward: 68, chance: 0.02 },
            { name: '🐓 Rooster', reward: 14, chance: 0.02 },
            { name: '🐔 Chicken', reward: 11, chance: 0.02 },
            { name: '🦃 Turkey', reward: 33, chance: 0.02 },
            { name: '🐄 Cow', reward: 85, chance: 0.02 },
            { name: '🐃 Water Buffalo', reward: 95, chance: 0.02 },
            { name: '🐂 Ox', reward: 88, chance: 0.02 },
            { name: '🐏 Ram', reward: 72, chance: 0.02 },
            { name: '🐑 Sheep', reward: 28, chance: 0.02 },
            { name: '🐐 Goat', reward: 38, chance: 0.02 },
            { name: '🦙 Llama', reward: 62, chance: 0.02 },
            { name: '🦒 Giraffe', reward: 105, chance: 0.02 },
            { name: '🐘 Elephant', reward: 180, chance: 0.02 }
        ]
    },
    fish: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦈 Shark', reward: 100, chance: 0.02 },
            { name: '🐟 Fish', reward: 40, chance: 0.02 },
            { name: '🐠 Tropical Fish', reward: 60, chance: 0.02 },
            { name: '👢 Old Boot', reward: 5, chance: 0.02 },
            { name: '🌊 Nothing', reward: 0, chance: 0.02 },
            { name: '🐡 Pufferfish', reward: 45, chance: 0.02 },
            { name: '🐙 Octopus', reward: 75, chance: 0.02 },
            { name: '🦑 Squid', reward: 55, chance: 0.02 },
            { name: '🦞 Lobster', reward: 85, chance: 0.02 },
            { name: '🦀 Crab', reward: 35, chance: 0.02 },
            { name: '🦐 Shrimp', reward: 15, chance: 0.02 },
            { name: '🐋 Whale', reward: 200, chance: 0.02 },
            { name: '🐬 Dolphin', reward: 120, chance: 0.02 },
            { name: '🦭 Seal', reward: 80, chance: 0.02 },
            { name: '🐢 Sea Turtle', reward: 65, chance: 0.02 },
            { name: '🐚 Conch Shell', reward: 10, chance: 0.02 },
            { name: '💎 Pearl', reward: 150, chance: 0.02 },
            { name: '🪙 Gold Coin', reward: 90, chance: 0.02 },
            { name: '💍 Ring', reward: 70, chance: 0.02 },
            { name: '📱 Phone (waterproof)', reward: 25, chance: 0.02 },
            { name: '🧦 Sock', reward: 1, chance: 0.02 },
            { name: '🎣 Fishing Rod', reward: 30, chance: 0.02 },
            { name: '🪣 Bucket', reward: 8, chance: 0.02 },
            { name: '🌊 Seaweed', reward: 2, chance: 0.02 },
            { name: '🦀 Hermit Crab', reward: 12, chance: 0.02 },
            { name: '🐠 Clownfish', reward: 38, chance: 0.02 },
            { name: '🐟 Tuna', reward: 50, chance: 0.02 },
            { name: '🐟 Salmon', reward: 48, chance: 0.02 },
            { name: '🐟 Cod', reward: 32, chance: 0.02 },
            { name: '🐟 Bass', reward: 42, chance: 0.02 },
            { name: '🐟 Trout', reward: 28, chance: 0.02 },
            { name: '🐟 Mackerel', reward: 22, chance: 0.02 },
            { name: '🐟 Sardine', reward: 18, chance: 0.02 },
            { name: '🐟 Anchovy', reward: 14, chance: 0.02 },
            { name: '🐟 Herring', reward: 20, chance: 0.02 },
            { name: '🐟 Snapper', reward: 52, chance: 0.02 },
            { name: '🐟 Grouper', reward: 58, chance: 0.02 },
            { name: '🐟 Mahi Mahi', reward: 62, chance: 0.02 },
            { name: '🐟 Marlin', reward: 110, chance: 0.02 },
            { name: '🐟 Swordfish', reward: 95, chance: 0.02 },
            { name: '🐟 Barracuda', reward: 68, chance: 0.02 },
            { name: '🐟 Eel', reward: 44, chance: 0.02 },
            { name: '🐟 Stingray', reward: 72, chance: 0.02 },
            { name: '🐟 Jellyfish', reward: 26, chance: 0.02 },
            { name: '🐟 Angelfish', reward: 46, chance: 0.02 },
            { name: '🐟 Piranha', reward: 54, chance: 0.02 },
            { name: '🐟 Catfish', reward: 36, chance: 0.02 },
            { name: '🐟 Carp', reward: 24, chance: 0.02 },
            { name: '🐟 Pike', reward: 40, chance: 0.02 },
            { name: '🐟 Perch', reward: 30, chance: 0.02 }
        ]
    },
    dig: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '💎 Diamond', reward: 150, chance: 0.02 },
            { name: '🪙 Gold Coins', reward: 70, chance: 0.02 },
            { name: '⚙️ Scrap Metal', reward: 25, chance: 0.02 },
            { name: '🪨 Rocks', reward: 10, chance: 0.02 },
            { name: '🕳️ Empty Hole', reward: 0, chance: 0.02 },
            { name: '💍 Gold Ring', reward: 80, chance: 0.02 },
            { name: '💎 Ruby', reward: 120, chance: 0.02 },
            { name: '💎 Emerald', reward: 110, chance: 0.02 },
            { name: '💎 Sapphire', reward: 105, chance: 0.02 },
            { name: '💎 Amethyst', reward: 95, chance: 0.02 },
            { name: '💎 Topaz', reward: 85, chance: 0.02 },
            { name: '💎 Opal', reward: 100, chance: 0.02 },
            { name: '💎 Pearl', reward: 90, chance: 0.02 },
            { name: '🪙 Silver Coins', reward: 50, chance: 0.02 },
            { name: '🪙 Bronze Coins', reward: 20, chance: 0.02 },
            { name: '⚙️ Iron Ore', reward: 30, chance: 0.02 },
            { name: '⚙️ Copper Wire', reward: 15, chance: 0.02 },
            { name: '⚙️ Aluminum Scraps', reward: 12, chance: 0.02 },
            { name: '🪨 Granite', reward: 8, chance: 0.02 },
            { name: '🪨 Limestone', reward: 6, chance: 0.02 },
            { name: '🪨 Marble', reward: 18, chance: 0.02 },
            { name: '🪨 Quartz', reward: 22, chance: 0.02 },
            { name: '🪨 Coal', reward: 5, chance: 0.02 },
            { name: '🪨 Sandstone', reward: 4, chance: 0.02 },
            { name: '🪨 Basalt', reward: 7, chance: 0.02 },
            { name: '🦴 Dinosaur Bone', reward: 200, chance: 0.02 },
            { name: '🦴 Fossil', reward: 140, chance: 0.02 },
            { name: '🏺 Ancient Pottery', reward: 130, chance: 0.02 },
            { name: '🗿 Statue Fragment', reward: 115, chance: 0.02 },
            { name: '⚱️ Urn', reward: 125, chance: 0.02 },
            { name: '🗡️ Rusty Sword', reward: 60, chance: 0.02 },
            { name: '🛡️ Broken Shield', reward: 55, chance: 0.02 },
            { name: '⚔️ Old Dagger', reward: 45, chance: 0.02 },
            { name: '🏺 Clay Pot', reward: 35, chance: 0.02 },
            { name: '📜 Scroll', reward: 75, chance: 0.02 },
            { name: '📜 Map', reward: 65, chance: 0.02 },
            { name: '💼 Briefcase', reward: 40, chance: 0.02 },
            { name: '🔑 Old Key', reward: 28, chance: 0.02 },
            { name: '💍 Ring', reward: 50, chance: 0.02 },
            { name: '⌚ Watch', reward: 35, chance: 0.02 },
            { name: '📱 Phone', reward: 30, chance: 0.02 },
            { name: '💻 Laptop', reward: 42, chance: 0.02 },
            { name: '🔋 Battery', reward: 14, chance: 0.02 },
            { name: '🔌 Plug', reward: 8, chance: 0.02 },
            { name: '🧲 Magnet', reward: 12, chance: 0.02 },
            { name: '🧰 Toolbox', reward: 38, chance: 0.02 },
            { name: '🔧 Wrench', reward: 16, chance: 0.02 },
            { name: '🔨 Hammer', reward: 18, chance: 0.02 },
            { name: '⛏️ Pickaxe', reward: 32, chance: 0.02 },
            { name: '🪓 Axe', reward: 26, chance: 0.02 }
        ]
    },
    beg: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: 'Tony Stark gave you', reward: 100, chance: 0.02 },
            { name: 'Pepper Potts donated', reward: 50, chance: 0.02 },
            { name: 'Happy Hogan tipped you', reward: 30, chance: 0.02 },
            { name: 'A stranger gave you', reward: 15, chance: 0.02 },
            { name: 'Everyone ignored you', reward: 0, chance: 0.02 },
            { name: '🦸 Captain America felt patriotic', reward: 75, chance: 0.02 },
            { name: '🕷️ Spider-Man gave you his lunch money', reward: 25, chance: 0.02 },
            { name: '🦅 Hawkeye dropped some spare change', reward: 20, chance: 0.02 },
            { name: '⚡ Thor threw you some Asgardian gold', reward: 90, chance: 0.02 },
            { name: '🛡️ Black Widow left a tip', reward: 40, chance: 0.02 },
            { name: '🤖 Vision calculated you need help', reward: 60, chance: 0.02 },
            {
                name: '🧙 Doctor Strange opened a portal and dropped coins',
                reward: 80,
                chance: 0.02
            },
            { name: '🦝 Rocket felt generous (rare!)', reward: 70, chance: 0.02 },
            { name: '🌳 Groot gave you a twig (worth something?)', reward: 5, chance: 0.02 },
            { name: "👑 T'Challa's Wakandan charity fund", reward: 85, chance: 0.02 },
            { name: '🧬 Bruce Banner felt bad for you', reward: 35, chance: 0.02 },
            { name: '🎯 Yelena Belova threw you a ruble', reward: 10, chance: 0.02 },
            { name: '🔮 Wanda felt your pain (literally)', reward: 55, chance: 0.02 },
            { name: "🦇 Moon Knight's alter ego donated", reward: 45, chance: 0.02 },
            { name: '⚔️ Loki tricked you into thinking you got money', reward: 0, chance: 0.02 },
            { name: "🕸️ Venom symbiote tried to help (it didn't)", reward: -10, chance: 0.02 },
            { name: '👻 Ghost Rider felt your suffering', reward: 50, chance: 0.02 },
            { name: "🎭 Deadpool gave you $4 (he's broke too)", reward: 4, chance: 0.02 },
            {
                name: "🌙 Daredevil heard your plea (he's blind but generous)",
                reward: 30,
                chance: 0.02
            },
            { name: '🔥 Human Torch warmed your heart (and wallet)', reward: 40, chance: 0.02 },
            { name: '❄️ Iceman froze you out (no money)', reward: 0, chance: 0.02 },
            { name: '🧲 Magneto threw you some spare metal', reward: 15, chance: 0.02 },
            { name: "👽 Nick Fury's eye saw your struggle", reward: 65, chance: 0.02 },
            { name: "🦂 Scorpion tried to help (he's broke)", reward: 0, chance: 0.02 },
            { name: '🕷️ Miles Morales shared his allowance', reward: 20, chance: 0.02 },
            { name: '🦇 Batroc the Leaper felt generous', reward: 12, chance: 0.02 },
            { name: '🌊 Namor threw you some underwater treasure', reward: 95, chance: 0.02 },
            { name: '⚔️ Taskmaster copied your begging technique', reward: 0, chance: 0.02 },
            { name: "🦾 Winter Soldier's metal arm dropped coins", reward: 35, chance: 0.02 },
            { name: '🦅 Falcon felt bad for you', reward: 25, chance: 0.02 },
            { name: '🕷️ Black Cat stole money then gave it to you', reward: 65, chance: 0.02 },
            { name: '👑 Killmonger felt a moment of pity', reward: 40, chance: 0.02 },
            { name: '🧪 Doctor Octopus dropped spare change', reward: 8, chance: 0.02 },
            { name: '🦎 Lizard felt your struggle', reward: 18, chance: 0.02 },
            { name: '⚡ Electro zapped you some money', reward: 55, chance: 0.02 },
            { name: '🦂 Vulture dropped some cash', reward: 22, chance: 0.02 },
            { name: '🔥 Sandman felt your pain', reward: 28, chance: 0.02 },
            { name: '❄️ Mr. Freeze gave you ice (worthless)', reward: 0, chance: 0.02 },
            { name: '🦇 Two-Face flipped a coin (you lost)', reward: 0, chance: 0.02 },
            { name: '🎭 Joker gave you a fake dollar', reward: 0, chance: 0.02 },
            { name: '🦅 Red Skull ignored you (Nazi vibes)', reward: 0, chance: 0.02 },
            { name: '⚔️ Crossbones felt generous', reward: 30, chance: 0.02 },
            { name: "🦾 Ultron calculated you're useless", reward: 0, chance: 0.02 },
            { name: '👑 Thanos felt your pain (snapped away)', reward: 0, chance: 0.02 },
            { name: '🌙 Blade gave you some cash', reward: 45, chance: 0.02 },
            { name: "🦂 Morbius felt bad (he's a vampire)", reward: 20, chance: 0.02 }
        ]
    },
    crime: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🏦 Robbed a bank vault', reward: 500, chance: 0.02 },
            { name: '💎 Stole from a jewelry store', reward: 300, chance: 0.02 },
            { name: '🚗 Jacked a luxury car', reward: 200, chance: 0.02 },
            { name: '👜 Pickpocketed a tourist', reward: 100, chance: 0.02 },
            { name: '🚨 Got caught! Paid bail', reward: -150, chance: 0.02 },
            { name: '👮 Arrested! Lost everything', reward: -300, chance: 0.02 },
            { name: '💀 Got beat up by the victim', reward: -100, chance: 0.02 },
            { name: "🍕 Stole pizza from Spider-Man (he's mad)", reward: 50, chance: 0.02 },
            { name: '🦹 Broke into Oscorp (found nothing)', reward: 0, chance: 0.02 },
            { name: '💼 Snatched a briefcase (it was empty)', reward: 25, chance: 0.02 },
            { name: '🎰 Robbed a casino (got lucky!)', reward: 400, chance: 0.02 },
            { name: '🏪 Shoplifted from a convenience store', reward: 75, chance: 0.02 },
            { name: "📱 Stole someone's phone (they tracked you)", reward: -50, chance: 0.02 },
            { name: '🚲 Stole a bike (it was a trap bike)', reward: -75, chance: 0.02 },
            { name: '🎨 Art heist gone wrong (fake painting)', reward: 10, chance: 0.02 },
            { name: '💳 Credit card fraud (got caught immediately)', reward: -200, chance: 0.02 },
            {
                name: '🏠 Broke into Avengers Tower (Jarvis called security)',
                reward: -250,
                chance: 0.02
            },
            { name: '🦝 Tried to rob Rocket (he robbed you instead)', reward: -175, chance: 0.02 },
            { name: "⚡ Stole Thor's hammer (you can't lift it)", reward: 0, chance: 0.02 },
            { name: "🛡️ Tried to steal Cap's shield (it came back)", reward: -50, chance: 0.02 },
            {
                name: '🧙 Stole from Doctor Strange (he opened a portal)',
                reward: -100,
                chance: 0.02
            },
            { name: '🕷️ Tried to steal from Kingpin (bad idea)', reward: -300, chance: 0.02 },
            { name: '👑 Stole from Wakanda (Shuri caught you)', reward: -150, chance: 0.02 },
            {
                name: "🌙 Broke into Moon Knight's place (he has 3 personalities)",
                reward: -125,
                chance: 0.02
            },
            { name: '🔥 Tried to rob Human Torch (you got burned)', reward: -80, chance: 0.02 },
            { name: '❄️ Stole from Iceman (frozen solid)', reward: -60, chance: 0.02 },
            {
                name: "🧲 Tried to steal Magneto's helmet (he controlled it)",
                reward: -90,
                chance: 0.02
            },
            { name: '🦇 Broke into Wayne Manor (wrong universe)', reward: 0, chance: 0.02 },
            {
                name: '👻 Tried to rob Ghost Rider (your soul is now in debt)',
                reward: -400,
                chance: 0.02
            },
            { name: "🎭 Deadpool caught you (he's keeping the money)", reward: -25, chance: 0.02 },
            { name: '🕸️ Stole from Venom (symbiote attached to you)', reward: -200, chance: 0.02 },
            { name: "🌊 Tried to rob Namor (he's underwater)", reward: 0, chance: 0.02 },
            { name: '🔮 Stole from Wanda (reality broke)', reward: -350, chance: 0.02 },
            { name: '⚔️ Tried to rob Loki (he tricked you)', reward: -100, chance: 0.02 },
            { name: '🦅 Stole from Hawkeye (he shot an arrow at you)', reward: -70, chance: 0.02 },
            { name: '🦂 Tried to rob Scorpion (he stung you)', reward: -55, chance: 0.02 },
            { name: '🦎 Stole from Lizard (he bit you)', reward: -45, chance: 0.02 },
            { name: '⚡ Tried to rob Electro (you got zapped)', reward: -65, chance: 0.02 },
            { name: '🔥 Stole from Sandman (he buried you)', reward: -40, chance: 0.02 },
            {
                name: "🦾 Broke into Doc Ock's lab (tentacles caught you)",
                reward: -110,
                chance: 0.02
            },
            { name: '🦅 Tried to rob Vulture (he dropped you)', reward: -85, chance: 0.02 },
            { name: '🎭 Stole from Mysterio (it was all illusions)', reward: 0, chance: 0.02 },
            {
                name: "🦇 Broke into Kraven's trophy room (he hunted you)",
                reward: -120,
                chance: 0.02
            },
            { name: '🦂 Tried to rob Rhino (he charged you)', reward: -95, chance: 0.02 },
            { name: '⚔️ Stole from Taskmaster (he copied your moves)', reward: -30, chance: 0.02 },
            { name: "🦾 Broke into Ultron's base (robots attacked)", reward: -180, chance: 0.02 },
            { name: '👑 Tried to rob Thanos (he snapped you)', reward: -500, chance: 0.02 },
            { name: "🌙 Stole from Blade (he's a vampire hunter)", reward: -35, chance: 0.02 },
            { name: "🦂 Broke into Morbius's lab (vampire vibes)", reward: -20, chance: 0.02 }
        ]
    },
    postmeme: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🔥 Went viral! 1M likes', reward: 400, chance: 0.02 },
            { name: '😂 Front page of Reddit', reward: 200, chance: 0.02 },
            { name: '👍 Got some upvotes', reward: 80, chance: 0.02 },
            { name: '😐 Mid meme, mid reward', reward: 40, chance: 0.02 },
            { name: '👎 Cringe post, got roasted', reward: 10, chance: 0.02 },
            { name: '🚫 Banned from the subreddit', reward: 0, chance: 0.02 },
            { name: '🎉 Hit r/all!', reward: 350, chance: 0.02 },
            { name: '📈 Trending on Twitter', reward: 300, chance: 0.02 },
            { name: '📱 Went viral on TikTok', reward: 280, chance: 0.02 },
            { name: '🖼️ Featured on Instagram', reward: 250, chance: 0.02 },
            { name: '💬 Got 10k comments', reward: 180, chance: 0.02 },
            { name: '⭐ Got gold award', reward: 150, chance: 0.02 },
            { name: '🏆 Got platinum award', reward: 220, chance: 0.02 },
            { name: '👏 Got silver award', reward: 120, chance: 0.02 },
            { name: '❤️ Got 5k upvotes', reward: 160, chance: 0.02 },
            { name: '👍 Got 1k upvotes', reward: 100, chance: 0.02 },
            { name: '😊 Got 500 upvotes', reward: 70, chance: 0.02 },
            { name: '🙂 Got 100 upvotes', reward: 50, chance: 0.02 },
            { name: '😐 Got 50 upvotes', reward: 35, chance: 0.02 },
            { name: '😑 Got 10 upvotes', reward: 20, chance: 0.02 },
            { name: '😒 Got 5 upvotes', reward: 15, chance: 0.02 },
            { name: '😕 Got 1 upvote', reward: 8, chance: 0.02 },
            { name: '😞 Got 0 upvotes', reward: 0, chance: 0.02 },
            { name: '😢 Got downvoted', reward: -5, chance: 0.02 },
            { name: '😭 Got heavily downvoted', reward: -15, chance: 0.02 },
            { name: '🤡 Got ratioed', reward: -25, chance: 0.02 },
            { name: '💀 Got ratioed hard', reward: -35, chance: 0.02 },
            { name: '🔥 Reposted by big account', reward: 320, chance: 0.02 },
            { name: '📺 Featured on YouTube', reward: 270, chance: 0.02 },
            { name: '🎬 Made into a video', reward: 240, chance: 0.02 },
            { name: '📰 Featured in news article', reward: 290, chance: 0.02 },
            { name: '🎨 Turned into art', reward: 210, chance: 0.02 },
            { name: '🎵 Made into a song', reward: 260, chance: 0.02 },
            { name: '🎮 Featured in game', reward: 230, chance: 0.02 },
            { name: '📚 Made into a book', reward: 310, chance: 0.02 },
            { name: '🎭 Performed on stage', reward: 190, chance: 0.02 },
            { name: '🎪 Featured in circus', reward: 170, chance: 0.02 },
            { name: '🎯 Perfect timing', reward: 140, chance: 0.02 },
            { name: '⏰ Bad timing', reward: 5, chance: 0.02 },
            { name: '🌍 Went international', reward: 330, chance: 0.02 },
            { name: '🌎 Crossed language barriers', reward: 340, chance: 0.02 },
            { name: '🌏 Became global phenomenon', reward: 380, chance: 0.02 },
            { name: '🚀 Launched into space (metaphorically)', reward: 360, chance: 0.02 },
            { name: '💫 Became a star', reward: 370, chance: 0.02 },
            { name: '⭐ Got famous', reward: 390, chance: 0.02 },
            { name: '👑 Became meme royalty', reward: 410, chance: 0.02 },
            { name: '🏰 Built a meme empire', reward: 420, chance: 0.02 },
            { name: '💎 Became a meme diamond', reward: 430, chance: 0.02 },
            { name: '👻 Got ghosted (no engagement)', reward: -10, chance: 0.02 },
            { name: '🗑️ Got deleted by mods', reward: -20, chance: 0.02 }
        ]
    },
    search: {
        cooldown: 60 * 1000, // 1 minute
        locations: [
            {
                name: "Tony's couch cushions",
                outcomes: [
                    { result: 'Found some loose change!', reward: 50, chance: 0.2 },
                    { result: 'Found old pizza... gross', reward: 0, chance: 0.2 },
                    { result: 'Found a $20 bill!', reward: 20, chance: 0.2 },
                    { result: 'Found nothing but lint', reward: 0, chance: 0.2 },
                    { result: "Found Tony's spare arc reactor (worthless)", reward: 0, chance: 0.2 }
                ]
            },
            {
                name: 'the Stark Industries dumpster',
                outcomes: [
                    { result: 'Found discarded prototype parts!', reward: 150, chance: 0.2 },
                    { result: 'Just garbage... literally', reward: 5, chance: 0.2 },
                    { result: 'Security caught you!', reward: -50, chance: 0.2 },
                    { result: 'Found broken tech worth something', reward: 75, chance: 0.2 },
                    { result: 'Found nothing but coffee cups', reward: 0, chance: 0.2 }
                ]
            },
            {
                name: "Happy's car",
                outcomes: [
                    { result: 'Found his emergency stash!', reward: 100, chance: 0.2 },
                    { result: 'Nothing but gym gear', reward: 0, chance: 0.2 },
                    { result: 'Happy saw you! Awkward...', reward: -20, chance: 0.2 },
                    { result: 'Found spare change in cup holder', reward: 15, chance: 0.2 },
                    { result: "Found Happy's gym membership card", reward: 0, chance: 0.2 }
                ]
            },
            {
                name: 'the Avengers compound',
                outcomes: [
                    { result: "Found Thor's forgotten gold!", reward: 300, chance: 0.2 },
                    { result: 'Picked up some spare parts', reward: 80, chance: 0.2 },
                    { result: "Empty... everyone's on a mission", reward: 20, chance: 0.2 },
                    { result: 'SHIELD detained you briefly', reward: -100, chance: 0.2 },
                    { result: "Found Cap's old shield polish", reward: 0, chance: 0.2 }
                ]
            },
            {
                name: "Pepper's office",
                outcomes: [
                    { result: 'Found some spare change', reward: 25, chance: 0.2 },
                    { result: "Found nothing (she's organized)", reward: 0, chance: 0.2 },
                    { result: 'Pepper caught you!', reward: -30, chance: 0.2 },
                    { result: 'Found a lost wallet', reward: 60, chance: 0.2 },
                    { result: 'Found old business cards', reward: 0, chance: 0.2 }
                ]
            },
            {
                name: 'the Quinjet hangar',
                outcomes: [
                    { result: 'Found spare parts worth money', reward: 120, chance: 0.2 },
                    { result: 'Found nothing but fuel', reward: 0, chance: 0.2 },
                    { result: 'Got caught by security', reward: -75, chance: 0.2 },
                    { result: "Found Hawkeye's arrow stash", reward: 40, chance: 0.2 },
                    { result: "Found Black Widow's hidden cash", reward: 90, chance: 0.2 }
                ]
            },
            {
                name: 'the training room',
                outcomes: [
                    { result: 'Found some dropped coins', reward: 30, chance: 0.2 },
                    { result: 'Found nothing but sweat', reward: 0, chance: 0.2 },
                    { result: 'Got caught by Cap', reward: -40, chance: 0.2 },
                    { result: "Found Hulk's torn pants (worthless)", reward: 0, chance: 0.2 },
                    { result: 'Found spare equipment', reward: 50, chance: 0.2 }
                ]
            },
            {
                name: 'the lab',
                outcomes: [
                    { result: 'Found experimental tech', reward: 180, chance: 0.2 },
                    { result: 'Found nothing but beakers', reward: 0, chance: 0.2 },
                    { result: 'Broke something expensive!', reward: -150, chance: 0.2 },
                    { result: "Found Shuri's prototype", reward: 200, chance: 0.2 },
                    { result: "Found Banner's research notes", reward: 35, chance: 0.2 }
                ]
            },
            {
                name: 'the kitchen',
                outcomes: [
                    { result: 'Found some cash in the fridge', reward: 45, chance: 0.2 },
                    { result: 'Found nothing but leftovers', reward: 0, chance: 0.2 },
                    { result: 'Thor ate everything', reward: 0, chance: 0.2 },
                    { result: "Found Tony's hidden snack stash", reward: 20, chance: 0.2 },
                    { result: "Found Pepper's emergency fund", reward: 70, chance: 0.2 }
                ]
            },
            {
                name: 'the armory',
                outcomes: [
                    { result: 'Found spare weapons worth money', reward: 160, chance: 0.2 },
                    { result: 'Found nothing (locked)', reward: 0, chance: 0.2 },
                    { result: 'Got caught by security!', reward: -200, chance: 0.2 },
                    { result: "Found War Machine's spare parts", reward: 110, chance: 0.2 },
                    { result: "Found Iron Man's old repulsors", reward: 140, chance: 0.2 }
                ]
            }
        ]
    }
};

// ============================================================================
// IN-MEMORY CACHE (syncs with MongoDB)
// ============================================================================

const userCache = new Map(); // userId -> userData
const cooldowns = new Map(); // `${userId}:${action}` -> timestamp
let lastCleanup = Date.now();

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getCollection() {
    await database.connect();
    return database.db.collection('starkEconomy');
}

/**
 * Ensure a value is a valid number, fallback to default
 */
function ensureNumber(value, defaultValue = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
}

/**
 * Load user from DB or create new
 */
async function loadUser(userId, username = 'Unknown') {
    // Check cache first
    if (userCache.has(userId)) {
        const cached = userCache.get(userId);
        // Validate cached balance is not NaN
        cached.balance = ensureNumber(cached.balance, ECONOMY_CONFIG.startingBalance);
        return cached;
    }

    try {
        const col = await getCollection();
        let user = await col.findOne({ userId: userId });

        if (!user) {
            // Create new user
            user = {
                userId: userId,
                username: username,
                balance: ECONOMY_CONFIG.startingBalance,
                totalEarned: ECONOMY_CONFIG.startingBalance,
                totalLost: 0,
                totalGambled: 0,
                gamesPlayed: 0,
                gamesWon: 0,
                dailyStreak: 0,
                lastDaily: 0,
                lastWork: 0,
                lastRob: 0,
                inventory: [],
                activeEffects: [],
                achievements: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await col.insertOne(user);
        } else {
            // Validate and fix NaN values from DB
            user.balance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
            user.totalEarned = ensureNumber(user.totalEarned, 0);
            user.totalLost = ensureNumber(user.totalLost, 0);
            user.totalGambled = ensureNumber(user.totalGambled, 0);
            user.gamesPlayed = ensureNumber(user.gamesPlayed, 0);
            user.gamesWon = ensureNumber(user.gamesWon, 0);
            user.dailyStreak = ensureNumber(user.dailyStreak, 0);
        }

        userCache.set(userId, user);
        return user;
    } catch (error) {
        console.error('[StarkEconomy] Failed to load user:', error);
        // Return default user object if DB fails
        return {
            userId: userId,
            username: username,
            balance: ECONOMY_CONFIG.startingBalance,
            totalEarned: 0,
            inventory: [],
            activeEffects: []
        };
    }
}

/**
 * Save user to DB
 */
async function saveUser(userId, userData) {
    // Validate all numeric fields before saving
    userData.balance = ensureNumber(userData.balance, ECONOMY_CONFIG.startingBalance);
    userData.totalEarned = ensureNumber(userData.totalEarned, 0);
    userData.totalLost = ensureNumber(userData.totalLost, 0);
    userData.totalGambled = ensureNumber(userData.totalGambled, 0);
    userData.gamesPlayed = ensureNumber(userData.gamesPlayed, 0);
    userData.gamesWon = ensureNumber(userData.gamesWon, 0);
    userData.dailyStreak = ensureNumber(userData.dailyStreak, 0);
    userData.updatedAt = new Date();
    userCache.set(userId, userData);

    try {
        const col = await getCollection();
        await col.updateOne({ userId: userId }, { $set: userData }, { upsert: true });
    } catch (error) {
        console.error('[StarkEconomy] Failed to save user:', error);
    }
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Get user balance
 */
async function getBalance(userId, username) {
    const user = await loadUser(userId, username);
    return user.balance;
}

/**
 * Modify user balance (atomic for withdrawals to prevent race conditions)
 * For negative amounts, uses conditional update to ensure balance doesn't go negative
 */
async function modifyBalance(userId, amount, reason = 'unknown') {
    const safeAmount = ensureNumber(amount, 0);
    
    // For withdrawals, use atomic conditional update
    if (safeAmount < 0) {
        const absAmount = Math.abs(safeAmount);
        try {
            const col = await getCollection();
            
            // Atomic update: only deduct if balance >= amount
            const result = await col.findOneAndUpdate(
                { userId: userId, balance: { $gte: absAmount } },
                {
                    $inc: { 
                        balance: safeAmount,
                        totalLost: absAmount
                    },
                    $set: { updatedAt: new Date() }
                },
                { returnDocument: 'after' }
            );
            
            if (!result) {
                // Either user doesn't exist or insufficient balance
                const user = await loadUser(userId);
                const currentBalance = ensureNumber(user.balance, 0);
                if (currentBalance < absAmount) {
                    return { 
                        success: false, 
                        error: 'Insufficient balance',
                        oldBalance: currentBalance, 
                        newBalance: currentBalance, 
                        change: 0 
                    };
                }
                // User doesn't exist - create and retry
                await saveUser(userId, user);
                return modifyBalance(userId, amount, reason);
            }
            
            const newBalance = ensureNumber(result.balance, 0);
            const oldBalance = newBalance + absAmount;
            
            // Invalidate cache
            userCache.delete(userId);
            
            return { success: true, oldBalance, newBalance, change: safeAmount };
        } catch (error) {
            console.error('[StarkEconomy] Atomic withdraw failed:', error);
            // Fallback to non-atomic (better than failing completely)
            const user = await loadUser(userId);
            const oldBalance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
            if (oldBalance < absAmount) {
                return { success: false, error: 'Insufficient balance', oldBalance, newBalance: oldBalance, change: 0 };
            }
            user.balance = oldBalance + safeAmount;
            user.totalLost = ensureNumber(user.totalLost, 0) + absAmount;
            await saveUser(userId, user);
            return { success: true, oldBalance, newBalance: user.balance, change: safeAmount };
        }
    }
    
    // For deposits, use atomic $inc (always safe)
    try {
        const col = await getCollection();
        const result = await col.findOneAndUpdate(
            { userId: userId },
            {
                $inc: { 
                    balance: safeAmount,
                    totalEarned: safeAmount
                },
                $set: { updatedAt: new Date() },
                $setOnInsert: { 
                    userId: userId,
                    totalLost: 0,
                    totalGambled: 0,
                    gamesPlayed: 0,
                    gamesWon: 0,
                    dailyStreak: 0,
                    inventory: [],
                    activeEffects: [],
                    createdAt: new Date()
                }
            },
            { upsert: true, returnDocument: 'after' }
        );
        
        const newBalance = ensureNumber(result?.balance, safeAmount);
        const oldBalance = newBalance - safeAmount;
        
        // Invalidate cache
        userCache.delete(userId);
        
        return { success: true, oldBalance, newBalance, change: safeAmount };
    } catch (error) {
        console.error('[StarkEconomy] Atomic deposit failed:', error);
        // Fallback to non-atomic
        const user = await loadUser(userId);
        const oldBalance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
        user.balance = oldBalance + safeAmount;
        user.totalEarned = ensureNumber(user.totalEarned, 0) + safeAmount;
        await saveUser(userId, user);
        return { success: true, oldBalance, newBalance: user.balance, change: safeAmount };
    }
}

/**
 * Check if user is bot owner (bypasses cooldowns)
 */
function isBotOwner(userId) {
    const ownerId = process.env.BOT_OWNER_ID || '';
    return ownerId && userId === ownerId;
}

/**
 * Check and set cooldown (bot owner bypasses all cooldowns)
 */
function checkCooldown(userId, action, cooldownMs) {
    // Bot owner bypasses all cooldowns
    if (isBotOwner(userId)) {
        return { onCooldown: false, remaining: 0, ownerBypass: true };
    }
    
    const key = `${userId}:${action}`;
    const lastAction = cooldowns.get(key) || 0;
    const now = Date.now();
    const remaining = cooldownMs - (now - lastAction);

    if (remaining > 0) {
        return { onCooldown: true, remaining };
    }

    cooldowns.set(key, now);
    return { onCooldown: false, remaining: 0 };
}

/**
 * Get active effects for user
 */
async function getActiveEffects(userId) {
    const user = await loadUser(userId);
    const now = Date.now();

    // Filter out expired effects
    user.activeEffects = (user.activeEffects || []).filter(effect => {
        return effect.expiresAt > now;
    });

    await saveUser(userId, user);
    return user.activeEffects;
}

/**
 * Check if user has Arc Reactor
 */
async function hasArcReactor(userId) {
    const user = await loadUser(userId);
    return (user.inventory || []).some(item => item.id === 'arc_reactor');
}

/**
 * Get Arc Reactor perks for user
 * Returns multipliers/bonuses if user has Arc Reactor, otherwise defaults
 */
async function getArcReactorPerks(userId) {
    const hasReactor = await hasArcReactor(userId);
    const perks = ECONOMY_CONFIG.arcReactorPerks;
    
    return {
        hasReactor,
        earningsMultiplier: hasReactor ? (1 + perks.earningsBonus) : 1,
        cooldownMultiplier: hasReactor ? (1 - perks.cooldownReduction) : 1,
        gamblingBonus: hasReactor ? perks.gamblingBonus : 0,
        dailyBonus: hasReactor ? perks.dailyBonusFlat : 0,
        interestRate: hasReactor ? perks.dailyInterestRate : 0,
        minigameCooldown: hasReactor ? perks.minigameCooldown : ECONOMY_CONFIG.workCooldown
    };
}

/**
 * Award SBX bonus alongside Stark Bucks earnings
 * Small SBX bonus (1% of Stark Bucks earned, scaled by SBX price)
 */
async function awardSbxBonus(userId, starkBucksEarned, reason = 'activity') {
    const sbx = getStarkbucks();
    if (!sbx) return { sbxAwarded: 0 };
    
    try {
        // Get current SBX price to calculate bonus
        const market = await sbx.getMarketData();
        const price = market?.price || 1;
        
        // Award 1% of Stark Bucks as SBX value (divided by price)
        // Minimum 0.01 SBX for any activity
        const sbxBonus = Math.max(0.01, (starkBucksEarned * 0.01) / price);
        const roundedBonus = Math.floor(sbxBonus * 100) / 100;
        
        if (roundedBonus > 0) {
            await sbx.updateWallet(userId, roundedBonus, `Bonus: ${reason}`);
            return { sbxAwarded: roundedBonus };
        }
    } catch (e) {
        // SBX system not available, continue without bonus
    }
    return { sbxAwarded: 0 };
}

/**
 * Get combined perks from Arc Reactor AND SBX purchases
 * This is the main function to check user perks across all systems
 */
async function getCombinedPerks(userId) {
    // Get Arc Reactor perks
    const arcPerks = await getArcReactorPerks(userId);
    
    // Get SBX purchase effects
    let sbxEffects = {};
    const sbx = getStarkbucks();
    if (sbx) {
        try {
            sbxEffects = await sbx.getUserEffects(userId);
        } catch (e) {
            sbxEffects = {};
        }
    }
    
    // Combine perks - SBX effects stack with Arc Reactor
    return {
        // Arc Reactor base
        hasReactor: arcPerks.hasReactor,
        
        // Earnings multiplier (Arc: 1.15x, SBX income_boost: 1.25x)
        earningsMultiplier: arcPerks.earningsMultiplier * (sbxEffects.incomeMultiplier || 1),
        
        // Cooldown reduction (Arc: 0.75x, SBX cooldown_reduction: 0.70x)
        cooldownMultiplier: arcPerks.cooldownMultiplier * (1 - (sbxEffects.cooldownReduction || 0)),
        
        // Gambling bonus (Arc: +5%, SBX luck_boost: +10%)
        gamblingBonus: arcPerks.gamblingBonus + (sbxEffects.luckBoost || 0),
        
        // Daily multiplier (SBX daily_multiplier: 1.5x)
        dailyMultiplier: sbxEffects.dailyMultiplier || 1,
        
        // Flat daily bonus (Arc: 500)
        dailyBonus: arcPerks.dailyBonus,
        
        // Interest rate (Arc: 1%)
        interestRate: arcPerks.interestRate,
        
        // Minigame cooldown
        minigameCooldown: Math.floor(arcPerks.minigameCooldown * (1 - (sbxEffects.cooldownReduction || 0))),
        
        // SBX-specific effects
        sbxMultiplier: sbxEffects.sbxMultiplier || 1,
        xpMultiplier: sbxEffects.xpMultiplier || 1,
        
        // AI-related perks (for use in AI handlers)
        memoryMultiplier: sbxEffects.memoryMultiplier || 1,
        priorityQueue: sbxEffects.priorityQueue || false,
        personalities: sbxEffects.personalities || [],
        tokenMultiplier: sbxEffects.tokenMultiplier || 1,
        betaAccess: sbxEffects.betaAccess || false,
        customCommands: sbxEffects.customCommands || 0,
        vipSupport: sbxEffects.vipSupport || false,
        
        // Raw SBX effects for reference
        _sbxEffects: sbxEffects
    };
}

/**
 * Apply item effect
 */
async function applyItemEffect(userId, item) {
    const user = await loadUser(userId);

    if (item.duration) {
        user.activeEffects = user.activeEffects || [];
        user.activeEffects.push({
            itemId: item.id,
            effect: item.effect,
            expiresAt: Date.now() + item.duration
        });
    }

    await saveUser(userId, user);
}

// ============================================================================
// GAME FUNCTIONS
// ============================================================================

/**
 * Daily reward with streak system
 * Now uses combined perks from Arc Reactor AND SBX purchases
 */
async function claimDaily(userId, username) {
    const user = await loadUser(userId, username);
    const perks = await getCombinedPerks(userId);
    const now = Date.now();
    const timeSinceLastDaily = now - (user.lastDaily || 0);

    // Bot owner bypasses daily cooldown
    if (!isBotOwner(userId) && timeSinceLastDaily < ECONOMY_CONFIG.dailyCooldown) {
        const remaining = ECONOMY_CONFIG.dailyCooldown - timeSinceLastDaily;
        return {
            success: false,
            message: 'Already claimed',
            cooldown: remaining
        };
    }

    // Check streak
    const wasYesterday = timeSinceLastDaily < ECONOMY_CONFIG.dailyCooldown * 2;
    if (wasYesterday) {
        user.dailyStreak = Math.min(
            ensureNumber(user.dailyStreak, 0) + 1,
            ensureNumber(ECONOMY_CONFIG.maxDailyStreak, 30)
        );
    } else {
        user.dailyStreak = 1; // Reset streak
    }

    // Calculate reward
    const configuredDailyReward = ECONOMY_CONFIG.dailyReward;
    const baseReward =
        configuredDailyReward && typeof configuredDailyReward === 'object'
            ? ensureNumber(configuredDailyReward.min, 0) +
              Math.random() *
                  (ensureNumber(configuredDailyReward.max, 0) -
                      ensureNumber(configuredDailyReward.min, 0))
            : ensureNumber(configuredDailyReward, 0);

    let reward = Math.floor(baseReward);
    reward = ensureNumber(reward, 0);

    // Streak bonus
    const streakBonus =
        ensureNumber(user.dailyStreak, 0) * ensureNumber(ECONOMY_CONFIG.dailyStreakBonus, 0);
    reward = ensureNumber(reward + streakBonus, reward);

    // Arc Reactor daily bonus (+500 flat)
    let reactorBonus = 0;
    if (perks.hasReactor) {
        reactorBonus = perks.dailyBonus;
        reward += reactorBonus;
    }

    // Arc Reactor interest (1% of balance)
    let interestEarned = 0;
    if (perks.hasReactor && perks.interestRate > 0) {
        interestEarned = Math.floor(user.balance * perks.interestRate);
        reward += interestEarned;
    }

    // SBX daily multiplier (from purchased daily_multiplier item)
    if (perks.dailyMultiplier > 1) {
        reward = Math.floor(reward * perks.dailyMultiplier);
    }

    // Check for double daily item
    const hasDoubleDaily = (user.inventory || []).find(i => i.id === 'double_daily' && i.uses > 0);
    if (hasDoubleDaily) {
        reward *= 2;
        hasDoubleDaily.uses -= 1;
        if (hasDoubleDaily.uses <= 0) {
            user.inventory = user.inventory.filter(i => i.id !== 'double_daily');
        }
    }

    user.balance =
        ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance) + ensureNumber(reward, 0);
    user.totalEarned = ensureNumber(user.totalEarned, 0) + ensureNumber(reward, 0);
    user.lastDaily = now;

    await saveUser(userId, user);

    // Award SBX bonus (1% of earnings)
    const sbxBonus = await awardSbxBonus(userId, reward, 'daily');

    return {
        success: true,
        reward,
        streak: user.dailyStreak,
        streakBonus,
        doubled: !!hasDoubleDaily,
        newBalance: user.balance,
        sbxAwarded: sbxBonus.sbxAwarded
    };
}

/**
 * Work for money
 */
async function work(userId, username) {
    const user = await loadUser(userId, username);
    const arcPerks = await getArcReactorPerks(userId);

    // Check for work cooldown reduction
    const effects = await getActiveEffects(userId);
    let cooldownMultiplier = arcPerks.cooldownMultiplier; // Arc Reactor reduces cooldowns
    effects.forEach(e => {
        if (e.effect?.workCooldownReduction) {
            cooldownMultiplier *= 1 - e.effect.workCooldownReduction;
        }
    });

    const cooldown = checkCooldown(
        userId,
        'work',
        ECONOMY_CONFIG.workCooldown * cooldownMultiplier
    );
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    let reward = Math.floor(
        ECONOMY_CONFIG.workReward.min +
            Math.random() * (ECONOMY_CONFIG.workReward.max - ECONOMY_CONFIG.workReward.min)
    );

    // Apply Arc Reactor earnings bonus
    reward = Math.floor(reward * arcPerks.earningsMultiplier);

    // Apply multiplier bonus if event active
    if (isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const jobs = [
        `fixed a bug in the Mark ${Math.floor(Math.random() * 50 + 1)} suit`,
        `calibrated the arc reactor`,
        `organized Tony's workshop`,
        `debugged FRIDAY's code`,
        `polished the Iron Legion`,
        `updated the Stark satellite network`,
        `ran diagnostics on the Quinjet`,
        `cleaned Dum-E's mess`,
        `tested new repulsor tech`,
        `encrypted classified files`,
        `repaired JARVIS's voice module`,
        `optimized nanotech deployment systems`,
        `calibrated Iron Man's targeting systems`,
        `fixed the Avengers Tower elevator`,
        `debugged War Machine's flight systems`,
        `updated Pepper's calendar integration`,
        `tested new energy shield prototypes`,
        `organized Cap's shield collection`,
        `repaired Spider-Man's web shooters`,
        `calibrated Hawkeye's bow targeting`,
        `fixed Black Widow's stealth tech`,
        `updated Thor's hammer tracking`,
        `debugged Hulk's transformation sensors`,
        `repaired Vision's density controls`,
        `calibrated Scarlet Witch's power dampeners`,
        `fixed Doctor Strange's portal generator`,
        `updated Black Panther's vibranium suit`,
        `debugged Ant-Man's size controls`,
        `repaired Wasp's shrinking tech`,
        `calibrated Captain Marvel's energy absorption`,
        `fixed Falcon's wing systems`,
        `updated Winter Soldier's arm`,
        `debugged Loki's illusion projectors`,
        `repaired Rocket's weapon modifications`,
        `calibrated Groot's growth inhibitors`,
        `fixed Drax's invisibility (still working on it)`,
        `updated Gamora's sword maintenance`,
        `debugged Nebula's cybernetic upgrades`,
        `repaired Mantis's empathy sensors`,
        `calibrated Star-Lord's music player`,
        `fixed Yondu's arrow controller`,
        `updated Ego's planet core systems`,
        `debugged Thanos's gauntlet interface`,
        `repaired Ultron's consciousness backup`,
        `calibrated Zemo's mask filters`,
        `fixed Killmonger's suit systems`,
        `updated Shuri's lab equipment`,
        `debugged M'Baku's armor`,
        `repaired Okoye's spear tech`,
        `calibrated Nakia's ring blades`
    ];

    const job = jobs[Math.floor(Math.random() * jobs.length)];

    user.balance += reward;
    user.totalEarned = (user.totalEarned || 0) + reward;
    await saveUser(userId, user);

    // Award SBX bonus (1% of earnings)
    const sbxBonus = await awardSbxBonus(userId, reward, 'work');

    return {
        success: true,
        reward,
        job,
        newBalance: user.balance,
        sbxAwarded: sbxBonus.sbxAwarded
    };
}

/**
 * Gamble (double or nothing)
 */
async function gamble(userId, amount) {
    const user = await loadUser(userId);
    const arcPerks = await getArcReactorPerks(userId);

    if (amount < 1) return { success: false, error: 'Minimum bet is 1 Stark Buck' };
    if (amount > user.balance) return { success: false, error: 'Insufficient funds' };

    // Check for lucky charm
    const effects = await getActiveEffects(userId);
    let winRate = ECONOMY_CONFIG.gamblingWinRate;
    effects.forEach(e => {
        if (e.effect?.gamblingBonus) {
            winRate += e.effect.gamblingBonus;
        }
    });

    // Arc Reactor gambling bonus (+5%)
    winRate += arcPerks.gamblingBonus;

    // Bot owner always wins
    const won = isBotOwner(userId) ? true : Math.random() < winRate;
    const change = won ? amount : -amount;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + amount;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (won) user.gamesWon = (user.gamesWon || 0) + 1;
    if (change > 0) user.totalEarned = (user.totalEarned || 0) + change;
    else user.totalLost = (user.totalLost || 0) + Math.abs(change);

    await saveUser(userId, user);

    return {
        success: true,
        won,
        amount,
        change,
        newBalance: user.balance,
        winRate: Math.round(winRate * 100)
    };
}

/**
 * Slot machine
 */
async function playSlots(userId, bet) {
    const user = await loadUser(userId);

    const normalizedBet = Number(bet);
    if (!Number.isFinite(normalizedBet) || normalizedBet <= 0) {
        return { success: false, error: 'Invalid bet amount' };
    }

    if (normalizedBet < 10) return { success: false, error: 'Minimum bet is 10 Stark Bucks' };
    if (normalizedBet > user.balance) return { success: false, error: 'Insufficient funds' };

    // Spin the slots (bot owner always gets jackpot)
    let results;
    if (isBotOwner(userId)) {
        results = ['💎', '💎', '💎']; // Guaranteed jackpot
    } else {
        results = [
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
        ];
    }

    // Calculate winnings
    let multiplier = 0;
    let resultType = 'loss';

    const slotsMultipliers =
        ECONOMY_CONFIG && ECONOMY_CONFIG.slotsMultipliers
            ? ECONOMY_CONFIG.slotsMultipliers
            : { double: 2, triple: 3, jackpot: 10 };

    if (results[0] === results[1] && results[1] === results[2]) {
        if (results[0] === '💎') {
            multiplier = slotsMultipliers.jackpot;
            resultType = 'jackpot';
        } else {
            multiplier = slotsMultipliers.triple;
            resultType = 'triple';
        }
    } else if (
        results[0] === results[1] ||
        results[1] === results[2] ||
        results[0] === results[2]
    ) {
        multiplier = slotsMultipliers.double;
        resultType = 'double';
    }

    if (!Number.isFinite(multiplier) || multiplier < 0) {
        multiplier = 0;
        resultType = 'loss';
    }

    const winnings = normalizedBet * multiplier;
    const change = winnings - normalizedBet;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + normalizedBet;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (change > 0) {
        user.gamesWon = (user.gamesWon || 0) + 1;
        user.totalEarned = (user.totalEarned || 0) + change;
    } else {
        user.totalLost = (user.totalLost || 0) + Math.abs(change);
    }

    await saveUser(userId, user);

    return {
        success: true,
        results,
        resultType,
        multiplier,
        bet: normalizedBet,
        winnings,
        change,
        newBalance: user.balance
    };
}

/**
 * Coinflip
 */
async function coinflip(userId, bet, choice) {
    const user = await loadUser(userId);

    if (bet < 1) return { success: false, error: 'Minimum bet is 1 Stark Buck' };
    if (bet > user.balance) return { success: false, error: 'Insufficient funds' };

    // Bot owner always wins (result matches their choice)
    const result = isBotOwner(userId) ? choice.toLowerCase() : (Math.random() < 0.5 ? 'heads' : 'tails');
    const won = choice.toLowerCase() === result;
    const change = won ? bet : -bet;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + bet;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (won) user.gamesWon = (user.gamesWon || 0) + 1;
    if (change > 0) user.totalEarned = (user.totalEarned || 0) + change;
    else user.totalLost = (user.totalLost || 0) + Math.abs(change);

    await saveUser(userId, user);

    return {
        success: true,
        choice,
        result,
        won,
        change,
        newBalance: user.balance
    };
}

/**
 * Rob another user
 */
async function rob(userId, targetId, username) {
    if (userId === targetId) return { success: false, error: 'Cannot rob yourself' };

    const cooldown = checkCooldown(userId, 'rob', ECONOMY_CONFIG.robCooldown);
    if (cooldown.onCooldown) {
        return { success: false, error: 'On cooldown', cooldown: cooldown.remaining };
    }

    const user = await loadUser(userId, username);
    const target = await loadUser(targetId);

    // Check if target has shield
    const targetEffects = await getActiveEffects(targetId);
    const hasShield = targetEffects.some(e => e.itemId === 'shield');
    if (hasShield) {
        return { success: false, error: 'Target has a shield active!' };
    }

    if (target.balance < 50) {
        return { success: false, error: 'Target is too poor to rob' };
    }

    // Bot owner always succeeds
    const succeeded = isBotOwner(userId) ? true : Math.random() < ECONOMY_CONFIG.robSuccessRate;

    if (succeeded) {
        const maxSteal = Math.floor(target.balance * ECONOMY_CONFIG.robMaxPercent);
        const stolen = Math.floor(Math.random() * maxSteal) + 1;

        user.balance += stolen;
        target.balance -= stolen;
        user.totalEarned = (user.totalEarned || 0) + stolen;
        target.totalLost = (target.totalLost || 0) + stolen;

        await saveUser(userId, user);
        await saveUser(targetId, target);

        return {
            success: true,
            succeeded: true,
            stolen,
            newBalance: user.balance
        };
    } else {
        // Failed - pay fine
        const fine = Math.floor(user.balance * 0.1);
        user.balance -= fine;
        user.totalLost = (user.totalLost || 0) + fine;
        await saveUser(userId, user);

        return {
            success: true,
            succeeded: false,
            fine,
            newBalance: user.balance
        };
    }
}

// ============================================================================
// SHOP FUNCTIONS
// ============================================================================

/**
 * Get shop items
 */
function getShopItems() {
    return Object.values(SHOP_ITEMS);
}

/**
 * Buy item from shop
 */
async function buyItem(userId, itemId) {
    const item = SHOP_ITEMS[itemId];
    if (!item) return { success: false, error: 'Item not found' };

    const user = await loadUser(userId);

    // Check if already owns one-time item
    if (item.oneTime) {
        const alreadyOwns = (user.inventory || []).some(i => i.id === itemId);
        if (alreadyOwns) {
            return { success: false, error: 'You already own this item' };
        }
    }

    if (user.balance < item.price) {
        return { success: false, error: 'Insufficient funds' };
    }

    user.balance -= item.price;
    user.inventory = user.inventory || [];
    user.inventory.push({
        id: item.id,
        name: item.name,
        purchasedAt: Date.now(),
        uses: item.uses || null
    });

    // Apply effect if applicable
    if (item.type === 'booster' || item.type === 'protection') {
        await applyItemEffect(userId, item);
    }

    await saveUser(userId, user);

    return {
        success: true,
        item,
        newBalance: user.balance
    };
}

/**
 * Get user inventory
 */
async function getInventory(userId) {
    const user = await loadUser(userId);
    return user.inventory || [];
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Get top users by balance
 * @param {number} limit - Number of users to return
 * @param {Object} client - Optional Discord client to fetch current usernames
 */
async function getLeaderboard(limit = 10, client = null) {
    try {
        const col = await getCollection();
        const users = await col.find({}).sort({ balance: -1 }).limit(limit).toArray();

        // Fetch current usernames from Discord if client is provided
        const leaderboardEntries = await Promise.all(
            users.map(async (u, i) => {
                let username = u.username || 'Unknown';

                // Try to get current username from Discord
                if (client) {
                    try {
                        // Check cache first
                        let discordUser = client.users.cache.get(u.userId);
                        if (!discordUser) {
                            // Fetch from API if not in cache
                            discordUser = await client.users.fetch(u.userId).catch(() => null);
                        }
                        if (discordUser) {
                            username = discordUser.globalName || discordUser.username || username;
                        }
                    } catch (error) {
                        // If fetch fails, use stored username
                        console.warn(
                            `[StarkEconomy] Failed to fetch username for user ${u.userId}:`,
                            error.message
                        );
                    }
                }

                return {
                    rank: i + 1,
                    userId: u.userId,
                    username: username,
                    balance: ensureNumber(u.balance, 0),
                    hasGoldenName: (u.inventory || []).some(item => item.id === 'golden_name'),
                    hasVipBadge: (u.inventory || []).some(item => item.id === 'vip_badge')
                };
            })
        );

        return leaderboardEntries;
    } catch (error) {
        console.error('[StarkEconomy] Failed to get leaderboard:', error);
        return [];
    }
}

/**
 * Get user stats
 */
async function getUserStats(userId) {
    const user = await loadUser(userId);
    return {
        balance: user.balance,
        totalEarned: user.totalEarned || 0,
        totalLost: user.totalLost || 0,
        totalGambled: user.totalGambled || 0,
        gamesPlayed: user.gamesPlayed || 0,
        gamesWon: user.gamesWon || 0,
        winRate: user.gamesPlayed > 0 ? Math.round((user.gamesWon / user.gamesPlayed) * 100) : 0,
        dailyStreak: user.dailyStreak || 0,
        inventoryCount: (user.inventory || []).length,
        memberSince: user.createdAt
    };
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clean up old session data (keeps user balances/inventory)
 */
async function cleanup() {
    const now = Date.now();

    // Clear old cooldowns from memory
    for (const [key, timestamp] of cooldowns.entries()) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            // 24 hours
            cooldowns.delete(key);
        }
    }

    // Clear cache for users not accessed in 1 hour
    for (const [userId, userData] of userCache.entries()) {
        if (userData.lastAccessed && now - userData.lastAccessed > 60 * 60 * 1000) {
            userCache.delete(userId);
        }
    }

    // Clean expired effects in database
    try {
        const col = await getCollection();
        await col.updateMany({}, { $pull: { activeEffects: { expiresAt: { $lt: now } } } });
    } catch (error) {
        console.error('[StarkEconomy] Cleanup failed:', error);
    }

    lastCleanup = now;
    console.log('[StarkEconomy] Cleanup completed');
}

// ============================================================================
// MINIGAMES (Hunt, Fish, Dig, Beg)
// ============================================================================

/**
 * Generic minigame handler
 */
async function playMinigame(userId, gameType) {
    const game = MINIGAME_REWARDS[gameType];
    if (!game) return { success: false, error: 'Unknown game type' };

    // Apply Arc Reactor cooldown reduction
    const arcPerks = await getArcReactorPerks(userId);
    const cooldown = checkCooldown(userId, gameType, game.cooldown * arcPerks.cooldownMultiplier);
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    // Pick random outcome uniformly from all outcomes
    // (all outcomes have equal chance regardless of 'chance' field value)
    const outcome = game.outcomes[Math.floor(Math.random() * game.outcomes.length)];

    // Apply Arc Reactor earnings bonus
    let reward = outcome.reward;
    if (reward > 0) {
        reward = Math.floor(reward * arcPerks.earningsMultiplier);
    }

    // Apply multiplier bonus if event active (only to positive rewards)
    if (reward > 0 && isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const user = await loadUser(userId);
    user.balance = Math.max(0, user.balance + reward); // Don't go negative
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

/**
 * Hunt for animals
 */
async function hunt(userId) {
    return playMinigame(userId, 'hunt');
}

/**
 * Fish in the ocean
 */
async function fish(userId) {
    return playMinigame(userId, 'fish');
}

/**
 * Dig for treasure
 */
async function dig(userId) {
    return playMinigame(userId, 'dig');
}

/**
 * Beg for money
 */
async function beg(userId) {
    return playMinigame(userId, 'beg');
}

/**
 * Commit a crime (risky but high reward)
 */
async function crime(userId) {
    return playMinigame(userId, 'crime');
}

/**
 * Post a meme for money
 */
async function postmeme(userId) {
    return playMinigame(userId, 'postmeme');
}

/**
 * Search a location for money
 */
async function search(userId, locationIndex = null) {
    const game = MINIGAME_REWARDS.search;

    const cooldown = checkCooldown(userId, 'search', game.cooldown);
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    // Pick random location if not specified
    const location =
        locationIndex !== null && game.locations[locationIndex]
            ? game.locations[locationIndex]
            : game.locations[Math.floor(Math.random() * game.locations.length)];

    // Pick random outcome from location
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

    // Apply multiplier bonus if event active (only to positive rewards)
    let reward = outcome.reward;
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

/**
 * Get available search locations
 */
function getSearchLocations() {
    return MINIGAME_REWARDS.search.locations.map((l, i) => ({
        index: i,
        name: l.name
    }));
}

/**
 * Give money to another user
 */
async function give(fromUserId, toUserId, amount, fromUsername, toUsername) {
    if (fromUserId === toUserId) {
        return { success: false, error: 'Cannot give money to yourself' };
    }
    if (amount < 1) {
        return { success: false, error: 'Amount must be at least 1' };
    }

    const fromUser = await loadUser(fromUserId, fromUsername);
    if (fromUser.balance < amount) {
        return { success: false, error: 'Insufficient funds' };
    }

    const toUser = await loadUser(toUserId, toUsername);

    // Transfer
    fromUser.balance -= amount;
    toUser.balance += amount;
    toUser.totalEarned = (toUser.totalEarned || 0) + amount;

    await saveUser(fromUserId, fromUser);
    await saveUser(toUserId, toUser);

    return {
        success: true,
        amount,
        fromBalance: fromUser.balance,
        toBalance: toUser.balance
    };
}

// Auto-cleanup interval
setInterval(() => {
    cleanup().catch(console.error);
}, ECONOMY_CONFIG.cleanupInterval);

// ============================================================================
// MULTIPLIER EVENT SYSTEM (250% bonus every 3 hours, lasts 7 hours)
// ============================================================================

let multiplierActive = false;
let multiplierEndTime = 0;
let lastMultiplierStart = 0;

/**
 * Check if multiplier is currently active
 */
function isMultiplierActive() {
    if (multiplierActive && Date.now() < multiplierEndTime) {
        return true;
    }
    if (multiplierActive && Date.now() >= multiplierEndTime) {
        multiplierActive = false;
        console.log('[StarkEconomy] 250% multiplier event ended');
    }
    return false;
}

/**
 * Get current multiplier value
 */
function getMultiplier() {
    return isMultiplierActive() ? ECONOMY_CONFIG.multiplierBonus : 1;
}

/**
 * Get multiplier status
 */
function getMultiplierStatus() {
    const active = isMultiplierActive();
    return {
        active,
        multiplier: active ? ECONOMY_CONFIG.multiplierBonus : 1,
        endsAt: active ? multiplierEndTime : null,
        nextEventIn: active
            ? null
            : Math.max(0, lastMultiplierStart + ECONOMY_CONFIG.multiplierInterval - Date.now())
    };
}

/**
 * Start multiplier event (no DMs - users see boost in command responses)
 */
async function startMultiplierEvent() {
    multiplierActive = true;
    multiplierEndTime = Date.now() + ECONOMY_CONFIG.multiplierDuration;
    lastMultiplierStart = Date.now();
    console.log('[StarkEconomy] 🎉 250% multiplier event started! Lasts 7 hours.');
}

/**
 * Get boost notification text to append to economy command responses
 * Returns empty string if no boost active
 */
function getBoostText() {
    if (!isMultiplierActive()) return '';

    const remaining = multiplierEndTime - Date.now();
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    return `\n\n🎉 **600% BOOST ACTIVE!** All earnings x6! (${hours}h ${minutes}m remaining)`;
}

// Schedule multiplier events every 3 hours
let multiplierInterval = null;
function startMultiplierScheduler() {
    if (multiplierInterval) clearInterval(multiplierInterval);

    // Start first event after 3 hours
    multiplierInterval = setInterval(() => {
        if (!isMultiplierActive()) {
            startMultiplierEvent();
        }
    }, ECONOMY_CONFIG.multiplierInterval);

    console.log('[StarkEconomy] Multiplier event scheduler started (every 3 hours)');
}

// ============================================================================
// TINKER / CRAFTING SYSTEM
// ============================================================================

/**
 * Get user's collected materials
 */
async function getMaterials(userId) {
    const user = await loadUser(userId);
    return user.materials || {};
}

/**
 * Check if user has required materials for a recipe
 */
async function hasRequiredMaterials(userId, ingredients) {
    const materials = await getMaterials(userId);
    for (const [material, required] of Object.entries(ingredients)) {
        if ((materials[material] || 0) < required) {
            return false;
        }
    }
    return true;
}

/**
 * Craft an item from materials
 */
async function craftItem(userId, recipeId, recipe) {
    const user = await loadUser(userId);
    user.materials = user.materials || {};

    // Check if user has all required materials
    for (const [material, required] of Object.entries(recipe.ingredients)) {
        if ((user.materials[material] || 0) < required) {
            return {
                success: false,
                error: `Missing ${required - (user.materials[material] || 0)}x ${material}`
            };
        }
    }

    // Consume materials
    for (const [material, required] of Object.entries(recipe.ingredients)) {
        user.materials[material] -= required;
        if (user.materials[material] <= 0) {
            delete user.materials[material];
        }
    }

    // Add crafted item to inventory
    user.inventory = user.inventory || [];
    user.inventory.push({
        id: recipeId,
        name: recipe.name,
        description: recipe.description,
        value: recipe.value,
        rarity: recipe.rarity,
        craftedAt: Date.now()
    });

    // Track crafting stats
    user.totalCrafted = (user.totalCrafted || 0) + 1;

    await saveUser(userId, user);

    return {
        success: true,
        item: recipe.name,
        value: recipe.value,
        rarity: recipe.rarity
    };
}

/**
 * Sell a crafted item for coins
 */
async function sellItem(userId, itemIndex) {
    const user = await loadUser(userId);
    user.inventory = user.inventory || [];

    if (itemIndex < 0 || itemIndex >= user.inventory.length) {
        return { success: false, error: 'Invalid item index' };
    }

    const item = user.inventory[itemIndex];
    
    // Can't sell special items like arc_reactor
    if (item.id === 'arc_reactor' || item.oneTime) {
        return { success: false, error: 'This item cannot be sold' };
    }

    const sellValue = Math.floor((item.value || 100) * 0.7); // 70% of value
    user.inventory.splice(itemIndex, 1);
    user.balance += sellValue;
    user.totalEarned = (user.totalEarned || 0) + sellValue;

    await saveUser(userId, user);

    return {
        success: true,
        item: item.name,
        value: sellValue,
        newBalance: user.balance
    };
}

// ============================================================================
// NEW FEATURES: Daily Challenges, Prestige, Pets, Heist, Boss, Lottery, Quests, Tournaments, Auction
// ============================================================================

// In-memory storage for new features (persisted via user document)
const activeHeists = new Map(); // guildId -> heist data
const activeBosses = new Map(); // guildId -> boss data
const activeTournaments = new Map(); // guildId -> tournament data
const auctionListings = new Map(); // auctionId -> listing data

// Lottery data
let lotteryData = {
    jackpot: 10000,
    ticketPrice: 100,
    tickets: new Map(), // userId -> ticket count
    lastWinner: null,
    drawTime: Date.now() + 7 * 24 * 60 * 60 * 1000 // 1 week
};

// Daily challenge definitions
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

// Pet definitions
const PET_TYPES = {
    dog: { emoji: '🐕', name: 'Dog', cost: 5000, bonus: '+5% work earnings', bonusType: 'work', bonusValue: 0.05 },
    cat: { emoji: '🐈', name: 'Cat', cost: 5000, bonus: '+5% gambling luck', bonusType: 'gambling', bonusValue: 0.05 },
    dragon: { emoji: '🐉', name: 'Dragon', cost: 25000, bonus: '+10% all earnings', bonusType: 'all', bonusValue: 0.10 },
    phoenix: { emoji: '🔥', name: 'Phoenix', cost: 50000, bonus: '+15% all earnings', bonusType: 'all', bonusValue: 0.15 },
    unicorn: { emoji: '🦄', name: 'Unicorn', cost: 30000, bonus: '-30% cooldowns', bonusType: 'cooldown', bonusValue: 0.30 }
};

// Quest definitions
const QUESTS = [
    { id: 'iron_collector', name: 'Iron Collector', shortDesc: 'Collect iron materials', description: 'Tony needs scrap metal for a new suit.', difficulty: 'Easy', objectives: ['Dig 5 times', 'Collect 3 Iron Ore'], reward: 1000, xp: 50 },
    { id: 'sea_hunter', name: 'Sea Hunter', shortDesc: 'Master the seas', description: 'Prove yourself as a fisherman.', difficulty: 'Easy', objectives: ['Fish 10 times', 'Catch a rare fish'], reward: 1500, xp: 75 },
    { id: 'risk_taker', name: 'Risk Taker', shortDesc: 'Test your luck', description: 'Gamble your way to glory.', difficulty: 'Medium', objectives: ['Win 5 gambles', 'Win 1000 total'], reward: 3000, xp: 150 },
    { id: 'master_crafter', name: 'Master Crafter', shortDesc: 'Craft MCU items', description: 'Create legendary Stark tech.', difficulty: 'Hard', objectives: ['Craft 5 items', 'Craft a rare+ item'], reward: 5000, xp: 250 },
    { id: 'stark_employee', name: 'Stark Employee', shortDesc: 'Work at Stark Industries', description: 'Prove your worth to Tony.', difficulty: 'Easy', objectives: ['Work 10 times', 'Earn 500 from work'], reward: 1200, xp: 60 }
];

// Boss definitions
const BOSSES = [
    { name: 'Ultron Prime', description: 'The rogue AI returns!', maxHp: 50000, rewardPool: 25000 },
    { name: 'Thanos', description: 'The Mad Titan seeks the stones.', maxHp: 100000, rewardPool: 50000 },
    { name: 'Dormammu', description: 'The Dark Dimension threatens reality.', maxHp: 75000, rewardPool: 35000 },
    { name: 'Galactus', description: 'The Devourer of Worlds approaches!', maxHp: 150000, rewardPool: 75000 }
];

/**
 * Get daily challenges for user
 */
async function getDailyChallenges(userId) {
    const user = await loadUser(userId);
    const today = new Date().toDateString();
    
    // Reset challenges if new day
    if (user.challengeDate !== today) {
        // Pick 3 random challenges
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

/**
 * Update challenge progress
 */
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

/**
 * Get prestige data
 */
async function getPrestigeData(userId) {
    const user = await loadUser(userId);
    return {
        level: user.prestigeLevel || 0,
        bonus: (user.prestigeLevel || 0) * 5 // 5% per level
    };
}

/**
 * Perform prestige
 */
async function prestige(userId) {
    const user = await loadUser(userId);
    const newLevel = (user.prestigeLevel || 0) + 1;
    
    user.prestigeLevel = newLevel;
    user.balance = ECONOMY_CONFIG.startingBalance; // Reset balance
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

/**
 * Get pet data
 */
async function getPetData(userId) {
    const user = await loadUser(userId);
    return {
        hasPet: !!user.pet,
        pet: user.pet || null
    };
}

/**
 * Buy a pet
 */
async function buyPet(userId, petType) {
    const user = await loadUser(userId);
    
    if (user.pet) {
        return { success: false, error: 'You already have a pet!' };
    }
    
    const type = petType.toLowerCase();
    const petDef = PET_TYPES[type];
    
    if (!petDef) {
        return { success: false, error: `Unknown pet type. Available: ${Object.keys(PET_TYPES).join(', ')}` };
    }
    
    if (user.balance < petDef.cost) {
        return { success: false, error: `Insufficient funds! Need ${petDef.cost} Stark Bucks` };
    }
    
    user.balance -= petDef.cost;
    user.pet = {
        type: petDef.name,
        emoji: petDef.emoji,
        name: petDef.name,
        level: 1,
        happiness: 100,
        bonus: petDef.bonus,
        bonusType: petDef.bonusType,
        bonusValue: petDef.bonusValue,
        lastFed: Date.now(),
        adoptedAt: Date.now()
    };
    
    await saveUser(userId, user);
    
    return { success: true, pet: user.pet, cost: petDef.cost };
}

/**
 * Feed pet
 */
async function feedPet(userId) {
    const user = await loadUser(userId);
    
    if (!user.pet) {
        return { success: false, error: 'You don\'t have a pet!' };
    }
    
    const feedCost = 100;
    if (user.balance < feedCost) {
        return { success: false, error: 'Not enough money to feed your pet!' };
    }
    
    user.balance -= feedCost;
    const happinessGain = Math.min(100 - user.pet.happiness, 30);
    user.pet.happiness = Math.min(100, user.pet.happiness + happinessGain);
    user.pet.lastFed = Date.now();
    
    // Level up pet occasionally
    if (Math.random() < 0.1) {
        user.pet.level++;
    }
    
    await saveUser(userId, user);
    
    return { success: true, newHappiness: user.pet.happiness, happinessGain, cost: feedCost };
}

/**
 * Rename pet
 */
async function renamePet(userId, newName) {
    const user = await loadUser(userId);
    if (user.pet) {
        user.pet.name = newName;
        await saveUser(userId, user);
    }
}

/**
 * Start a heist
 */
async function startHeist(guildId, userId, bet) {
    if (activeHeists.has(guildId)) {
        return { success: false, error: 'A heist is already in progress!' };
    }
    
    const user = await loadUser(userId);
    if (user.balance < bet) {
        return { success: false, error: 'Insufficient funds!' };
    }
    
    user.balance -= bet;
    await saveUser(userId, user);
    
    activeHeists.set(guildId, {
        startedBy: userId,
        bet,
        participants: [{ id: userId, bet }],
        prizePool: bet,
        startTime: Date.now(),
        maxParticipants: 8
    });
    
    return { success: true };
}

/**
 * Join a heist
 */
async function joinHeist(guildId, userId) {
    const heist = activeHeists.get(guildId);
    
    if (!heist) {
        return { success: false, error: 'No active heist!' };
    }
    
    if (heist.participants.some(p => p.id === userId)) {
        return { success: false, error: 'Already in this heist!' };
    }
    
    if (heist.participants.length >= heist.maxParticipants) {
        return { success: false, error: 'Heist is full!' };
    }
    
    const user = await loadUser(userId);
    if (user.balance < heist.bet) {
        return { success: false, error: 'Insufficient funds!' };
    }
    
    user.balance -= heist.bet;
    await saveUser(userId, user);
    
    heist.participants.push({ id: userId, bet: heist.bet });
    heist.prizePool += heist.bet;
    
    return { 
        success: true, 
        participants: heist.participants.length,
        maxParticipants: heist.maxParticipants
    };
}

/**
 * Execute heist
 */
async function executeHeist(guildId) {
    const heist = activeHeists.get(guildId);
    
    if (!heist) {
        return { success: false, error: 'No active heist!' };
    }
    
    activeHeists.delete(guildId);
    
    if (heist.participants.length < 3) {
        // Refund everyone
        for (const p of heist.participants) {
            await modifyBalance(p.id, p.bet, 'heist_refund');
        }
        return { success: true, won: false, story: 'Not enough participants. Everyone refunded.' };
    }
    
    // Calculate success (more participants = better odds)
    const successChance = 0.3 + (heist.participants.length * 0.08);
    const won = Math.random() < successChance;
    
    const stories = won ? [
        'The team infiltrated the vault undetected!',
        'Jarvis hacked the security system perfectly!',
        'A flawless execution worthy of Ocean\'s Eleven!'
    ] : [
        'Security caught wind of the plan!',
        'The vault was empty - it was a trap!',
        'Iron Man showed up and stopped the heist!'
    ];
    
    const story = stories[Math.floor(Math.random() * stories.length)];
    
    if (won) {
        const bonus = Math.floor(heist.prizePool * 0.5); // 50% bonus
        const totalPayout = heist.prizePool + bonus;
        const perPerson = Math.floor(totalPayout / heist.participants.length);
        
        const winners = [];
        for (const p of heist.participants) {
            await modifyBalance(p.id, perPerson, 'heist_win');
            winners.push({ id: p.id, winnings: perPerson });
        }
        
        return { success: true, won: true, story, winners };
    }
    
    return { success: true, won: false, story, winners: [] };
}

/**
 * Get heist status
 */
async function getHeistStatus(guildId) {
    const heist = activeHeists.get(guildId);
    
    if (!heist) {
        return { active: false };
    }
    
    return {
        active: true,
        participants: heist.participants.length,
        maxParticipants: heist.maxParticipants,
        prizePool: heist.prizePool,
        timeLeft: 60000 - (Date.now() - heist.startTime)
    };
}

/**
 * Get boss data
 */
async function getBossData(guildId) {
    if (!activeBosses.has(guildId)) {
        // Spawn a random boss
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

/**
 * Attack boss
 */
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
        // Distribute rewards
        const totalDamage = Array.from(boss.damageDealt.values()).reduce((a, b) => a + b, 0);
        const userShare = userDamage / totalDamage;
        const reward = Math.floor(boss.rewardPool * userShare);
        
        await modifyBalance(userId, reward, 'boss_kill');
        result.reward = reward;
        
        // Respawn new boss
        activeBosses.delete(guildId);
    }
    
    return result;
}

/**
 * Get lottery data
 */
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

/**
 * Buy lottery tickets
 */
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

/**
 * Get quest data
 */
async function getQuestData(userId) {
    const user = await loadUser(userId);
    return {
        activeQuest: user.activeQuest || null,
        completedQuests: user.completedQuests || []
    };
}

/**
 * Get available quests
 */
async function getAvailableQuests() {
    return QUESTS;
}

/**
 * Start a quest
 */
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

/**
 * Complete quest
 */
async function completeQuest(userId) {
    const user = await loadUser(userId);
    
    if (!user.activeQuest) {
        return { success: false, error: 'No active quest!' };
    }
    
    // For simplicity, auto-complete after some activity
    const quest = user.activeQuest;
    
    user.balance += quest.reward;
    user.totalEarned = (user.totalEarned || 0) + quest.reward;
    user.completedQuests = user.completedQuests || [];
    user.completedQuests.push(quest.id);
    user.activeQuest = null;
    
    await saveUser(userId, user);
    
    return { success: true, quest, reward: quest.reward, xp: quest.xp };
}

/**
 * Get tournament data
 */
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

/**
 * Join tournament
 */
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

/**
 * List auction
 */
async function listAuction(userId, itemIndex, price) {
    const user = await loadUser(userId);
    
    if (!user.inventory || itemIndex >= user.inventory.length) {
        return { success: false, error: 'Invalid item!' };
    }
    
    const item = user.inventory[itemIndex];
    if (item.id === 'arc_reactor') {
        return { success: false, error: 'Cannot sell Arc Reactor!' };
    }
    
    const auctionId = `AH${Date.now().toString(36)}`;
    
    auctionListings.set(auctionId, {
        id: auctionId,
        sellerId: userId,
        sellerName: user.username || 'Unknown',
        item: item.name,
        itemData: item,
        price,
        listedAt: Date.now()
    });
    
    user.inventory.splice(itemIndex, 1);
    await saveUser(userId, user);
    
    return { success: true, item: item.name, auctionId };
}

/**
 * Buy from auction
 */
async function buyAuction(userId, auctionId) {
    const listing = auctionListings.get(auctionId);
    
    if (!listing) {
        return { success: false, error: 'Listing not found!' };
    }
    
    if (listing.sellerId === userId) {
        return { success: false, error: 'Cannot buy your own listing!' };
    }
    
    const buyer = await loadUser(userId);
    
    if (buyer.balance < listing.price) {
        return { success: false, error: 'Insufficient funds!' };
    }
    
    // Transfer money
    buyer.balance -= listing.price;
    buyer.inventory = buyer.inventory || [];
    buyer.inventory.push(listing.itemData);
    await saveUser(userId, buyer);
    
    // Pay seller (minus 5% fee)
    const sellerPayout = Math.floor(listing.price * 0.95);
    await modifyBalance(listing.sellerId, sellerPayout, 'auction_sale');
    
    auctionListings.delete(auctionId);
    
    return { success: true, item: listing.item, price: listing.price };
}

/**
 * Get all auctions
 */
async function getAuctions() {
    return Array.from(auctionListings.values()).slice(0, 50);
}

/**
 * Get user's auctions
 */
async function getUserAuctions(userId) {
    return Array.from(auctionListings.values()).filter(a => a.sellerId === userId);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Config
    ECONOMY_CONFIG,
    SHOP_ITEMS,

    // Core
    getBalance,
    modifyBalance,
    loadUser,
    isBotOwner,

    // Games
    claimDaily,
    work,
    gamble,
    playSlots,
    coinflip,
    rob,

    // Shop
    getShopItems,
    buyItem,
    getInventory,
    getActiveEffects,

    // Arc Reactor & SBX Perks
    hasArcReactor,
    getArcReactorPerks,
    getCombinedPerks,

    // Tinker / Crafting
    getMaterials,
    hasRequiredMaterials,
    craftItem,
    sellItem,

    // Stats
    getLeaderboard,
    getUserStats,

    // Minigames
    hunt,
    fish,
    dig,
    beg,
    crime,
    postmeme,
    search,
    getSearchLocations,
    give,

    // Maintenance
    cleanup,

    // Multiplier Events
    isMultiplierActive,
    getMultiplier,
    getMultiplierStatus,
    getBoostText,
    startMultiplierEvent,
    startMultiplierScheduler,

    // NEW: Daily Challenges
    getDailyChallenges,
    updateChallengeProgress,

    // NEW: Prestige System
    getPrestigeData,
    prestige,

    // NEW: Pet System
    getPetData,
    buyPet,
    feedPet,
    renamePet,

    // NEW: Heist System
    startHeist,
    joinHeist,
    executeHeist,
    getHeistStatus,

    // NEW: Boss Battles
    getBossData,
    attackBoss,

    // NEW: Lottery
    getLotteryData,
    buyLotteryTickets,

    // NEW: Quests
    getQuestData,
    getAvailableQuests,
    startQuest,
    completeQuest,

    // NEW: Tournaments
    getTournamentData,
    joinTournament,

    // NEW: Auction House
    listAuction,
    buyAuction,
    getAuctions,
    getUserAuctions
};
