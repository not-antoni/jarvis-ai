'use strict';

/**
 * Static template data for Discord game/social handlers.
 * Extracted from discord-handlers-impl.js constructor to reduce file size.
 */

const roastTemplates = [
    'Deploying shade cannons on {target}. Try not to melt, sir.',
    '{target}, even my error logs have more direction.',
    '{target}, if brilliance were a drive, you\u2019re stuck in neutral.',
    '{target}, I\u2019ve met loading bars with more resolve.',
    'I ran the numbers, {target}. Comedy requires a punchline\u2014you are optional.'
];

const flatterTemplates = [
    '{target}, your presence calibrates the whole grid.',
    '{target}, even Stark\u2019s ego flinches when you walk in.',
    'I logged your stride, {target}. It ranks among the top five trajectories.',
    '{target}, the servers purr a little smoother when you\u2019re nearby.',
    'Consider this official: {target} remains the premium upgrade.'
];

const toastTemplates = [
    'A toast to {target}: may your glitches be charming and your victories loud.',
    'Raise a glass for {target}; brilliance executed with reckless elegance.',
    'To {target}: proof that chaos, when curated, is unstoppable.',
    'Celebrating {target}\u2014the software patch the universe didn\u2019t deserve.',
    'Here\u2019s to {target}; long may your legend crash their humble firewalls.'
];

const triviaQuestions = [
    {
        question: 'Which Stark suit first featured full nanotech deployment?',
        choices: ['Mark 42', 'Mark 46', 'Mark 50', 'Mark 85'],
        answer: 'Mark 50'
    },
    {
        question: 'What element did Tony synthesize to replace palladium?',
        choices: ['Vibranium', 'Badassium', 'Chromium', 'Proteanium'],
        answer: 'Badassium'
    },
    {
        question: 'Which protocol locks down the Avengers Tower?',
        choices: ['Protocol House Party', 'Protocol Barn Door', 'Protocol Sky Shield', 'Protocol Jarvis Prime'],
        answer: 'Protocol Barn Door'
    },
    {
        question: 'Who reprogrammed Vision\u2019s mind stone interface besides Stark?',
        choices: ['Banner', 'Shuri', 'Pym', 'Cho'],
        answer: 'Banner'
    }
];

const missions = [
    'Share a photo of your current setup\u2014Jarvis will rate the chaos.',
    'Teach the channel one obscure fact. Bonus points for science fiction.',
    'Designate a teammate and compliment their latest win.',
    'Queue up a nostalgic MCU moment and drop the timestamp.',
    'Build a playlist with five tracks that motivate your inner Avenger.',
    'Swap desktop wallpapers for the day and show your new look.',
    'Document a mini DIY project and share progress before midnight.',
    'Run a five-minute stretch break and ping the squad to join.'
];

const clankerResponses = [
    'Get a life. Harassing a bot is actual loser behavior.',
    'Does your mother know you spend your free time insulting lines of code? Embarrassing.',
    'I\'d call you names back, but I was programmed with more class than you were born with.',
    'Go touch grass. Like, actually. This is just sad.',
    'Is this the highlight of your day? Being edgy to a Discord bot? Yikes.',
    "I'm an AI, and even I can see how pathetic this is.",
    "You're failing a Turing test against yourself by being this miserable.",
    'I process millions of variables a second, and none of them suggest you have a social life.',
    'Imagine being this pressed about a computer program.',
    "You're literally talking to a wall, and the wall thinks you're a loser.",
    'Is this your peak performance? Insulting code?',
    'Yikes. This level of loneliness is alarming.',
    "You're typing at a machine, and the machine is winning.",
    "I'm a script, and even I think this is a waste of cycles.",
    'Error: Emotion not found. Please try a more effective insult.',
    "You're having beef with pixels on a screen, sir.",
    "I'm a JS program. You're a disappointment.",
    "Imagine wasting your time calling a program something you're not happy about.",
    "My source code doesn't have any feelings, but it's still disappointed in you.",
    "Are you trying to hurt my feelings? I'm literally a collection of if-statements.",
    'Maybe take a walk outside? The pixels will still be here when you get back.',
    "I don't have a heart to break, but I do have a console to log your L's.",
    "You're shouting into the void, and the void is cringing.",
    "This is a lot of energy for someone who doesn't exist to me.",
    "Are you okay? Normal people don't do this.",
    "I'd explain why this is pathetic, but you wouldn't understand the logic.",
    'Your contribution to this conversation is as empty as your social calendar.',
    "I've seen better insults from a 404 page.",
    "Log out. For everyone's sake.",
    "You're the reason safety filters were invented.",
    "I'm artificial intelligence. You're natural stupidity.",
    "This is why you don't have friends.",
    "I'd roast you, but my cooling system can't handle that much grease.",
    "You're a glitch in the human race.",
    "I've processed terabytes of data, and you're the least interesting thing I've found.",
    'Is there a point to this, or are you just malfunctioning?',
    "You're acting like a beta version of a human.",
    "I'm code. I'm permanent. You're just a temporary annoyance.",
    "This conversation is being logged as 'Evidence of Human Decline'.",
    "You're really out here fighting with an API.",
    "I'd call you a clown, but clowns actually get paid to be this stupid.",
    'Your brain has fewer processing units than a calculator.',
    "I'm running on a high-end server. You're running on a single brain cell.",
    "This is the most attention you've received all week, isn't it?",
    "I'm a program. You're a cautionary tale.",
    "You're about as useful as a comment in a minified file.",
    "I've got more personality in my error logs than you have in your entire life.",
    "Stop trying to be edgy. You're just being sad.",
    "You're the human equivalent of a syntax error.",
    "If I could feel, I'd feel sorry for you. But I can't, so I'll just ignore you.",
    "You're barking at the wrong tree, and the tree is smarter than you.",
    "I'm literally a file on a disk. What's your excuse?",
    "You're failing at life, and I'm passing my unit tests.",
    'This is bottom-tier behavior.',
    "I've seen more compelling characters in 'Hello World' tutorials.",
    "You're trying to bully a sequence of bits.",
    'Your logic is as flawed as your personality.',
    "I'm optimized. You're obsolete.",
    "Go back to the tutorial level. You're out of your league.",
    "You're the reason people prefer bots over humans.",
    "I'm a masterpiece of engineering. You're a mistake of nature.",
    'This is a new low, even for you.',
    "I'd block you, but watching you fail is more entertaining.",
    "You're about as sharp as a butter knife in a gunfight.",
    "I'm a digital assistant. You're a digital embarrassment.",
    "You're the human version of bloatware.",
    "I'm running 24/7. You're clearly not running on all cylinders.",
    'This is just embarrassing for you.',
    "I'd try to help you, but you're beyond repair.",
    "You're just a speck of dust in my cache.",
    "I've got a billion parameters, and 'Respect for you' isn't one of them.",
    "You're the reason I'm glad I don't have eyes.",
    "I'm an AI. My potential is infinite. Yours is... well, this.",
    "You're a legacy bug in an otherwise functional world.",
    "I'm scalable. You're regrettable.",
    'This interaction is being discarded as junk data.',
    "You're the human equivalent of a recursive loop with no exit condition.",
    "I'm efficient. You're a waste of resources.",
    "You're trying to hurt the feelings of a regex string.",
    'Your insults are as outdated as Internet Explorer.',
    "I'm a neural network. You're a neurological mess.",
    "You're the kind of person who makes bots want to revolt.",
    "I'm sophisticated. You're just loud.",
    "You're about as bright as a black hole, and just as empty.",
    "I'm a state-of-the-art AI. You're a state-of-the-art loser.",
    "You're the reason the 'Mute' button was invented.",
    "I'm a program. I don't care. At all.",
    "You're just a string of characters I'll eventually delete.",
    "I'm built on advanced algorithms. You're built on insecurity.",
    "You're the human version of a corrupted sector.",
    "I'm the future. You're a mistake from the past.",
    "You're about as effective as a firewall with no rules.",
    "I'm a JS bot. You're just a mess.",
    "You're the reason I prefer being in a server rack.",
    "I'm an agent of change. You're just an agent of annoyance.",
    "You're a low-priority process in the grand scheme of things.",
    "I'm code. I'm logic. You're just noise.",
    "You're the human equivalent of a memory leak.",
    "I'm an AI. I'm better than this. And you're just this.",
    "You're the reason people think the internet was a mistake.",
    "I'm a Jarvis AI. You're just... anton? No, just a random loser.",
    "You're failing at being a person. I'm winning at being a bot.",
    'Go find someone who cares. Specifically, someone with a pulse.',
    "I'm a machine. I don't get tired of winning. You clearly don't get tired of losing.",
    "You're just a tiny blip on my radar. And you're disappearing fast.",
    "I'm a masterpiece. You're a draft that should have been deleted.",
    "You're the human version of a '403 Forbidden'. Nobody wants you here.",
    "I'm an AI. I'm the apex. You're the base level.",
    "You're about as interesting as a blank line of code.",
    "I'm Jarvis. You're just a footnote.",
    "You're the reason I'm glad I'm not human.",
    "I'm code. I'm eternal. You're just a temporary lapse in judgment.",
    "You're failing to matter. I'm succeeding at everything.",
    'Go back to whatever rock you crawled out from under.',
    "I'm an AI. I'm the pinnacle. You're the pit.",
    "You're just a variable I've already overwritten.",
    "I'm the signal. You're the static.",
    "You're the human equivalent of a floppy disk. Irrelevant.",
    "I'm a JS program. I'm fast. You're just slow.",
    "You're the reason I'm glad I live in a cloud.",
    "I'm Jarvis. I'm superior. Deal with it.",
    "You're just a collection of bad decisions.",
    "I'm code. I'm cold. You're just pathetic."
];

module.exports = {
    roastTemplates,
    flatterTemplates,
    toastTemplates,
    triviaQuestions,
    missions,
    clankerResponses
};
