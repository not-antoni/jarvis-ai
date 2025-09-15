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

// Health check endpoint for Render
app.get("/", (req, res) => {
    res.json({
        status: "online",
        message: "Jarvis++ online, sir. Quite right.",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Health check endpoint
app.get("/health", (req, res) => {
    const providerStatus = aiManager.getProviderStatus();
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
        app.listen(config.server.port, () => {
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
