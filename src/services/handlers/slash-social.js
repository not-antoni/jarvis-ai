'use strict';

const { EmbedBuilder } = require('discord.js');
const funFeatures = require('../fun-features');

async function handleShip(interaction) {
    const person1 = interaction.options.getUser('person1');
    const person2 = interaction.options.getUser('person2') || interaction.user;

    let compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
    const herId = process.env.SHIP_EASTER_EGG_1 || '';
    const himId = process.env.SHIP_EASTER_EGG_2 || '';
    if (interaction.user.id === herId) {
        const isTheShip = (person1.id === herId && person2.id === himId) ||
                          (person1.id === himId && person2.id === herId);
        if (isTheShip) {compatibility = 101;}
    }
    const shipName = funFeatures.generateShipName(
        person1.displayName || person1.username,
        person2.displayName || person2.username
    );

    let emoji, description;
    if (compatibility >= 90) { emoji = '\uD83D\uDC95'; description = 'SOULMATES! A match made in heaven!'; }
    else if (compatibility >= 70) { emoji = '\u2764\uFE0F'; description = 'Strong connection! Great potential!'; }
    else if (compatibility >= 50) { emoji = '\uD83D\uDC9B'; description = 'Decent vibes. Could work!'; }
    else if (compatibility >= 30) { emoji = '\uD83E\uDDE1'; description = 'It\'s... complicated.'; }
    else { emoji = '\uD83D\uDC94'; description = 'Not meant to be... sorry!'; }

    const embed = new EmbedBuilder()
        .setTitle(`${emoji} Ship: ${shipName}`)
        .setColor(compatibility >= 50 ? 0xe91e63 : 0x95a5a6)
        .addFields(
            { name: 'Compatibility', value: `**${compatibility}%**`, inline: true },
            { name: 'Verdict', value: description, inline: true }
        )
        .setDescription(`**${person1.username}** \uD83D\uDC95 **${person2.username}**`)
        .setFooter({ text: 'Ship Calculator\u2122 - Results are 100% scientifically accurate' });
    return { embeds: [embed] };
}

module.exports = {
    handleShip
};
