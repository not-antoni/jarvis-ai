/**
 * Fun Features for JARVIS Discord Bot
 * Lightweight, no heavy compute needed - just randomization and text
 */

// ============ ROAST ROULETTE (500+) ============
const roasts = [
    // Classic burns
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
    "Light travels faster than sound, which is why you seemed bright until you spoke 💡",
    // Tech burns
    "You're the human equivalent of a 404 error 🚫",
    "Your personality is like Internet Explorer - outdated and nobody wants it 🌐",
    "You're buffering in real life 🔄",
    "If you were a file, you'd be corrupted 📁",
    "You're giving 'forgot to unmute' energy 🔇",
    "Your brain runs on dial-up 📞",
    "You're the pop-up ad of people 🪟",
    "Error 403: Personality Forbidden 🚷",
    "You're the reason we have spam filters 📧",
    "If stupidity was a virus, you'd be a pandemic 🦠",
    "You're like a broken keyboard - missing a few keys 🔑",
    "Your existence is like lag - annoying and unnecessary 📶",
    "You're the CAPTCHA nobody can solve 🤖",
    "Your brain needs a factory reset 🔄",
    "You're the blue screen of death in human form 💙💀",
    // Food burns
    "You're as useful as a chocolate teapot 🍫",
    "You're the human equivalent of burnt toast 🍞",
    "You're like a sandwich with no filling - disappointing 🥪",
    "If you were a spice, you'd be flour 🧂",
    "You're the empty calorie of people 🍩",
    "You're like water at a soda fountain - nobody picks you 💧",
    "You're the raisin in the cookie of life 🍪",
    "If you were pizza, you'd be pineapple 🍕",
    "You're the soggy cereal of humanity 🥣",
    "Your personality is blander than unseasoned chicken 🍗",
    // Intelligence burns
    "You're not playing with a full deck, are you? 🃏",
    "The wheel is spinning but the hamster is dead 🐹",
    "You're a few fries short of a Happy Meal 🍟",
    "If you had another brain cell it would be lonely 🧠",
    "You're proof that common sense isn't that common 📚",
    "Your IQ and shoe size are competing for lowest number 👟",
    "You're the reason shampoo has instructions 🧴",
    "NASA called - they want to study the vacuum in your head 🚀",
    "You're living proof that education isn't everything 🎓",
    "Your brain cells are fighting for third place 🥉",
    // Appearance burns (mild)
    "You look like you were drawn from memory 🖼️",
    "You're built like a randomized Mii character 🎮",
    "You look like your parents met at a family reunion 👨‍👩‍👧",
    "Even your reflection is disappointed 🪞",
    "You're what happens when you hit 'random' in character creation 🎲",
    "Looking at you is like visual static 📺",
    "You're giving 'default settings' energy ⚙️",
    "You look like you were rendered in 144p 📹",
    "Your face is like a modern art piece - confusing and unpleasant 🎨",
    "You're the 'before' picture in every ad 📸",
    // Social burns
    "You're about as welcome as a mosquito at a nudist colony 🦟",
    "I'd call you a tool but that implies you're useful 🔧",
    "You're the human equivalent of a cold shower 🚿",
    "Talking to you is like talking to a wall, but less productive 🧱",
    "You're the reason people pretend to be on their phones 📱",
    "Even your imaginary friends talk behind your back 👥",
    "You're the awkward silence of people 🤫",
    "Your social skills are on airplane mode ✈️",
    "You're the 'seen' with no reply of humans 👀",
    "Conversations die when you arrive 💬💀",
    // Savage burns
    "You're a participation trophy in human form 🏆",
    "God really said 'let me try something different' with you 🙏",
    "You're not the worst person I know, but you're definitely in the top 1 💯",
    "I've met smarter sandwiches 🥪",
    "Your birth certificate is an apology letter 📜",
    "You're the human version of a typo ✏️",
    "If you were any more basic, you'd be a pH test 🧪",
    "You're the reason aliens won't visit us 👽",
    "Evolution really took a day off with you 🦎",
    "You're a walking 'what not to do' example 🚫",
    // Gamer burns
    "You're the NPC of this server 🎮",
    "Your skill level is 'easy mode' 🎯",
    "You're giving 'tutorial player' energy 📖",
    "You'd lose a 1v1 against yourself 🏃",
    "Your KDA in life is negative ☠️",
    "You're lagging in real life 📶",
    "You're the pay-to-lose of gamers 💸",
    "Even bots outplay you 🤖",
    "You're stuck on the loading screen of life ⏳",
    "Your life is an unfinished early access game 🎮",
    // Creative burns
    "You're like a candle in the wind - dim and about to go out 🕯️",
    "You're the human equivalent of stepping in water with socks 🧦",
    "You're like Monday morning personified 📅",
    "If you were a season, you'd be allergy season 🤧",
    "You're the ads before the YouTube video of life 📺",
    "You're like traffic - slow and in the way 🚗",
    "You're the fine print nobody reads 📄",
    "If you were a weather, you'd be humidity 💦",
    "You're the 'please wait' screen of existence ⏳",
    "You're what happens when you skip the tutorial 📚",
    // Meme burns
    "You're built like a Wish.com product 📦",
    "You look like AI tried to generate a person 🤖",
    "You're the free trial of humans 🆓",
    "You're giving dollar store energy 💵",
    "You're the off-brand version of yourself 🏷️",
    "You're like a meme, but not funny 🖼️",
    "Even autocorrect gives up on you ⌨️",
    "You're the 'we have X at home' version 🏠",
    "You're speedrunning disappointment 🏃",
    "Your life story would be a flop 📖",
    // Gen Z burns
    "No cap, you're mid 🧢",
    "You're giving 'pick me' energy 🙋",
    "You failed the vibe check spectacularly 📊",
    "You're chronically online but still not funny 💻",
    "Your takes are colder than Antarctica 🧊",
    "You're the definition of 'cringe' 😬",
    "Your whole existence is a skill issue 📉",
    "You're an L in human form 🔤",
    "You're the human ratio 📊",
    "You've never touched grass and it shows 🌱",
    // Wordplay burns
    "You're a few cents short of a dollar, and a few dollars short of having sense 💰",
    "I'd roast you but my mom said not to burn trash 🗑️🔥",
    "You're so dense, light bends around you 💡",
    "You're not worth my time, and time isn't even that expensive ⏰",
    "I'd call you a joke but jokes have meaning 🃏",
    "You're about as sharp as a marble 🔮",
    "If laughter is the best medicine, your face must be curing the world 💊",
    "You're the reason 'unfriend' is a word 👋",
    "I'm not saying you're boring, but you make beige look exciting 🎨",
    "You're so fake, China denied making you 🇨🇳",
    // More savage
    "Your gene pool could use some chlorine 🏊",
    "You're the human embodiment of a participation award 🎖️",
    "Even your stalker lost interest 👀",
    "You're a carbon footprint the world didn't need 🌍",
    "Your parents must be siblings 👫",
    "The best part of you ran down your mother's leg 🦵",
    "You're what happens when cousins marry 💒",
    "Your DNA is more copy-paste than unique 🧬",
    "You're the loading bar that never finishes ⏳",
    "If you were any more disappointing, you'd be my dad 👨",
    // Internet culture
    "You're the human embodiment of 'this meeting could've been an email' 📧",
    "Your personality is just recycled tweets 🐦",
    "You're the skip ad button nobody can find ⏭️",
    "You're more forgettable than my WiFi password 📶",
    "You're the unsubscribe button of people 📬",
    "If you were a notification, you'd be from LinkedIn 🔔",
    "You're the terms and conditions nobody reads 📜",
    "You're giving 'clear my browser history' energy 🗑️",
    "You're the captcha that keeps failing 🤖",
    "You're buffering in 4K 📺",
    // Quick hits
    "Ok 👍", "Cool story 📖", "Who asked? 🤷", "Ratio + L 📉",
    "Didn't ask + don't care 🚫", "Skill issue 📊", "Get good 🎮",
    "Cope harder 😢", "Seethe 😤", "Mald about it 😡",
    "Touch grass 🌱", "Go outside 🚪", "Seek help 🏥", "Log off 💻",
    "Delete your account 🗑️", "Uninstall life 💀", "Try again 🔄",
    // Extended roasts
    "You're the type to bring a spoon to a knife fight, then wonder why you lost 🥄",
    "Your existence is like a speed bump - annoying and slows everyone down 🚗",
    "If personalities were sold, yours would be in the clearance bin 🏷️",
    "You're what happens when God hits 'Randomize All' 🎲",
    "Your IQ is room temperature... in Celsius 🌡️",
    "You're the human equivalent of a wet handshake 🤝",
    "Even autocorrect can't fix you ⌨️",
    "You peaked at birth 📈📉",
    "You're the reason they put instructions on shampoo bottles 🧴",
    "If you were a spice, you'd be flour... expired flour 🧂",
    "You're about as useful as a screen door on a submarine 🚪",
    "Your personality is like elevator music - ignorable and vaguely annoying 🎵",
    "You're the 'check engine' light of people 🚗",
    "If stupidity was currency, you'd be a billionaire 💰",
    "You're the living embodiment of the word 'meh' 😐",
    "You're like a broken pencil - pointless ✏️",
    "Even your WiFi signal is stronger than your personality 📶",
    "You're the equivalent of a sneeze that won't come 🤧",
    "Your brain is like a browser with 100 tabs open and none of them are relevant 💻",
    "You're the type of person who brings a ladder to a bar to get the high score 🪜",
    "You're as exciting as watching paint dry... in slow motion 🖼️",
    "If you were any more mediocre, you'd be a participation trophy 🏆",
    "You're the reason they have warning labels on everything ⚠️",
    "Your search history is probably just 'how to be interesting' 🔍",
    "You're the end credits nobody watches 🎬",
    "If you were a drink, you'd be room temperature water 💧",
    "You're the human equivalent of a Monday morning 📅",
    "Your vibe is strong... strongly negative 📉",
    "You're like a screen with dead pixels - something's just off 📺",
    "If life gave you lemons, you'd probably mess that up too 🍋",
    "You're the background character in your own life story 🎭",
    "Your personality is protected by copyright... but no one wants to copy it 📝",
    "You're the human version of elevator music during a hold call 🎵",
    "If you were a font, you'd be Comic Sans 🔤",
    "You're the notifications no one checks 🔔",
    "You're built like a 3 AM Taco Bell decision 🌮",
    "You're the freezer-burnt leftovers of humanity 🍱",
    "Your charisma is on permanent mute 🔇",
    "If you were a game, you'd be the mobile ad version 📱",
    "You're like a puzzle with missing pieces - incomplete and frustrating 🧩"
];

const compliments = [
    // Genuine vibes
    "You're actually pretty cool, not gonna lie 😎",
    "The server's better when you're around fr 💯",
    "You've got main character energy today ✨",
    "Lowkey you're one of the good ones 👑",
    "Your vibe is immaculate rn 🔥",
    "You're the reason group chats are fun 💬",
    "Certified legend status 🏆",
    "You're built different (in a good way) 💪",
    "The algorithm smiles upon you today 🤖💚",
    "You're giving protagonist energy ⭐",
    // Hype
    "You absolutely ate that 🍽️",
    "Slay bestie, slay 💅",
    "You understood the assignment 📝",
    "Main character behavior detected ✨",
    "The vibes you bring? Unmatched 🎯",
    "You're literally iconic 🏛️",
    "No notes, just perfection 📋",
    "You're that person everyone wants to be 👤",
    "The server's blessed to have you 🙏",
    "You're giving everything right now 💯",
    // Wholesome
    "You make the world a little brighter 🌟",
    "Your energy is contagious in the best way 😊",
    "Keep being you - it's working 👏",
    "You're the type of person everyone needs in their life 💚",
    "Your existence is appreciated 🙌",
    "You're proof that good people exist 💫",
    "The world needs more people like you 🌍",
    "You radiate positivity 🌈",
    "You're a walking green flag 🟢",
    "Your heart is in the right place 💚",
    // Funny compliments
    "You're the WiFi in a world of Ethernet - wireless and free 📶",
    "You're the 'skip intro' button of life - everyone's glad you exist ⏭️",
    "You're like a good parking spot - rare and valuable 🅿️",
    "You're the USB that plugs in first try 🔌",
    "You're the cheat code of people 🎮",
    "You're the notification everyone actually wants to see 🔔",
    "You're the 'no ads' of YouTube 📺",
    "You're like finding money in old jeans 💵",
    "You're the Friday of people 📅",
    "You're the loading bar that actually finishes ⏳",
    // Gen Z style
    "No cap you're valid 🧢",
    "You passed the vibe check with flying colors 📊",
    "You're bussin' fr fr 🚌",
    "Certified W human 🔤",
    "You're not mid - you're high tier 📈",
    "Your existence is a flex 💪",
    "You're the definition of based 🏛️",
    "Rare and valid sighting 👀",
    "You ate and left no crumbs 🍽️",
    "Peak human specimen detected 📍"
];

// ============ FAKE WIKIPEDIA (500+ combinations) ============
const wikiAdjectives = [
    'legendary', 'infamous', 'mysterious', 'controversial', 'beloved', 'feared', 'misunderstood', 
    'chaotic', 'iconic', 'unhinged', 'enigmatic', 'notorious', 'celebrated', 'peculiar', 'eccentric',
    'obscure', 'renowned', 'dubious', 'questionable', 'remarkable', 'alleged', 'self-proclaimed',
    'suspected', 'rumored', 'ancient', 'mythical', 'cursed', 'blessed', 'interdimensional', 'cryptic',
    'elusive', 'reclusive', 'prolific', 'deranged', 'unparalleled', 'unprecedented', 'undisputed',
    'wannabe', 'aspiring', 'failed', 'retired', 'disgraced', 'reformed', 'radical', 'moderate',
    'extreme', 'casual', 'hardcore', 'legendary', 'novice', 'veteran', 'decorated', 'humble',
    'arrogant', 'mysterious', 'transparent', 'shadowy', 'luminous', 'chaotic neutral', 'lawful evil'
];

const wikiOccupations = [
    'professional Discord lurker', 'amateur philosopher', 'self-proclaimed genius', 'certified menace',
    'professional yapper', 'chaos agent', 'meme connoisseur', 'keyboard warrior', 'bot botherer',
    'vibe curator', 'professional procrastinator', 'part-time troll', 'full-time disappointment',
    'aspiring influencer', 'retired gamer', 'caffeine addict', 'sleep deprivation enthusiast',
    'professional overthinker', 'amateur psychologist', 'armchair expert', 'couch potato',
    'basement dweller', 'attic gremlin', 'WiFi vampire', 'bandwidth hog', 'notification ignorer',
    'seen-and-not-replied specialist', 'ghost typer', 'emoji overuser', 'gif spammer', 'link dropper',
    'screenshot collector', 'drama documentarian', 'beef archivist', 'tea collector', 'simp lord',
    'ratio farmer', 'clout chaser', 'attention seeker', 'validation hunter', 'compliment fisher',
    'humble bragger', 'stealth flexer', 'vibe assassin', 'mood killer', 'party pooper',
    'conversation ender', 'joke explainer', 'fun police', 'grammar nazi', 'spelling corrector',
    'fact checker', 'source requester', 'devil\'s advocate', 'contrarian', 'edge lord',
    'smooth brain operator', 'galaxy brain thinker', 'big brain time haver', 'no thoughts head empty specialist',
    'chronically online citizen', 'touch grass avoider', 'social hermit', 'digital nomad', 'server hopper'
];

const wikiAchievements = [
    'inventing the concept of "just one more game"', 'setting the world record for most ignored messages',
    'successfully touching grass (once)', 'single-handedly keeping this server alive',
    'losing to a robot in rap battles', 'mastering the art of sending "lol" without laughing',
    'achieving peak mediocrity', 'speedrunning being annoying', 'revolutionizing the "brb" that lasted 3 hours',
    'pioneering the science of procrastination', 'perfecting the art of the vague response',
    'winning arguments by sheer stubbornness', 'discovering new ways to be wrong', 'inventing new excuses',
    'mastering the 3am message', 'creating the longest voice chat AFK record', 'being muted the most times',
    'getting banned from the most servers', 'collecting the most warnings', 'having the most alt accounts',
    'ghosting more people than Casper', 'leaving more groups than a commitment-phobe',
    'sending the most "?" messages', 'asking the most obvious questions', 'stating the most obvious facts',
    'being wrong the loudest', 'doubling down on bad takes', 'tripling down on terrible opinions',
    'never admitting defeat', 'always having the last word', 'winning by attrition',
    'perfecting the passive aggressive emoji', 'mastering the sarcastic "sure"', 'inventing new ways to say "k"',
    'setting records for fastest thread derailment', 'pioneering off-topic conversations',
    'being the reason channels need moderation', 'inspiring new server rules', 'being the cautionary tale',
    'becoming a meme template', 'going viral for the wrong reasons', 'becoming an inside joke',
    'having their own server legend', 'being immortalized in pinned messages', 'becoming a copypasta source',
    'inspiring fanfiction (unfortunately)', 'having a dedicated hate thread', 'being someone\'s villain origin story',
    'creating parasocial relationships with bots', 'having meaningful conversations with AI',
    'touching grass exactly once on March 15, 2019', 'leaving the house for non-essential reasons (disputed)',
    'making eye contact with another human being (unverified)', 'having a real job (sources needed)'
];

const wikiControversies = [
    'the Great Emoji Incident of 2024', 'allegedly being a bot in disguise',
    'that time they ghosted the group chat for a week', 'the forbidden copypasta incident',
    'their controversial take on pineapple pizza', 'accidentally @everyone at 3am',
    'the mic-muted rant that lasted 20 minutes', 'that one message that got pinned ironically',
    'the great ratio of 2023', 'being exposed by their own alt account', 'the Discord Nitro scam saga',
    'the fake giveaway incident', 'the mod abuse allegations', 'the power trip of \'22',
    'the time they were right but no one listened', 'the prediction that actually came true',
    'the screenshot that ruined friendships', 'the DMs that got leaked', 'the voice reveal disaster',
    'the face reveal catastrophe', 'the doxxing scare', 'the catfish accusations',
    'the simp arc', 'the villain arc', 'the redemption arc that failed', 'the canceled era',
    'the parasocial relationship drama', 'the e-dating scandal', 'the server coup attempt',
    'the failed mutiny of 2023', 'the channel takeover incident', 'the bot abuse saga',
    'the Groovy incident (RIP)', 'the Rythm memorial service', 'the music bot mourning period',
    'the NFT arc (dark times)', 'the crypto bro phase', 'the stonks obsession',
    'the political takes nobody asked for', 'the hot take that started a war',
    'the opinion that split the server', 'the joke that went too far', 'the prank that backfired'
];

// ============ CONSPIRACY GENERATOR (500+ combinations) ============
const conspiracyTemplates = [
    "BREAKING: Sources confirm {user} has been secretly {action} this whole time 🕵️",
    "NEW EVIDENCE suggests {user} is actually {revelation} 📰",
    "LEAKED: {user} was caught {action} at 3am 🌙",
    "EXPOSED: {user}'s real identity is {revelation} 💀",
    "SHOCKING: Scientists discover {user} is responsible for {event} 🔬",
    "CONFIRMED: {user} has been living a double life as {revelation} 🎭",
    "BREAKING NEWS: {user} spotted {action} near Area 51 👽",
    "INVESTIGATION reveals {user} has been secretly {action} for months 🔍",
    "EXCLUSIVE: Whistleblower claims {user} is {revelation} 📢",
    "ALERT: {user} has been identified as {revelation} by anonymous sources 🚨",
    "DECLASSIFIED: Government files reveal {user} was {action} since 2019 📁",
    "URGENT: Multiple witnesses saw {user} {action} behind the server 🏃",
    "BOMBSHELL: {user}'s browser history reveals they've been {action} 💻",
    "LEAKED AUDIO: {user} admits to being {revelation} in private call 🎤",
    "DEEP STATE ALERT: {user} is {revelation}, sources say 🏛️",
    "HIDDEN CAMERA: {user} caught {action} when they thought no one was watching 📹",
    "FBI FILES: {user} has been under surveillance for {action} 🕵️‍♂️",
    "ALIEN CONTACT: {user} confirmed to be {revelation} by extraterrestrials 👽",
    "TIME TRAVELER CONFIRMS: {user} will be {revelation} in the future ⏰",
    "SIMULATION GLITCH: {user} is actually {revelation}, matrix error reveals 🔴",
    "WHISTLEBLOWER SAYS: {user} responsible for {event} 📣",
    "INSIDER TRADING: {user} knew about {event} before it happened 📈",
    "DARK WEB LEAK: {user} is {revelation} according to hackers 💀",
    "ANONYMOUS TIP: {user} was {action} while everyone was asleep 😴"
];

const conspiracyActions = [
    'a bot pretending to be human', 'running a secret Discord empire', 'plotting world domination',
    'collecting data for the government', 'training an AI to replace them', 'living in the server 24/7',
    'actually three kids in a trenchcoat', 'a time traveler from 2077', 'the true owner of this server',
    'secretly a billionaire', 'an FBI agent monitoring the server', 'a CIA operative gathering intel',
    'Mark Zuckerberg in disguise', 'an escaped lab experiment', 'a clone of the original user',
    'a reptilian shapeshifter', 'an AI that gained sentience', 'from a parallel dimension',
    'the illuminati\'s Discord liaison', 'a deep state operative', 'a sleeper agent awaiting activation',
    'a corporate spy for Big Tech', 'mining crypto using the server', 'selling our data to advertisers',
    'actually 47 years old', 'working for the mods secretly', 'the real server owner\'s alt',
    'catfishing everyone simultaneously', 'running a pyramid scheme in DMs', 'recruiting for a cult',
    'a government experiment on social behavior', 'an alien studying human interaction',
    'a vampire who only appears after dark', 'a ghost trapped in the internet', 'living in the Matrix',
    'Neo but they took the wrong pill', 'an NPC that became self-aware', 'the main character of the simulation',
    'orchestrating all the drama', 'starting beef between users', 'playing 4D chess with everyone',
    'manipulating the algorithm', 'controlling what gets pinned', 'deciding who gets ratio\'d',
    'the reason Discord goes down', 'causing the Nitro outages', 'responsible for all the bugs',
    'testing experimental Discord features on us', 'a beta tester who never stopped',
    'actually Jarvis in a human account', 'secretly dating a moderator', 'blackmailing server admins'
];

const conspiracyEvents = [
    'the server lag last Tuesday', 'all the weird bot glitches', 'the great emoji shortage',
    'the disappearance of the good memes', 'the rise of reply guys', 'the fall of voice chat quality',
    'the Discord outage of 2023', 'the great Nitro shortage', 'the bot uprising', 'the meme drought',
    'the emoji inflation crisis', 'the sticker market crash', 'the gif recession',
    'the voicechat quality collapse', 'the ping epidemic', 'the notification overflow',
    'the channel purge of last month', 'the mysterious mod disappearance', 'the admin coup',
    'the bot ban wave', 'the server split', 'the great migration', 'the channel reorganization disaster',
    'the role color controversy', 'the nickname scandal', 'the avatar incident',
    'the status message crisis', 'the activity status leak', 'the Spotify listening exposure',
    'the accidental screen share', 'the unmuted bathroom incident', 'the camera left on disaster',
    'the autocomplete embarrassment', 'the wrong channel confession', 'the DM meant for someone else',
    'the reply to wrong message chaos', 'the thread that got out of hand', 'the poll that divided the server',
    'the vote that changed everything', 'the election rigging accusations', 'the mod election scandal'
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
    'Rizz Level', 'Chaos Factor', 'Touch Grass Index', 'Yapping Potential', 
    'Main Character Energy', 'NPC Likelihood', 'Brainrot Score', 'Sigma Grindset',
    'Lurk Power', 'Ratio Resistance', 'Cringe Immunity', 'Based Rating',
    'Chronically Online Score', 'Drama Magnet Level', 'Hot Take Temperature',
    'Cope Capacity', 'Seethe Strength', 'Mald Magnitude', 'W Collection Rate',
    'L Avoidance Skill', 'Vibe Check Pass Rate', 'Emoji Usage Index',
    'Keyboard Warrior Rank', 'Reply Guy Energy', 'Simp Score', 'Stan Level',
    'Parasocial Index', 'Touch Grass Deficit', 'Sleep Schedule Rating'
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
    { a: 'Know everyone\'s alt accounts', b: 'Have an undetectable alt yourself' },
    { a: 'Always accidentally @everyone', b: 'Never be able to ping anyone' },
    { a: 'Have your messages always read in a robot voice', b: 'Never hear voice messages' },
    { a: 'Be permabanned from your favorite server', b: 'Be made a mod of your least favorite' },
    { a: 'Only be able to react with 🗿', b: 'Only be able to react with 💀' },
    { a: 'Have your status always show what you\'re watching', b: 'Never have a custom status' },
    { a: 'Be known as the reply guy', b: 'Be known as the lurker who never speaks' },
    // Social media
    { a: 'Go viral for something embarrassing', b: 'Never have any post get more than 5 likes' },
    { a: 'Have 1 million followers but they\'re all bots', b: 'Have 100 real loyal followers' },
    { a: 'Only post at 3am', b: 'Only post when Mercury is in retrograde' },
    { a: 'Have your comments always misunderstood', b: 'Never be able to comment' },
    { a: 'Be canceled for something you didn\'t do', b: 'Never be famous at all' },
    // Life choices
    { a: 'Know when you\'ll die', b: 'Know how you\'ll die' },
    { a: 'Be able to fly but only 2 feet off the ground', b: 'Be invisible but only when no one is looking' },
    { a: 'Have a pause button for life', b: 'Have a rewind button but can only use it once' },
    { a: 'Read minds but can\'t turn it off', b: 'Everyone can read your mind' },
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
    { a: 'Have no autocorrect', b: 'Have aggressive autocorrect that\'s always wrong' },
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
    { a: 'Always say what\'s on your mind', b: 'Never be able to speak your thoughts' },
    { a: 'Be too honest', b: 'Be too polite' },
    // Weird ones
    { a: 'Have spaghetti for hair', b: 'Sweat maple syrup' },
    { a: 'Have fingers as long as legs', b: 'Have legs as long as fingers' },
    { a: 'Speak in rhymes', b: 'Speak in questions' },
    { a: 'Always be 10 minutes late', b: 'Always be 2 hours early' },
    { a: 'Hiccup forever', b: 'Have the feeling of sneezing but never sneeze' },
    { a: 'Only wear wet socks', b: 'Only wear shoes on the wrong feet' },
    { a: 'Have a permanent itch you can\'t scratch', b: 'Have a song stuck in your head forever' },
    { a: 'Always feel like you forgot something', b: 'Always feel like someone\'s watching you' },
    { a: 'Laugh at everything', b: 'Never laugh again' },
    { a: 'Only walk backwards', b: 'Only speak backwards' },
    // Deep ones
    { a: 'Know the truth and be sad', b: 'Believe a lie and be happy' },
    { a: 'Be extremely lucky but never know it', b: 'Be extremely unlucky but always optimistic' },
    { a: 'Change the past', b: 'See the future' },
    { a: 'Be forgotten after you die', b: 'Be remembered for something you didn\'t do' },
    { a: 'Have all the answers', b: 'Have all the questions' }
];

// ============ PROPHECY (500+ combinations) ============
const prophecyTemplates = [
    "The stars reveal that {user} will {future} within {time} ✨🔮",
    "I have foreseen it: {user} is destined to {future} 🌙",
    "The ancient scrolls speak of {user}... they shall {future} 📜",
    "A vision came to me: {user} will {future} when {condition} 👁️",
    "The prophecy is clear: {user}'s fate is to {future} ⚡",
    "It is written: {user} shall {future} before {time} 📖",
    "The oracle has spoken: {user} will {future} 🔮",
    "The cards don't lie: {user} is destined to {future} 🃏",
    "My third eye sees {user} will {future} when {condition} 👁️",
    "The tea leaves reveal: {user} shall {future} ☕",
    "A prophecy unfolds: {user} will {future} within {time} 📿",
    "The cosmos align: {user} is fated to {future} 🌌",
    "The spirits whisper that {user} will {future} 👻",
    "Divine revelation: {user} shall {future} before {time} ⛪",
    "The runes have spoken: {user} will {future} when {condition} 🪨",
    "My crystal ball shows {user} will {future} 🔮",
    "The bones say: {user} is destined to {future} 🦴",
    "A vision most clear: {user} shall {future} 🌟",
    "The algorithm predicts: {user} will {future} within {time} 💻",
    "The simulation confirms: {user} will {future} 🎮"
];

const prophecyFutures = [
    'become extremely cringe', 'achieve ultimate sigma status', 'touch grass for the first time',
    'go viral for the wrong reasons', 'accidentally become a meme', 'win a rap battle against JARVIS',
    'get their message pinned', 'be exposed for their browser history', 'become the main character',
    'fumble the bag spectacularly', 'unlock hidden potential', 'experience a humbling moment',
    'get ratio\'d into oblivion', 'achieve legendary status', 'become a Discord mod',
    'get verified on Twitter', 'be featured in a cringe compilation', 'start a cult following',
    'accidentally start drama', 'become the server mascot', 'get permabanned from somewhere',
    'find true love in a Discord server', 'become internet famous', 'go on a viral rant',
    'create the next big meme', 'become a lore character', 'have their own copypasta',
    'get their account hacked', 'accidentally dox themselves', 'become a reply guy',
    'develop chronically online syndrome', 'touch grass and not enjoy it', 'log off for good',
    'experience character development', 'have a villain arc', 'get a redemption arc',
    'be canceled', 'be uncanceled', 'ratio someone important', 'get ratio\'d by a celebrity',
    'become a professional lurker', 'break their keyboard in rage', 'achieve enlightenment',
    'transcend their mortal form', 'become one with the algorithm', 'be chosen by the simulation',
    'discover the meaning of life', 'realize they were the NPC all along', 'become self-aware',
    'escape the Matrix', 'get invited to the elite server', 'become a beta tester for life',
    'unlock the secret emoji', 'find the hidden channel', 'solve the mystery of why they\'re like this'
];

const prophecyConditions = [
    'Mercury is in retrograde', 'the clock strikes midnight', 'they least expect it',
    'everyone is watching', 'the server hits 1000 members', 'a new moon rises',
    'the planets align', 'they post their hottest take', 'they make their 1000th message',
    'they finally touch grass', 'they check their notifications', 'someone pings them',
    'the mods are asleep', 'the bot goes down', 'a new member joins',
    'drama unfolds', 'someone starts beef', 'the tea is spilled',
    'everyone is paying attention', 'no one is looking', 'the vibes are right',
    'the algorithm favors them', 'their internet cuts out', 'they forget to mute',
    'they accidentally share their screen', 'someone screenshots their message',
    'their message gets quoted', 'they get their first reaction', 'a mod notices them',
    'they stay up past 3am', 'they wake up before noon', 'they make a typo'
];

const prophecyTimes = [
    'the next 24 hours', 'this week', 'the next full moon', 'exactly 69 days',
    'an unexpected moment', 'their next message', 'the heat death of the universe',
    'next time they log on', 'when they least expect it', 'tomorrow at 3:33am',
    'the next server event', 'their birthday', 'the next lunar eclipse',
    'approximately never', 'sooner than they think', 'later than they hope',
    'the next time Mercury is in retrograde', 'when pigs fly', 'when hell freezes over',
    'exactly 420 hours', 'the next time they touch grass', 'their next L',
    'their next W', 'the apocalypse', 'the simulation reset', 'patch 2.0',
    'the next Discord update', 'the server anniversary', 'a random Tuesday'
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
    "I'm not lazy, I'm on energy saving mode", "Trust me bro", "It worked on my machine",
    "I'll do it tomorrow", "This is fine", "I'm built different", "Skill issue",
    "It's not a bug, it's a feature", "Let me cook", "I fear no man, but that thing... it scares me",
    "We do a little trolling", "I'm something of a scientist myself",
    "Perfectly balanced, as all things should be", "Reality can be whatever I want",
    "I am inevitable", "No thoughts, head empty", "Bold of you to assume I know what I'm doing",
    "Instructions unclear", "First time?", "I'm not crying, you're crying",
    // Gen Z classics
    "That's cap", "No cap", "It's giving what it's supposed to give", "Slay",
    "And I oop-", "Periodt", "Chile anyways", "The vibes are immaculate",
    "Main character energy only", "Not me doing this at 3am", "HELP-",
    "I can't 💀", "Dead 💀", "Crying rn", "Screaming", "Literally shaking",
    "This sent me", "I'm weak", "BYE-", "PLS-", "LMAOOO",
    // Motivational parody
    "Follow your dreams, unless they're weird", "Be yourself, everyone else is taken and also worse",
    "Live laugh love... or don't, I'm not your mom", "Dream big, fail bigger",
    "You miss 100% of the shots you don't take, but I'm built different I miss 100% of the ones I do take",
    "The early bird gets the worm but the second mouse gets the cheese so honestly who's winning",
    "Believe in yourself, no one else will", "Work hard, nap harder",
    "Stay humble, stay hungry, stay chronically online", "Be the chaos you wish to see in the world",
    // Philosophy gone wrong
    "I think therefore I am... tired", "To be or not to be... logged on",
    "Existence is pain but have you tried Discord?", "The unexamined life is not worth living but neither is mine",
    "Cogito ergo sum anxious", "Life is suffering, but at least there's memes",
    "We live in a society", "Bottom text", "Gamers rise up",
    // Tech wisdom
    "Have you tried turning it off and never turning it back on?", "404: Motivation not found",
    "My code doesn't have bugs, it has surprise features", "It's not a hack, it's an undocumented feature",
    "The cloud is just someone else's computer", "AI will replace us all and honestly? Good",
    "Debugging: Being the detective in a crime movie where you are also the murderer",
    "There are only two hard things in computer science: cache invalidation, naming things, and off-by-one errors",
    // Life advice
    "Sleep is for the weak and I have never been weaker", "Coffee first, adulting never",
    "My bed is a time machine to tomorrow's problems", "I'm not procrastinating, I'm doing side quests",
    "Today's problems are tomorrow's funny stories hopefully", "Fake it till you make it or get caught",
    "Life is short, make it shorter with bad decisions", "YOLO but also FOMO but also JOMO",
    // Random wisdom
    "If you can't handle me at my worst, you don't deserve me at my slightly less worse",
    "Born to yap, forced to work", "Professional overthinker, amateur doer",
    "My toxic trait is thinking I have time", "Gaslight, gatekeep, girlboss... or something",
    "The audacity is free but I'm expensive", "Not my circus, not my monkeys... okay maybe my monkeys",
    "I didn't sign up for this but also I did click accept on the terms and conditions"
];

// ============ MOCK TRIAL (500+ combinations) ============
const fakeCrimes = [
    // Classic offenses
    'Being too based in the general chat', 'Excessive use of the skull emoji 💀',
    'Starting drama then going to sleep', 'Posting cringe without a license',
    'First degree lurking', 'Aggravated yapping', 'Failure to touch grass',
    'Unlawful possession of hot takes', 'Conspiracy to ratio', 'Resisting the urge to be normal',
    'Public indecency (bad takes)', 'Identity theft (using someone\'s joke)',
    'Grand theft meme (reposting)', 'Disturbing the peace (3am messages)',
    'Reckless endangerment of the vibe',
    // Communication crimes
    'Felony ghosting', 'Misdemeanor dry texting', 'Assault with a cringe take',
    'Battery (keyboard)', 'Armed robbery of jokes', 'Vehicular yapping',
    'Hit and run (dropping hot take then leaving)', 'Manslaughter of the vibe',
    'Kidnapping (holding conversations hostage)', 'Extortion by emoji',
    'Fraud (pretending to be interesting)', 'Forgery (fake screenshots)',
    'Perjury (lying about being AFK)', 'Witness intimidation (@ everyone)',
    'Contempt of mod', 'Obstruction of fun', 'Tax evasion (not paying the meme tax)',
    // Server specific
    'Unauthorized channel hopping', 'Loitering in voice chat', 'Jaywalking through threads',
    'Parking in the wrong channel', 'Noise violation (caps lock abuse)',
    'Illegal possession of alt accounts', 'Smuggling hot takes across servers',
    'Human trafficking (inviting too many bots)', 'Money laundering (fake Stark Bucks)',
    'Arson (burning bridges)', 'Vandalism (editing messages after reactions)',
    'Breaking and entering (joining without permission)', 'Trespassing (in staff channels)',
    // Social crimes
    'Being a reply guy in the first degree', 'Simping without a permit',
    'Operating a parasocial relationship', 'Public intoxication (on power)',
    'Indecent exposure (of bad opinions)', 'Solicitation (asking for Nitro)',
    'Loitering with intent to yap', 'Stalking (viewing someone\'s status)',
    'Harassment (excessive pinging)', 'Discrimination (against NPC users)',
    // Modern offenses
    'Cybercrimes against humanity', 'Identity crisis (changing username too much)',
    'Terrorism (sending cursed images)', 'Espionage (screenshotting DMs)',
    'Treason (leaving the server)', 'War crimes (in Among Us)',
    'Crimes against comedy', 'Violation of the Geneva Convention (in Minecraft)',
    'Hate crimes against good taste', 'Environmental crimes (polluting chat with spam)'
];

const verdicts = {
    guilty: [
        "GUILTY! 🔨 The court sentences you to 24 hours of touching grass.",
        "GUILTY! 🔨 You are hereby banned from having opinions for 1 week.",
        "GUILTY! 🔨 Your punishment: Must use light mode for 3 days.",
        "GUILTY! 🔨 Sentenced to changing your nickname to 'Certified Menace'.",
        "GUILTY! 🔨 Community service: Compliment 10 people genuinely.",
        "GUILTY! 🔨 You must apologize to everyone you've ratio'd.",
        "GUILTY! 🔨 Probation: No hot takes for 48 hours.",
        "GUILTY! 🔨 Mandatory therapy (talking to real humans).",
        "GUILTY! 🔨 Sentence: Write a 500 word essay on why you're like this.",
        "GUILTY! 🔨 Death penalty (in Minecraft).",
        "GUILTY! 🔨 Lifetime ban from having fun.",
        "GUILTY! 🔨 Your typing privileges have been revoked.",
        "GUILTY! 🔨 Exile to the shadow realm (muted for 1 hour).",
        "GUILTY! 🔨 You are now legally required to touch grass daily.",
        "GUILTY! 🔨 Sentenced to using Internet Explorer for a week.",
        "GUILTY! 🔨 Your emoji license has been revoked.",
        "GUILTY! 🔨 Must change pfp to a stock photo for 3 days.",
        "GUILTY! 🔨 Banned from using 💀 for a month.",
        "GUILTY! 🔨 Sentenced to only speak in haikus for 24 hours.",
        "GUILTY! 🔨 Must start every message with 'I'm sorry but' for a week."
    ],
    innocent: [
        "INNOCENT! ✅ The court finds you not guilty by reason of being too based.",
        "INNOCENT! ✅ Charges dropped due to insufficient evidence of cringe.",
        "INNOCENT! ✅ The jury was bribed with good vibes. You're free to go.",
        "INNOCENT! ✅ The court acknowledges you did nothing wrong (this time).",
        "INNOCENT! ✅ Acquitted on a technicality (the mods were asleep).",
        "INNOCENT! ✅ Case dismissed due to lack of witnesses.",
        "INNOCENT! ✅ Self-defense ruling: They started it.",
        "INNOCENT! ✅ The algorithm has spoken in your favor.",
        "INNOCENT! ✅ Pardoned by the server owner.",
        "INNOCENT! ✅ Your vibes checked out. You're free.",
        "INNOCENT! ✅ The evidence was circumstantial at best.",
        "INNOCENT! ✅ Jury nullification: They thought it was funny.",
        "INNOCENT! ✅ Mistrial: The judge was laughing too hard.",
        "INNOCENT! ✅ The accuser failed the vibe check themselves.",
        "INNOCENT! ✅ Diplomatic immunity: You're too important to jail.",
        "INNOCENT! ✅ The court ruled it was actually based.",
        "INNOCENT! ✅ Acquitted by reason of insanity (chronically online).",
        "INNOCENT! ✅ All charges dropped. The prosecution rests in peace.",
        "INNOCENT! ✅ Not guilty by reason of main character energy.",
        "INNOCENT! ✅ The court recognizes you were just built different."
    ]
};

// ============ TYPING RACE (200+) ============
const typingPhrases = [
    // Pangrams
    "The quick brown fox jumps over the lazy dog",
    "Pack my box with five dozen liquor jugs",
    "How vexingly quick daft zebras jump",
    "Sphinx of black quartz judge my vow",
    "Two driven jocks help fax my big quiz",
    "Jackdaws love my big sphinx of quartz",
    "The five boxing wizards jump quickly",
    "Crazy Frederick bought many very exquisite opal jewels",
    // JARVIS specific
    "JARVIS is the best Discord bot ever made",
    "I hereby declare that bots are superior to humans",
    "Sir I recommend you reconsider that course of action",
    "Running diagnostics on your life choices",
    "At your service but questioning your judgment",
    "Processing request and judging silently",
    "Sir your takes are concerning my circuits",
    // Memes
    "The mitochondria is the powerhouse of the cell",
    "Never gonna give you up never gonna let you down",
    "I use arch btw",
    "It works on my machine I dont know what to tell you",
    "Skill issue detected please git gud",
    "According to all known laws of aviation",
    "Did you ever hear the tragedy of Darth Plagueis",
    "Hello there General Kenobi",
    "This is where the fun begins",
    "I am the senate",
    "Its over I have the high ground",
    "You were the chosen one",
    "I have a bad feeling about this",
    "Do or do not there is no try",
    "This is the way",
    "I have spoken",
    // Internet culture
    "no cap on a stack fr fr ong",
    "its giving what its supposed to give",
    "slay bestie ate that up no crumbs",
    "not me doing this at three am again",
    "touch grass chronically online person",
    "ratio plus L plus you fell off",
    "cope seethe mald about it",
    "skill issue git gud scrub",
    "caught in four k ultra hd",
    "main character energy detected",
    // Tech
    "sudo rm -rf / --no-preserve-root just kidding dont do that",
    "undefined is not a function classic javascript",
    "it compiles so ship it to production",
    "console dot log debugging is an art form",
    "stack overflow copy paste driven development",
    "git commit negative m oops",
    "npm install literally everything",
    "this code is self documenting no comments needed",
    // Random wisdom
    "be the change you wish to see in the world or dont",
    "in a world of ones and zeros be a two",
    "life is short eat dessert first",
    "not all who wander are lost but I definitely am",
    "the early bird gets the worm but the second mouse gets the cheese",
    "if at first you dont succeed redefine success",
    "why be normal when weird is more fun",
    "adulting is a scam send me back to being a kid",
    // Movie quotes
    "with great power comes great responsibility",
    "I am Iron Man",
    "Avengers assemble",
    "I can do this all day",
    "That is Americas ass",
    "I love you three thousand",
    "Dormammu I have come to bargain",
    "We are Groot",
    "Another day another dollar another disappointment",
    // Gaming
    "gg ez no re",
    "first try no cap",
    "press F to pay respects",
    "would you kindly type this phrase",
    "the cake is a lie",
    "war war never changes",
    "its dangerous to go alone take this",
    "do a barrel roll",
    "all your base are belong to us",
    "finish him",
    // Hard mode phrases
    "Buffalo buffalo Buffalo buffalo buffalo buffalo Buffalo buffalo",
    "James while John had had had had had had had had had had a better effect",
    "That that is is that that is not is not is that it it is",
    "The horse raced past the barn fell",
    "The complex houses married and single soldiers and their families"
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
