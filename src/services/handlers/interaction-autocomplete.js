'use strict';

const { commandMap: musicCommandMap } = require('../../commands/music');
const { commandFeatureMap } = require('../../core/command-registry');
const { isFeatureGloballyEnabled } = require('../../core/feature-flags');

function isCommandEnabled(commandName) {
    const featureKey = commandFeatureMap.get(commandName);
    return isFeatureGloballyEnabled(featureKey);
}

async function handle(handler, interaction) {
    const commandName = interaction.commandName;
    const guild = interaction.guild || null;
    const musicCommand = musicCommandMap.get(commandName);

    if (!musicCommand || typeof musicCommand.autocomplete !== 'function') {
        await interaction.respond([]).catch(() => {});
        return;
    }

    if (!isCommandEnabled(commandName)) {
        await interaction.respond([]).catch(() => {});
        return;
    }

    const featureAllowed = await handler.isCommandFeatureEnabled(commandName, guild);
    if (!featureAllowed) {
        await interaction.respond([]).catch(() => {});
        return;
    }

    try {
        await musicCommand.autocomplete(interaction);
    } catch (error) {
        console.error(`Error handling /${commandName} autocomplete:`, error);
        await interaction.respond([]).catch(() => {});
    }
}

module.exports = {
    handle
};
