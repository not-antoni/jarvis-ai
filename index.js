/**
 * Jarvis Discord Bot - Main Entry Point
 * Refactored for better organization and maintainability
 */

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, InteractionContextType } = require("discord.js");
const express = require("express");
const cron = require("node-cron");

// Import our modules
const config = require('./config');
const database = require('./database');
const aiManager = require('./ai-providers');
const discordHandlers = require('./discord-handlers');

// Import new feature modules
const imageGeneration = require('./image-generation');
const ttsService = require('./tts-service');
const realtimeData = require('./realtime-data');
const productivityTools = require('./productivity-tools');
const serverManagement = require('./server-management');
const entertainmentGames = require('./entertainment-games');

// ------------------------ Discord Client Setup ------------------------
const client = new Client({
    intents: config.discord.intents.map(intent => GatewayIntentBits[intent])
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
        .setName("clip")
        .setDescription("Clip a message into an image")
        .addStringOption((option) =>
            option
                .setName("message_id")
                .setDescription("ID of the message to clip")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Image Generation Commands
    new SlashCommandBuilder()
        .setName("generate")
        .setDescription("Generate an AI image")
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Description of the image to generate")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("width")
                .setDescription("Image width (default: 512)")
                .setRequired(false)
                .addChoices(
                    { name: "256px", value: 256 },
                    { name: "512px", value: 512 },
                    { name: "768px", value: 768 }
                ),
        )
        .addIntegerOption((option) =>
            option
                .setName("height")
                .setDescription("Image height (default: 512)")
                .setRequired(false)
                .addChoices(
                    { name: "256px", value: 256 },
                    { name: "512px", value: 512 },
                    { name: "768px", value: 768 }
                ),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // TTS Commands
    new SlashCommandBuilder()
        .setName("speak")
        .setDescription("Convert text to speech")
        .addStringOption((option) =>
            option
                .setName("text")
                .setDescription("Text to convert to speech")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("voice")
                .setDescription("Voice to use")
                .setRequired(false)
                .addChoices(
                    { name: "Jarvis (Male)", value: 0 },
                    { name: "Assistant (Female)", value: 1 },
                    { name: "British (Male)", value: 2 },
                    { name: "British (Female)", value: 3 },
                    { name: "Australian (Male)", value: 4 }
                ),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Weather Command
    new SlashCommandBuilder()
        .setName("weather")
        .setDescription("Get current weather information")
        .addStringOption((option) =>
            option
                .setName("location")
                .setDescription("City, state, or country")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("unit")
                .setDescription("Temperature unit")
                .setRequired(false)
                .addChoices(
                    { name: "Fahrenheit", value: "F" },
                    { name: "Celsius", value: "C" }
                ),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Stock Command
    new SlashCommandBuilder()
        .setName("stock")
        .setDescription("Get stock market information")
        .addStringOption((option) =>
            option
                .setName("symbol")
                .setDescription("Stock symbol (e.g., AAPL, GOOGL)")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Crypto Command
    new SlashCommandBuilder()
        .setName("crypto")
        .setDescription("Get cryptocurrency prices")
        .addStringOption((option) =>
            option
                .setName("symbol")
                .setDescription("Crypto symbol (e.g., BTC, ETH)")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // News Command
    new SlashCommandBuilder()
        .setName("news")
        .setDescription("Get latest news")
        .addStringOption((option) =>
            option
                .setName("topic")
                .setDescription("News topic")
                .setRequired(false)
                .addChoices(
                    { name: "Technology", value: "technology" },
                    { name: "Business", value: "business" },
                    { name: "Science", value: "science" },
                    { name: "Sports", value: "sports" },
                    { name: "Entertainment", value: "entertainment" }
                ),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Task Management Commands
    new SlashCommandBuilder()
        .setName("task")
        .setDescription("Manage your tasks")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Task action")
                .setRequired(true)
                .addChoices(
                    { name: "Create", value: "create" },
                    { name: "List", value: "list" },
                    { name: "Complete", value: "complete" },
                    { name: "Delete", value: "delete" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("title")
                .setDescription("Task title")
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("description")
                .setDescription("Task description")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Calendar Command
    new SlashCommandBuilder()
        .setName("calendar")
        .setDescription("Manage your calendar")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Calendar action")
                .setRequired(true)
                .addChoices(
                    { name: "Create Event", value: "create" },
                    { name: "List Events", value: "list" },
                    { name: "Upcoming", value: "upcoming" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("title")
                .setDescription("Event title")
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("start")
                .setDescription("Start time (YYYY-MM-DD HH:MM)")
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("end")
                .setDescription("End time (YYYY-MM-DD HH:MM)")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Email Command
    new SlashCommandBuilder()
        .setName("email")
        .setDescription("Send an email")
        .addStringOption((option) =>
            option
                .setName("to")
                .setDescription("Recipient email address")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("subject")
                .setDescription("Email subject")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("message")
                .setDescription("Email message")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Trivia Command
    new SlashCommandBuilder()
        .setName("trivia")
        .setDescription("Start a trivia game")
        .addStringOption((option) =>
            option
                .setName("category")
                .setDescription("Trivia category")
                .setRequired(false)
                .addChoices(
                    { name: "General", value: "general" },
                    { name: "Technology", value: "technology" },
                    { name: "Science", value: "science" },
                    { name: "Geography", value: "geography" },
                    { name: "Programming", value: "programming" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("difficulty")
                .setDescription("Question difficulty")
                .setRequired(false)
                .addChoices(
                    { name: "Easy", value: "easy" },
                    { name: "Medium", value: "medium" },
                    { name: "Hard", value: "hard" }
                ),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Poll Command
    new SlashCommandBuilder()
        .setName("poll")
        .setDescription("Create a poll")
        .addStringOption((option) =>
            option
                .setName("question")
                .setDescription("Poll question")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("options")
                .setDescription("Poll options separated by commas")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("duration")
                .setDescription("Poll duration in minutes")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Meme Command
    new SlashCommandBuilder()
        .setName("meme")
        .setDescription("Generate a meme")
        .addStringOption((option) =>
            option
                .setName("template")
                .setDescription("Meme template")
                .setRequired(true)
                .addChoices(
                    { name: "Distracted Boyfriend", value: "distracted-boyfriend" },
                    { name: "Drake Pointing", value: "drake-pointing" },
                    { name: "Two Buttons", value: "two-buttons" },
                    { name: "Expanding Brain", value: "expanding-brain" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("text")
                .setDescription("Text for the meme (separated by commas)")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Story Command
    new SlashCommandBuilder()
        .setName("story")
        .setDescription("Collaborative story generation")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Story action")
                .setRequired(true)
                .addChoices(
                    { name: "Start", value: "start" },
                    { name: "Continue", value: "continue" },
                    { name: "Summary", value: "summary" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Story prompt or continuation")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Server Analytics Command
    new SlashCommandBuilder()
        .setName("analytics")
        .setDescription("Get server analytics")
        .addStringOption((option) =>
            option
                .setName("timeframe")
                .setDescription("Analytics timeframe")
                .setRequired(false)
                .addChoices(
                    { name: "Last Hour", value: "1h" },
                    { name: "Last 24 Hours", value: "24h" },
                    { name: "Last 7 Days", value: "7d" },
                    { name: "Last 30 Days", value: "30d" }
                ),
        )
        .setContexts([InteractionContextType.Guild]),
    
    // Reminder Command
    new SlashCommandBuilder()
        .setName("remind")
        .setDescription("Set a reminder")
        .addStringOption((option) =>
            option
                .setName("message")
                .setDescription("Reminder message")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("minutes")
                .setDescription("Minutes from now")
                .setRequired(false),
        )
        .addIntegerOption((option) =>
            option
                .setName("hours")
                .setDescription("Hours from now")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    
    // Note Command
    new SlashCommandBuilder()
        .setName("note")
        .setDescription("Manage your notes")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Note action")
                .setRequired(true)
                .addChoices(
                    { name: "Create", value: "create" },
                    { name: "List", value: "list" },
                    { name: "Search", value: "search" },
                    { name: "Delete", value: "delete" }
                ),
        )
        .addStringOption((option) =>
            option
                .setName("title")
                .setDescription("Note title")
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("content")
                .setDescription("Note content")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
];

const rest = new REST({ version: "10" }).setToken(config.discord.token);

async function registerSlashCommands() {
    try {
        console.log("Fetching existing global commands...");
        const existingCommands = await rest.get(Routes.applicationCommands(client.application.id));
        console.log(`Found ${existingCommands.length} existing commands: ${existingCommands.map(c => c.name).join(", ")}`);

        // Create a map of desired commands by name, overwriting duplicates
        const commandsToRegister = [];
        const seenNames = new Set();

        // Preserve non-desired existing commands
        for (const existing of existingCommands) {
            if (!commands.some(cmd => cmd.name === existing.name)) {
                commandsToRegister.push(existing);
                seenNames.add(existing.name);
                console.log(`Preserving existing command: ${existing.name}`);
            }
        }

        // Add/update desired commands
        for (const cmd of commands) {
            const json = cmd.toJSON();
            commandsToRegister.push(json);
            seenNames.add(cmd.name);
            console.log(seenNames.has(cmd.name) ? `Updating command: ${cmd.name}` : `Adding command: ${cmd.name}`);
        }

        console.log(`Registering ${commandsToRegister.length} global slash commands...`);
        await rest.put(Routes.applicationCommands(client.application.id), {
            body: commandsToRegister,
        });
        console.log("Successfully registered global slash commands.");
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

// ------------------------ Cleanup Tasks ------------------------
// Clean up old data periodically
cron.schedule('0 2 * * *', () => {
    console.log('Running daily cleanup...');
    aiManager.cleanupOldMetrics();
    discordHandlers.cleanupCooldowns();
    serverManagement.cleanup();
    entertainmentGames.cleanup();
    realtimeData.clearCache();
    require('./free-apis').clearCache();
    require('./advanced-utils').cleanup();
    require('./marvel-features').cleanup();
    require('./interactive-games').cleanup();
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
