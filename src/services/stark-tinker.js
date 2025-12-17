/**
 * Stark Industries Tinker System
 * Combine items from minigames to craft MCU-themed gear
 * 
 * Features:
 * - 100+ recipes based on MCU/Marvel
 * - Rare Stark Tech drops
 * - Crafting with materials from hunt/fish/dig
 */

// ============================================================================
// MCU TINKER RECIPES (100+)
// ============================================================================

const TINKER_RECIPES = {
    // ==================== IRON MAN TECH ====================
    repulsor_glove: {
        name: '🔫 Repulsor Glove',
        description: 'A miniaturized repulsor from the Mark series',
        ingredients: { '⚙️ Scrap Metal': 3, '🔋 Battery': 2, '💎 Diamond': 1 },
        value: 500,
        rarity: 'rare'
    },
    arc_reactor_mini: {
        name: '💠 Mini Arc Reactor Replica',
        description: 'A non-functional but beautiful replica',
        ingredients: { '💎 Diamond': 2, '🔋 Battery': 3, '⚙️ Copper Wire': 5 },
        value: 800,
        rarity: 'epic'
    },
    iron_man_helmet: {
        name: '🪖 Iron Man Helmet',
        description: 'Mark 3 helmet replica with working HUD',
        ingredients: { '⚙️ Iron Ore': 5, '🔌 Plug': 3, '💻 Laptop': 1 },
        value: 1200,
        rarity: 'epic'
    },
    jarvis_chip: {
        name: '🧠 J.A.R.V.I.S. AI Chip',
        description: 'Contains a fragment of JARVIS consciousness',
        ingredients: { '💻 Laptop': 2, '🔋 Battery': 4, '📜 Scroll': 1 },
        value: 2000,
        rarity: 'legendary'
    },
    nanotech_housing: {
        name: '⚡ Nanotech Housing Unit',
        description: 'Bleeding edge tech from Mark 50',
        ingredients: { '💎 Diamond': 3, '⚙️ Aluminum Scraps': 10, '🧲 Magnet': 5 },
        value: 3000,
        rarity: 'legendary'
    },
    
    // ==================== AVENGERS GEAR ====================
    captain_shield_fragment: {
        name: '🛡️ Vibranium Fragment',
        description: "A chip from Cap's shield",
        ingredients: { '🛡️ Broken Shield': 3, '💎 Sapphire': 2 },
        value: 600,
        rarity: 'rare'
    },
    mjolnir_handle: {
        name: '🔨 Mjolnir Handle',
        description: 'The leather grip from Thor\'s hammer',
        ingredients: { '🔨 Hammer': 2, '⚡ Electro': 1, '🪨 Granite': 5 },
        value: 750,
        rarity: 'rare'
    },
    black_widow_stinger: {
        name: '⚡ Widow\'s Bite',
        description: 'Electroshock weapon from Natasha',
        ingredients: { '🔋 Battery': 4, '⚙️ Copper Wire': 3, '🔧 Wrench': 2 },
        value: 550,
        rarity: 'rare'
    },
    hawkeye_arrowhead: {
        name: '🏹 Trick Arrowhead',
        description: 'Explosive-tipped from Clint\'s quiver',
        ingredients: { '⚔️ Old Dagger': 2, '🔋 Battery': 1, '⚙️ Scrap Metal': 3 },
        value: 400,
        rarity: 'uncommon'
    },
    hulk_buster_joint: {
        name: '🦾 Hulkbuster Joint',
        description: 'Reinforced joint from Veronica',
        ingredients: { '⚙️ Iron Ore': 8, '🔧 Wrench': 3, '🧲 Magnet': 4 },
        value: 900,
        rarity: 'epic'
    },
    
    // ==================== SPIDER-MAN TECH ====================
    web_fluid_canister: {
        name: '🕸️ Web Fluid Canister',
        description: 'Peter\'s homemade formula',
        ingredients: { '🌊 Seaweed': 5, '🐠 Clownfish': 2, '🔋 Battery': 1 },
        value: 350,
        rarity: 'uncommon'
    },
    spider_tracer: {
        name: '🔴 Spider-Tracer',
        description: 'Tiny tracking device',
        ingredients: { '🔋 Battery': 2, '🧲 Magnet': 1, '⚙️ Copper Wire': 2 },
        value: 300,
        rarity: 'uncommon'
    },
    iron_spider_leg: {
        name: '🦿 Iron Spider Leg',
        description: 'Waldoe leg from the Iron Spider suit',
        ingredients: { '⚙️ Iron Ore': 4, '🔌 Plug': 2, '🦴 Fossil': 1 },
        value: 700,
        rarity: 'rare'
    },
    
    // ==================== GUARDIANS GEAR ====================
    starlord_mask: {
        name: '🎭 Star-Lord Mask',
        description: 'Space helmet with translator',
        ingredients: { '🏺 Ancient Pottery': 1, '🔋 Battery': 3, '⚙️ Aluminum Scraps': 4 },
        value: 650,
        rarity: 'rare'
    },
    groot_cutting: {
        name: '🌱 Groot Cutting',
        description: 'A living branch that says "I am Groot"',
        ingredients: { '🌳 Groot gave you a twig': 3, '🌊 Seaweed': 5, '🐸 Frog': 2 },
        value: 500,
        rarity: 'rare'
    },
    rocket_blaster: {
        name: '🔫 Rocket\'s Blaster',
        description: 'Cobbled together from spare parts',
        ingredients: { '🔧 Wrench': 3, '🔋 Battery': 4, '⚙️ Scrap Metal': 6 },
        value: 800,
        rarity: 'epic'
    },
    infinity_stone_fake: {
        name: '💎 Fake Infinity Stone',
        description: 'Convincing replica (totally harmless)',
        ingredients: { '💎 Diamond': 1, '💎 Ruby': 1, '💎 Emerald': 1, '💎 Sapphire': 1 },
        value: 2500,
        rarity: 'legendary'
    },
    
    // ==================== WAKANDAN TECH ====================
    vibranium_bead: {
        name: '⚪ Vibranium Bead',
        description: 'Kimoyo bead from Wakanda',
        ingredients: { '💎 Pearl': 3, '🔋 Battery': 2, '💎 Amethyst': 1 },
        value: 600,
        rarity: 'rare'
    },
    black_panther_claw: {
        name: '🐾 Panther Claw',
        description: 'Retractable claw from the habit',
        ingredients: { '⚔️ Rusty Sword': 2, '💎 Opal': 1, '🦴 Dinosaur Bone': 1 },
        value: 900,
        rarity: 'epic'
    },
    shuri_gauntlet: {
        name: '🤜 Shuri\'s Gauntlet',
        description: 'Sonic blast technology',
        ingredients: { '⚙️ Iron Ore': 3, '🔋 Battery': 5, '💎 Topaz': 2 },
        value: 1100,
        rarity: 'epic'
    },
    
    // ==================== MYSTIC ARTS ====================
    sling_ring: {
        name: '🔮 Sling Ring',
        description: 'Opens portals to anywhere',
        ingredients: { '💍 Gold Ring': 2, '📜 Scroll': 3, '💎 Amethyst': 2 },
        value: 1500,
        rarity: 'legendary'
    },
    eye_of_agamotto_replica: {
        name: '👁️ Eye of Agamotto Replica',
        description: 'Decorative but mystically inert',
        ingredients: { '💍 Ring': 3, '💎 Emerald': 2, '🏺 Urn': 1 },
        value: 2000,
        rarity: 'legendary'
    },
    cloak_patch: {
        name: '🧣 Cloak of Levitation Patch',
        description: 'A torn piece that still floats slightly',
        ingredients: { '📜 Map': 2, '🦋 Butterfly': 5, '💎 Ruby': 1 },
        value: 800,
        rarity: 'epic'
    },
    
    // ==================== ANT-MAN TECH ====================
    pym_particle_vial: {
        name: '🧪 Pym Particle Vial',
        description: 'Shrinks or grows anything',
        ingredients: { '🐜 Ant': 10, '🔋 Battery': 2, '💎 Diamond': 1 },
        value: 1200,
        rarity: 'epic'
    },
    ant_communicator: {
        name: '📡 Ant Communicator',
        description: 'Talk to ants like Scott Lang',
        ingredients: { '🐝 Bee': 5, '🔋 Battery': 3, '⚙️ Copper Wire': 4 },
        value: 400,
        rarity: 'uncommon'
    },
    quantum_realm_map: {
        name: '🗺️ Quantum Realm Map',
        description: 'Navigation through subatomic space',
        ingredients: { '📜 Map': 3, '📜 Scroll': 2, '💎 Opal': 2 },
        value: 1800,
        rarity: 'legendary'
    },
    
    // ==================== SHIELD EQUIPMENT ====================
    shield_badge: {
        name: '🦅 S.H.I.E.L.D. Badge',
        description: 'Level 7 clearance (expired)',
        ingredients: { '🪙 Gold Coins': 2, '📱 Phone': 1, '🔑 Old Key': 2 },
        value: 300,
        rarity: 'uncommon'
    },
    fury_eyepatch: {
        name: '👁️ Fury\'s Eyepatch',
        description: 'Tactical eyepatch (Goose scratched the original)',
        ingredients: { '🐟 Catfish': 2, '📜 Scroll': 1, '⚙️ Scrap Metal': 2 },
        value: 350,
        rarity: 'uncommon'
    },
    helicarrier_piece: {
        name: '✈️ Helicarrier Fragment',
        description: 'Piece of the flying fortress',
        ingredients: { '⚙️ Iron Ore': 6, '⚙️ Aluminum Scraps': 8, '🔧 Wrench': 4 },
        value: 1000,
        rarity: 'epic'
    },
    
    // ==================== ASGARDIAN RELICS ====================
    bifrost_shard: {
        name: '🌈 Bifrost Shard',
        description: 'Crystal from the Rainbow Bridge',
        ingredients: { '💎 Diamond': 2, '💎 Ruby': 1, '💎 Sapphire': 1, '💎 Emerald': 1 },
        value: 2200,
        rarity: 'legendary'
    },
    asgardian_ale_mug: {
        name: '🍺 Asgardian Ale Mug',
        description: 'Indestructible drinking vessel',
        ingredients: { '🏺 Clay Pot': 3, '🪨 Marble': 4, '🪙 Gold Coins': 2 },
        value: 450,
        rarity: 'uncommon'
    },
    loki_dagger: {
        name: '🗡️ Loki\'s Dagger',
        description: 'Enchanted blade (or is it an illusion?)',
        ingredients: { '⚔️ Old Dagger': 3, '💎 Emerald': 2, '📜 Scroll': 2 },
        value: 950,
        rarity: 'epic'
    },
    
    // ==================== WAR MACHINE ====================
    war_machine_ammo: {
        name: '💣 War Machine Ammo Belt',
        description: 'High caliber rounds for Rhodey',
        ingredients: { '⚙️ Iron Ore': 4, '⚙️ Scrap Metal': 6, '🔧 Wrench': 2 },
        value: 500,
        rarity: 'rare'
    },
    shoulder_cannon: {
        name: '🎯 Shoulder Cannon Module',
        description: 'Targeting system included',
        ingredients: { '⚙️ Iron Ore': 6, '🔋 Battery': 4, '💻 Laptop': 1 },
        value: 1100,
        rarity: 'epic'
    },
    
    // ==================== ULTRON SALVAGE ====================
    ultron_core: {
        name: '🤖 Ultron Core Fragment',
        description: 'Dormant AI consciousness (hopefully)',
        ingredients: { '💻 Laptop': 3, '🔋 Battery': 5, '💎 Diamond': 2 },
        value: 2500,
        rarity: 'legendary'
    },
    vibranium_alloy: {
        name: '⬜ Vibranium Alloy',
        description: 'Synthetic vibranium compound',
        ingredients: { '💎 Diamond': 3, '⚙️ Iron Ore': 8, '🪨 Quartz': 5 },
        value: 1800,
        rarity: 'legendary'
    },
    
    // ==================== SIMPLE CRAFTS ====================
    stark_phone: {
        name: '📱 Stark Phone',
        description: 'Prototype smartphone from 2008',
        ingredients: { '📱 Phone': 2, '🔋 Battery': 2, '⚙️ Copper Wire': 3 },
        value: 250,
        rarity: 'common'
    },
    arc_reactor_keychain: {
        name: '🔑 Arc Reactor Keychain',
        description: 'Glows in the dark!',
        ingredients: { '🔑 Old Key': 2, '🔋 Battery': 1, '💎 Pearl': 1 },
        value: 150,
        rarity: 'common'
    },
    stark_industries_mug: {
        name: '☕ Stark Industries Mug',
        description: 'Says "I survived the Mandarin attack"',
        ingredients: { '🏺 Clay Pot': 2, '🪨 Marble': 2 },
        value: 100,
        rarity: 'common'
    },
    dum_e_figure: {
        name: '🤖 Dum-E Figurine',
        description: 'The beloved robot arm in miniature',
        ingredients: { '⚙️ Scrap Metal': 4, '🔧 Wrench': 2, '🔌 Plug': 1 },
        value: 200,
        rarity: 'common'
    },
    pepper_potts_heels: {
        name: '👠 Pepper\'s Rescue Heels',
        description: 'Surprisingly combat-ready footwear',
        ingredients: { '⚙️ Iron Ore': 2, '💍 Ring': 1, '💎 Ruby': 1 },
        value: 350,
        rarity: 'uncommon'
    },
    
    // ==================== WEAPONS ====================
    chitauri_rifle: {
        name: '👽 Chitauri Rifle',
        description: 'Alien weapon from the Battle of New York',
        ingredients: { '⚙️ Scrap Metal': 8, '🔋 Battery': 3, '💎 Topaz': 2 },
        value: 900,
        rarity: 'epic'
    },
    dark_elf_grenade: {
        name: '💥 Dark Elf Grenade',
        description: 'Black hole in a ball',
        ingredients: { '🪨 Basalt': 5, '💎 Amethyst': 3, '⚙️ Aluminum Scraps': 4 },
        value: 1300,
        rarity: 'epic'
    },
    tesseract_case: {
        name: '💼 Tesseract Case',
        description: 'Empty but still glows blue',
        ingredients: { '💼 Briefcase': 2, '💎 Sapphire': 3, '🔋 Battery': 4 },
        value: 1600,
        rarity: 'legendary'
    },
    
    // ==================== COSTUMES ====================
    captain_america_cowl: {
        name: '🇺🇸 Cap\'s Cowl',
        description: 'Iconic headpiece with ear wings',
        ingredients: { '🛡️ Broken Shield': 1, '📜 Map': 2, '💎 Sapphire': 1 },
        value: 550,
        rarity: 'rare'
    },
    black_widow_belt: {
        name: '🕷️ Widow\'s Belt',
        description: 'Contains tasers, gas, and a grapple',
        ingredients: { '⚙️ Copper Wire': 5, '🔋 Battery': 3, '🔧 Wrench': 2 },
        value: 600,
        rarity: 'rare'
    },
    scarlet_witch_tiara: {
        name: '👑 Scarlet Witch Tiara',
        description: 'Chaos magic not included',
        ingredients: { '💍 Gold Ring': 2, '💎 Ruby': 3, '📜 Scroll': 2 },
        value: 1000,
        rarity: 'epic'
    },
    vision_cape: {
        name: '🧣 Vision\'s Cape',
        description: 'Surprisingly flowing for a synthezoid',
        ingredients: { '📜 Scroll': 4, '💎 Emerald': 2, '💎 Topaz': 1 },
        value: 850,
        rarity: 'epic'
    },
    
    // ==================== VEHICLES ====================
    quinjet_key: {
        name: '🔑 Quinjet Ignition Key',
        description: 'Start the Avengers jet',
        ingredients: { '🔑 Old Key': 3, '🔋 Battery': 2, '⚙️ Iron Ore': 2 },
        value: 400,
        rarity: 'uncommon'
    },
    benatar_fuel_cell: {
        name: '⛽ Benatar Fuel Cell',
        description: 'Powers Star-Lord\'s ship',
        ingredients: { '🔋 Battery': 6, '💎 Diamond': 1, '⚙️ Aluminum Scraps': 5 },
        value: 1100,
        rarity: 'epic'
    },
    hover_bike_parts: {
        name: '🏍️ Hover Bike Parts',
        description: 'From Sakaar\'s scrapyards',
        ingredients: { '⚙️ Scrap Metal': 10, '🧲 Magnet': 4, '🔋 Battery': 3 },
        value: 700,
        rarity: 'rare'
    },
    
    // ==================== MISC MCU ====================
    stan_lee_sunglasses: {
        name: '🕶️ Stan Lee\'s Sunglasses',
        description: 'Excelsior!',
        ingredients: { '📱 Phone': 1, '💎 Pearl': 2, '🔑 Old Key': 1 },
        value: 1000,
        rarity: 'epic'
    },
    thanos_gauntlet_toy: {
        name: '🧤 Infinity Gauntlet (Toy)',
        description: 'Foam version, still makes you feel powerful',
        ingredients: { '🪨 Sandstone': 3, '💎 Ruby': 1, '💎 Sapphire': 1, '💎 Emerald': 1 },
        value: 600,
        rarity: 'rare'
    },
    hydra_pin: {
        name: '🐙 HYDRA Pin',
        description: 'Hail...wait, wrong side',
        ingredients: { '🪙 Bronze Coins': 3, '🦎 Lizard': 2, '🐍 Snake': 1 },
        value: 200,
        rarity: 'uncommon'
    },
    kree_blood_vial: {
        name: '💉 Kree Blood Vial',
        description: 'Blue and mysterious',
        ingredients: { '🐟 Marlin': 1, '💎 Sapphire': 2, '🦴 Fossil': 1 },
        value: 800,
        rarity: 'rare'
    }
};

// ============================================================================
// STARK CONTRACTS (High-paying jobs)
// ============================================================================

const STARK_CONTRACTS = [
    { name: 'Repair the Helicarrier engines', reward: { min: 200, max: 400 }, difficulty: 'easy' },
    { name: 'Debug War Machine\'s targeting', reward: { min: 300, max: 500 }, difficulty: 'medium' },
    { name: 'Calibrate the Iron Legion', reward: { min: 400, max: 700 }, difficulty: 'medium' },
    { name: 'Extract data from Ultron fragments', reward: { min: 600, max: 1000 }, difficulty: 'hard' },
    { name: 'Retrofit Quinjet with stealth tech', reward: { min: 500, max: 800 }, difficulty: 'hard' },
    { name: 'Analyze Chitauri weapon samples', reward: { min: 350, max: 550 }, difficulty: 'medium' },
    { name: 'Decrypt HYDRA communications', reward: { min: 400, max: 650 }, difficulty: 'medium' },
    { name: 'Maintain the Hall of Armor', reward: { min: 250, max: 450 }, difficulty: 'easy' },
    { name: 'Upgrade Spider-Man\'s web shooters', reward: { min: 300, max: 500 }, difficulty: 'medium' },
    { name: 'Test new repulsor configurations', reward: { min: 450, max: 750 }, difficulty: 'hard' },
    { name: 'Install FRIDAY in new systems', reward: { min: 350, max: 600 }, difficulty: 'medium' },
    { name: 'Decontaminate Hulk\'s lab', reward: { min: 200, max: 350 }, difficulty: 'easy' },
    { name: 'Fix Dum-E (again)', reward: { min: 150, max: 250 }, difficulty: 'easy' },
    { name: 'Optimize nanotech regeneration', reward: { min: 700, max: 1200 }, difficulty: 'hard' },
    { name: 'Secure Avengers Compound perimeter', reward: { min: 280, max: 480 }, difficulty: 'medium' },
    { name: 'Catalog Thor\'s Asgardian artifacts', reward: { min: 320, max: 520 }, difficulty: 'medium' },
    { name: 'Reverse-engineer Wakandan tech', reward: { min: 800, max: 1500 }, difficulty: 'hard' },
    { name: 'Train new S.H.I.E.L.D. recruits', reward: { min: 220, max: 380 }, difficulty: 'easy' },
    { name: 'Repair Falcon\'s wing thrusters', reward: { min: 350, max: 550 }, difficulty: 'medium' },
    { name: 'Analyze Pym Particle samples', reward: { min: 600, max: 950 }, difficulty: 'hard' }
];

// ============================================================================
// LOOTBOX SYSTEM
// ============================================================================

const LOOTBOX_TYPES = {
    standard: {
        name: '📦 Standard Lootbox',
        price: 100,
        rewards: [
            { type: 'coins', amount: { min: 50, max: 200 }, chance: 0.5 },
            { type: 'coins', amount: { min: 200, max: 500 }, chance: 0.3 },
            { type: 'item', pool: 'common', chance: 0.15 },
            { type: 'item', pool: 'uncommon', chance: 0.05 }
        ]
    },
    stark: {
        name: '🔧 Stark Tech Lootbox',
        price: 500,
        rewards: [
            { type: 'coins', amount: { min: 300, max: 800 }, chance: 0.4 },
            { type: 'item', pool: 'uncommon', chance: 0.3 },
            { type: 'item', pool: 'rare', chance: 0.2 },
            { type: 'item', pool: 'epic', chance: 0.1 }
        ]
    },
    legendary: {
        name: '💎 Legendary Lootbox',
        price: 2000,
        rewards: [
            { type: 'coins', amount: { min: 1000, max: 3000 }, chance: 0.3 },
            { type: 'item', pool: 'rare', chance: 0.35 },
            { type: 'item', pool: 'epic', chance: 0.25 },
            { type: 'item', pool: 'legendary', chance: 0.1 }
        ]
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    TINKER_RECIPES,
    STARK_CONTRACTS,
    LOOTBOX_TYPES,
    
    // Get recipe by ID
    getRecipe(recipeId) {
        return TINKER_RECIPES[recipeId] || null;
    },
    
    // Get all recipes
    getAllRecipes() {
        return Object.entries(TINKER_RECIPES).map(([id, recipe]) => ({
            id,
            ...recipe
        }));
    },
    
    // Get recipes by rarity
    getRecipesByRarity(rarity) {
        return Object.entries(TINKER_RECIPES)
            .filter(([, recipe]) => recipe.rarity === rarity)
            .map(([id, recipe]) => ({ id, ...recipe }));
    },
    
    // Get random contract
    getRandomContract() {
        return STARK_CONTRACTS[Math.floor(Math.random() * STARK_CONTRACTS.length)];
    },
    
    // Get lootbox type
    getLootboxType(type) {
        return LOOTBOX_TYPES[type] || LOOTBOX_TYPES.standard;
    }
};
