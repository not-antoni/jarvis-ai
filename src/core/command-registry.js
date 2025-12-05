/**
 * Central registry describing Jarvis slash commands.
 * Used for feature gating, help generation, and future auto-registration.
 */

const commandDefinitions = [
    {
        name: 'jarvis',
        description: 'Chat with Jarvis or request on-demand assistance.',
        category: 'Core Systems',
        usage: '/jarvis <prompt>',
        feature: 'coreChat',
        ephemeral: false
    },
    {
        name: 'filter',
        description: 'Manage per-guild blocked words and regex filters',
        category: 'Moderation',
        usage: '/filter <subcommand>',
        feature: 'moderationFilters',
        ephemeral: true
    },
    {
        name: '67',
        description: '6 7',
        category: 'Fun',
        usage: '/67',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'help',
        description: 'Show command categories and support resources.',
        category: 'Core Systems',
        usage: '/help',
        feature: 'coreChat',
        ephemeral: true
    },
    {
        name: 'invite',
        description: 'Grab the Jarvis HQ support server invite.',
        category: 'Core Systems',
        usage: '/invite',
        feature: 'invite',
        ephemeral: false
    },
    {
        name: 'status',
        description: 'Check Jarvis subsystem health.',
        category: 'Core Systems',
        usage: '/status',
        feature: 'coreChat',
        ephemeral: false
    },
    {
        name: 'providers',
        description: 'List available AI providers and rotation status.',
        category: 'Core Systems',
        usage: '/providers',
        feature: 'providers',
        ephemeral: false
    },
    {
        name: 'features',
        description: 'Inspect which Jarvis modules are enabled globally and for the current guild.',
        category: 'Core Systems',
        usage: '/features',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'joke',
        description: 'Pull a random safe joke from public APIs.',
        category: 'Fun',
        usage: '/joke',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'yt',
        description: 'Search YouTube for a relevant video.',
        category: 'Utilities',
        usage: '/yt <query>',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'search',
        description: 'Perform a safety-filtered Brave web search.',
        category: 'Utilities',
        usage: '/search <query>',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'math',
        description: 'Evaluate a mathematical expression or equation.',
        category: 'Utilities',
        usage: '/math <expression>',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'crypto',
        description: 'Retrieve live market data for popular cryptocurrencies.',
        category: 'Utilities',
        usage: '/crypto coin:<symbol> convert:<currency>',
        feature: 'crypto',
        ephemeral: false
    },
    {
        name: 'opt',
        description: 'Control whether Jarvis stores your conversation history.',
        category: 'Utilities',
        usage: '/opt mode:<in|out>',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'mission',
        description: 'Receive a rotating daily directive from Jarvis.',
        category: 'Fun',
        usage: '/mission [refresh:true]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'memory',
        description: 'Review the memories Jarvis currently retains for you.',
        category: 'Personal Tools',
        usage: '/memory [entries:5]',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'persona',
        description: 'Preview or switch Jarvis into alternate personas.',
        category: 'Personal Tools',
        usage: '/persona mode:<persona> [preview:true]',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'reset',
        description: 'Clear your conversation history and profile.',
        category: 'Core Systems',
        usage: '/reset',
        feature: 'reset',
        ephemeral: false
    },
    {
        name: 'profile',
        description: 'View or update your saved preferences.',
        category: 'Personal Tools',
        usage: '/profile show',
        feature: 'coreChat',
        ephemeral: true
    },
    {
        name: 'history',
        description: 'Review your recent prompts with Jarvis.',
        category: 'Personal Tools',
        usage: '/history [count]',
        feature: 'coreChat',
        ephemeral: true
    },
    {
        name: 'recap',
        description: 'Summary of recent conversations.',
        category: 'Personal Tools',
        usage: '/recap [window]',
        feature: 'coreChat',
        ephemeral: true
    },
    {
        name: 'digest',
        description: 'Summarize recent server activity.',
        category: 'Personal Tools',
        usage: '/digest [window] [highlights]',
        feature: 'digests',
        ephemeral: true
    },
    {
        name: 'roll',
        description: 'Roll a virtual die.',
        category: 'Utilities',
        usage: '/roll [sides]',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'time',
        description: 'Render a Discord timestamp in your timezone.',
        category: 'Utilities',
        usage: '/time [format]',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'encode',
        description: 'Encode plain text in various formats.',
        category: 'Utilities',
        usage: '/encode text:<value> format:<type>',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'decode',
        description: 'Decode text back to plaintext.',
        category: 'Utilities',
        usage: '/decode text:<value> format:<type>',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'news',
        description: 'Fetch curated headlines via Brave Search.',
        category: 'Utilities',
        usage: '/news <topic>',
        feature: 'newsBriefings',
        ephemeral: false
    },
    {
        name: 'clip',
        description: 'Render a message as a clean PNG.',
        category: 'Utilities',
        usage: '/clip message:<link>',
        feature: 'clipping',
        ephemeral: false
    },
    {
        name: 'caption',
        description: 'Add a meme-style caption to an image.',
        category: 'Meme Lab',
        usage: '/caption text:<caption> image:<attachment>',
        feature: 'memeTools',
        ephemeral: false
    },
    {
        name: 'meme',
        description: 'Generate meme variations with top and bottom text.',
        category: 'Meme Lab',
        usage: '/meme impact top:<text> bottom:<text> image:<attachment>',
        feature: 'memeTools',
        ephemeral: false
    },
    {
        name: 'eightball',
        description: 'Ask the oracle of Stark for guidance.',
        category: 'Fun',
        usage: '/eightball "Should I deploy?"',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'vibecheck',
        description: 'Audit the vibes of a comrade.',
        category: 'Fun',
        usage: '/vibecheck [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'bonk',
        description: 'Deliver comedic corrective action.',
        category: 'Fun',
        usage: '/bonk <user>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'banter',
        description: 'Trade a Stark-grade banter line.',
        category: 'Fun',
        usage: '/banter [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'roast',
        description: 'Deploy a refined Jarvis roast.',
        category: 'Fun',
        usage: '/roast <user>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'flatter',
        description: 'Deliver a premium compliment.',
        category: 'Fun',
        usage: '/flatter [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'toast',
        description: 'Raise a celebratory toast.',
        category: 'Fun',
        usage: '/toast [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'trivia',
        description: 'Answer Marvel/Stark trivia prompts.',
        category: 'Fun',
        usage: '/trivia',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'cipher',
        description: 'Decode a rotating Stark cipher.',
        category: 'Fun',
        usage: '/cipher',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'scramble',
        description: 'Unscramble a Stark Industries keyword.',
        category: 'Fun',
        usage: '/scramble',
        feature: 'funUtilities',
        ephemeral: false
    },
    // ============ STARK BUCKS ECONOMY ============
    {
        name: 'balance',
        description: 'Check your Stark Bucks balance and stats.',
        category: 'Economy',
        usage: '/balance',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'daily',
        description: 'Claim your daily Stark Bucks reward.',
        category: 'Economy',
        usage: '/daily',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'work',
        description: 'Work at Stark Industries for money.',
        category: 'Economy',
        usage: '/work',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'gamble',
        description: 'Gamble your Stark Bucks.',
        category: 'Economy',
        usage: '/gamble amount:<number>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'slots',
        description: 'Play the slot machine.',
        category: 'Economy',
        usage: '/slots bet:<number>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'coinflip',
        description: 'Flip a coin and bet.',
        category: 'Economy',
        usage: '/coinflip bet:<number> choice:<heads/tails>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'shop',
        description: 'Browse the Stark Industries shop.',
        category: 'Economy',
        usage: '/shop',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'buy',
        description: 'Buy an item from the shop.',
        category: 'Economy',
        usage: '/buy item:<item_id>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'leaderboard',
        description: 'View the Stark Bucks leaderboard.',
        category: 'Economy',
        usage: '/leaderboard',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'show',
        description: 'Show off your Stark Bucks balance to everyone!',
        category: 'Economy',
        usage: '/show',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'crime',
        description: 'Commit a crime for money (risky but high reward!)',
        category: 'Economy',
        usage: '/crime',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'postmeme',
        description: 'Post a meme and hope it goes viral',
        category: 'Economy',
        usage: '/postmeme',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'searchlocation',
        description: 'Search a location for money',
        category: 'Economy',
        usage: '/searchlocation [location]',
        feature: 'funUtilities',
        ephemeral: false
    },
    // ============ FUN COMMANDS (Available Everywhere) ============
    {
        name: 'rapbattle',
        description: 'HUMANOID vs HUMAN rap battle - challenge Jarvis!',
        category: 'Fun',
        usage: '/rapbattle',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'roast',
        description: '50/50 chance to get roasted or blessed.',
        category: 'Fun',
        usage: '/roast [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'wiki',
        description: 'Generate a fake Wikipedia entry for someone.',
        category: 'Fun',
        usage: '/wiki [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'conspiracy',
        description: 'Generate a conspiracy theory about someone.',
        category: 'Fun',
        usage: '/conspiracy [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'wyr',
        description: 'Would You Rather - get a random dilemma.',
        category: 'Fun',
        usage: '/wyr',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'prophecy',
        description: 'Receive a prophecy about someone\'s future.',
        category: 'Fun',
        usage: '/prophecy [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'fakequote',
        description: 'Generate a fake inspirational quote.',
        category: 'Fun',
        usage: '/fakequote [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'trial',
        description: 'Put someone on trial for fake crimes.',
        category: 'Fun',
        usage: '/trial <user>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'typerace',
        description: 'Typing race - first to type the phrase wins!',
        category: 'Fun',
        usage: '/typerace',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'rps',
        description: 'Rock Paper Scissors',
        category: 'Fun',
        usage: '/rps [opponent]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'ship',
        description: 'Calculate compatibility between two people',
        category: 'Fun',
        usage: '/ship <person1> [person2]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'howgay',
        description: 'Check how gay someone is',
        category: 'Fun',
        usage: '/howgay [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'howbased',
        description: 'Check how based someone is',
        category: 'Fun',
        usage: '/howbased [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'pickupline',
        description: 'Get a cringe pickup line',
        category: 'Fun',
        usage: '/pickupline',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'dadjoke',
        description: 'Get a classic dad joke',
        category: 'Fun',
        usage: '/dadjoke',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'fight',
        description: 'Start a fight with someone',
        category: 'Fun',
        usage: '/fight <opponent>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'hug',
        description: 'Hug someone',
        category: 'Fun',
        usage: '/hug <user>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'slap',
        description: 'Slap someone',
        category: 'Fun',
        usage: '/slap <user>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'roll',
        description: 'Roll dice (e.g., 2d6, 1d20+5)',
        category: 'Fun',
        usage: '/roll [dice]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'choose',
        description: 'Choose between options',
        category: 'Fun',
        usage: '/choose <options>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'afk',
        description: 'Set your AFK status',
        category: 'Fun',
        usage: '/afk [reason]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'rate',
        description: 'Rate something or someone',
        category: 'Fun',
        usage: '/rate <thing>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'eightball',
        description: 'Ask the magic 8-ball',
        category: 'Fun',
        usage: '/eightball <question>',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'achievements',
        description: 'View your achievements and progress',
        category: 'Fun',
        usage: '/achievements [category] [user]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'soul',
        description: 'View Jarvis\'s artificial soul status.',
        category: 'Fun',
        usage: '/soul status',
        feature: 'funUtilities',
        ephemeral: false
    },
    // ============ SELFHOST-ONLY COMMANDS ============
    {
        name: 'selfmod',
        description: 'Jarvis self-modification analysis.',
        category: 'Experimental',
        usage: '/selfmod analyze',
        feature: 'selfhostExperimental',
        ephemeral: true
    },
    {
        name: 'ytdlp',
        description: 'yt-dlp status and updates.',
        category: 'Utilities',
        usage: '/ytdlp status',
        feature: 'music',
        ephemeral: true
    },
    {
        name: 'sentient',
        description: 'Sentient agent system controls.',
        category: 'Experimental',
        usage: '/sentient status',
        feature: 'selfhostExperimental',
        ephemeral: true
    },
    // ============ END SELFHOST-ONLY COMMANDS ============
    {
        name: 'reactionrole',
        description: 'Configure reaction role menus.',
        category: 'Operations',
        usage: '/reactionrole create',
        feature: 'reactionRoles',
        ephemeral: true
    },
    {
        name: 'automod',
        description: 'Manage blacklist filters and automod rules.',
        category: 'Operations',
        usage: '/automod status',
        feature: 'automod',
        ephemeral: true
    },
    {
        name: 'serverstats',
        description: 'Maintain live member counters.',
        category: 'Operations',
        usage: '/serverstats enable',
        feature: 'serverStats',
        ephemeral: true
    },
    {
        name: 'memberlog',
        description: 'Customize join and leave announcements.',
        category: 'Operations',
        usage: '/memberlog enable',
        feature: 'memberLog',
        ephemeral: true
    },
    {
        name: 'ask',
        description: 'Query the knowledge base.',
        category: 'Operations',
        usage: '/ask <question>',
        feature: 'knowledgeAsk',
        ephemeral: false
    },
    {
        name: 'macro',
        description: 'Set up canned responses.',
        category: 'Operations',
        usage: '/macro list',
        feature: 'macroReplies',
        ephemeral: true
    },
    {
        name: 'play',
        description: 'Queue music from YouTube and other sources.',
        category: 'Music',
        usage: '/play <song>',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'skip',
        description: 'Skip the current track.',
        category: 'Music',
        usage: '/skip',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'pause',
        description: 'Pause playback.',
        category: 'Music',
        usage: '/pause',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'resume',
        description: 'Resume playback.',
        category: 'Music',
        usage: '/resume',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'stop',
        description: 'Stop playback and clear queue.',
        category: 'Music',
        usage: '/stop',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'queue',
        description: 'Show the current song queue.',
        category: 'Music',
        usage: '/queue',
        feature: 'music',
        ephemeral: false
    }
];

const commandFeatureMap = new Map(
    commandDefinitions.map((definition) => [definition.name, definition.feature || null])
);

const SLASH_EPHEMERAL_COMMANDS = new Set(
    commandDefinitions.filter((definition) => definition.ephemeral).map((definition) => definition.name)
);

function buildHelpCatalog() {
    const categoryMap = new Map();

    for (const definition of commandDefinitions) {
        if (definition.hidden) {
            continue;
        }

        const category = definition.category || 'Miscellaneous';
        if (!categoryMap.has(category)) {
            categoryMap.set(category, []);
        }
        categoryMap.get(category).push(definition);
    }

    return [...categoryMap.entries()].map(([category, commands]) => ({
        category,
        commands: commands.sort((a, b) => a.name.localeCompare(b.name))
    }));
}

module.exports = {
    commandDefinitions,
    commandFeatureMap,
    SLASH_EPHEMERAL_COMMANDS,
    buildHelpCatalog
};
