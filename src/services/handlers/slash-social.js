'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const funFeatures = require('../fun-features');

async function handleAatrox(interaction) {
    const gifPath = path.join(process.cwd(), 'aatrox.gif');
    const attachment = new AttachmentBuilder(gifPath, { name: 'aatrox.gif' });
    return { files: [attachment] };
}

async function handleTyperace(interaction) {
    const phrase = funFeatures.getRandomTypingPhrase();
    const embed = new EmbedBuilder()
        .setTitle('\u2328\uFE0F TYPING RACE \u2328\uFE0F')
        .setDescription('First person to type the phrase correctly wins!')
        .setColor(0xf1c40f)
        .addFields({ name: '\uD83D\uDCDD Type this:', value: `\`\`\`${phrase}\`\`\``, inline: false })
        .setFooter({ text: 'GO GO GO!' });

    await interaction.editReply({ embeds: [embed] });

    // Set up collector for the race
    const filter = m => m.content.toLowerCase() === phrase.toLowerCase() && !m.author.bot;
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async(msg) => {
        const winEmbed = new EmbedBuilder()
            .setTitle('\uD83C\uDFC6 WINNER! \uD83C\uDFC6')
            .setDescription(`<@${msg.author.id}> typed it first!`)
            .setColor(0x2ecc71)
            .setFooter({ text: 'Speed demon!' });
        await interaction.channel.send({ embeds: [winEmbed] });
    });

    collector.on('end', (collected) => {
        if (collected.size === 0) {
            interaction.channel.send('\u23F0 Time\'s up! Nobody typed it correctly.').catch(() => {});
        }
    });

    return '__TYPERACE_HANDLED__';
}

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

async function handlePickupline(interaction) {
    const line = funFeatures.getPickupLine();
    return `\uD83D\uDC95 **Pickup Line**\n\n${line}`;
}

async function handleDiceRoll(interaction) {
    const diceNotation = interaction.options.getString('dice') || '1d6';
    const result = funFeatures.rollDice(diceNotation);

    if (!result) {
        return '\u274C Invalid dice notation! Use format like `2d6` or `1d20+5`';
    }

    const embed = new EmbedBuilder()
        .setTitle('\uD83C\uDFB2 Dice Roll')
        .setColor(0x9b59b6)
        .addFields(
            { name: 'Dice', value: result.notation, inline: true },
            { name: 'Rolls', value: result.rolls.join(', '), inline: true },
            { name: 'Total', value: `**${result.total}**`, inline: true }
        );
    return { embeds: [embed] };
}

async function handle8ball(interaction) {
    const question = interaction.options.getString('question');
    const answer = funFeatures.get8BallResponse();
    const embed = new EmbedBuilder()
        .setTitle('\uD83C\uDFB1 Magic 8-Ball')
        .setColor(0x000000)
        .addFields(
            { name: '\u2753 Question', value: question, inline: false },
            { name: '\uD83D\uDD2E Answer', value: answer, inline: false }
        );
    return { embeds: [embed] };
}

module.exports = {
    handleAatrox,
    handleTyperace,
    handleShip,
    handlePickupline,
    handleDiceRoll,
    handle8ball
};
