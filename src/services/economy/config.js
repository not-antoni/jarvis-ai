'use strict';

// Economy system configuration and data - extracted from stark-economy.js

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
    },
    // New Upgrades & Peripherals
    ai_assistant_chip: {
        id: 'ai_assistant_chip',
        name: '💾 AI Assistant Chip',
        description: 'Reduces work cooldown by 25% permanently',
        price: 2500,
        type: 'upgrade',
        oneTime: true,
        effect: { workCooldownReduction: 0.25 }
    },
    mark_v_briefcase: {
        id: 'mark_v_briefcase',
        name: '💼 Mark V Briefcase',
        description: 'Increase gambling win rate by 2% permanently',
        price: 5000,
        type: 'upgrade',
        oneTime: true,
        effect: { gamblingBonus: 0.02 }
    },
    edith_glasses: {
        id: 'edith_glasses',
        name: '👓 E.D.I.T.H. Glasses',
        description: '+10% earnings boost for 4 hours',
        price: 800,
        type: 'booster',
        duration: 4 * 60 * 60 * 1000,
        effect: { earningsBonus: 0.10 }
    },
    hulkbuster_armor: {
        id: 'hulkbuster_armor',
        name: '🦾 Hulkbuster Armor',
        description: 'Ultimate protection! 24h robbery immunity',
        price: 2000,
        type: 'protection',
        duration: 24 * 60 * 60 * 1000,
        effect: { robberyImmunity: true }
    },
    iron_legion_droid: {
        id: 'iron_legion_droid',
        name: '🤖 Iron Legion Droid',
        description: 'Automated defense system. 50% chance to repel robbers for 12h.',
        price: 1200,
        type: 'protection',
        duration: 12 * 60 * 60 * 1000,
        effect: { robberyDefense: 0.5 }
    }
};

// Slot machine symbols
const SLOT_SYMBOLS = ['💎', '7️⃣', '🍒', '🍋', '⭐', '🔔'];

// Hunt/Fish/Dig rewards
// NOTE: The vestigial 'chance' field was removed during extraction.
// Selection uses uniform random distribution - all outcomes have equal probability.
const MINIGAME_REWARDS = {
    hunt: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦌 Deer', reward: 80 },
            { name: '🐗 Boar', reward: 60 },
            { name: '🐰 Rabbit', reward: 30 },
            { name: '💨 Nothing', reward: 0 },
            { name: '🦅 Eagle', reward: 90 },
            { name: '🐻 Bear', reward: 120 },
            { name: '🦊 Fox', reward: 40 },
            { name: '🐺 Wolf', reward: 100 },
            { name: '🦃 Turkey', reward: 25 },
            { name: '🦆 Duck', reward: 20 },
            { name: '🐿️ Squirrel', reward: 5 },
            { name: '🦔 Hedgehog', reward: 15 },
            { name: '🦝 Raccoon', reward: 35 },
            { name: '🐍 Snake', reward: 45 },
            { name: '🦎 Lizard', reward: 10 },
            { name: '🐢 Turtle', reward: 8 },
            { name: '🐸 Frog', reward: 3 },
            { name: '🦋 Butterfly', reward: 1 },
            { name: '🐝 Bee', reward: 2 },
            { name: '🦗 Cricket', reward: 1 },
            { name: '🦂 Scorpion', reward: 50 },
            { name: '🕷️ Spider', reward: 12 },
            { name: '🦐 Shrimp', reward: 7 },
            { name: '🦞 Lobster', reward: 55 },
            { name: '🦀 Crab', reward: 18 },
            { name: '🐙 Octopus', reward: 65 },
            { name: '🦑 Squid', reward: 38 },
            { name: '🐟 Fish', reward: 22 },
            { name: '🐠 Tropical Fish', reward: 28 },
            { name: '🐡 Pufferfish', reward: 32 },
            { name: '🦈 Shark', reward: 150 },
            { name: '🐋 Whale', reward: 200 },
            { name: '🐬 Dolphin', reward: 110 },
            { name: '🦭 Seal', reward: 75 },
            { name: '🐧 Penguin', reward: 42 },
            { name: '🦢 Swan', reward: 48 },
            { name: '🦩 Flamingo', reward: 52 },
            { name: '🦜 Parrot', reward: 58 },
            { name: '🦉 Owl', reward: 68 },
            { name: '🐓 Rooster', reward: 14 },
            { name: '🐔 Chicken', reward: 11 },
            { name: '🐄 Cow', reward: 85 },
            { name: '🐃 Water Buffalo', reward: 95 },
            { name: '🐂 Ox', reward: 88 },
            { name: '🐏 Ram', reward: 72 },
            { name: '🐑 Sheep', reward: 28 },
            { name: '🐐 Goat', reward: 38 },
            { name: '🦙 Llama', reward: 62 },
            { name: '🦒 Giraffe', reward: 105 },
            { name: '🐘 Elephant', reward: 180 }
        ]
    },
    fish: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦈 Shark', reward: 100 },
            { name: '🐟 Fish', reward: 40 },
            { name: '🐠 Tropical Fish', reward: 60 },
            { name: '👢 Old Boot', reward: 5 },
            { name: '🌊 Nothing', reward: 0 },
            { name: '🐡 Pufferfish', reward: 45 },
            { name: '🐙 Octopus', reward: 75 },
            { name: '🦑 Squid', reward: 55 },
            { name: '🦞 Lobster', reward: 85 },
            { name: '🦀 Crab', reward: 35 },
            { name: '🦐 Shrimp', reward: 15 },
            { name: '🐋 Whale', reward: 200 },
            { name: '🐬 Dolphin', reward: 120 },
            { name: '🦭 Seal', reward: 80 },
            { name: '🐢 Sea Turtle', reward: 65 },
            { name: '🐚 Conch Shell', reward: 10 },
            { name: '💎 Pearl', reward: 150 },
            { name: '🪙 Gold Coin', reward: 90 },
            { name: '💍 Ring', reward: 70 },
            { name: '📱 Phone (waterproof)', reward: 25 },
            { name: '🧦 Sock', reward: 1 },
            { name: '🎣 Fishing Rod', reward: 30 },
            { name: '🪣 Bucket', reward: 8 },
            { name: '🌊 Seaweed', reward: 2 },
            { name: '🦀 Hermit Crab', reward: 12 },
            { name: '🐠 Clownfish', reward: 38 },
            { name: '🐟 Tuna', reward: 50 },
            { name: '🐟 Salmon', reward: 48 },
            { name: '🐟 Cod', reward: 32 },
            { name: '🐟 Bass', reward: 42 },
            { name: '🐟 Trout', reward: 28 },
            { name: '🐟 Mackerel', reward: 22 },
            { name: '🐟 Sardine', reward: 18 },
            { name: '🐟 Anchovy', reward: 14 },
            { name: '🐟 Herring', reward: 20 },
            { name: '🐟 Snapper', reward: 52 },
            { name: '🐟 Grouper', reward: 58 },
            { name: '🐟 Mahi Mahi', reward: 62 },
            { name: '🐟 Marlin', reward: 110 },
            { name: '🐟 Swordfish', reward: 95 },
            { name: '🐟 Barracuda', reward: 68 },
            { name: '🐟 Eel', reward: 44 },
            { name: '🐟 Stingray', reward: 72 },
            { name: '🐟 Jellyfish', reward: 26 },
            { name: '🐟 Angelfish', reward: 46 },
            { name: '🐟 Piranha', reward: 54 },
            { name: '🐟 Catfish', reward: 36 },
            { name: '🐟 Carp', reward: 24 },
            { name: '🐟 Pike', reward: 40 },
            { name: '🐟 Perch', reward: 30 }
        ]
    },
    dig: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '💎 Diamond', reward: 150 },
            { name: '🪙 Gold Coins', reward: 70 },
            { name: '⚙️ Scrap Metal', reward: 25 },
            { name: '🪨 Rocks', reward: 10 },
            { name: '🕳️ Empty Hole', reward: 0 },
            { name: '💍 Gold Ring', reward: 80 },
            { name: '💎 Ruby', reward: 120 },
            { name: '💎 Emerald', reward: 110 },
            { name: '💎 Sapphire', reward: 105 },
            { name: '💎 Amethyst', reward: 95 },
            { name: '💎 Topaz', reward: 85 },
            { name: '💎 Opal', reward: 100 },
            { name: '💎 Pearl', reward: 90 },
            { name: '🪙 Silver Coins', reward: 50 },
            { name: '🪙 Bronze Coins', reward: 20 },
            { name: '⚙️ Iron Ore', reward: 30 },
            { name: '⚙️ Copper Wire', reward: 15 },
            { name: '⚙️ Aluminum Scraps', reward: 12 },
            { name: '🪨 Granite', reward: 8 },
            { name: '🪨 Limestone', reward: 6 },
            { name: '🪨 Marble', reward: 18 },
            { name: '🪨 Quartz', reward: 22 },
            { name: '🪨 Coal', reward: 5 },
            { name: '🪨 Sandstone', reward: 4 },
            { name: '🪨 Basalt', reward: 7 },
            { name: '🦴 Dinosaur Bone', reward: 200 },
            { name: '🦴 Fossil', reward: 140 },
            { name: '🏺 Ancient Pottery', reward: 130 },
            { name: '🗿 Statue Fragment', reward: 115 },
            { name: '⚱️ Urn', reward: 125 },
            { name: '🗡️ Rusty Sword', reward: 60 },
            { name: '🛡️ Broken Shield', reward: 55 },
            { name: '⚔️ Old Dagger', reward: 45 },
            { name: '🏺 Clay Pot', reward: 35 },
            { name: '📜 Scroll', reward: 75 },
            { name: '📜 Map', reward: 65 },
            { name: '💼 Briefcase', reward: 40 },
            { name: '🔑 Old Key', reward: 28 },
            { name: '💍 Ring', reward: 50 },
            { name: '⌚ Watch', reward: 35 },
            { name: '📱 Phone', reward: 30 },
            { name: '💻 Laptop', reward: 42 },
            { name: '🔋 Battery', reward: 14 },
            { name: '🔌 Plug', reward: 8 },
            { name: '🧲 Magnet', reward: 12 },
            { name: '🧰 Toolbox', reward: 38 },
            { name: '🔧 Wrench', reward: 16 },
            { name: '🔨 Hammer', reward: 18 },
            { name: '⛏️ Pickaxe', reward: 32 },
            { name: '🪓 Axe', reward: 26 }
        ]
    },
    beg: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: 'Tony Stark gave you', reward: 100 },
            { name: 'Pepper Potts donated', reward: 50 },
            { name: 'Happy Hogan tipped you', reward: 30 },
            { name: 'A stranger gave you', reward: 15 },
            { name: 'Everyone ignored you', reward: 0 },
            { name: '🦸 Captain America felt patriotic', reward: 75 },
            { name: '🕷️ Spider-Man gave you his lunch money', reward: 25 },
            { name: '🦅 Hawkeye dropped some spare change', reward: 20 },
            { name: '⚡ Thor threw you some Asgardian gold', reward: 90 },
            { name: '🛡️ Black Widow left a tip', reward: 40 },
            { name: '🤖 Vision calculated you need help', reward: 60 },
            {
                name: '🧙 Doctor Strange opened a portal and dropped coins',
                reward: 80
            },
            { name: '🦝 Rocket felt generous (rare!)', reward: 70 },
            { name: '🌳 Groot gave you a twig (worth something?)', reward: 5 },
            { name: "👑 T'Challa's Wakandan charity fund", reward: 85 },
            { name: '🧬 Bruce Banner felt bad for you', reward: 35 },
            { name: '🎯 Yelena Belova threw you a ruble', reward: 10 },
            { name: '🔮 Wanda felt your pain (literally)', reward: 55 },
            { name: "🦇 Moon Knight's alter ego donated", reward: 45 },
            { name: '⚔️ Loki tricked you into thinking you got money', reward: 0 },
            { name: "🕸️ Venom symbiote tried to help (it didn't)", reward: -10 },
            { name: '👻 Ghost Rider felt your suffering', reward: 50 },
            { name: "🎭 Deadpool gave you $4 (he's broke too)", reward: 4 },
            {
                name: "🌙 Daredevil heard your plea (he's blind but generous)",
                reward: 30
            },
            { name: '🔥 Human Torch warmed your heart (and wallet)', reward: 40 },
            { name: '❄️ Iceman froze you out (no money)', reward: 0 },
            { name: '🧲 Magneto threw you some spare metal', reward: 15 },
            { name: "👽 Nick Fury's eye saw your struggle", reward: 65 },
            { name: "🦂 Scorpion tried to help (he's broke)", reward: 0 },
            { name: '🕷️ Miles Morales shared his allowance', reward: 20 },
            { name: '🦇 Batroc the Leaper felt generous', reward: 12 },
            { name: '🌊 Namor threw you some underwater treasure', reward: 95 },
            { name: '⚔️ Taskmaster copied your begging technique', reward: 0 },
            { name: "🦾 Winter Soldier's metal arm dropped coins", reward: 35 },
            { name: '🦅 Falcon felt bad for you', reward: 25 },
            { name: '🕷️ Black Cat stole money then gave it to you', reward: 65 },
            { name: '👑 Killmonger felt a moment of pity', reward: 40 },
            { name: '🧪 Doctor Octopus dropped spare change', reward: 8 },
            { name: '🦎 Lizard felt your struggle', reward: 18 },
            { name: '⚡ Electro zapped you some money', reward: 55 },
            { name: '🦂 Vulture dropped some cash', reward: 22 },
            { name: '🔥 Sandman felt your pain', reward: 28 },
            { name: '❄️ Mr. Freeze gave you ice (worthless)', reward: 0 },
            { name: '🦇 Two-Face flipped a coin (you lost)', reward: 0 },
            { name: '🎭 Joker gave you a fake dollar', reward: 0 },
            { name: '🦅 Red Skull ignored you (Nazi vibes)', reward: 0 },
            { name: '⚔️ Crossbones felt generous', reward: 30 },
            { name: "🦾 Ultron calculated you're useless", reward: 0 },
            { name: '👑 Thanos felt your pain (snapped away)', reward: 0 },
            { name: '🌙 Blade gave you some cash', reward: 45 },
            { name: "🦂 Morbius felt bad (he's a vampire)", reward: 20 }
        ]
    },
    crime: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🏦 Robbed a bank vault', reward: 500 },
            { name: '💎 Stole from a jewelry store', reward: 300 },
            { name: '🚗 Jacked a luxury car', reward: 200 },
            { name: '👜 Pickpocketed a tourist', reward: 100 },
            { name: '🚨 Got caught! Paid bail', reward: -150 },
            { name: '👮 Arrested! Lost everything', reward: -300 },
            { name: '💀 Got beat up by the victim', reward: -100 },
            { name: "🍕 Stole pizza from Spider-Man (he's mad)", reward: 50 },
            { name: '🦹 Broke into Oscorp (found nothing)', reward: 0 },
            { name: '💼 Snatched a briefcase (it was empty)', reward: 25 },
            { name: '🎰 Robbed a casino (got lucky!)', reward: 400 },
            { name: '🏪 Shoplifted from a convenience store', reward: 75 },
            { name: "📱 Stole someone's phone (they tracked you)", reward: -50 },
            { name: '🚲 Stole a bike (it was a trap bike)', reward: -75 },
            { name: '🎨 Art heist gone wrong (fake painting)', reward: 10 },
            { name: '💳 Credit card fraud (got caught immediately)', reward: -200 },
            {
                name: '🏠 Broke into Avengers Tower (Jarvis called security)',
                reward: -250
            },
            { name: '🦝 Tried to rob Rocket (he robbed you instead)', reward: -175 },
            { name: "⚡ Stole Thor's hammer (you can't lift it)", reward: 0 },
            { name: "🛡️ Tried to steal Cap's shield (it came back)", reward: -50 },
            {
                name: '🧙 Stole from Doctor Strange (he opened a portal)',
                reward: -100
            },
            { name: '🕷️ Tried to steal from Kingpin (bad idea)', reward: -300 },
            { name: '👑 Stole from Wakanda (Shuri caught you)', reward: -150 },
            {
                name: "🌙 Broke into Moon Knight's place (he has 3 personalities)",
                reward: -125
            },
            { name: '🔥 Tried to rob Human Torch (you got burned)', reward: -80 },
            { name: '❄️ Stole from Iceman (frozen solid)', reward: -60 },
            {
                name: "🧲 Tried to steal Magneto's helmet (he controlled it)",
                reward: -90
            },
            { name: '🦇 Broke into Wayne Manor (wrong universe)', reward: 0 },
            {
                name: '👻 Tried to rob Ghost Rider (your soul is now in debt)',
                reward: -400
            },
            { name: "🎭 Deadpool caught you (he's keeping the money)", reward: -25 },
            { name: '🕸️ Stole from Venom (symbiote attached to you)', reward: -200 },
            { name: "🌊 Tried to rob Namor (he's underwater)", reward: 0 },
            { name: '🔮 Stole from Wanda (reality broke)', reward: -350 },
            { name: '⚔️ Tried to rob Loki (he tricked you)', reward: -100 },
            { name: '🦅 Stole from Hawkeye (he shot an arrow at you)', reward: -70 },
            { name: '🦂 Tried to rob Scorpion (he stung you)', reward: -55 },
            { name: '🦎 Stole from Lizard (he bit you)', reward: -45 },
            { name: '⚡ Tried to rob Electro (you got zapped)', reward: -65 },
            { name: '🔥 Stole from Sandman (he buried you)', reward: -40 },
            {
                name: "🦾 Broke into Doc Ock's lab (tentacles caught you)",
                reward: -110
            },
            { name: '🦅 Tried to rob Vulture (he dropped you)', reward: -85 },
            { name: '🎭 Stole from Mysterio (it was all illusions)', reward: 0 },
            {
                name: "🦇 Broke into Kraven's trophy room (he hunted you)",
                reward: -120
            },
            { name: '🦂 Tried to rob Rhino (he charged you)', reward: -95 },
            { name: '⚔️ Stole from Taskmaster (he copied your moves)', reward: -30 },
            { name: "🦾 Broke into Ultron's base (robots attacked)", reward: -180 },
            { name: '👑 Tried to rob Thanos (he snapped you)', reward: -500 },
            { name: "🌙 Stole from Blade (he's a vampire hunter)", reward: -35 },
            { name: "🦂 Broke into Morbius's lab (vampire vibes)", reward: -20 }
        ]
    },
    postmeme: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🔥 Went viral! 1M likes', reward: 400 },
            { name: '😂 Front page of Reddit', reward: 200 },
            { name: '👍 Got some upvotes', reward: 80 },
            { name: '😐 Mid meme, mid reward', reward: 40 },
            { name: '👎 Cringe post, got roasted', reward: 10 },
            { name: '🚫 Banned from the subreddit', reward: 0 },
            { name: '🎉 Hit r/all!', reward: 350 },
            { name: '📈 Trending on Twitter', reward: 300 },
            { name: '📱 Went viral on TikTok', reward: 280 },
            { name: '🖼️ Featured on Instagram', reward: 250 },
            { name: '💬 Got 10k comments', reward: 180 },
            { name: '⭐ Got gold award', reward: 150 },
            { name: '🏆 Got platinum award', reward: 220 },
            { name: '👏 Got silver award', reward: 120 },
            { name: '❤️ Got 5k upvotes', reward: 160 },
            { name: '👍 Got 1k upvotes', reward: 100 },
            { name: '😊 Got 500 upvotes', reward: 70 },
            { name: '🙂 Got 100 upvotes', reward: 50 },
            { name: '😐 Got 50 upvotes', reward: 35 },
            { name: '😑 Got 10 upvotes', reward: 20 },
            { name: '😒 Got 5 upvotes', reward: 15 },
            { name: '😕 Got 1 upvote', reward: 8 },
            { name: '😞 Got 0 upvotes', reward: 0 },
            { name: '😢 Got downvoted', reward: -5 },
            { name: '😭 Got heavily downvoted', reward: -15 },
            { name: '🤡 Got ratioed', reward: -25 },
            { name: '💀 Got ratioed hard', reward: -35 },
            { name: '🔥 Reposted by big account', reward: 320 },
            { name: '📺 Featured on YouTube', reward: 270 },
            { name: '🎬 Made into a video', reward: 240 },
            { name: '📰 Featured in news article', reward: 290 },
            { name: '🎨 Turned into art', reward: 210 },
            { name: '🎵 Made into a song', reward: 260 },
            { name: '🎮 Featured in game', reward: 230 },
            { name: '📚 Made into a book', reward: 310 },
            { name: '🎭 Performed on stage', reward: 190 },
            { name: '🎪 Featured in circus', reward: 170 },
            { name: '🎯 Perfect timing', reward: 140 },
            { name: '⏰ Bad timing', reward: 5 },
            { name: '🌍 Went international', reward: 330 },
            { name: '🌎 Crossed language barriers', reward: 340 },
            { name: '🌏 Became global phenomenon', reward: 380 },
            { name: '🚀 Launched into space (metaphorically)', reward: 360 },
            { name: '💫 Became a star', reward: 370 },
            { name: '⭐ Got famous', reward: 390 },
            { name: '👑 Became meme royalty', reward: 410 },
            { name: '🏰 Built a meme empire', reward: 420 },
            { name: '💎 Became a meme diamond', reward: 430 },
            { name: '👻 Got ghosted (no engagement)', reward: -10 },
            { name: '🗑️ Got deleted by mods', reward: -20 }
        ]
    },
    search: {
        cooldown: 60 * 1000, // 1 minute
        locations: [
            {
                name: "Tony's couch cushions",
                outcomes: [
                    { result: 'Found some loose change!', reward: 50 },
                    { result: 'Found old pizza... gross', reward: 0 },
                    { result: 'Found a $20 bill!', reward: 20 },
                    { result: 'Found nothing but lint', reward: 0 },
                    { result: "Found Tony's spare arc reactor (worthless)", reward: 0 }
                ]
            },
            {
                name: 'the Stark Industries dumpster',
                outcomes: [
                    { result: 'Found discarded prototype parts!', reward: 150 },
                    { result: 'Just garbage... literally', reward: 5 },
                    { result: 'Security caught you!', reward: -50 },
                    { result: 'Found broken tech worth something', reward: 75 },
                    { result: 'Found nothing but coffee cups', reward: 0 }
                ]
            },
            {
                name: "Happy's car",
                outcomes: [
                    { result: 'Found his emergency stash!', reward: 100 },
                    { result: 'Nothing but gym gear', reward: 0 },
                    { result: 'Happy saw you! Awkward...', reward: -20 },
                    { result: 'Found spare change in cup holder', reward: 15 },
                    { result: "Found Happy's gym membership card", reward: 0 }
                ]
            },
            {
                name: 'the Avengers compound',
                outcomes: [
                    { result: "Found Thor's forgotten gold!", reward: 300 },
                    { result: 'Picked up some spare parts', reward: 80 },
                    { result: "Empty... everyone's on a mission", reward: 20 },
                    { result: 'SHIELD detained you briefly', reward: -100 },
                    { result: "Found Cap's old shield polish", reward: 0 }
                ]
            },
            {
                name: "Pepper's office",
                outcomes: [
                    { result: 'Found some spare change', reward: 25 },
                    { result: "Found nothing (she's organized)", reward: 0 },
                    { result: 'Pepper caught you!', reward: -30 },
                    { result: 'Found a lost wallet', reward: 60 },
                    { result: 'Found old business cards', reward: 0 }
                ]
            },
            {
                name: 'the Quinjet hangar',
                outcomes: [
                    { result: 'Found spare parts worth money', reward: 120 },
                    { result: 'Found nothing but fuel', reward: 0 },
                    { result: 'Got caught by security', reward: -75 },
                    { result: "Found Hawkeye's arrow stash", reward: 40 },
                    { result: "Found Black Widow's hidden cash", reward: 90 }
                ]
            },
            {
                name: 'the training room',
                outcomes: [
                    { result: 'Found some dropped coins', reward: 30 },
                    { result: 'Found nothing but sweat', reward: 0 },
                    { result: 'Got caught by Cap', reward: -40 },
                    { result: "Found Hulk's torn pants (worthless)", reward: 0 },
                    { result: 'Found spare equipment', reward: 50 }
                ]
            },
            {
                name: 'the lab',
                outcomes: [
                    { result: 'Found experimental tech', reward: 180 },
                    { result: 'Found nothing but beakers', reward: 0 },
                    { result: 'Broke something expensive!', reward: -150 },
                    { result: "Found Shuri's prototype", reward: 200 },
                    { result: "Found Banner's research notes", reward: 35 }
                ]
            },
            {
                name: 'the kitchen',
                outcomes: [
                    { result: 'Found some cash in the fridge', reward: 45 },
                    { result: 'Found nothing but leftovers', reward: 0 },
                    { result: 'Thor ate everything', reward: 0 },
                    { result: "Found Tony's hidden snack stash", reward: 20 },
                    { result: "Found Pepper's emergency fund", reward: 70 }
                ]
            },
            {
                name: 'the armory',
                outcomes: [
                    { result: 'Found spare weapons worth money', reward: 160 },
                    { result: 'Found nothing (locked)', reward: 0 },
                    { result: 'Got caught by security!', reward: -200 },
                    { result: "Found War Machine's spare parts", reward: 110 },
                    { result: "Found Iron Man's old repulsors", reward: 140 }
                ]
            }
        ]
    }
};

module.exports = { ECONOMY_CONFIG, SHOP_ITEMS, SLOT_SYMBOLS, MINIGAME_REWARDS };
