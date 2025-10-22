/**
 * Jarvis Discord Bot - Main Entry Point
 * Refactored for better organization and maintainability
 */

const { Client, GatewayIntentBits, SlashCommandBuilder, InteractionContextType, ChannelType, Partials } = require("discord.js");
const express = require("express");
const cron = require("node-cron");

// Import our modules
const config = require('./config');
const database = require('./database');
const aiManager = require('./ai-providers');
const discordHandlers = require('./discord-handlers');

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
const commands = [
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Check Jarvis's system status")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("providers")
        .setDescription("List available AI providers")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Delete your conversation history and profile with Jarvis")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
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
];

const serverStatsRefreshJob = cron.schedule('*/10 * * * *', async () => {
    try {
        await discordHandlers.refreshAllServerStats(client);
    } catch (error) {
        console.error('Failed to refresh server stats:', error);
    }
}, { scheduled: false });

async function registerSlashCommands() {
    try {
        const commandData = commands.map(command => command.toJSON());

        if (!client.application?.id) {
            await client.application?.fetch();
        }

        await client.application.commands.set(commandData);
        console.log(`Successfully registered ${commandData.length} global slash commands.`);
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
}

// ------------------------ Uptime Server ------------------------
const app = express();

// Main endpoint - ASCII Animation Page
app.get("/", (req, res) => {
    const providerStatus = aiManager.getRedactedProviderStatus();
    const workingProviders = providerStatus.filter(p => !p.hasError).length;
    const uptime = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    
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
                    ${providerStatus.map(provider => `
                        <div class="provider-item">
                            <span class="provider-name">${provider.name}</span>
                            <span class="provider-status ${provider.hasError ? 'offline' : 'online'}">
                                ${provider.hasError ? '❌ OFFLINE' : '✅ ONLINE'}
                            </span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 10px; text-align: center;">
                    <strong>${workingProviders}/${providerStatus.length} Active</strong>
                </div>
            </div>
            
            <div class="status-card">
                <h3>💾 SYSTEM INFO</h3>
                <div style="white-space: pre;">
Database: ${database.isConnected ? '✅ Connected' : '❌ Disconnected'}
Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s
Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB
Status: <span class="online">OPERATIONAL</span>
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
});

// Health check endpoint (for monitoring)
app.get("/health", (req, res) => {
    const providerStatus = aiManager.getRedactedProviderStatus();
    const workingProviders = providerStatus.filter(p => !p.hasError).length;
    
    res.json({
        status: "healthy",
        database: database.isConnected ? "connected" : "disconnected",
        aiProviders: {
            total: providerStatus.length,
            working: workingProviders,
            status: providerStatus
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// ------------------------ Event Handlers ------------------------
client.once("ready", async () => {
    console.log(`Jarvis++ online. Logged in as ${client.user.tag}`);

    try {
        await database.connect();
        client.user.setActivity("over the digital realm", { type: "WATCHING" });
        await registerSlashCommands();
        serverStatsRefreshJob.start();
        await discordHandlers.refreshAllServerStats(client);
        console.log("Provider status on startup:", aiManager.getProviderStatus());
    } catch (error) {
        console.error("Failed to initialize:", error);
    }
});

client.on("messageCreate", async (message) => {
    await discordHandlers.handleMessage(message, client);
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;
    await discordHandlers.handleSlashCommand(interaction);
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
