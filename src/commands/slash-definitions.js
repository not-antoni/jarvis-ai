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
                .setDescription('Number of entries to review (1-30)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30)
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
        .setDescription('Grab the Jarvis HQ support server invite')
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
        .setName('gif')
        .setDescription('Convert an image or GIF into a GIF file')
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('Image/GIF URL (Tenor and direct links supported)')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('image').setDescription('Image to convert').setRequired(false)
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
        .setDescription('Configure Jarvis auto moderation')
        .addSubcommand(subcommand =>
            subcommand.setName('status').setDescription('Show auto moderation status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable auto moderation with the configured blacklist')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Disable auto moderation')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add words to the blacklist')
                .addStringOption(option =>
                    option
                        .setName('words')
                        .setDescription('Comma or newline separated words')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove words from the blacklist')
                .addStringOption(option =>
                    option
                        .setName('words')
                        .setDescription('Comma or newline separated words')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('import')
                .setDescription('Import blacklist entries from a text file')
                .addAttachmentOption(option =>
                    option
                        .setName('file')
                        .setDescription('Plain text file with one word or phrase per line')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option
                        .setName('replace')
                        .setDescription('Replace the existing blacklist instead of merging')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('list').setDescription('List configured blacklist entries')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all blacklisted entries and disable auto moderation')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setmessage')
                .setDescription('Set the custom message shown when blocking a message')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Custom response shown to users')
                        .setRequired(true)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('filter')
                .setDescription('Manage additional auto moderation filters')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription(
                            'Create a separate auto moderation rule with its own keywords'
                        )
                        .addStringOption(option =>
                            option
                                .setName('words')
                                .setDescription(
                                    'Comma or newline separated words for the new filter'
                                )
                                .setRequired(true)
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
        .setDescription('Set a custom wake word that triggers Jarvis for you or your server')
        .addStringOption(opt =>
            opt
                .setName('word')
                .setDescription('Your custom wake word (2-20 characters, alphanumeric)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt
                .setName('scope')
                .setDescription('Apply to yourself or the whole server (server requires admin)')
                .setRequired(false)
                .addChoices(
                    { name: 'Personal (just you)', value: 'personal' },
                    { name: 'Server (everyone in this server)', value: 'server' }
                )
        )
        .addBooleanOption(opt =>
            opt
                .setName('clear')
                .setDescription('Remove your (or server) wake word')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt
                .setName('disable_defaults')
                .setDescription('Disable default wake words (jarvis/garmin) for this server')
                .setRequired(false)
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
        .setName('voice')
        .setDescription('Voice chat with Jarvis in a voice channel')
        .setContexts([InteractionContextType.Guild])
        .addSubcommand(sub =>
            sub.setName('join').setDescription('Jarvis joins your voice channel and listens')
        )
        .addSubcommand(sub =>
            sub.setName('leave').setDescription('Jarvis leaves the voice channel')
        ),

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
