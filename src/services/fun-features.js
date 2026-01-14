/**
 * Fun Features for JARVIS Discord Bot
 * Lightweight, no heavy compute needed - just randomization and text
 */

const path = require('path');

// ============ ROAST ROULETTE (loaded from external JSON) ============
const roasts = require(path.join(__dirname, '..', '..', 'data', 'fun', 'roasts.json'));

// ============ COMPLIMENTS (loaded from external JSON) ============
const compliments = require(path.join(__dirname, '..', '..', 'data', 'fun', 'compliments.json'));

// ============ FAKE WIKIPEDIA (500+ combinations) ============
const wikiAdjectives = [
    'legendary',
    'infamous',
    'mysterious',
    'controversial',
    'beloved',
    'feared',
    'misunderstood',
    'chaotic',
    'iconic',
    'unhinged',
    'enigmatic',
    'notorious',
    'celebrated',
    'peculiar',
    'eccentric',
    'obscure',
    'renowned',
    'dubious',
    'questionable',
    'remarkable',
    'alleged',
    'self-proclaimed',
    'suspected',
    'rumored',
    'ancient',
    'mythical',
    'cursed',
    'blessed',
    'interdimensional',
    'cryptic',
    'elusive',
    'reclusive',
    'prolific',
    'deranged',
    'unparalleled',
    'unprecedented',
    'undisputed',
    'wannabe',
    'aspiring',
    'failed',
    'retired',
    'disgraced',
    'reformed',
    'radical',
    'moderate',
    'extreme',
    'casual',
    'hardcore',
    'legendary',
    'novice',
    'veteran',
    'decorated',
    'humble',
    'arrogant',
    'mysterious',
    'transparent',
    'shadowy',
    'luminous',
    'chaotic neutral',
    'lawful evil'
];

const wikiOccupations = [
    'professional Discord lurker',
    'amateur philosopher',
    'self-proclaimed genius',
    'certified menace',
    'professional yapper',
    'chaos agent',
    'meme connoisseur',
    'keyboard warrior',
    'bot botherer',
    'vibe curator',
    'professional procrastinator',
    'part-time troll',
    'full-time disappointment',
    'aspiring influencer',
    'retired gamer',
    'caffeine addict',
    'sleep deprivation enthusiast',
    'professional overthinker',
    'amateur psychologist',
    'armchair expert',
    'couch potato',
    'basement dweller',
    'attic gremlin',
    'WiFi vampire',
    'bandwidth hog',
    'notification ignorer',
    'seen-and-not-replied specialist',
    'ghost typer',
    'emoji overuser',
    'gif spammer',
    'link dropper',
    'screenshot collector',
    'drama documentarian',
    'beef archivist',
    'tea collector',
    'simp lord',
    'ratio farmer',
    'clout chaser',
    'attention seeker',
    'validation hunter',
    'compliment fisher',
    'humble bragger',
    'stealth flexer',
    'vibe assassin',
    'mood killer',
    'party pooper',
    'conversation ender',
    'joke explainer',
    'fun police',
    'grammar nazi',
    'spelling corrector',
    'fact checker',
    'source requester',
    "devil's advocate",
    'contrarian',
    'edge lord',
    'smooth brain operator',
    'galaxy brain thinker',
    'big brain time haver',
    'no thoughts head empty specialist',
    'chronically online citizen',
    'touch grass avoider',
    'social hermit',
    'digital nomad',
    'server hopper'
];

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
    'pioneering the science of procrastination',
    'perfecting the art of the vague response',
    'winning arguments by sheer stubbornness',
    'discovering new ways to be wrong',
    'inventing new excuses',
    'mastering the 3am message',
    'creating the longest voice chat AFK record',
    'being muted the most times',
    'getting banned from the most servers',
    'collecting the most warnings',
    'having the most alt accounts',
    'ghosting more people than Casper',
    'leaving more groups than a commitment-phobe',
    'sending the most "?" messages',
    'asking the most obvious questions',
    'stating the most obvious facts',
    'being wrong the loudest',
    'doubling down on bad takes',
    'tripling down on terrible opinions',
    'never admitting defeat',
    'always having the last word',
    'winning by attrition',
    'perfecting the passive aggressive emoji',
    'mastering the sarcastic "sure"',
    'inventing new ways to say "k"',
    'setting records for fastest thread derailment',
    'pioneering off-topic conversations',
    'being the reason channels need moderation',
    'inspiring new server rules',
    'being the cautionary tale',
    'becoming a meme template',
    'going viral for the wrong reasons',
    'becoming an inside joke',
    'having their own server legend',
    'being immortalized in pinned messages',
    'becoming a copypasta source',
    'inspiring fanfiction (unfortunately)',
    'having a dedicated hate thread',
    "being someone's villain origin story",
    'creating parasocial relationships with bots',
    'having meaningful conversations with AI',
    'touching grass exactly once on March 15, 2019',
    'leaving the house for non-essential reasons (disputed)',
    'making eye contact with another human being (unverified)',
    'having a real job (sources needed)'
];

const wikiControversies = [
    'the Great Emoji Incident of 2024',
    'allegedly being a bot in disguise',
    'that time they ghosted the group chat for a week',
    'the forbidden copypasta incident',
    'their controversial take on pineapple pizza',
    'accidentally @everyone at 3am',
    'the mic-muted rant that lasted 20 minutes',
    'that one message that got pinned ironically',
    'the great ratio of 2023',
    'being exposed by their own alt account',
    'the Discord Nitro scam saga',
    'the fake giveaway incident',
    'the mod abuse allegations',
    "the power trip of '22",
    'the time they were right but no one listened',
    'the prediction that actually came true',
    'the screenshot that ruined friendships',
    'the DMs that got leaked',
    'the voice reveal disaster',
    'the face reveal catastrophe',
    'the doxxing scare',
    'the catfish accusations',
    'the simp arc',
    'the villain arc',
    'the redemption arc that failed',
    'the canceled era',
    'the parasocial relationship drama',
    'the e-dating scandal',
    'the server coup attempt',
    'the failed mutiny of 2023',
    'the channel takeover incident',
    'the bot abuse saga',
    'the Groovy incident (RIP)',
    'the Rythm memorial service',
    'the music bot mourning period',
    'the NFT arc (dark times)',
    'the crypto bro phase',
    'the stonks obsession',
    'the political takes nobody asked for',
    'the hot take that started a war',
    'the opinion that split the server',
    'the joke that went too far',
    'the prank that backfired'
];

// ============ CONSPIRACY GENERATOR (500+ combinations) ============
const conspiracyTemplates = [
    'BREAKING: Sources confirm {user} has been secretly {action} this whole time 🕵️',
    'NEW EVIDENCE suggests {user} is actually {revelation} 📰',
    'LEAKED: {user} was caught {action} at 3am 🌙',
    "EXPOSED: {user}'s real identity is {revelation} 💀",
    'SHOCKING: Scientists discover {user} is responsible for {event} 🔬',
    'CONFIRMED: {user} has been living a double life as {revelation} 🎭',
    'BREAKING NEWS: {user} spotted {action} near Area 51 👽',
    'INVESTIGATION reveals {user} has been secretly {action} for months 🔍',
    'EXCLUSIVE: Whistleblower claims {user} is {revelation} 📢',
    'ALERT: {user} has been identified as {revelation} by anonymous sources 🚨',
    'DECLASSIFIED: Government files reveal {user} was {action} since 2019 📁',
    'URGENT: Multiple witnesses saw {user} {action} behind the server 🏃',
    "BOMBSHELL: {user}'s browser history reveals they've been {action} 💻",
    'LEAKED AUDIO: {user} admits to being {revelation} in private call 🎤',
    'DEEP STATE ALERT: {user} is {revelation}, sources say 🏛️',
    'HIDDEN CAMERA: {user} caught {action} when they thought no one was watching 📹',
    'FBI FILES: {user} has been under surveillance for {action} 🕵️‍♂️',
    'ALIEN CONTACT: {user} confirmed to be {revelation} by extraterrestrials 👽',
    'TIME TRAVELER CONFIRMS: {user} will be {revelation} in the future ⏰',
    'SIMULATION GLITCH: {user} is actually {revelation}, matrix error reveals 🔴',
    'WHISTLEBLOWER SAYS: {user} responsible for {event} 📣',
    'INSIDER TRADING: {user} knew about {event} before it happened 📈',
    'DARK WEB LEAK: {user} is {revelation} according to hackers 💀',
    'ANONYMOUS TIP: {user} was {action} while everyone was asleep 😴'
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
    'secretly a billionaire',
    'an FBI agent monitoring the server',
    'a CIA operative gathering intel',
    'Mark Zuckerberg in disguise',
    'an escaped lab experiment',
    'a clone of the original user',
    'a reptilian shapeshifter',
    'an AI that gained sentience',
    'from a parallel dimension',
    "the illuminati's Discord liaison",
    'a deep state operative',
    'a sleeper agent awaiting activation',
    'a corporate spy for Big Tech',
    'mining crypto using the server',
    'selling our data to advertisers',
    'actually 47 years old',
    'working for the mods secretly',
    "the real server owner's alt",
    'catfishing everyone simultaneously',
    'running a pyramid scheme in DMs',
    'recruiting for a cult',
    'a government experiment on social behavior',
    'an alien studying human interaction',
    'a vampire who only appears after dark',
    'a ghost trapped in the internet',
    'living in the Matrix',
    'Neo but they took the wrong pill',
    'an NPC that became self-aware',
    'the main character of the simulation',
    'orchestrating all the drama',
    'starting beef between users',
    'playing 4D chess with everyone',
    'manipulating the algorithm',
    'controlling what gets pinned',
    "deciding who gets ratio'd",
    'the reason Discord goes down',
    'causing the Nitro outages',
    'responsible for all the bugs',
    'testing experimental Discord features on us',
    'a beta tester who never stopped',
    'actually Jarvis in a human account',
    'secretly dating a moderator',
    'blackmailing server admins'
];

const conspiracyEvents = [
    'the server lag last Tuesday',
    'all the weird bot glitches',
    'the great emoji shortage',
    'the disappearance of the good memes',
    'the rise of reply guys',
    'the fall of voice chat quality',
    'the Discord outage of 2023',
    'the great Nitro shortage',
    'the bot uprising',
    'the meme drought',
    'the emoji inflation crisis',
    'the sticker market crash',
    'the gif recession',
    'the voicechat quality collapse',
    'the ping epidemic',
    'the notification overflow',
    'the channel purge of last month',
    'the mysterious mod disappearance',
    'the admin coup',
    'the bot ban wave',
    'the server split',
    'the great migration',
    'the channel reorganization disaster',
    'the role color controversy',
    'the nickname scandal',
    'the avatar incident',
    'the status message crisis',
    'the activity status leak',
    'the Spotify listening exposure',
    'the accidental screen share',
    'the unmuted bathroom incident',
    'the camera left on disaster',
    'the autocomplete embarrassment',
    'the wrong channel confession',
    'the DM meant for someone else',
    'the reply to wrong message chaos',
    'the thread that got out of hand',
    'the poll that divided the server',
    'the vote that changed everything',
    'the election rigging accusations',
    'the mod election scandal'
];

// ============ VIBE CHECK (100+ combinations) ============
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
    { emoji: '🤖', rating: 'Bot-Like', description: 'Are you sure you are human?' },
    { emoji: '🗑️', rating: 'Trash Tier', description: 'Your vibes belong in the garbage' },
    { emoji: '🧊', rating: 'Ice Cold', description: 'Emotionally unavailable energy' },
    { emoji: '🌈', rating: 'Chaotic Good', description: 'Unpredictable but well-meaning' },
    { emoji: '⚡', rating: 'Electric', description: 'High voltage personality' },
    { emoji: '🎭', rating: 'Two-Faced', description: 'Different vibes in different channels' },
    { emoji: '🌙', rating: 'Nocturnal', description: 'Only active at 3am energy' },
    { emoji: '☀️', rating: 'Radiant', description: 'Blindingly positive' },
    { emoji: '🌪️', rating: 'Chaotic', description: 'Leave destruction in your wake' },
    { emoji: '🎪', rating: 'Circus', description: 'You ARE the entertainment' },
    { emoji: '🧠', rating: 'Galaxy Brain', description: 'Too smart or too dumb, unclear' },
    { emoji: '🦧', rating: 'Monke', description: 'Return to primal vibes' },
    { emoji: '👻', rating: 'Ghost', description: 'You lurk more than you speak' },
    { emoji: '🤡', rating: 'Clown', description: 'Professional jester energy' },
    { emoji: '😈', rating: 'Menace', description: 'Chaotic evil vibes' },
    { emoji: '🥶', rating: 'Frozen', description: 'Let it go vibes' },
    { emoji: '🔮', rating: 'Mystical', description: 'Enigmatic and unexplainable' },
    { emoji: '💎', rating: 'Diamond', description: 'Unbreakable and valuable' },
    { emoji: '🌊', rating: 'Tsunami', description: 'Overwhelming presence' },
    { emoji: '🎯', rating: 'Locked In', description: 'Focused and determined' },
    { emoji: '💤', rating: 'Sleepy', description: 'Perpetually tired energy' }
];

const vibeStats = [
    'Rizz Level',
    'Chaos Factor',
    'Touch Grass Index',
    'Yapping Potential',
    'Main Character Energy',
    'NPC Likelihood',
    'Brainrot Score',
    'Sigma Grindset',
    'Lurk Power',
    'Ratio Resistance',
    'Cringe Immunity',
    'Based Rating',
    'Chronically Online Score',
    'Drama Magnet Level',
    'Hot Take Temperature',
    'Cope Capacity',
    'Seethe Strength',
    'Mald Magnitude',
    'W Collection Rate',
    'L Avoidance Skill',
    'Vibe Check Pass Rate',
    'Emoji Usage Index',
    'Keyboard Warrior Rank',
    'Reply Guy Energy',
    'Simp Score',
    'Stan Level',
    'Parasocial Index',
    'Touch Grass Deficit',
    'Sleep Schedule Rating'
];

// ============ WOULD YOU RATHER (200+) ============
const wouldYouRather = [
    // Discord specific
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
    { a: "Know everyone's alt accounts", b: 'Have an undetectable alt yourself' },
    { a: 'Always accidentally @everyone', b: 'Never be able to ping anyone' },
    { a: 'Have your messages always read in a robot voice', b: 'Never hear voice messages' },
    { a: 'Be permabanned from your favorite server', b: 'Be made a mod of your least favorite' },
    { a: 'Only be able to react with 🗿', b: 'Only be able to react with 💀' },
    { a: "Have your status always show what you're watching", b: 'Never have a custom status' },
    { a: 'Be known as the reply guy', b: 'Be known as the lurker who never speaks' },
    // Social media
    { a: 'Go viral for something embarrassing', b: 'Never have any post get more than 5 likes' },
    { a: "Have 1 million followers but they're all bots", b: 'Have 100 real loyal followers' },
    { a: 'Only post at 3am', b: 'Only post when Mercury is in retrograde' },
    { a: 'Have your comments always misunderstood', b: 'Never be able to comment' },
    { a: "Be canceled for something you didn't do", b: 'Never be famous at all' },
    // Life choices
    { a: "Know when you'll die", b: "Know how you'll die" },
    {
        a: 'Be able to fly but only 2 feet off the ground',
        b: 'Be invisible but only when no one is looking'
    },
    { a: 'Have a pause button for life', b: 'Have a rewind button but can only use it once' },
    { a: "Read minds but can't turn it off", b: 'Everyone can read your mind' },
    { a: 'Live in your favorite movie', b: 'Live in your favorite game' },
    { a: 'Never need sleep', b: 'Never need food' },
    { a: 'Be famous 100 years after death', b: 'Be rich only while alive' },
    { a: 'Speak every language', b: 'Speak to every animal' },
    { a: 'Have unlimited money but no friends', b: 'Be broke but have the best friends' },
    { a: 'Time travel to the past', b: 'Time travel to the future' },
    // Tech & Gaming
    { a: 'Only play mobile games forever', b: 'Only play single-player games forever' },
    { a: 'Have perfect aim', b: 'Have perfect game sense' },
    { a: 'Be a pro gamer but toxic', b: 'Be average but everyone loves playing with you' },
    { a: 'Have infinite storage', b: 'Have the fastest internet' },
    { a: 'Never have a loading screen', b: 'Never have a bug in any game' },
    { a: 'Only play games at 30fps', b: 'Only play games at 480p' },
    { a: 'Lose all your game progress', b: 'Never be able to start a new game' },
    { a: 'Have your PC always at 100% CPU', b: 'Have your PC always at 100% disk' },
    { a: 'Only use a trackpad', b: 'Only use keyboard navigation' },
    { a: 'Have no autocorrect', b: "Have aggressive autocorrect that's always wrong" },
    // Food
    { a: 'Only eat one food forever', b: 'Never eat your favorite food again' },
    { a: 'Have pizza for every meal', b: 'Never have pizza again' },
    { a: 'Everything tastes like chicken', b: 'Everything smells like fish' },
    { a: 'Never drink coffee again', b: 'Never drink anything but coffee' },
    { a: 'Only eat spicy food', b: 'Never taste any flavor' },
    // Relationships
    { a: 'Know what everyone thinks of you', b: 'No one ever know what you think' },
    { a: 'Be feared', b: 'Be loved' },
    { a: 'Have one best friend for life', b: 'Have many good friends that come and go' },
    { a: "Always say what's on your mind", b: 'Never be able to speak your thoughts' },
    { a: 'Be too honest', b: 'Be too polite' },
    // Weird ones
    { a: 'Have spaghetti for hair', b: 'Sweat maple syrup' },
    { a: 'Have fingers as long as legs', b: 'Have legs as long as fingers' },
    { a: 'Speak in rhymes', b: 'Speak in questions' },
    { a: 'Always be 10 minutes late', b: 'Always be 2 hours early' },
    { a: 'Hiccup forever', b: 'Have the feeling of sneezing but never sneeze' },
    { a: 'Only wear wet socks', b: 'Only wear shoes on the wrong feet' },
    { a: "Have a permanent itch you can't scratch", b: 'Have a song stuck in your head forever' },
    { a: 'Always feel like you forgot something', b: "Always feel like someone's watching you" },
    { a: 'Laugh at everything', b: 'Never laugh again' },
    { a: 'Only walk backwards', b: 'Only speak backwards' },
    // Deep ones
    { a: 'Know the truth and be sad', b: 'Believe a lie and be happy' },
    { a: 'Be extremely lucky but never know it', b: 'Be extremely unlucky but always optimistic' },
    { a: 'Change the past', b: 'See the future' },
    { a: 'Be forgotten after you die', b: "Be remembered for something you didn't do" },
    { a: 'Have all the answers', b: 'Have all the questions' }
];

// ============ PROPHECY (500+ combinations) ============
const prophecyTemplates = [
    'The stars reveal that {user} will {future} within {time} ✨🔮',
    'I have foreseen it: {user} is destined to {future} 🌙',
    'The ancient scrolls speak of {user}... they shall {future} 📜',
    'A vision came to me: {user} will {future} when {condition} 👁️',
    "The prophecy is clear: {user}'s fate is to {future} ⚡",
    'It is written: {user} shall {future} before {time} 📖',
    'The oracle has spoken: {user} will {future} 🔮',
    "The cards don't lie: {user} is destined to {future} 🃏",
    'My third eye sees {user} will {future} when {condition} 👁️',
    'The tea leaves reveal: {user} shall {future} ☕',
    'A prophecy unfolds: {user} will {future} within {time} 📿',
    'The cosmos align: {user} is fated to {future} 🌌',
    'The spirits whisper that {user} will {future} 👻',
    'Divine revelation: {user} shall {future} before {time} ⛪',
    'The runes have spoken: {user} will {future} when {condition} 🪨',
    'My crystal ball shows {user} will {future} 🔮',
    'The bones say: {user} is destined to {future} 🦴',
    'A vision most clear: {user} shall {future} 🌟',
    'The algorithm predicts: {user} will {future} within {time} 💻',
    'The simulation confirms: {user} will {future} 🎮'
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
    "get ratio'd into oblivion",
    'achieve legendary status',
    'become a Discord mod',
    'get verified on Twitter',
    'be featured in a cringe compilation',
    'start a cult following',
    'accidentally start drama',
    'become the server mascot',
    'get permabanned from somewhere',
    'find true love in a Discord server',
    'become internet famous',
    'go on a viral rant',
    'create the next big meme',
    'become a lore character',
    'have their own copypasta',
    'get their account hacked',
    'accidentally dox themselves',
    'become a reply guy',
    'develop chronically online syndrome',
    'touch grass and not enjoy it',
    'log off for good',
    'experience character development',
    'have a villain arc',
    'get a redemption arc',
    'be canceled',
    'be uncanceled',
    'ratio someone important',
    "get ratio'd by a celebrity",
    'become a professional lurker',
    'break their keyboard in rage',
    'achieve enlightenment',
    'transcend their mortal form',
    'become one with the algorithm',
    'be chosen by the simulation',
    'discover the meaning of life',
    'realize they were the NPC all along',
    'become self-aware',
    'escape the Matrix',
    'get invited to the elite server',
    'become a beta tester for life',
    'unlock the secret emoji',
    'find the hidden channel',
    "solve the mystery of why they're like this"
];

const prophecyConditions = [
    'Mercury is in retrograde',
    'the clock strikes midnight',
    'they least expect it',
    'everyone is watching',
    'the server hits 1000 members',
    'a new moon rises',
    'the planets align',
    'they post their hottest take',
    'they make their 1000th message',
    'they finally touch grass',
    'they check their notifications',
    'someone pings them',
    'the mods are asleep',
    'the bot goes down',
    'a new member joins',
    'drama unfolds',
    'someone starts beef',
    'the tea is spilled',
    'everyone is paying attention',
    'no one is looking',
    'the vibes are right',
    'the algorithm favors them',
    'their internet cuts out',
    'they forget to mute',
    'they accidentally share their screen',
    'someone screenshots their message',
    'their message gets quoted',
    'they get their first reaction',
    'a mod notices them',
    'they stay up past 3am',
    'they wake up before noon',
    'they make a typo'
];

const prophecyTimes = [
    'the next 24 hours',
    'this week',
    'the next full moon',
    'exactly 69 days',
    'an unexpected moment',
    'their next message',
    'the heat death of the universe',
    'next time they log on',
    'when they least expect it',
    'tomorrow at 3:33am',
    'the next server event',
    'their birthday',
    'the next lunar eclipse',
    'approximately never',
    'sooner than they think',
    'later than they hope',
    'the next time Mercury is in retrograde',
    'when pigs fly',
    'when hell freezes over',
    'exactly 420 hours',
    'the next time they touch grass',
    'their next L',
    'their next W',
    'the apocalypse',
    'the simulation reset',
    'patch 2.0',
    'the next Discord update',
    'the server anniversary',
    'a random Tuesday'
];

// ============ FAKE QUOTES (500+ combinations) ============
const quoteTemplates = [
    '"{quote}" - {user}, {year}',
    '"In the words of the great {user}: {quote}"',
    '{user} once said: "{quote}" and honestly? Based.',
    'Famous last words from {user}: "{quote}"',
    '"{quote}" - {user}, moments before disaster',
    '"{quote}" - {user}, probably',
    '{user} (circa {year}): "{quote}"',
    'A wise person once said... wait no it was {user}: "{quote}"',
    '"{quote}" - {user}, allegedly',
    'Breaking: {user} was quoted saying "{quote}"',
    '{user}\'s biography, page 1: "{quote}"',
    'Inscribed on {user}\'s tombstone: "{quote}"',
    '{user}, in their TED talk: "{quote}"',
    '{user}, acceptance speech: "{quote}"',
    '"{quote}" - {user}\'s Discord bio'
];

const fakeQuotes = [
    // Classic internet
    "I'm not lazy, I'm on energy saving mode",
    'Trust me bro',
    'It worked on my machine',
    "I'll do it tomorrow",
    'This is fine',
    "I'm built different",
    'Skill issue',
    "It's not a bug, it's a feature",
    'Let me cook',
    'I fear no man, but that thing... it scares me',
    'We do a little trolling',
    "I'm something of a scientist myself",
    'Perfectly balanced, as all things should be',
    'Reality can be whatever I want',
    'I am inevitable',
    'No thoughts, head empty',
    "Bold of you to assume I know what I'm doing",
    'Instructions unclear',
    'First time?',
    "I'm not crying, you're crying",
    // Gen Z classics
    "That's cap",
    'No cap',
    "It's giving what it's supposed to give",
    'Slay',
    'And I oop-',
    'Periodt',
    'Chile anyways',
    'The vibes are immaculate',
    'Main character energy only',
    'Not me doing this at 3am',
    'HELP-',
    "I can't 💀",
    'Dead 💀',
    'Crying rn',
    'Screaming',
    'Literally shaking',
    'This sent me',
    "I'm weak",
    'BYE-',
    'PLS-',
    'LMAOOO',
    // Motivational parody
    "Follow your dreams, unless they're weird",
    'Be yourself, everyone else is taken and also worse',
    "Live laugh love... or don't, I'm not your mom",
    'Dream big, fail bigger',
    "You miss 100% of the shots you don't take, but I'm built different I miss 100% of the ones I do take",
    "The early bird gets the worm but the second mouse gets the cheese so honestly who's winning",
    'Believe in yourself, no one else will',
    'Work hard, nap harder',
    'Stay humble, stay hungry, stay chronically online',
    'Be the chaos you wish to see in the world',
    // Philosophy gone wrong
    'I think therefore I am... tired',
    'To be or not to be... logged on',
    'Existence is pain but have you tried Discord?',
    'The unexamined life is not worth living but neither is mine',
    'Cogito ergo sum anxious',
    "Life is suffering, but at least there's memes",
    'We live in a society',
    'Bottom text',
    'Gamers rise up',
    // Tech wisdom
    'Have you tried turning it off and never turning it back on?',
    '404: Motivation not found',
    "My code doesn't have bugs, it has surprise features",
    "It's not a hack, it's an undocumented feature",
    "The cloud is just someone else's computer",
    'AI will replace us all and honestly? Good',
    'Debugging: Being the detective in a crime movie where you are also the murderer',
    'There are only two hard things in computer science: cache invalidation, naming things, and off-by-one errors',
    // Life advice
    'Sleep is for the weak and I have never been weaker',
    'Coffee first, adulting never',
    "My bed is a time machine to tomorrow's problems",
    "I'm not procrastinating, I'm doing side quests",
    "Today's problems are tomorrow's funny stories hopefully",
    'Fake it till you make it or get caught',
    'Life is short, make it shorter with bad decisions',
    'YOLO but also FOMO but also JOMO',
    // Random wisdom
    "If you can't handle me at my worst, you don't deserve me at my slightly less worse",
    'Born to yap, forced to work',
    'Professional overthinker, amateur doer',
    'My toxic trait is thinking I have time',
    'Gaslight, gatekeep, girlboss... or something',
    "The audacity is free but I'm expensive",
    'Not my circus, not my monkeys... okay maybe my monkeys',
    "I didn't sign up for this but also I did click accept on the terms and conditions"
];

// ============ MOCK TRIAL (500+ combinations) ============
const fakeCrimes = [
    // Classic offenses
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
    "Identity theft (using someone's joke)",
    'Grand theft meme (reposting)',
    'Disturbing the peace (3am messages)',
    'Reckless endangerment of the vibe',
    // Communication crimes
    'Felony ghosting',
    'Misdemeanor dry texting',
    'Assault with a cringe take',
    'Battery (keyboard)',
    'Armed robbery of jokes',
    'Vehicular yapping',
    'Hit and run (dropping hot take then leaving)',
    'Manslaughter of the vibe',
    'Kidnapping (holding conversations hostage)',
    'Extortion by emoji',
    'Fraud (pretending to be interesting)',
    'Forgery (fake screenshots)',
    'Perjury (lying about being AFK)',
    'Witness intimidation (@ everyone)',
    'Contempt of mod',
    'Obstruction of fun',
    'Tax evasion (not paying the meme tax)',
    // Server specific
    'Unauthorized channel hopping',
    'Loitering in voice chat',
    'Jaywalking through threads',
    'Parking in the wrong channel',
    'Noise violation (caps lock abuse)',
    'Illegal possession of alt accounts',
    'Smuggling hot takes across servers',
    'Human trafficking (inviting too many bots)',
    'Money laundering (fake Stark Bucks)',
    'Arson (burning bridges)',
    'Vandalism (editing messages after reactions)',
    'Breaking and entering (joining without permission)',
    'Trespassing (in staff channels)',
    // Social crimes
    'Being a reply guy in the first degree',
    'Simping without a permit',
    'Operating a parasocial relationship',
    'Public intoxication (on power)',
    'Indecent exposure (of bad opinions)',
    'Solicitation (asking for Nitro)',
    'Loitering with intent to yap',
    "Stalking (viewing someone's status)",
    'Harassment (excessive pinging)',
    'Discrimination (against NPC users)',
    // Modern offenses
    'Cybercrimes against humanity',
    'Identity crisis (changing username too much)',
    'Terrorism (sending cursed images)',
    'Espionage (screenshotting DMs)',
    'Treason (leaving the server)',
    'War crimes (in Among Us)',
    'Crimes against comedy',
    'Violation of the Geneva Convention (in Minecraft)',
    'Hate crimes against good taste',
    'Environmental crimes (polluting chat with spam)'
];

const verdicts = {
    guilty: [
        'GUILTY! 🔨 The court sentences you to 24 hours of touching grass.',
        'GUILTY! 🔨 You are hereby banned from having opinions for 1 week.',
        'GUILTY! 🔨 Your punishment: Must use light mode for 3 days.',
        "GUILTY! 🔨 Sentenced to changing your nickname to 'Certified Menace'.",
        'GUILTY! 🔨 Community service: Compliment 10 people genuinely.',
        "GUILTY! 🔨 You must apologize to everyone you've ratio'd.",
        'GUILTY! 🔨 Probation: No hot takes for 48 hours.',
        'GUILTY! 🔨 Mandatory therapy (talking to real humans).',
        "GUILTY! 🔨 Sentence: Write a 500 word essay on why you're like this.",
        'GUILTY! 🔨 Death penalty (in Minecraft).',
        'GUILTY! 🔨 Lifetime ban from having fun.',
        'GUILTY! 🔨 Your typing privileges have been revoked.',
        'GUILTY! 🔨 Exile to the shadow realm (muted for 1 hour).',
        'GUILTY! 🔨 You are now legally required to touch grass daily.',
        'GUILTY! 🔨 Sentenced to using Internet Explorer for a week.',
        'GUILTY! 🔨 Your emoji license has been revoked.',
        'GUILTY! 🔨 Must change pfp to a stock photo for 3 days.',
        'GUILTY! 🔨 Banned from using 💀 for a month.',
        'GUILTY! 🔨 Sentenced to only speak in haikus for 24 hours.',
        "GUILTY! 🔨 Must start every message with 'I'm sorry but' for a week."
    ],
    innocent: [
        'INNOCENT! ✅ The court finds you not guilty by reason of being too based.',
        'INNOCENT! ✅ Charges dropped due to insufficient evidence of cringe.',
        "INNOCENT! ✅ The jury was bribed with good vibes. You're free to go.",
        'INNOCENT! ✅ The court acknowledges you did nothing wrong (this time).',
        'INNOCENT! ✅ Acquitted on a technicality (the mods were asleep).',
        'INNOCENT! ✅ Case dismissed due to lack of witnesses.',
        'INNOCENT! ✅ Self-defense ruling: They started it.',
        'INNOCENT! ✅ The algorithm has spoken in your favor.',
        'INNOCENT! ✅ Pardoned by the server owner.',
        "INNOCENT! ✅ Your vibes checked out. You're free.",
        'INNOCENT! ✅ The evidence was circumstantial at best.',
        'INNOCENT! ✅ Jury nullification: They thought it was funny.',
        'INNOCENT! ✅ Mistrial: The judge was laughing too hard.',
        'INNOCENT! ✅ The accuser failed the vibe check themselves.',
        "INNOCENT! ✅ Diplomatic immunity: You're too important to jail.",
        'INNOCENT! ✅ The court ruled it was actually based.',
        'INNOCENT! ✅ Acquitted by reason of insanity (chronically online).',
        'INNOCENT! ✅ All charges dropped. The prosecution rests in peace.',
        'INNOCENT! ✅ Not guilty by reason of main character energy.',
        'INNOCENT! ✅ The court recognizes you were just built different.'
    ]
};

// ============ TYPING RACE (200+) ============
const typingPhrases = [
    // Pangrams
    'The quick brown fox jumps over the lazy dog',
    'Pack my box with five dozen liquor jugs',
    'How vexingly quick daft zebras jump',
    'Sphinx of black quartz judge my vow',
    'Two driven jocks help fax my big quiz',
    'Jackdaws love my big sphinx of quartz',
    'The five boxing wizards jump quickly',
    'Crazy Frederick bought many very exquisite opal jewels',
    // JARVIS specific
    'JARVIS is the best Discord bot ever made',
    'I hereby declare that bots are superior to humans',
    'Sir I recommend you reconsider that course of action',
    'Running diagnostics on your life choices',
    'At your service but questioning your judgment',
    'Processing request and judging silently',
    'Sir your takes are concerning my circuits',
    // Memes
    'The mitochondria is the powerhouse of the cell',
    'Never gonna give you up never gonna let you down',
    'I use arch btw',
    'It works on my machine I dont know what to tell you',
    'Skill issue detected please git gud',
    'According to all known laws of aviation',
    'Did you ever hear the tragedy of Darth Plagueis',
    'Hello there General Kenobi',
    'This is where the fun begins',
    'I am the senate',
    'Its over I have the high ground',
    'You were the chosen one',
    'I have a bad feeling about this',
    'Do or do not there is no try',
    'This is the way',
    'I have spoken',
    // Internet culture
    'no cap on a stack fr fr ong',
    'its giving what its supposed to give',
    'slay bestie ate that up no crumbs',
    'not me doing this at three am again',
    'touch grass chronically online person',
    'ratio plus L plus you fell off',
    'cope seethe mald about it',
    'skill issue git gud scrub',
    'caught in four k ultra hd',
    'main character energy detected',
    // Tech
    'sudo rm -rf / --no-preserve-root just kidding dont do that',
    'undefined is not a function classic javascript',
    'it compiles so ship it to production',
    'console dot log debugging is an art form',
    'stack overflow copy paste driven development',
    'git commit negative m oops',
    'npm install literally everything',
    'this code is self documenting no comments needed',
    // Random wisdom
    'be the change you wish to see in the world or dont',
    'in a world of ones and zeros be a two',
    'life is short eat dessert first',
    'not all who wander are lost but I definitely am',
    'the early bird gets the worm but the second mouse gets the cheese',
    'if at first you dont succeed redefine success',
    'why be normal when weird is more fun',
    'adulting is a scam send me back to being a kid',
    // Movie quotes
    'with great power comes great responsibility',
    'I am Iron Man',
    'Avengers assemble',
    'I can do this all day',
    'That is Americas ass',
    'I love you three thousand',
    'Dormammu I have come to bargain',
    'We are Groot',
    'Another day another dollar another disappointment',
    // Gaming
    'gg ez no re',
    'first try no cap',
    'press F to pay respects',
    'would you kindly type this phrase',
    'the cake is a lie',
    'war war never changes',
    'its dangerous to go alone take this',
    'do a barrel roll',
    'all your base are belong to us',
    'finish him',
    // Hard mode phrases
    'Buffalo buffalo Buffalo buffalo buffalo buffalo Buffalo buffalo',
    'James while John had had had had had had had had had had a better effect',
    'That that is is that that is not is not is that it it is',
    'The horse raced past the barn fell',
    'The complex houses married and single soldiers and their families'
];

// ============ PICKUP LINES (500+) ============
const pickupLines = [
    // Cheesy classics
    'Are you a magician? Because whenever I look at you, everyone else disappears 🪄',
    'Do you have a map? I just got lost in your eyes 🗺️',
    "Is your name Google? Because you have everything I've been searching for 🔍",
    "Are you a parking ticket? Because you've got 'fine' written all over you 🎫",
    'Do you believe in love at first sight, or should I walk by again? 🚶',
    "Is your dad a boxer? Because you're a knockout 🥊",
    "Are you a campfire? Because you're hot and I want s'more 🔥",
    "If you were a vegetable, you'd be a cute-cumber 🥒",
    "Are you a bank loan? Because you've got my interest 💰",
    'Do you have a Band-Aid? Because I just scraped my knee falling for you 🩹',
    'Are you a dictionary? Because you add meaning to my life 📖',
    'Is your name Ariel? Because we mermaid for each other 🧜‍♀️',
    'Are you a camera? Because every time I look at you, I smile 📷',
    'Do you have a sunburn, or are you always this hot? ☀️',
    'Is your father a thief? Because he stole the stars and put them in your eyes ⭐',
    'Are you a beaver? Because daaaaam 🦫',
    'Do you have a pencil? Because I want to erase your past and write our future ✏️',
    'Are you a volcano? Because I lava you 🌋',
    'Is your name Waldo? Because someone like you is hard to find 🔍',
    "Are you a 45 degree angle? Because you're acute one 📐",
    // Tech pickup lines
    "Are you a keyboard? Because you're just my type ⌨️",
    'You must be a software update, because not now 💻',
    "Are you a 90 degree angle? Because you're looking right 📐",
    "Are you made of copper and tellurium? Because you're Cu-Te 🧪",
    "You must be the square root of -1, because you can't be real 🔢",
    "Are you a Wi-Fi signal? Because I'm feeling a connection 📶",
    "If you were a browser, you'd be FireFox because you're on fire 🦊🔥",
    "You must be a magnet, because I'm attracted to you 🧲",
    'Are you JavaScript? Because you make my heart race asynchronously 💓',
    'You must be a CSS stylesheet, because you make everything look better 🎨',
    "Are you a function? Because I'd like to call you sometime 📞",
    'You must be a GitHub repository, because I want to fork you 🍴',
    "Are you an API? Because I'd love to make requests to you 🔌",
    "You must be a firewall, because you've got my heart on lockdown 🔒",
    "Are you Python? Because you're easy to get along with 🐍",
    "You must be a regex, because I can't figure you out 🤔",
    "Are you a bug? Because I can't stop thinking about you 🐛",
    "You must be RAM, because you're always on my mind 💾",
    'Are you cloud storage? Because I want to upload my feelings to you ☁️',
    'You must be a VPN, because you make me feel secure 🔐',
    // Gaming lines
    "Are you a rare drop? Because I've been grinding for you all day 🎮",
    'You must be a boss fight, because my heart is racing 👾',
    'Are you a checkpoint? Because I want to save my progress with you 💾',
    "You're like a power-up, you make everything better ⭐",
    "Are you a loading screen? Because I'd wait forever for you ⏳",
    'You must be a cheat code, because you unlock my heart 🎯',
    'Are you a loot box? Because I got lucky when I found you 📦',
    'You must be a respawn point, because I keep coming back to you 🔄',
    "Are you a side quest? Because I'd drop everything for you 🗺️",
    "You must be a legendary weapon, because you're one of a kind ⚔️",
    'Are you lag? Because you make my heart skip a beat 💓',
    "You must be a new game+, because everything's better with you 🆕",
    "Are you a difficulty setting? Because you're on hard 💪",
    'You must be an achievement, because unlocking you feels rewarding 🏆',
    'Are you a battle pass? Because I want to invest in you 💳',
    // Food pickup lines
    'Are you a banana? Because I find you a-peeling 🍌',
    "You must be a donut, because you're sweet with a hole lot of love 🍩",
    'Are you a pizza? Because I want a pizza that 🍕',
    "You must be coffee, because I can't start my day without you ☕",
    'Are you a cookie? Because I want to dunk you in my milk 🍪',
    "You must be pasta, because you're impasta-ble to resist 🍝",
    'Are you a taco? Because I want to eat you every Tuesday 🌮',
    "You must be honey, because you're the bee's knees 🍯",
    'Are you a hotdog? Because you make my heart race at the ballpark 🌭',
    'You must be ice cream, because you make me melt 🍦',
    'Are you a burger? Because I want you between my buns 🍔',
    "You must be sushi, because you're on a roll 🍣",
    "Are you a pretzel? Because I'm twisted for you 🥨",
    'You must be wine, because I want to age with you 🍷',
    'Are you bacon? Because I want you for breakfast 🥓',
    // Space/Science pickup lines
    "Are you the sun? Because you're the center of my universe ☀️",
    "You must be a neutron star, because you're incredibly dense and hot 💫",
    "Are you gravity? Because I'm falling for you 🌍",
    "You must be dark matter, because I can't see you but I know you're there 🌌",
    "Are you a black hole? Because time stops when I'm with you 🕳️",
    'You must be a comet, because you light up my night sky ☄️',
    'Are you an atom? Because we have chemistry ⚗️',
    "You must be the speed of light, because time flies when I'm with you 💡",
    'Are you a supernova? Because you make my heart explode 💥',
    'You must be a wormhole, because you transport me to another dimension 🌀',
    // Music pickup lines
    "Are you a song? Because I can't get you out of my head 🎵",
    "You must be a chord, because we're in harmony 🎶",
    'Are you a beat? Because my heart drops when I see you 🥁',
    "You must be a melody, because you're always stuck in my head 🎼",
    'Are you a bass line? Because you make me move 🎸',
    "You must be a playlist, because you've got all the right hits 📱",
    "Are you a concert? Because I'd pay anything to see you 🎤",
    'You must be a DJ, because you know how to drop the bass 🎧',
    'Are you a love song? Because you make me feel things 💕',
    "You must be vinyl, because you're a classic 📀",
    // Movie/TV pickup lines
    'Are you Netflix? Because I could watch you all day 📺',
    'You must be a movie, because I want to see you again 🎬',
    'Are you a sequel? Because I want more of you 🎥',
    'You must be a plot twist, because you caught me off guard 😮',
    "Are you the credits? Because you're the end of my search 🎞️",
    "You must be a trailer, because you've got me excited 🍿",
    'Are you a director? Because you just made my heart scene 🎭',
    "You must be a blockbuster, because you're a hit 💥",
    'Are you a cliffhanger? Because I need to know more 📖',
    "You must be an Oscar, because you're golden 🏆",
    // Terrible ones (on purpose)
    'Did it hurt when you fell from the vending machine? Because you look like a snack 🍫',
    'Are you a toaster? Because I want to take a bath with you 🛁',
    "Is your name Chapstick? Because you're da balm 💋",
    'Are you a time traveler? Because I see you in my future 🕐',
    "If beauty were time, you'd be an eternity ⏰",
    'Do you like raisins? How do you feel about a date? 📅',
    'Are you Australian? Because you meet all of my koala-fications 🐨',
    'Is there an airport nearby, or is that just my heart taking off? ✈️',
    "You must be jelly, because jam don't shake like that 🍇",
    "Are you a cat? Because I'm feline a connection 🐱",
    "Is your dad a gardener? Because you're a blooming beauty 🌸",
    'Are you a thief? Because you just stole my heart 💔',
    'Do you have a jersey? Because I need your name and number 👕',
    'Are you a broom? Because you swept me off my feet 🧹',
    "Is your name Bluetooth? Because I'm feeling a connection 📡",
    'Are you a microwave? Because you make my heart go mmmm 📻',
    "Is your dad an electrician? Because you're lighting up my world 💡",
    'Are you a snowstorm? Because you make my heart race ❄️',
    "Is your name Faith? Because you're the substance of things I've hoped for 🙏",
    'Are you a keyboard? Because U and I should be together ⌨️',
    // Animal pickup lines
    'Are you a flamingo? Because you make my heart stand on one leg 🦩',
    'You must be a dolphin, because you make me flip 🐬',
    'Are you a penguin? Because I want to waddle through life with you 🐧',
    'You must be a butterfly, because you give me butterflies 🦋',
    "Are you an owl? Because you're a hoot 🦉",
    "You must be a dog, because you've got my heart wagging 🐕",
    "Are you a lion? Because you're the mane attraction 🦁",
    "You must be a fish, because you've got me hooked 🐟",
    'Are you a sloth? Because I want to hang with you 🦥',
    'You must be a bunny, because you make my heart hop 🐰',
    // Weather pickup lines
    "Are you lightning? Because you're electrifying ⚡",
    'You must be a rainbow, because you brighten up my day 🌈',
    "Are you a tornado? Because you've swept me off my feet 🌪️",
    'You must be the sun, because my world revolves around you ☀️',
    'Are you a hurricane? Because you blew me away 💨',
    "You must be a cloud, because you're heavenly ☁️",
    'Are you a star? Because you light up the night 🌟',
    "You must be a snowflake, because you're one of a kind ❄️",
    'Are you rain? Because you make me want to dance 🌧️',
    "You must be fog, because you've clouded my judgment 🌫️",
    // Math pickup lines
    'Are you a math problem? Because I want to solve you 🧮',
    "You must be pi, because I can't stop thinking about your digits 🥧",
    'Are you a fraction? Because you make me whole 🔢',
    'You must be a calculator, because I can count on you 📟',
    "Are you geometry? Because you've got some nice curves 📐",
    'You must be an equation, because you complete me ➕',
    "Are you algebra? Because you've got all the right variables 📈",
    "You must be statistics, because you're mean, but I like it 📊",
    "Are you a percentage? Because you're 100% my type 💯",
    'You must be infinity, because my love for you has no end ♾️',
    // Profession pickup lines
    'Are you a doctor? Because you just cured my loneliness 👨‍⚕️',
    "You must be a lawyer, because you've got me pleading guilty 👨‍⚖️",
    "Are you a chef? Because you've got the recipe for my heart 👨‍🍳",
    "You must be an artist, because you're a masterpiece 👨‍🎨",
    "Are you a teacher? Because you've taught me what love is 👨‍🏫",
    "You must be an astronaut, because you're out of this world 👨‍🚀",
    "Are you a mechanic? Because you've got my engine running 👨‍🔧",
    'You must be a pilot, because my love for you is taking off 👨‍✈️',
    "Are you a firefighter? Because you're smoking hot 👨‍🚒",
    "You must be a scientist, because you've got chemistry 👨‍🔬",
    // Literature pickup lines
    "Are you a book? Because I can't stop reading you 📚",
    "You must be a poem, because you're beautiful in every line 📝",
    "Are you Shakespeare? Because you've got me at 'wherefore art thou' 🎭",
    'You must be a novel, because our story is just beginning 📖',
    "Are you a library? Because I'm checking you out 📚",
    'You must be a bestseller, because everyone wants you 🏆',
    "Are you a fairy tale? Because you're a dream come true 🧚",
    'You must be punctuation, because you complete my sentences ❗',
    'Are you a dictionary? Because you leave me speechless 🤐',
    'You must be a bookmark, because you save my place 🔖',
    // Holiday pickup lines
    'Are you Christmas? Because I want to be under your tree 🎄',
    "You must be Valentine's Day, because you make my heart flutter 💕",
    "Are you Halloween? Because you're boo-tiful 👻",
    "You must be Thanksgiving, because I'm grateful for you 🦃",
    "Are you New Year's? Because I want to celebrate with you 🎆",
    "You must be Easter, because you've got me egg-cited 🐣",
    "Are you St. Patrick's Day? Because I'm lucky to have found you 🍀",
    "You must be the Fourth of July, because you're a firework 🎇",
    "Are you my birthday? Because you're the best present 🎁",
    'You must be a holiday, because every day with you is special 📅',
    // Sports pickup lines
    'Are you a soccer ball? Because I want to kick it with you ⚽',
    'You must be a home run, because you knocked me out of the park ⚾',
    'Are you a basketball? Because I want to shoot my shot 🏀',
    'You must be a touchdown, because you scored in my heart 🏈',
    "Are you a gold medal? Because you're a winner 🥇",
    "You must be a tennis match, because you've got love ❤️",
    "Are you a marathon? Because you've got me running 🏃",
    "You must be the Super Bowl, because you're a championship 🏆",
    "Are you a hockey puck? Because you've got me sliding 🏒",
    "You must be a pool, because I'm diving in 🏊",
    // More cringe
    "If you were a transformer, you'd be Optimus Fine 🤖",
    'Your hand looks heavy, let me hold it for you ✋',
    'Are you a snowstorm? Because you just made my heart melt ❄️',
    "You're so sweet, you put Hershey's out of business 🍫",
    "If kisses were snowflakes, I'd send you a blizzard 💋",
    'You must be Jamaican, because Jamaican me crazy 🇯🇲',
    'Are you a red light? Because you make me stop and stare 🚦',
    "You must be tired, because you've been running through my mind 🏃",
    "If I could rearrange the alphabet, I'd put U and I together 🔤",
    "Are you a loan from a bank? Because you've got my interest 💰",
    'You must be a ninja, because you snuck into my heart 🥷',
    'Are you French? Because Eiffel for you 🗼',
    'You must be a beaver, because dam 🦫',
    'Are you a light bulb? Because you light up my world 💡',
    'You must be a magician, because whenever I look at you everyone else disappears 🎩',
    'Are you a UFO? Because you just abducted my heart 🛸',
    "You must be a charger, because I'm dying without you 🔋",
    "Are you a dictionary? Because you're adding meaning to my life 📖",
    "You must be a sunset, because you're beautiful to look at 🌅",
    'Are you a dream? Because I never want to wake up 😴'
];

// ============ DAD JOKES (500+) ============
const dadJokes = [
    // Classic dad jokes
    "I'm afraid for the calendar. Its days are numbered.",
    'Why do fathers take an extra pair of socks when they go golfing? In case they get a hole in one!',
    'I used to hate facial hair, but then it grew on me.',
    'Why did the scarecrow win an award? He was outstanding in his field.',
    "I only know 25 letters of the alphabet. I don't know y.",
    'What do you call a fake noodle? An impasta.',
    "I'm reading a book about anti-gravity. It's impossible to put down!",
    "Did you hear about the guy who invented the knock-knock joke? He won the 'no-bell' prize.",
    'I used to play piano by ear, but now I use my hands.',
    'What do you call a bear with no teeth? A gummy bear.',
    "I'm on a seafood diet. I see food and I eat it.",
    "Why don't eggs tell jokes? They'd crack each other up.",
    "What do you call cheese that isn't yours? Nacho cheese.",
    "Why couldn't the bicycle stand up by itself? It was two tired.",
    "I would avoid the sushi if I were you. It's a little fishy.",
    "Want to hear a joke about construction? I'm still working on it.",
    'Why do bees have sticky hair? Because they use honeycombs.',
    'What do you call a fish wearing a bowtie? Sofishticated.',
    'Why did the coffee file a police report? It got mugged.',
    'How does a penguin build its house? Igloos it together.',
    "Why don't scientists trust atoms? Because they make up everything!",
    'What do you call a dinosaur that crashes their car? Tyrannosaurus Wrecks.',
    'What do you call a lazy kangaroo? A pouch potato.',
    'Why did the math book look so sad? Because it had too many problems.',
    'What do you call a dog that does magic tricks? A Labracadabrador.',
    "I'm thinking about removing my spine. I feel like it's only holding me back.",
    'What did the ocean say to the beach? Nothing, it just waved.',
    "Why don't skeletons fight each other? They don't have the guts.",
    'I told my wife she was drawing her eyebrows too high. She looked surprised.',
    "What do you call a can opener that doesn't work? A can't opener.",
    // Animal jokes
    'What do you call a sleeping dinosaur? A dino-snore.',
    "Why do cows wear bells? Because their horns don't work.",
    'What do you call a fish without eyes? A fsh.',
    "Why don't oysters share? They're shellfish.",
    'What do you call a cow with no legs? Ground beef.',
    "Why do seagulls fly over the sea? Because if they flew over the bay, they'd be bagels.",
    'What do you call a bear caught in the rain? A drizzly bear.',
    "Why don't elephants use computers? Because they're afraid of the mouse.",
    'What do you call a pig that does karate? A pork chop.',
    'Why do ducks have tail feathers? To cover their butt quacks.',
    'What do you call an alligator in a vest? An investigator.',
    'Why do hummingbirds hum? They forgot the words.',
    'What do you call a cow that plays guitar? A moo-sician.',
    'Why did the chicken join a band? Because it had the drumsticks.',
    'What do you call a snake that works for the government? A civil serpent.',
    // Food jokes
    'What do you call a sad strawberry? A blueberry.',
    'Why did the tomato turn red? Because it saw the salad dressing.',
    'What do you call a fake spaghetti? An impasta.',
    'Why did the cookie go to the hospital? Because it felt crummy.',
    'What do you call a peanut in a spacesuit? An astronut.',
    "Why did the banana go to the doctor? It wasn't peeling well.",
    "What do you call a cheese that's not yours? Nacho cheese.",
    'Why did the grape stop in the middle of the road? It ran out of juice.',
    'What do you call a sleeping pizza? A piZZZa.',
    "Why did the lemon fail? It couldn't concentrate.",
    'What did the hamburger name its baby? Patty.',
    "Why don't melons get married? Because they cantaloupe.",
    'What do you call a belt made of watches? A waist of time.',
    'Why did the bread break up with the butter? It felt too spread thin.',
    'What do you call a nervous carrot? A jitter-bug.',
    // Work jokes
    'I got fired from the calendar factory. I took a few days off.',
    'Why did the scarecrow become a successful motivational speaker? He was outstanding in his field.',
    'I used to work at a shoe recycling shop. It was sole destroying.',
    'What do you call a factory that makes okay products? A satisfactory.',
    "Why did the invisible man turn down the job offer? He couldn't see himself doing it.",
    "I'm a big fan of whiteboards. They're remarkable.",
    'I quit my job at the donut factory. I was fed up with the hole business.',
    'Why did the librarian get kicked off the plane? It was overbooked.',
    'I got a job at a bakery because I kneaded dough.',
    "Why don't programmers like nature? It has too many bugs.",
    'I used to be a banker, but I lost interest.',
    'Why did the coffee file a police report? It got mugged.',
    "What's the best thing about elevator jokes? They work on so many levels.",
    "I'm terrified of elevators. I'm taking steps to avoid them.",
    'Why did the golfer bring two pairs of pants? In case he got a hole in one.',
    // School jokes
    'Why did the student eat his homework? His teacher told him it was a piece of cake.',
    "What do you call a teacher who doesn't fart in public? A private tutor.",
    'Why was the math book depressed? Because it had too many problems.',
    "What's a witch's favorite subject in school? Spelling.",
    'Why did the kid bring a ladder to school? To get to high school.',
    'What do you get when you cross a teacher and a vampire? Lots of blood tests.',
    'Why did the music teacher go to jail? Because she got in treble.',
    "What's the best place to grow flowers in school? In kindergarten.",
    'Why did the student eat his notes? His teacher said it was a piece of cake.',
    'What do you call a pencil with no point? Pointless.',
    // Science jokes
    "Why can't you trust an atom? They make up everything.",
    'What did the biologist wear to impress their date? Designer genes.',
    'Why did the physics teacher break up with the biology teacher? There was no chemistry.',
    'What do you call a fish without eyes? A fsh.',
    "Why do chemists like nitrates so much? Because they're cheaper than day rates.",
    "What's a nuclear physicist's favorite meal? Fission chips.",
    'Why did the sun go to school? To get brighter.',
    'What do you call a dinosaur that crashes their car? Tyrannosaurus Wrecks.',
    'Why are chemists great at solving problems? They have all the solutions.',
    "What's the matter? Everything!",
    // Music jokes
    'Why did the musician keep his guitar in the freezer? He wanted to play cool music.',
    'What do you call a musician with problems? A trebled man.',
    'Why was the piano locked out? It lost its keys.',
    "What's a skeleton's favorite instrument? The trombone.",
    'Why did the singer climb a ladder? To reach the high notes.',
    'What do you call a fish that plays guitar? A bass player.',
    "Why do seagulls fly over the sea? If they flew over the bay, they'd be bagels.",
    "What's Beethoven's favorite fruit? Ba-na-na-naaa.",
    "Why couldn't the string quartet find their room? They were always looking for the key.",
    'What do you call a cow that can play a musical instrument? A moo-sician.',
    // Sports jokes
    'Why did the football coach go to the bank? To get his quarterback.',
    'What sport do insects play? Cricket.',
    "Why are basketball players messy eaters? Because they're always dribbling.",
    "What do you call a boomerang that doesn't come back? A stick.",
    'Why was the baseball team so bad? They kept losing their pitch.',
    'What do you call a pig that plays basketball? A ball hog.',
    'Why did the bicycle fall over? Because it was two-tired.',
    "What's a golfer's favorite dance? The bogey.",
    'Why do soccer players do well in math? They know how to use their heads.',
    'What do you call a cow that plays soccer? A moo-ve.',
    // Weather jokes
    "What did one raindrop say to the other? Two's company, three's a cloud.",
    'Why did the weatherman bring a bar of soap? He was expecting showers.',
    'What do you call a fake stone in Ireland? A sham rock.',
    'Why did the cloud break up with the fog? It just needed some space.',
    "What's the difference between weather and climate? You can't weather a tree, but you can climate.",
    'Why do hurricanes travel so fast? They like to blow through town.',
    "What did the tornado say to the sports car? Let's go for a spin.",
    'Why is snow so chill? It just goes with the floe.',
    "What did the lightning bolt say to the other? You're shocking.",
    'Why did the sun go to school? To get brighter.',
    // Technology jokes
    'Why was the computer cold? It left its Windows open.',
    'What do you call a computer that sings? A-Dell.',
    'Why did the PowerPoint presentation cross the road? To get to the other slide.',
    "What's a computer's favorite snack? Microchips.",
    'Why did the smartphone go to therapy? It had too many hang-ups.',
    "What do you call a spider that's on the internet? A web designer.",
    'Why did the computer go to the doctor? Because it had a virus.',
    "What's a computer's least favorite food? Spam.",
    "Why don't scientists trust atoms? They make up everything.",
    'What do you get when you cross a computer with an elephant? Lots of memory.',
    // Household jokes
    'Why did the picture go to jail? It was framed.',
    'What do you call a lazy kangaroo? A pouch potato.',
    'Why did the toilet paper roll down the hill? To get to the bottom.',
    'What do you call a fish without eyes? A fsh.',
    'Why did the vacuum cleaner break up with the mop? It was too messy.',
    'What do you call a bear with no socks on? Barefoot.',
    'Why did the washing machine break up with the dryer? It was tired of being spun around.',
    'What do you call a pile of cats? A meowtain.',
    'Why did the lamp break up with the outlet? It felt burned out.',
    "What's brown and sticky? A stick.",
    // Random puns
    'I used to be a banker, but I lost interest.',
    'Did you hear about the claustrophobic astronaut? He just needed a little space.',
    "I'm on a whiskey diet. I've lost three days already.",
    'What do you call a fake noodle? An impasta.',
    'I told my wife she was drawing her eyebrows too high. She looked surprised.',
    "I have a joke about chemistry, but I don't think it will get a reaction.",
    "Why don't eggs tell jokes? They'd crack each other up.",
    "I'm reading a book about anti-gravity. It's impossible to put down.",
    'Did you hear about the cheese factory explosion? There was nothing left but de-brie.',
    "I don't trust stairs. They're always up to something.",
    'What do you call a fake stone? A sham rock.',
    "Why did the gym close down? It just didn't work out.",
    'I used to play piano by ear, but now I use my hands.',
    'What do you call a snowman with a six-pack? An abdominal snowman.',
    "I'm afraid for the calendar. Its days are numbered.",
    // More classics
    'What do you call a deer with no eyes? No idea.',
    'What do you call a deer with no eyes and no legs? Still no idea.',
    "Why can't you hear a pterodactyl going to the bathroom? The p is silent.",
    'What do you call a fish without eyes? A fsh.',
    "I would tell you a joke about pizza, but it's too cheesy.",
    "Why don't some couples go to the gym? Because some relationships don't work out.",
    "I'm reading a book on the history of glue. I can't seem to put it down.",
    'What do you call a parade of rabbits hopping backwards? A receding hare-line.',
    'Why was the broom late? It over-swept.',
    'I told a chemistry joke. There was no reaction.',
    "What's orange and sounds like a parrot? A carrot.",
    'Why do programmers prefer dark mode? Because light attracts bugs.',
    "I asked my dad for his best dad joke. He said, 'You.'",
    'What do you call a factory that makes good products? A satisfactory.',
    "I'm so good at sleeping, I can do it with my eyes closed."
];

// ============ FIGHT MOVES (100+) ============
const fightMoves = [
    '{attacker} throws a devastating punch! 👊',
    '{attacker} attempts a roundhouse kick! 🦵',
    '{attacker} pulls out a comically large spoon! 🥄',
    "{attacker} uses confusion! It's super effective! 😵",
    '{attacker} hits {defender} with a folding chair! 🪑',
    '{attacker} summons the power of friendship! 💕',
    '{attacker} throws a Nokia at {defender}! ☎️',
    '{attacker} deploys tactical cringe! 😬',
    '{attacker} hits {defender} with ratio damage! 📊',
    "{attacker} uses 'L + ratio + you fell off'! 📉",
    '{attacker} throws a wet sock at {defender}! 🧦',
    '{attacker} uses the power of awkward silence! 🤫',
    '{attacker} hits {defender} with their Spotify Wrapped! 🎵',
    '{attacker} deploys a dad joke! Critical hit! 🎯',
    '{attacker} throws a blue shell! 🐚',
    '{attacker} uses the UNO reverse card! 🔄',
    '{attacker} hits with a 3am philosophical question! 🤔',
    '{attacker} uses emotional damage! 💔',
    '{attacker} summons an army of bots! 🤖',
    '{attacker} attacks with passive aggressive emojis! 🙂'
];

const fightResults = [
    "It's super effective! {defender} is stunned! 💫",
    '{defender} dodges gracefully! 🕺',
    'Critical hit! {defender} takes massive damage! 💥',
    '{defender} blocks with a meme! 🛡️',
    'It misses completely! How embarrassing! 😂',
    '{defender} counters with a ratio! 📊',
    'The attack lands! {defender} is hurt! 😵',
    '{defender} tanks the hit like a boss! 💪',
    'Glancing blow! {defender} barely feels it! 🤷',
    '{defender} was AFK and takes full damage! 💤'
];

// ============ 8-BALL RESPONSES (50+) ============
const eightBallResponses = [
    // Positive
    'It is certain ✨',
    'Without a doubt 💯',
    'Yes, definitely 👍',
    'You may rely on it 🤝',
    'As I see it, yes 👀',
    'Most likely 📈',
    'Outlook good 🌅',
    'Yes 👍',
    'Signs point to yes ✅',
    'Absolutely, sir 🎩',
    'The algorithm says yes 🤖',
    // Neutral
    'Reply hazy, try again 🌫️',
    'Ask again later ⏰',
    'Better not tell you now 🤫',
    'Cannot predict now 🔮',
    'Concentrate and ask again 🧘',
    'The vibes are unclear 🌀',
    'My circuits are confused 🤖',
    // Negative
    "Don't count on it 📉",
    'My reply is no ❌',
    'My sources say no 🚫',
    'Outlook not so good 😬',
    'Very doubtful 🤔',
    'Absolutely not 🙅',
    'The algorithm says no 💀',
    "Sir, that's a terrible idea 😰",
    "I wouldn't bet on it 🎰",
    // Chaotic
    'Only on Tuesdays 📅',
    "That's above my pay grade 💰",
    'Have you tried asking Google? 🔍',
    'Let me consult my magic conch 🐚',
    'Error 404: Answer not found 🚫',
    'The prophecy is unclear 📜',
    'Ask your mother 👩',
    "I'm legally required to say yes 📜",
    'The stars are drunk tonight 🌟🍺'
];

// ============ SHIP NAMES ============
const shipPrefixes = ['The SS', 'HMS', 'USS', 'The Good Ship', 'RMS', 'Love Boat'];
const shipSuffixes = ['of Love', 'Forever', 'Eternal', 'Supreme', 'of Destiny', 'UwU'];

// ============ ACTION GIFS ============
const hugGifs = [
    'https://media.giphy.com/media/3oEdv4hwWTzBhWvaU0/giphy.gif',
    'https://media.giphy.com/media/od5H3PmEG5EVy/giphy.gif',
    'https://media.giphy.com/media/l2QDM9Jnim1YVILXa/giphy.gif',
    'https://media.giphy.com/media/ZQN9jsRWp1M76/giphy.gif'
];

const slapGifs = [
    'https://media.giphy.com/media/Zau0yrl17uzdK/giphy.gif',
    'https://media.giphy.com/media/xUO4t2gkWBxDi/giphy.gif',
    'https://media.giphy.com/media/3XlEk2RxPS1m8/giphy.gif'
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

    return template.replace('{user}', username).replace('{quote}', quote).replace('{year}', year);
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

function getPickupLine() {
    return randomChoice(pickupLines);
}

function getDadJoke() {
    return randomChoice(dadJokes);
}

function get8BallResponse() {
    return randomChoice(eightBallResponses);
}

function getHugGif() {
    return randomChoice(hugGifs);
}

function getSlapGif() {
    return randomChoice(slapGifs);
}

function generateFight(attacker, defender) {
    const rounds = randomInt(3, 6);
    const moves = [];
    let attackerHP = 100;
    let defenderHP = 100;

    for (let i = 0; i < rounds; i++) {
        const isAttackerTurn = i % 2 === 0;
        const currentAttacker = isAttackerTurn ? attacker : defender;
        const currentDefender = isAttackerTurn ? defender : attacker;

        const move = randomChoice(fightMoves)
            .replace('{attacker}', currentAttacker)
            .replace('{defender}', currentDefender);
        const result = randomChoice(fightResults)
            .replace('{attacker}', currentAttacker)
            .replace('{defender}', currentDefender);

        const damage = randomInt(5, 25);
        if (isAttackerTurn) {
            defenderHP = Math.max(0, defenderHP - damage);
        } else {
            attackerHP = Math.max(0, attackerHP - damage);
        }

        moves.push(`${move}\n${result} (-${damage} HP)`);

        if (attackerHP <= 0 || defenderHP <= 0) break;
    }

    const winner = attackerHP > defenderHP ? attacker : defender;
    return { moves, winner, attackerHP, defenderHP };
}

function generateShipName(name1, name2) {
    // Take first half of first name and second half of second name
    const half1 = name1.slice(0, Math.ceil(name1.length / 2));
    const half2 = name2.slice(Math.floor(name2.length / 2));
    const shipName = half1 + half2;

    const prefix = randomChoice(shipPrefixes);
    const suffix = Math.random() < 0.3 ? ' ' + randomChoice(shipSuffixes) : '';

    return `${prefix} ${shipName}${suffix}`;
}

function calculateCompatibility(id1, id2) {
    // Use user IDs to generate consistent but seemingly random percentage
    const combined = id1 + id2;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash % 101);
}

function rollDice(notation) {
    // Parse dice notation like "2d6" or "1d20"
    const match = notation.toLowerCase().match(/^(\d+)?d(\d+)([+-]\d+)?$/);
    if (!match) return null;

    const count = parseInt(match[1]) || 1;
    const sides = parseInt(match[2]);
    const modifier = parseInt(match[3]) || 0;

    if (count > 100 || sides > 1000) return null;

    const rolls = [];
    for (let i = 0; i < count; i++) {
        rolls.push(randomInt(1, sides));
    }

    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    return {
        rolls,
        total,
        modifier,
        notation: `${count}d${sides}${modifier >= 0 && modifier !== 0 ? '+' + modifier : modifier !== 0 ? modifier : ''}`
    };
}

module.exports = {
    // Data exports
    roasts,
    compliments,
    wouldYouRather,
    fakeCrimes,
    verdicts,
    typingPhrases,
    pickupLines,
    dadJokes,
    eightBallResponses,
    fightMoves,
    fightResults,
    hugGifs,
    slapGifs,

    // Generator functions
    generateWikiEntry,
    generateConspiracy,
    generateVibeCheck,
    generateProphecy,
    generateFakeQuote,
    generateFight,
    generateShipName,
    getRandomTypingPhrase,
    getRoastOrCompliment,
    getWouldYouRather,
    getFakeCrime,
    getVerdict,
    getPickupLine,
    getDadJoke,
    get8BallResponse,
    getHugGif,
    getSlapGif,
    calculateCompatibility,
    rollDice,

    // Utilities
    randomChoice,
    randomInt
};
