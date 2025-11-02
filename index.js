/**
 * Jarvis Discord Bot - Main Entry Point
 * Refactored for better organization and maintainability
 */
require("dotenv").config();
const { Client, GatewayIntentBits, SlashCommandBuilder, InteractionContextType, ChannelType, Partials, PermissionsBitField } = require("discord.js");
const express = require("express");
const cron = require("node-cron");

// Import our modules
const config = require('./config');
const database = require('./database');
const { initializeDatabaseClients } = require('./db');
const aiManager = require('./ai-providers');
const discordHandlers = require('./discord-handlers');
const { gatherHealthSnapshot } = require('./diagnostics');
const { commandList: musicCommandList } = require("./src/commands/music");
const { commandFeatureMap } = require('./src/core/command-registry');
const { isFeatureGloballyEnabled } = require('./src/core/feature-flags');

initializeDatabaseClients()
    .then(() => console.log('MongoDB clients initialized for main and vault databases.'))
    .catch((error) => console.error('Failed to initialize MongoDB clients at startup:', error));

// ------------------------ Discord Client Setup ------------------------
const client = new Client({
    intents: config.discord.intents.map(intent => GatewayIntentBits[intent]),
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember
    ]
});

// ------------------------ Slash Command Registration ------------------------
const allCommands = [
    new SlashCommandBuilder()
        .setName("jarvis")
        .setDescription("Interact with Jarvis, Tony Stark's AI assistant")
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Your message to Jarvis")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("roll")
        .setDescription("Roll a die (e.g., /roll sides:20)")
        .addIntegerOption((option) =>
            option
                .setName("sides")
                .setDescription("Number of sides (default: 6)")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Check Jarvis's system status")
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("time")
        .setDescription("Get the current time in your timezone")
        .addStringOption((option) =>
            option
                .setName("format")
                .setDescription("Time format to display")
                .setRequired(false)
                .addChoices(
                    { name: "Time only", value: "t" },
                    { name: "Time with seconds", value: "T" },
                    { name: "Short date", value: "d" },
                    { name: "Long date", value: "D" },
                    { name: "Short date/time", value: "f" },
                    { name: "Long date/time", value: "F" },
                    { name: "Relative time", value: "R" }
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("providers")
        .setDescription("List available AI providers")
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Delete your conversation history and profile with Jarvis")
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show Jarvis command overview")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("invite")
        .setDescription("Grab the Jarvis HQ support server invite")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("profile")
        .setDescription("View or update your Jarvis profile")
        .addSubcommand(subcommand =>
            subcommand
                .setName("show")
                .setDescription("Display your saved profile information"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("set")
                .setDescription("Update one of your profile preferences")
                .addStringOption(option =>
                    option
                        .setName("key")
                        .setDescription("Preference key to update")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("value")
                        .setDescription("Value to store for the preference")
                        .setRequired(true)))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("history")
        .setDescription("Review your recent prompts")
        .addIntegerOption(option =>
            option
                .setName("count")
                .setDescription("How many prompts to show (max 20)")
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("recap")
        .setDescription("Get a quick activity summary")
        .addStringOption(option =>
            option
                .setName("window")
                .setDescription("How far back to look")
                .setRequired(false)
                .addChoices(
                    { name: "Last 6 hours", value: "6h" },
                    { name: "Last 12 hours", value: "12h" },
                    { name: "Last 24 hours", value: "24h" },
                    { name: "Last 7 days", value: "7d" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("digest")
        .setDescription("Summarize recent activity for this server")
        .addStringOption(option =>
            option
                .setName("window")
                .setDescription("Time range to summarize")
                .setRequired(false)
                .addChoices(
                    { name: "Last 6 hours", value: "6h" },
                    { name: "Last 24 hours", value: "24h" },
                    { name: "Last 7 days", value: "7d" }
                ))
        .addIntegerOption(option =>
            option
                .setName("highlights")
                .setDescription("Approximate number of highlights to surface (default 5)")
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(10))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Display a member\'s level progress')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Member to inspect')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the leveling leaderboard')
        .addIntegerOption(option =>
            option
                .setName('page')
                .setDescription('Leaderboard page (defaults to 1)')
                .setRequired(false)
                .setMinValue(1)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Configure automatic level reward roles')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Grant a role when members reach a level')
                .addIntegerOption(option =>
                    option
                        .setName('level')
                        .setDescription('Level at which to grant the role')
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to award')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a level reward role')
                .addIntegerOption(option =>
                    option
                        .setName('level')
                        .setDescription('Level to remove')
                        .setRequired(true)
                        .setMinValue(1)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List configured level reward roles')
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("decode")
        .setDescription("Decode encoded text")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("The text to decode")
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName("format")
                .setDescription("Encoding to decode from (default: auto)")
                .setRequired(false)
                .addChoices(
                    { name: "Auto detect", value: "auto" },
                    { name: "Base64", value: "base64" },
                    { name: "Base32", value: "base32" },
                    { name: "Base58", value: "base58" },
                    { name: "Hexadecimal", value: "hex" },
                    { name: "Binary", value: "binary" },
                    { name: "URL-encoded", value: "url" },
                    { name: "ROT13", value: "rot13" },
                    { name: "Punycode", value: "punycode" },
                    { name: "Morse code", value: "morse" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("encode")
        .setDescription("Encode plain text")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("The text to encode")
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName("format")
                .setDescription("Encoding format (default: base64)")
                .setRequired(false)
                .addChoices(
                    { name: "Base64", value: "base64" },
                    { name: "Base32", value: "base32" },
                    { name: "Base58", value: "base58" },
                    { name: "Hexadecimal", value: "hex" },
                    { name: "Binary", value: "binary" },
                    { name: "URL-encoded", value: "url" },
                    { name: "ROT13", value: "rot13" },
                    { name: "Punycode", value: "punycode" },
                    { name: "Morse code", value: "morse" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('eightball')
        .setDescription('Consult Stark Industries magic eight ball')
        .addStringOption((option) =>
            option
                .setName('question')
                .setDescription('Ask anything')
                .setRequired(true)
                .setMaxLength(200)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('vibecheck')
        .setDescription('Evaluate the vibe levels of a comrade')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Optional target (defaults to you)')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('bonk')
        .setDescription('Deliver a comedic corrective bonk')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Who deserves the bonk?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("news")
        .setDescription("Fetch curated headlines for a topic")
        .addStringOption(option =>
            option
                .setName("topic")
                .setDescription("Which news desk to pull from")
                .setRequired(false)
                .addChoices(
                    { name: "Technology", value: "technology" },
                    { name: "Artificial Intelligence", value: "ai" },
                    { name: "Gaming", value: "gaming" },
                    { name: "Crypto", value: "crypto" },
                    { name: "Science", value: "science" },
                    { name: "World", value: "world" }
                ))
        .addBooleanOption(option =>
            option
                .setName("fresh")
                .setDescription("Bypass cache and fetch fresh headlines")
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("clip")
        .setDescription("Clip a message into an image")
        .addStringOption((option) =>
            option
                .setName("message_id")
                .setDescription("ID of the message to clip")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('caption')
        .setDescription('Add a meme caption above an image')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('Caption text (max 200 characters)')
                .setRequired(true)
                .setMaxLength(200)
        )
        .addAttachmentOption((option) =>
            option
                .setName('image')
                .setDescription('Image to caption')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('meme')
        .setDescription('Generate meme variants')
        .addSubcommand((sub) =>
            sub
                .setName('impact')
                .setDescription('Classic impact meme with top/bottom text')
                .addAttachmentOption((option) =>
                    option
                        .setName('image')
                        .setDescription('Image to memeify')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('top')
                        .setDescription('Top text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
                .addStringOption((option) =>
                    option
                        .setName('bottom')
                        .setDescription('Bottom text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets')
        .addSubcommand((sub) =>
            sub
                .setName('open')
                .setDescription('Open a new private support ticket')
                .addStringOption((option) =>
                    option
                        .setName('reason')
                        .setDescription('Brief description of the issue')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('close')
                .setDescription('Close the current ticket')
        )
        .addSubcommand((sub) =>
            sub
                .setName('export')
                .setDescription('Export a transcript of a ticket')
                .addStringOption((option) =>
                    option
                        .setName('ticket_id')
                        .setDescription('Ticket identifier to export (optional when used inside a ticket channel)')
                        .setRequired(false)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('ticket_number')
                        .setDescription('Ticket number to export (alternative to ticket_id)')
                        .setRequired(false)
                        .setMinValue(1)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('kb')
        .setDescription('Manage the server knowledge base')
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Add content to the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('title')
                        .setDescription('Title for the entry')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('content')
                        .setDescription('Plain text or markdown content to store')
                        .setRequired(false)
                )
                .addAttachmentOption((option) =>
                    option
                        .setName('file')
                        .setDescription('Optional text or markdown file to ingest')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('search')
                .setDescription('Search the knowledge base for a query')
                .addStringOption((option) =>
                    option
                        .setName('query')
                        .setDescription('Search keywords')
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('limit')
                        .setDescription('Maximum number of results to display (default 5)')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('delete')
                .setDescription('Remove an entry from the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('entry_id')
                        .setDescription('Identifier returned by /kb search or /kb add')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Query the server knowledge base for an answer')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('What would you like to know?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('macro')
        .setDescription('Send reusable knowledge base responses')
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List macros available for this server')
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription('Filter macros by tag')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('send')
                .setDescription('Send a macro response from the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('entry_id')
                        .setDescription('Knowledge base entry identifier to send')
                        .setRequired(false)
                )
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription('Fallback tag if entry id is not provided')
                        .setRequired(false)
                )
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the macro to (defaults to here)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText))
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('econ')
        .setDescription('Interact with the StarkTokens economy')
        .addSubcommandGroup((group) =>
            group
                .setName('config')
                .setDescription('Configure where economy commands are allowed')
                .addSubcommand((sub) =>
                    sub
                        .setName('enable')
                        .setDescription('Enable StarkTokens in this channel or a specified one')
                        .addChannelOption((option) =>
                            option
                                .setName('channel')
                                .setDescription('Channel to enable (defaults to current)')
                                .setRequired(false)
                                .addChannelTypes(
                                    ChannelType.GuildText,
                                    ChannelType.GuildAnnouncement,
                                    ChannelType.PublicThread,
                                    ChannelType.PrivateThread,
                                    ChannelType.GuildVoice
                                )
                        )
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('disable')
                        .setDescription('Disable StarkTokens in a channel')
                        .addChannelOption((option) =>
                            option
                                .setName('channel')
                                .setDescription('Channel to disable (defaults to current)')
                                .setRequired(false)
                                .addChannelTypes(
                                    ChannelType.GuildText,
                                    ChannelType.GuildAnnouncement,
                                    ChannelType.PublicThread,
                                    ChannelType.PrivateThread,
                                    ChannelType.GuildVoice
                                )
                        )
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('status')
                        .setDescription('List channels where StarkTokens is enabled')
                )
        )
        .addSubcommandGroup((group) =>
            group
                .setName('boss')
                .setDescription('Launch Stark Industries boss events')
                .addSubcommand((sub) =>
                    sub
                        .setName('spawn')
                        .setDescription('Deploy a training boss in this channel')
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('status')
                        .setDescription('Check the current boss status')
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('balance')
                .setDescription('Check a user\'s token balance')
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription('Member to inspect')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('daily')
                .setDescription('Claim your StarkTokens daily stipend')
        )
        .addSubcommand((sub) =>
            sub
                .setName('work')
                .setDescription('Complete a Stark Industries contract for pay')
        )
        .addSubcommand((sub) =>
            sub
                .setName('coinflip')
                .setDescription('Wager StarkTokens on a coin flip')
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('Amount to wager')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(1000000)
                )
                .addStringOption((option) =>
                    option
                        .setName('side')
                        .setDescription('Heads or tails')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Heads', value: 'heads' },
                            { name: 'Tails', value: 'tails' }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('crate')
                .setDescription('Open a Stark supply crate')
        )
        .addSubcommand((sub) =>
            sub
                .setName('leaderboard')
                .setDescription('Show the richest StarkToken holders')
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse or manage the Stark shop')
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Add an item to the shop catalog')
                .addStringOption((option) =>
                    option
                        .setName('sku')
                        .setDescription('Unique identifier (letters, numbers, dashes)')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(32)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('price')
                        .setDescription('Purchase price in StarkTokens')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(1000000)
                )
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Display name for the item')
                        .setRequired(true)
                        .setMaxLength(80)
                )
                .addStringOption((option) =>
                    option
                        .setName('description')
                        .setDescription('Optional short description')
                        .setRequired(false)
                        .setMaxLength(200)
                )
                .addRoleOption((option) =>
                    option
                        .setName('role')
                        .setDescription('Role granted when purchased')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('Remove a SKU from the catalog')
                .addStringOption((option) =>
                    option
                        .setName('sku')
                        .setDescription('Identifier to remove')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(32)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List available shop items')
        )
        .addSubcommand((sub) =>
            sub
                .setName('buy')
                .setDescription('Purchase an item')
                .addStringOption((option) =>
                    option
                        .setName('sku')
                        .setDescription('Identifier to purchase')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(32)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("reactionrole")
        .setDescription("Manage reaction role panels")
        .addSubcommand(subcommand =>
            subcommand
                .setName("create")
                .setDescription("Create a reaction role panel")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Channel where the panel will be posted")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
                .addStringOption(option =>
                    option
                        .setName("pairs")
                        .setDescription("Emoji-role pairs, e.g. 😀 @Role, 😎 @AnotherRole")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("title")
                        .setDescription("Panel title")
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName("description")
                        .setDescription("Panel description")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove a reaction role panel")
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message ID or link to the panel")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("List configured reaction role panels"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setmods")
                .setDescription("Configure which roles may manage reaction roles")
                .addRoleOption(option =>
                    option
                        .setName("role1")
                        .setDescription("Allowed moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role2")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role3")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role4")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role5")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addBooleanOption(option =>
                    option
                        .setName("clear")
                        .setDescription("Clear moderator roles and revert to owner-only control")
                        .setRequired(false)))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("automod")
        .setDescription("Configure Jarvis auto moderation")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Show auto moderation status"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Enable auto moderation with the configured blacklist"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Disable auto moderation"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Add words to the blacklist")
                .addStringOption(option =>
                    option
                        .setName("words")
                        .setDescription("Comma or newline separated words")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove words from the blacklist")
                .addStringOption(option =>
                    option
                        .setName("words")
                        .setDescription("Comma or newline separated words")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("import")
                .setDescription("Import blacklist entries from a text file")
                .addAttachmentOption(option =>
                    option
                        .setName("file")
                        .setDescription("Plain text file with one word or phrase per line")
                        .setRequired(true))
                .addBooleanOption(option =>
                    option
                        .setName("replace")
                        .setDescription("Replace the existing blacklist instead of merging")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("List configured blacklist entries"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("clear")
                .setDescription("Remove all blacklisted entries and disable auto moderation"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setmessage")
                .setDescription("Set the custom message shown when blocking a message")
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Custom response shown to users")
                        .setRequired(true)))
        .addSubcommandGroup(group =>
            group
                .setName("filter")
                .setDescription("Manage additional auto moderation filters")
                .addSubcommand(subcommand =>
                    subcommand
                        .setName("add")
                        .setDescription("Create a separate auto moderation rule with its own keywords")
                        .addStringOption(option =>
                            option
                                .setName("words")
                                .setDescription("Comma or newline separated words for the new filter")
                                .setRequired(true))))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Manage Jarvis server statistics channels")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Show the current server stats configuration"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Create or update server stats channels"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("refresh")
                .setDescription("Refresh the server stats counts immediately"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("report")
                .setDescription("Generate a snapshot report with charts")
                .addBooleanOption(option =>
                    option
                        .setName("public")
                        .setDescription("Post the report in the channel instead of privately")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Remove the server stats channels"))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("memberlog")
        .setDescription("Configure Jarvis join and leave announcements")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("View the current join/leave log configuration"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setchannel")
                .setDescription("Choose where Jarvis posts join and leave messages")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Text channel for join/leave reports")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Enable join and leave announcements"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Disable join and leave announcements"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("addvariation")
                .setDescription("Add a custom message variation")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to customize")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message text (supports placeholders like {mention})")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("removevariation")
                .setDescription("Remove a custom variation by its index")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to modify")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addIntegerOption(option =>
                    option
                        .setName("index")
                        .setDescription("Position from the status list to remove")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setcustom")
                .setDescription("Set a single custom message that always sends")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to customize")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message text (supports placeholders like {mention})")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("clearcustom")
                .setDescription("Remove the custom message override")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to reset")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        )))
        .setContexts([InteractionContextType.Guild]),
    ...musicCommandList.map((command) => command.data)
];

const commands = allCommands.filter((builder) => {
    const featureKey = commandFeatureMap.get(builder.name);
    return isFeatureGloballyEnabled(featureKey, true);
});

function buildCommandData() {
    return commands.map((command) => command.toJSON());
}

const serverStatsRefreshJob = cron.schedule('*/10 * * * *', async () => {
    try {
        await discordHandlers.refreshAllServerStats(client);
    } catch (error) {
        console.error('Failed to refresh server stats:', error);
    }
}, { scheduled: false });

async function registerSlashCommands() {
    const commandData = buildCommandData();

    if (!client.application?.id) {
        await client.application?.fetch();
    }

    const registered = await client.application.commands.set(commandData);
    const registeredNames = Array.from(registered.values(), (cmd) => cmd.name);

    console.log(
        `Successfully registered ${registered.size ?? commandData.length} global slash commands: ${registeredNames.join(', ')}`
    );

    const guilds = Array.from(client.guilds.cache.values());
    for (const guild of guilds) {
        try {
            await guild.commands.set([]);
            console.log(`Cleared guild-specific commands for ${guild.name ?? 'Unknown'} (${guild.id})`);
        } catch (error) {
            console.warn(`Failed to clear guild-specific commands for ${guild.id}:`, error);
        }
    }

    return registeredNames;
}

// ------------------------ Uptime Server ------------------------
const app = express();

// Main endpoint - ASCII Animation Page
app.get("/", async (req, res) => {
    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: true,
            pingDatabase: false
        });

        const providerStatus = snapshot.providers;
        const workingProviders = providerStatus.filter(p => !p.hasError && !p.isDisabled).length;
        const uptimeSeconds = Math.floor(snapshot.system.uptimeSeconds);
        const memory = snapshot.system.memory;
        const envRequiredCount = snapshot.env.required.filter(item => item.present).length;
        const envRequiredTotal = snapshot.env.required.length;
        const optionalConfigured = snapshot.env.optionalConfigured;
        const optionalTotal = snapshot.env.optionalTotal;
        const missingRequired = snapshot.env.required.filter(item => !item.present).map(item => item.name);
        const optionalEnabled = snapshot.env.optional.filter(item => item.present).map(item => item.name);
        const databaseStatus = snapshot.database;

        const providerList = providerStatus.map(provider => {
            const uptimePercent = provider.metrics.successRate != null
                ? `${(provider.metrics.successRate * 100).toFixed(1)}%`
                : 'n/a';
            const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                ? `${Math.round(provider.metrics.avgLatencyMs)}ms`
                : 'n/a';
            let statusClass = 'online';
            let statusLabel = '✅ OK';

            if (provider.isDisabled) {
                statusClass = 'offline';
                statusLabel = '⛔ Paused';
            } else if (provider.hasError) {
                statusClass = 'warning';
                statusLabel = '⚠️ Error';
            }

            const disabledInfo = provider.isDisabled && provider.disabledUntil
                ? ` • resumes ${new Date(provider.disabledUntil).toLocaleString()}`
                : '';

            return `
                        <div class="provider-item">
                            <div>
                                <div class="provider-name">${provider.name}</div>
                                <div class="provider-meta">Uptime ${uptimePercent} • Latency ${latency}${disabledInfo}</div>
                            </div>
                            <span class="provider-status ${statusClass}">${statusLabel}</span>
                        </div>`;
        }).join('') || '<div class="provider-item"><span class="provider-name">No providers configured</span></div>';

        const envSummaryLines = [
            `Required: ${envRequiredCount}/${envRequiredTotal}`,
            missingRequired.length ? `Missing: ${missingRequired.join(', ')}` : 'Missing: None',
            `Optional: ${optionalConfigured}/${optionalTotal}`,
            `Enabled: ${optionalEnabled.length}`,
            ...optionalEnabled.map((name) => `- ${name}`)
        ].join('\\n');

        const dbLines = [
            `Connected: ${databaseStatus.connected ? '✅ Yes' : '❌ No'}`,
            `Ping: ${databaseStatus.ping}`,
            databaseStatus.error ? `Last error: ${databaseStatus.error}` : null
        ].filter(Boolean).join('\n');

        const uptimeText = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
        const memoryText = `${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis++ - AI Assistant</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: #000;
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
            overflow-x: auto;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .ascii-art {
            white-space: pre;
            text-align: center;
            margin: 20px 0;
            color: #00ffff;
            text-shadow: 0 0 10px #00ffff;
        }
        
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        
        .status-card {
            background: rgba(0, 255, 0, 0.1);
            border: 1px solid #00ff00;
            border-radius: 5px;
            padding: 15px;
            font-family: 'Courier New', monospace;
        }
        
        .status-card h3 {
            color: #00ffff;
            margin-bottom: 10px;
            text-align: center;
        }
        
        .provider-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .provider-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2px 0;
            border-bottom: 1px solid rgba(0, 255, 0, 0.2);
        }
        
        .provider-name {
            color: #ffffff;
        }
        
        .provider-meta {
            font-size: 12px;
            color: #66ff66;
        }
        
        .provider-status {
            font-weight: bold;
        }
        
        .online { color: #00ff00; }
        .offline { color: #ff0000; }
        .warning { color: #ffff00; }
        
        .pulse {
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .glitch {
            animation: glitch 3s infinite;
        }
        
        @keyframes glitch {
            0% { transform: translate(0); }
            20% { transform: translate(-2px, 2px); }
            40% { transform: translate(-2px, -2px); }
            60% { transform: translate(2px, 2px); }
            80% { transform: translate(2px, -2px); }
            100% { transform: translate(0); }
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }
        
        .refresh-btn {
            background: #00ff00;
            color: #000;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            margin: 20px auto;
            display: block;
        }
        
        .refresh-btn:hover {
            background: #00ffff;
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="ascii-art glitch">
         ██╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗
         ██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝
         ██║███████║██████╔╝██║   ██║██║███████╗
         ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
    ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
        </div>
        
        <div class="ascii-art pulse">
    ╔══════════════════════════════════════════════════════════════╗
    ║                    SYSTEM STATUS: ONLINE                    ║
    ║                  Always at your service, sir.               ║
    ╚══════════════════════════════════════════════════════════════╝
        </div>
        
        <div class="status-grid">
            <div class="status-card">
                <h3>🤖 AI PROVIDERS</h3>
                <div class="provider-list">
                    ${providerList}
                </div>
                <div style="margin-top: 10px; text-align: center;">
                    <strong>${workingProviders}/${providerStatus.length} Active</strong>
                </div>
            </div>

            <div class="status-card">
                <h3>🧪 ENVIRONMENT</h3>
                <div style="white-space: pre;">
${envSummaryLines}
                </div>
            </div>
            
            <div class="status-card">
                <h3>💾 SYSTEM INFO</h3>
                <div style="white-space: pre;">
Database:
${dbLines}
Uptime: ${uptimeText}
Memory: ${memoryText}
                </div>
            </div>
        </div>
        
        <div class="ascii-art">
    ╔══════════════════════════════════════════════════════════════╗
    ║  🔗 Health Check: /health                                   ║
    ║  🎯 Discord Bot: Active                                     ║
    ╚══════════════════════════════════════════════════════════════╝
        </div>
        
        <button class="refresh-btn" onclick="location.reload()">
            🔄 REFRESH STATUS
        </button>
        <button class="refresh-btn" onclick="location.href='/dashboard'">
            📊 OPEN DASHBOARD
        </button>
        
        <div class="footer">
            <div class="ascii-art">
    ═══════════════════════════════════════════════════════════════
    Powered by Advanced AI • Neural Networks • Quantum Processing
    ═══════════════════════════════════════════════════════════════
            </div>
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => {
            location.reload();
        }, 30000);
        
        // Add some terminal-like effects
        document.addEventListener('DOMContentLoaded', function() {
            const cards = document.querySelectorAll('.status-card');
            cards.forEach((card, index) => {
                setTimeout(() => {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    card.style.transition = 'all 0.5s ease';
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, 100);
                }, index * 200);
            });
        });
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('Failed to render status page:', error);
        res.status(500).send('Jarvis uplink is initializing. Please try again shortly.');
    }
});

app.get("/dashboard", async (req, res) => {
    const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: false,
            pingDatabase: deep,
            attemptReconnect: deep
        });

        const providerRows = snapshot.providers.map((provider, index) => {
            const uptimePercent = provider.metrics.successRate != null
                ? `${provider.metrics.successRate.toFixed(1)}%`
                : 'n/a';
            const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                ? `${Math.round(provider.metrics.avgLatencyMs)} ms`
                : 'n/a';
            const totalCalls = provider.metrics.total ?? (provider.metrics.successes + provider.metrics.failures);
            const status = provider.isDisabled
                ? 'Paused'
                : provider.hasError
                    ? 'Error'
                    : 'Healthy';
            const disabledUntil = provider.isDisabled && provider.disabledUntil
                ? new Date(provider.disabledUntil).toLocaleString()
                : '-';

            return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${provider.name}</td>
                        <td>${provider.model}</td>
                        <td>${provider.costTier}</td>
                        <td class="${status.toLowerCase()}">${status}</td>
                        <td>${uptimePercent}</td>
                        <td>${latency}</td>
                        <td>${totalCalls}</td>
                        <td>${disabledUntil}</td>
                    </tr>`;
        }).join('') || '<tr><td colspan="9">No providers configured</td></tr>';

        const requiredRows = snapshot.env.required.map((item) => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'error'}">${item.present ? 'Present' : 'Missing'}</td>
                    </tr>
        `).join('');

        const optionalRows = snapshot.env.optional.map((item) => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'paused'}">${item.present ? 'Configured' : 'Not set'}</td>
                    </tr>
        `).join('');

        const healthyProviders = snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis Dashboard</title>
    <style>
        body {
            background: #0a0a0a;
            color: #e0e0e0;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
        }
        h1 {
            color: #00ffff;
            text-align: center;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: rgba(0, 255, 255, 0.04);
            border: 1px solid rgba(0, 255, 255, 0.2);
            border-radius: 8px;
            padding: 16px;
        }
        .card h2 {
            margin-top: 0;
            color: #00ffff;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: rgba(255, 255, 255, 0.03);
        }
        th, td {
            padding: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            text-align: left;
        }
        th {
            background: rgba(0, 255, 255, 0.1);
        }
        .healthy {
            color: #00ff7f;
        }
        .error {
            color: #ff6b6b;
        }
        .paused {
            color: #ffd166;
        }
        .actions {
            margin-top: 20px;
            text-align: center;
        }
        .actions a {
            color: #00ffff;
            text-decoration: none;
            margin: 0 10px;
        }
    </style>
</head>
<body>
    <h1>Jarvis Operations Dashboard</h1>

    <div class="grid">
        <div class="card">
            <h2>System</h2>
            <p>Uptime: ${Math.round(snapshot.system.uptimeSeconds / 60)} minutes</p>
            <p>Node: ${snapshot.system.nodeVersion}</p>
            <p>Memory: ${Math.round(snapshot.system.memory.heapUsed / 1024 / 1024)}MB used</p>
            <p>Timestamp: ${snapshot.system.timestamp}</p>
        </div>
        <div class="card">
            <h2>Database</h2>
            <p>Status: ${snapshot.database.connected ? '<span class="healthy">Connected</span>' : '<span class="error">Disconnected</span>'}</p>
            <p>Ping: ${snapshot.database.ping}</p>
            ${snapshot.database.error ? `<p>Error: ${snapshot.database.error}</p>` : ''}
        </div>
        <div class="card">
            <h2>Providers</h2>
            <p>Total: ${snapshot.providers.length}</p>
            <p>Healthy: ${healthyProviders}</p>
            <p>Mode: free tiers prioritized</p>
        </div>
    </div>

    <h2>AI Providers</h2>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Name</th>
                <th>Model</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Uptime</th>
                <th>Latency</th>
                <th>Calls</th>
                <th>Disabled Until</th>
            </tr>
        </thead>
        <tbody>
            ${providerRows}
        </tbody>
    </table>

    <div class="grid">
        <div class="card">
            <h2>Required Environment</h2>
            <table>
                <tbody>
                    ${requiredRows}
                </tbody>
            </table>
        </div>
        <div class="card">
            <h2>Optional Environment</h2>
            <table>
                <tbody>
                    ${optionalRows}
                </tbody>
            </table>
        </div>
    </div>

    <div class="actions">
        <a href="/">Back to Status Page</a> •
        <a href="/health${deep ? '' : '?deep=1'}">JSON Health Check${deep ? '' : ' (deep)'}</a>
    </div>
</body>
</html>
        `);
    } catch (error) {
        console.error('Failed to render dashboard:', error);
        res.status(500).send('Dashboard unavailable while diagnostics recalibrate.');
    }
});

// Health check endpoint (for monitoring)
app.get("/health", async (req, res) => {
    const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: false,
            pingDatabase: deep,
            attemptReconnect: deep
        });

        const healthyProviders = snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length;
        const status =
            snapshot.env.hasAllRequired && snapshot.database.connected && healthyProviders > 0
                ? 'ok'
                : 'degraded';

        res.json({
            status,
            env: snapshot.env,
            database: snapshot.database,
            providers: snapshot.providers,
            system: snapshot.system,
            counts: {
                providersTotal: snapshot.providers.length,
                providersHealthy: healthyProviders
            }
        });
    } catch (error) {
        console.error('Health endpoint failed:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// ------------------------ Event Handlers ------------------------
client.once("ready", async () => {
    console.log(`Jarvis++ online. Logged in as ${client.user.tag}`);
    client.user.setActivity("over the digital realm", { type: "WATCHING" });

    let databaseConnected = false;

    try {
        await database.connect();
        databaseConnected = true;
    } catch (error) {
        console.error("Failed to connect to MongoDB on startup:", error);
    }

    try {
        await registerSlashCommands();
    } catch (error) {
        console.error("Failed to register slash commands on startup:", error);
    }

    if (databaseConnected) {
        serverStatsRefreshJob.start();
        try {
            await discordHandlers.refreshAllServerStats(client);
        } catch (error) {
            console.error("Failed to refresh server stats on startup:", error);
        }
    } else {
        console.warn("Skipping server stats initialization because the database connection was not established.");
    }

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("guildCreate", async (guild) => {
    console.log(`Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`);

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("messageCreate", async (message) => {
    await discordHandlers.handleMessage(message, client);
});

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await discordHandlers.handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
            await discordHandlers.handleComponentInteraction(interaction);
        }
    } catch (error) {
        console.error('Interaction handler error:', error);
        if (typeof interaction.isRepliable === 'function' && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Technical difficulties, sir.', ephemeral: true }).catch(() => {});
        }
    }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    await discordHandlers.handleVoiceStateUpdate(oldState, newState);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    await discordHandlers.handleVoiceStateUpdate(oldState, newState);
});

client.on("messageReactionAdd", async (reaction, user) => {
    await discordHandlers.handleReactionAdd(reaction, user);
});

client.on("messageReactionRemove", async (reaction, user) => {
    await discordHandlers.handleReactionRemove(reaction, user);
});

client.on("messageDelete", async (message) => {
    await discordHandlers.handleTrackedMessageDelete(message);
});

client.on("guildMemberAdd", async (member) => {
    await discordHandlers.handleGuildMemberAdd(member);
});

client.on("guildMemberRemove", async (member) => {
    await discordHandlers.handleGuildMemberRemove(member);
});

// ------------------------ Cleanup Tasks ------------------------
// Clean up old data periodically
cron.schedule('0 2 * * *', () => {
    console.log('Running daily cleanup...');
    aiManager.cleanupOldMetrics();
    discordHandlers.cleanupCooldowns();
});

// ------------------------ Error Handling ------------------------
client.on("error", (err) => {
    console.error("Discord client error:", err);
    // Don't exit on Discord errors, just log them
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled promise rejection:", err);
    // Log but don't exit - let the bot continue running
});

process.on("SIGTERM", async () => {
    console.log("Jarvis is powering down...");
    try {
        serverStatsRefreshJob.stop();
        await database.disconnect();
        client.destroy();
    } catch (error) {
        console.error("Error during shutdown:", error);
    }
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("Jarvis received SIGINT, shutting down gracefully...");
    try {
        serverStatsRefreshJob.stop();
        await database.disconnect();
        client.destroy();
    } catch (error) {
        console.error("Error during shutdown:", error);
    }
    process.exit(0);
});

// ------------------------ Boot ------------------------
async function startBot() {
    try {
        // Start uptime server
        app.listen(config.server.port, '0.0.0.0', () => {
            console.log(`Uptime server listening on port ${config.server.port}`);
        });

        // Start Discord bot
        await client.login(config.discord.token);
        console.log(`✅ Logged in as ${client.user.tag}`);
    } catch (error) {
        console.error("Failed to start bot:", error);
        process.exit(1);
    }
}

// Start the bot
startBot();
