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
        name: 'ping',
        description: 'Check bot latency and system vitals.',
        category: 'Core Systems',
        usage: '/ping',
        feature: 'coreChat',
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
        name: 'yt',
        description: 'Search YouTube for a relevant video.',
        category: 'Utilities',
        usage: '/yt <query>',
        feature: 'utilities',
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
        name: 'memory',
        description: 'Review the memories Jarvis currently retains for you.',
        category: 'Personal Tools',
        usage: '/memory [entries:5]',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'remind',
        description: 'Set, list, or cancel a reminder.',
        category: 'Personal Tools',
        usage: '/remind set message:<text> time:<in 2 hours>',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'timezone',
        description: 'Set your timezone for reminders and timestamps.',
        category: 'Personal Tools',
        usage: '/timezone zone:Europe/London',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'wakeword',
        description: 'Set your wake word or manage the server wake word.',
        category: 'Personal Tools',
        usage: '/wakeword set word:friday OR /wakeword server set word:friday',
        feature: 'utilities',
        ephemeral: true
    },
    {
        name: 'clear',
        description: 'Clear your conversation history with Jarvis.',
        category: 'Core Systems',
        usage: '/clear',
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
        name: 'news',
        description: 'Fetch curated headlines for a topic.',
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
        name: 'gif',
        description: 'Convert an image or gif into a GIF file.',
        category: 'Meme Lab',
        usage: '/gif [image|url]',
        feature: 'memeTools',
        ephemeral: false
    },
    {
        name: 'Make it a Quote',
        description: 'Render a quoted message as an image.',
        category: 'Meme Lab',
        usage: 'Message context menu -> Make it a Quote',
        feature: 'memeTools',
        ephemeral: false,
        hidden: true
    },
    {
        name: 'avatar',
        description: "Get a user's avatar.",
        category: 'Utilities',
        usage: '/avatar [user] [server]',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'banner',
        description: "Get a user's banner.",
        category: 'Utilities',
        usage: '/banner [user] [server]',
        feature: 'utilities',
        ephemeral: false
    },
    // ============ FUN COMMANDS ============
    {
        name: 'ship',
        description: 'Calculate compatibility between two people',
        category: 'Fun',
        usage: '/ship <person1> [person2]',
        feature: 'funUtilities',
        ephemeral: false
    },
    {
        name: 'automod',
        description: 'Block words and phrases in this server.',
        category: 'Operations',
        usage: '/automod add words:spam, scam',
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
        name: 'play',
        description: 'Queue music from YouTube, SoundCloud, or audio file uploads.',
        category: 'Music',
        usage: '/play <song> or <upload file>',
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
    },
    {
        name: 'loop',
        description: 'Toggle loop mode (song/queue/off).',
        category: 'Music',
        usage: '/loop [mode]',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'dj',
        description: 'Manage DJ-only controls and blocked listeners.',
        category: 'Music',
        usage: '/dj <toggle|user|role|block|unblock|list>',
        feature: 'music',
        ephemeral: false
    },
    {
        name: 'userinfo',
        description: 'Get detailed information about a member.',
        category: 'Utilities',
        usage: '/userinfo [user]',
        feature: 'utilities',
        ephemeral: false
    },
    {
        name: 'serverinfo',
        description: 'Get detailed information about the current server.',
        category: 'Utilities',
        usage: '/serverinfo',
        feature: 'utilities',
        ephemeral: false
    }
];

const commandFeatureMap = new Map(
    commandDefinitions.map(definition => [definition.name, definition.feature || null])
);

const SLASH_EPHEMERAL_COMMANDS = new Set(
    commandDefinitions.filter(definition => definition.ephemeral).map(definition => definition.name)
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
