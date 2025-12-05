/**
 * Fun Features for JARVIS Discord Bot
 * Lightweight, no heavy compute needed - just randomization and text
 */

// ============ ROAST ROULETTE ============
const roasts = [
    "You're the reason the gene pool needs a lifeguard 💀",
    "I'd agree with you but then we'd both be wrong 🤡",
    "You're not stupid, you just have bad luck thinking 🧠❌",
    "If you were any more inbred you'd be a sandwich 🥪",
    "You're the human equivalent of a participation trophy 🏅",
    "I've seen salads more intimidating than you 🥗",
    "You're proof that evolution CAN go in reverse 🦠",
    "Your family tree must be a cactus because everyone on it is a prick 🌵",
    "You're like a cloud - when you disappear it's a beautiful day ☀️",
    "If brains were dynamite you couldn't blow your nose 💣",
    "You're the reason God created the middle finger 🖕",
    "I'd explain it to you but I left my crayons at home 🖍️",
    "You're not the dumbest person alive, but you better hope they don't die 💀",
    "Somewhere out there a tree is producing oxygen for you. Go apologize 🌳",
    "You bring everyone so much joy... when you leave 👋",
    "I'm not insulting you, I'm describing you 📝",
    "You're like a software update - whenever I see you I think 'not now' 💻",
    "If I wanted to kill myself I'd climb your ego and jump to your IQ 📉",
    "You're the human version of a migraine 🤕",
    "Light travels faster than sound, which is why you seemed bright until you spoke 💡"
];

const compliments = [
    "You're actually pretty cool, not gonna lie 😎",
    "The server's better when you're around fr 💯",
    "You've got main character energy today ✨",
    "Lowkey you're one of the good ones 👑",
    "Your vibe is immaculate rn 🔥",
    "You're the reason group chats are fun 💬",
    "Certified legend status 🏆",
    "You're built different (in a good way) 💪",
    "The algorithm smiles upon you today 🤖💚",
    "You're giving protagonist energy ⭐"
];

// ============ FAKE WIKIPEDIA ============
const wikiAdjectives = ['legendary', 'infamous', 'mysterious', 'controversial', 'beloved', 'feared', 'misunderstood', 'chaotic', 'iconic', 'unhinged'];
const wikiOccupations = ['professional Discord lurker', 'amateur philosopher', 'self-proclaimed genius', 'certified menace', 'professional yapper', 'chaos agent', 'meme connoisseur', 'keyboard warrior', 'bot botherer', 'vibe curator'];
const wikiAchievements = [
    'inventing the concept of "just one more game"',
    'setting the world record for most ignored messages',
    'successfully touching grass (once)',
    'single-handedly keeping this server alive',
    'losing to a robot in rap battles',
    'mastering the art of sending "lol" without laughing',
    'achieving peak mediocrity',
    'speedrunning being annoying',
    'revolutionizing the "brb" that lasted 3 hours',
    'pioneering the science of procrastination'
];
const wikiControversies = [
    'the Great Emoji Incident of 2024',
    'allegedly being a bot in disguise',
    'that time they ghosted the group chat for a week',
    'the forbidden copypasta incident',
    'their controversial take on pineapple pizza',
    'accidentally @everyone at 3am',
    'the mic-muted rant that lasted 20 minutes',
    'that one message that got pinned ironically'
];

// ============ CONSPIRACY GENERATOR ============
const conspiracyTemplates = [
    "BREAKING: Sources confirm {user} has been secretly {action} this whole time 🕵️",
    "NEW EVIDENCE suggests {user} is actually {revelation} 📰",
    "LEAKED: {user} was caught {action} at 3am 🌙",
    "EXPOSED: {user}'s real identity is {revelation} 💀",
    "SHOCKING: Scientists discover {user} is responsible for {event} 🔬",
    "CONFIRMED: {user} has been living a double life as {revelation} 🎭",
    "BREAKING NEWS: {user} spotted {action} near Area 51 👽",
    "INVESTIGATION reveals {user} has been secretly {action} for months 🔍"
];
const conspiracyActions = [
    'a bot pretending to be human',
    'running a secret Discord empire',
    'plotting world domination',
    'collecting data for the government',
    'training an AI to replace them',
    'living in the server 24/7',
    'actually three kids in a trenchcoat',
    'a time traveler from 2077',
    'the true owner of this server',
    'secretly a billionaire'
];
const conspiracyEvents = [
    'the server lag last Tuesday',
    'all the weird bot glitches',
    'the great emoji shortage',
    'the disappearance of the good memes',
    'the rise of reply guys',
    'the fall of voice chat quality'
];

// ============ VIBE CHECK ============
const vibeRatings = [
    { emoji: '💀', rating: 'Dead Inside', description: 'Your vibes are in the ICU' },
    { emoji: '😬', rating: 'Concerning', description: 'The vibes are... questionable' },
    { emoji: '😐', rating: 'NPC Energy', description: 'You blend into the background' },
    { emoji: '🙂', rating: 'Mid', description: 'Neither good nor bad, just... there' },
    { emoji: '😎', rating: 'Chill', description: 'Vibes are acceptable' },
    { emoji: '🔥', rating: 'Fire', description: 'Your energy is contagious' },
    { emoji: '✨', rating: 'Immaculate', description: 'Main character energy detected' },
    { emoji: '👑', rating: 'Legendary', description: 'The vibes are *chefs kiss*' },
    { emoji: '🌟', rating: 'Transcendent', description: 'You have ascended beyond vibes' },
    { emoji: '🤖', rating: 'Bot-Like', description: 'Are you sure you are human?' }
];

const vibeStats = [
    'Rizz Level', 'Chaos Factor', 'Touch Grass Index', 'Yapping Potential', 
    'Main Character Energy', 'NPC Likelihood', 'Brainrot Score', 'Sigma Grindset'
];

// ============ WOULD YOU RATHER ============
const wouldYouRather = [
    { a: 'Only communicate in memes forever', b: 'Never use emojis again' },
    { a: 'Have your search history made public', b: 'Have your DMs leaked' },
    { a: 'Be permanently stuck in voice chat', b: 'Never use voice chat again' },
    { a: 'Only type in ALL CAPS', b: 'only type in lowercase forever' },
    { a: 'Have infinite Discord Nitro', b: 'Have $100 in real money' },
    { a: 'Be an admin but everyone hates you', b: 'Be loved but have no perms' },
    { a: 'Get pinged 100 times a day', b: 'Never get pinged again' },
    { a: 'Have your typing always visible', b: 'Have 5 minute message delay' },
    { a: 'Be stuck in a dead server forever', b: 'Be in an overwhelming active server' },
    { a: 'Only use light mode', b: 'Only use Comic Sans font' },
    { a: 'Win every rap battle', b: 'Never lose an argument' },
    { a: 'Have perfect meme timing', b: 'Have perfect comeback timing' },
    { a: 'Be a famous streamer but cringe', b: 'Be unknown but actually funny' },
    { a: 'Know everyone\'s alt accounts', b: 'Have an undetectable alt yourself' }
];

// ============ PROPHECY ============
const prophecyTemplates = [
    "The stars reveal that {user} will {future} within {time} ✨🔮",
    "I have foreseen it: {user} is destined to {future} 🌙",
    "The ancient scrolls speak of {user}... they shall {future} 📜",
    "A vision came to me: {user} will {future} when {condition} 👁️",
    "The prophecy is clear: {user}'s fate is to {future} ⚡",
    "It is written: {user} shall {future} before {time} 📖"
];
const prophecyFutures = [
    'become extremely cringe',
    'achieve ultimate sigma status',
    'touch grass for the first time',
    'go viral for the wrong reasons',
    'accidentally become a meme',
    'win a rap battle against JARVIS',
    'get their message pinned',
    'be exposed for their browser history',
    'become the main character',
    'fumble the bag spectacularly',
    'unlock hidden potential',
    'experience a humbling moment',
    'get ratio\'d into oblivion',
    'achieve legendary status'
];
const prophecyConditions = [
    'Mercury is in retrograde',
    'the clock strikes midnight',
    'they least expect it',
    'everyone is watching',
    'the server hits 1000 members',
    'a new moon rises'
];
const prophecyTimes = [
    'the next 24 hours',
    'this week',
    'the next full moon',
    'exactly 69 days',
    'an unexpected moment',
    'their next message'
];

// ============ FAKE QUOTES ============
const quoteTemplates = [
    '"{quote}" - {user}, {year}',
    '"In the words of the great {user}: {quote}"',
    '{user} once said: "{quote}" and honestly? Based.',
    'Famous last words from {user}: "{quote}"',
    '"{quote}" - {user}, moments before disaster'
];
const fakeQuotes = [
    "I'm not lazy, I'm on energy saving mode",
    "Trust me bro",
    "It worked on my machine",
    "I'll do it tomorrow",
    "This is fine",
    "I'm built different",
    "Skill issue",
    "It's not a bug, it's a feature",
    "Let me cook",
    "I fear no man, but that thing... it scares me",
    "We do a little trolling",
    "I'm something of a scientist myself",
    "Perfectly balanced, as all things should be",
    "Reality can be whatever I want",
    "I am inevitable",
    "No thoughts, head empty",
    "Bold of you to assume I know what I'm doing",
    "Instructions unclear",
    "First time?",
    "I'm not crying, you're crying"
];

// ============ MOCK TRIAL ============
const fakeCrimes = [
    'Being too based in the general chat',
    'Excessive use of the skull emoji 💀',
    'Starting drama then going to sleep',
    'Posting cringe without a license',
    'First degree lurking',
    'Aggravated yapping',
    'Failure to touch grass',
    'Unlawful possession of hot takes',
    'Conspiracy to ratio',
    'Resisting the urge to be normal',
    'Public indecency (bad takes)',
    'Identity theft (using someone\'s joke)',
    'Grand theft meme (reposting)',
    'Disturbing the peace (3am messages)',
    'Reckless endangerment of the vibe'
];

const verdicts = {
    guilty: [
        "GUILTY! 🔨 The court sentences you to 24 hours of touching grass.",
        "GUILTY! 🔨 You are hereby banned from having opinions for 1 week.",
        "GUILTY! 🔨 Your punishment: Must use light mode for 3 days.",
        "GUILTY! 🔨 Sentenced to changing your nickname to 'Certified Menace'."
    ],
    innocent: [
        "INNOCENT! ✅ The court finds you not guilty by reason of being too based.",
        "INNOCENT! ✅ Charges dropped due to insufficient evidence of cringe.",
        "INNOCENT! ✅ The jury was bribed with good vibes. You're free to go.",
        "INNOCENT! ✅ The court acknowledges you did nothing wrong (this time)."
    ]
};

// ============ TYPING RACE ============
const typingPhrases = [
    "The quick brown fox jumps over the lazy dog",
    "Pack my box with five dozen liquor jugs",
    "How vexingly quick daft zebras jump",
    "Sphinx of black quartz judge my vow",
    "Two driven jocks help fax my big quiz",
    "JARVIS is the best Discord bot ever made",
    "I hereby declare that bots are superior to humans",
    "The mitochondria is the powerhouse of the cell",
    "Never gonna give you up never gonna let you down",
    "I use arch btw",
    "It works on my machine I dont know what to tell you",
    "Skill issue detected please git gud",
    "According to all known laws of aviation",
    "Did you ever hear the tragedy of Darth Plagueis",
    "Hello there General Kenobi"
];

// ============ HELPER FUNCTIONS ============
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateWikiEntry(username) {
    const adj = randomChoice(wikiAdjectives);
    const occupation = randomChoice(wikiOccupations);
    const achievement = randomChoice(wikiAchievements);
    const controversy = randomChoice(wikiControversies);
    const birthYear = randomInt(1847, 2010);
    const followers = randomInt(0, 999999).toLocaleString();
    
    return {
        title: `📚 Wikipedia: ${username}`,
        description: `**${username}** (born ${birthYear}) is a ${adj} ${occupation} known for ${achievement}.`,
        fields: [
            { name: '🎂 Born', value: `${birthYear}, probably in a Discord server`, inline: true },
            { name: '💼 Occupation', value: occupation, inline: true },
            { name: '👥 Followers', value: followers, inline: true },
            { name: '🏆 Notable Achievement', value: achievement, inline: false },
            { name: '⚠️ Controversy', value: controversy, inline: false }
        ],
        footer: '⚠️ This article may contain inaccuracies. Actually, it definitely does.'
    };
}

function generateConspiracy(username) {
    const template = randomChoice(conspiracyTemplates);
    const action = randomChoice(conspiracyActions);
    const event = randomChoice(conspiracyEvents);
    
    return template
        .replace('{user}', username)
        .replace('{action}', action)
        .replace('{revelation}', action)
        .replace('{event}', event);
}

function generateVibeCheck(username) {
    const vibe = randomChoice(vibeRatings);
    const stats = {};
    vibeStats.forEach(stat => {
        stats[stat] = randomInt(0, 100);
    });
    
    return {
        username,
        emoji: vibe.emoji,
        rating: vibe.rating,
        description: vibe.description,
        stats,
        overallScore: randomInt(0, 100)
    };
}

function generateProphecy(username) {
    const template = randomChoice(prophecyTemplates);
    const future = randomChoice(prophecyFutures);
    const condition = randomChoice(prophecyConditions);
    const time = randomChoice(prophecyTimes);
    
    return template
        .replace('{user}', username)
        .replace('{future}', future)
        .replace('{condition}', condition)
        .replace('{time}', time);
}

function generateFakeQuote(username) {
    const template = randomChoice(quoteTemplates);
    const quote = randomChoice(fakeQuotes);
    const year = randomInt(1990, 2025);
    
    return template
        .replace('{user}', username)
        .replace('{quote}', quote)
        .replace('{year}', year);
}

function getRandomTypingPhrase() {
    return randomChoice(typingPhrases);
}

function getRoastOrCompliment() {
    const isRoast = Math.random() < 0.5;
    return {
        isRoast,
        text: isRoast ? randomChoice(roasts) : randomChoice(compliments)
    };
}

function getWouldYouRather() {
    return randomChoice(wouldYouRather);
}

function getFakeCrime() {
    return randomChoice(fakeCrimes);
}

function getVerdict(isGuilty) {
    return isGuilty ? randomChoice(verdicts.guilty) : randomChoice(verdicts.innocent);
}

module.exports = {
    // Data exports
    roasts,
    compliments,
    wouldYouRather,
    fakeCrimes,
    verdicts,
    typingPhrases,
    
    // Generator functions
    generateWikiEntry,
    generateConspiracy,
    generateVibeCheck,
    generateProphecy,
    generateFakeQuote,
    getRandomTypingPhrase,
    getRoastOrCompliment,
    getWouldYouRather,
    getFakeCrime,
    getVerdict,
    
    // Utilities
    randomChoice,
    randomInt
};
