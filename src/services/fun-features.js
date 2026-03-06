/**
 * Fun features still used by live slash handlers.
 *
 * Everything else in the old file was dead generator/data sludge with no
 * inbound callers after the current command cleanup.
 */

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
    'You must be a milestone, because unlocking you feels rewarding 🏆',
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

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomTypingPhrase() {
    return randomChoice(typingPhrases);
}

function getPickupLine() {
    return randomChoice(pickupLines);
}

function get8BallResponse() {
    return randomChoice(eightBallResponses);
}

function generateShipName(name1, name2) {
    // Take first half of first name and second half of second name
    const half1 = name1.slice(0, Math.ceil(name1.length / 2));
    const half2 = name2.slice(Math.floor(name2.length / 2));
    const shipName = half1 + half2;

    const prefix = randomChoice(shipPrefixes);
    const suffix = Math.random() < 0.3 ? ` ${  randomChoice(shipSuffixes)}` : '';

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
    if (!match) {return null;}

    const count = parseInt(match[1]) || 1;
    const sides = parseInt(match[2]);
    const modifier = parseInt(match[3]) || 0;

    if (count > 100 || sides > 1000) {return null;}

    const rolls = [];
    for (let i = 0; i < count; i++) {
        rolls.push(randomInt(1, sides));
    }

    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    return {
        rolls,
        total,
        modifier,
        notation: `${count}d${sides}${modifier >= 0 && modifier !== 0 ? `+${  modifier}` : modifier !== 0 ? modifier : ''}`
    };
}

module.exports = {
    typingPhrases,
    pickupLines,
    eightBallResponses,
    generateShipName,
    getRandomTypingPhrase,
    getPickupLine,
    get8BallResponse,
    calculateCompatibility,
    rollDice,
    randomChoice,
    randomInt
};
