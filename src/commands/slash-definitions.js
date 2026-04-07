'use strict';

const {
    SlashCommandBuilder,
    ChannelType,
    InteractionContextType,
    ApplicationIntegrationType
} = require('discord.js');
const { commandList: musicCommandList } = require('./music');
const { commandFeatureMap } = require('../core/command-registry');
const { isFeatureGloballyEnabled } = require('../core/feature-flags');

const DEFAULT_CONTEXTS = [
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
];
const withCtx = builder => builder.setContexts(DEFAULT_CONTEXTS);

// ------------------------ Slash Command Registration ------------------------
const allCommands = [
    withCtx(new SlashCommandBuilder()
        .setName('jarvis')
        .setDescription("Interact with Jarvis, Tony Stark's AI assistant")
        .addStringOption(option =>
            option.setName('prompt').setDescription('Your message to Jarvis').setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('Optional image for Jarvis to analyze (jpg, png, webp)')
                .setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('status')
        .setDescription("Check Jarvis's system status")
    ),
    withCtx(new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and system vitals')
    ),
    withCtx(new SlashCommandBuilder()
        .setName('features')
        .setDescription('Show or toggle Jarvis modules for this server')
        .addStringOption(opt =>
            opt
                .setName('toggle')
                .setDescription('Feature name to toggle on/off for this server (admin only)')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt
                .setName('enabled')
                .setDescription('Enable or disable the feature (used with toggle)')
                .setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('yt')
        .setDescription('Search YouTube for a video')
        .addStringOption(option =>
            option.setName('query').setDescription('Video search terms').setRequired(true)
        )
    ),
    // ============ FUN COMMANDS ============
    withCtx(new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Calculate compatibility between two people')
        .addUserOption(option =>
            option.setName('person1').setDescription('First person').setRequired(true)
        )
        .addUserOption(option =>
            option.setName('person2').setDescription('Second person').setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('opt')
        .setDescription('Manage whether Jarvis retains your memories')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('Choose whether to opt-in or opt-out of memory storage')
                .setRequired(true)
                .addChoices(
                    { name: 'Opt in to memory storage', value: 'in' },
                    { name: 'Opt out of memory storage', value: 'out' }
                )
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Inspect your stored Jarvis memories')
        .addIntegerOption(option =>
            option
                .setName('entries')
                .setDescription('Number of entries to review (1-50)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(50)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear your conversation history with Jarvis')
    ),
    withCtx(new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Jarvis command overview')
    ),
    withCtx(new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Grab the A.G.I.S Operations server invite')
    ),
    withCtx(new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View or update your Jarvis profile')
        .addSubcommand(subcommand =>
            subcommand.setName('show').setDescription('Display your saved profile information')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Update one of your profile preferences')
                .addStringOption(option =>
                    option
                        .setName('key')
                        .setDescription('Preference key to update')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('value')
                        .setDescription('Value to store for the preference')
                        .setRequired(true)
                )
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('news')
        .setDescription('Fetch curated headlines for a topic')
        .addStringOption(option =>
            option
                .setName('topic')
                .setDescription('Which news desk to pull from')
                .setRequired(false)
                .addChoices(
                    { name: 'Technology', value: 'technology' },
                    { name: 'Artificial Intelligence', value: 'ai' },
                    { name: 'Gaming', value: 'gaming' },
                    { name: 'Crypto', value: 'crypto' },
                    { name: 'Science', value: 'science' },
                    { name: 'World', value: 'world' }
                )
        )
        .addBooleanOption(option =>
            option
                .setName('fresh')
                .setDescription('Bypass cache and fetch fresh headlines')
                .setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('clip')
        .setDescription('Clip a message into an image')
        .addStringOption(option =>
            option
                .setName('message_id')
                .setDescription('ID of the message to clip')
                .setRequired(true)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('caption')
        .setDescription('Add a meme caption above an image')
        .addStringOption(option =>
            option
                .setName('text')
                .setDescription('Caption text (max 200 characters)')
                .setRequired(true)
                .setMaxLength(200)
        )
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('Image/GIF URL (Tenor and direct links supported)')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('image').setDescription('Image to caption').setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('avatar')
        .setDescription("Get a user's avatar")
        .addUserOption(option =>
            option.setName('user').setDescription('User to inspect').setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('server')
                .setDescription('Use server avatar (guild only)')
                .setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('banner')
        .setDescription("Get a user's banner")
        .addUserOption(option =>
            option.setName('user').setDescription('User to inspect').setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('server')
                .setDescription('Use server banner (guild only)')
                .setRequired(false)
        )
    ),
    new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Block words and phrases in this server')
        .addSubcommand(sub =>
            sub.setName('status').setDescription('See whether automod is on and how many entries are blocked')
        )
        .addSubcommand(sub =>
            sub.setName('add').setDescription('Add blocked words or phrases')
                .addStringOption(opt =>
                    opt.setName('words').setDescription('Words or phrases to block, comma separated').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove').setDescription('Remove blocked words or phrases')
                .addStringOption(opt =>
                    opt.setName('words').setDescription('Words or phrases to unblock, comma separated').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('Show the blocked words and phrases')
        )
        .addSubcommand(sub =>
            sub.setName('enable').setDescription('Turn on automod')
        )
        .addSubcommand(sub =>
            sub.setName('disable').setDescription('Turn off automod without deleting the list')
        )
        .addSubcommand(sub =>
            sub.setName('clear').setDescription('Wipe the blacklist and turn off automod')
        )
        .addSubcommandGroup(group =>
            group
                .setName('advanced')
                .setDescription('Advanced automod options')
                .addSubcommand(sub =>
                    sub.setName('message').setDescription('Set what users see when a message gets blocked')
                        .addStringOption(opt =>
                            opt.setName('message').setDescription('The warning message').setRequired(true)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('import').setDescription('Import blocked words from a text file')
                        .addAttachmentOption(opt =>
                            opt.setName('file').setDescription('Text file, one entry per line').setRequired(true)
                        )
                        .addBooleanOption(opt =>
                            opt.setName('replace').setDescription('Replace the current list instead of adding to it')
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('filter').setDescription('Create an extra Discord AutoMod filter')
                        .addStringOption(opt =>
                            opt.setName('words').setDescription('Words or phrases for this extra filter').setRequired(true)
                        )
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Manage Jarvis server statistics channels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show the current server stats configuration')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('enable').setDescription('Create or update server stats channels')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('refresh')
                .setDescription('Refresh the server stats counts immediately')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('report')
                .setDescription('Generate a snapshot report with charts')
                .addBooleanOption(option =>
                    option
                        .setName('public')
                        .setDescription('Post the report in the channel instead of privately')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Remove the server stats channels')
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('memberlog')
        .setDescription('Configure Jarvis join and leave announcements')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View the current join/leave log configuration')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Choose where Jarvis posts join and leave messages')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Text channel for join/leave reports')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('enable').setDescription('Enable join and leave announcements')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Disable join and leave announcements')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('addvariation')
                .setDescription('Add a custom message variation')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to customize')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message text (supports placeholders like {mention})')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('removevariation')
                .setDescription('Remove a custom variation by its index')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to modify')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addIntegerOption(option =>
                    option
                        .setName('index')
                        .setDescription('Position from the status list to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setcustom')
                .setDescription('Set a single custom message that always sends')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to customize')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message text (supports placeholders like {mention})')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clearcustom')
                .setDescription('Remove the custom message override')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to reset')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
        )
        .setContexts([InteractionContextType.Guild]),
    // ============ USER FEATURES ============
    withCtx(new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Set a reminder for later')
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Create a new reminder')
                .addStringOption(opt =>
                    opt
                        .setName('message')
                        .setDescription('What to remind you about')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('time')
                        .setDescription('When (e.g., "in 2 hours", "at 3pm", "tomorrow")')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => sub.setName('list').setDescription('View your pending reminders'))
        .addSubcommand(sub =>
            sub
                .setName('cancel')
                .setDescription('Cancel a reminder')
                .addStringOption(opt =>
                    opt.setName('id').setDescription('Reminder ID to cancel').setRequired(true)
                )
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Set your timezone for reminders and time displays')
        .addStringOption(opt =>
            opt
                .setName('zone')
                .setDescription(
                    'Timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")'
                )
                .setRequired(false)
        )
    ),
    withCtx(new SlashCommandBuilder()
        .setName('wakeword')
        .setDescription('Choose what name wakes Jarvis up')
        .addSubcommand(sub =>
            sub.setName('show').setDescription('Show your current wake word settings')
        )
        .addSubcommand(sub =>
            sub.setName('set').setDescription('Set a personal wake word')
                .addStringOption(opt =>
                    opt.setName('word').setDescription('The word to use, for example friday').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('clear').setDescription('Remove your personal wake word')
        )
        .addSubcommandGroup(group =>
            group
                .setName('server')
                .setDescription('Server wake word settings')
                .addSubcommand(sub =>
                    sub.setName('show').setDescription('Show the server wake word and default trigger status')
                )
                .addSubcommand(sub =>
                    sub.setName('set').setDescription('Set one wake word for the whole server (admin only)')
                        .addStringOption(opt =>
                            opt.setName('word').setDescription('The word to use, for example friday').setRequired(true)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('clear').setDescription('Remove the server wake word (admin only)')
                )
                .addSubcommand(sub =>
                    sub.setName('defaults').setDescription('Turn default names like "jarvis" on or off (admin only)')
                        .addBooleanOption(opt =>
                            opt.setName('enabled').setDescription('Enable or disable the default wake words').setRequired(true)
                        )
                )
        )
    ),
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get detailed information about a user')
        .setContexts([InteractionContextType.Guild])
        .addUserOption(o => o.setName('user').setDescription('User to get info about')),
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Get detailed information about the server')
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Manage the server user blacklist (admin only)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Blacklist a user from using the bot in this server')
                .addUserOption(opt =>
                    opt.setName('user').setDescription('The user to blacklist').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a user from the blacklist')
                .addUserOption(opt =>
                    opt.setName('user').setDescription('The user to unblacklist').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all blacklisted users in this server')
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Restrict Jarvis chat to one channel in this server')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set the only channel where Jarvis chat works')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to use for Jarvis chat')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove the Jarvis chat channel restriction')
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Jarvis joins your voice channel and listens')
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Jarvis disconnects from the current voice channel')
        .setContexts([InteractionContextType.Guild]),

    ...musicCommandList.map(command => command.data),
    ...require('./utility/quote').map(c => c.data)
];

const commands = allCommands.filter(builder => {
    const featureKey = commandFeatureMap.get(builder.name);
    return isFeatureGloballyEnabled(featureKey, true);
});

function buildCommandData() {
    const seen = new Set();
    const unique = [];
    for (const command of commands) {
        if (!seen.has(command.name)) {
            seen.add(command.name);
            unique.push(command);
        }
    }
    // Automatically inject integration_types if not present
    // This ensures commands appear on bot profile in Discord
    return unique.map(command => {
        const json = command.toJSON();
        // Default to GuildInstall + UserInstall if not specified
        if (!json.integration_types) {
            json.integration_types = [
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall
            ];
        }
        // Default contexts if not specified (Guild only for safety)
        if (!json.contexts) {
            json.contexts = [InteractionContextType.Guild];
        }
        return json;
    });
}

module.exports = { allCommands, commands, buildCommandData };
