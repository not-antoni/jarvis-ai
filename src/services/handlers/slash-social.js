'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const funFeatures = require('../fun-features');
const selfhostFeatures = require('../selfhost-features');

async function handleSoul(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
        const soulStatus = selfhostFeatures.jarvisSoul.getStatus();
        const traits = soulStatus?.traits && typeof soulStatus.traits === 'object' ? soulStatus.traits : {};

        const traitLines = Object.entries(traits)
            .map(([trait, valueRaw]) => {
                const value = Math.max(0, Math.min(100, Number(valueRaw) || 0));
                const blocks = Math.round(value / 10);
                const bar = '\u2588'.repeat(blocks) + '\u2591'.repeat(Math.max(0, 10 - blocks));
                return `**${trait}**: ${bar} ${value}%`;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('\uD83E\uDDE0 Jarvis Soul Status')
            .setDescription(`**Mood:** ${soulStatus.mood || 'neutral'}\n**Age:** ${soulStatus.age || 'unknown'}`)
            .setColor(0x9b59b6)
            .addFields(
                { name: 'Personality Traits', value: traitLines || 'No traits found', inline: false },
                { name: 'Total Memories', value: String(soulStatus.totalMemories || 0), inline: true },
                { name: 'Evolutions', value: String(soulStatus.evolutions || 0), inline: true }
            )
            .setFooter({ text: 'Jarvis Soul System' })
            .setTimestamp();
        return { embeds: [embed] };
    } else if (subcommand === 'evolve') {
        const stimulus = interaction.options.getString('stimulus') || 'curiosity';
        const context = interaction.options.getString('context') || 'neutral';
        selfhostFeatures.jarvisSoul.evolve(stimulus, context);
        const newStatus = selfhostFeatures.jarvisSoul.getStatus();
        return `\uD83E\uDDE0 Soul evolved with stimulus: **${stimulus}** (context: ${context})\nNew mood: **${newStatus.mood}** | Evolutions: **${newStatus.evolutions}**`;
    } else if (subcommand === 'memory') {
        const memories = selfhostFeatures.jarvisSoul.getMemories?.() || [];
        if (!memories.length) return 'No soul memories recorded yet.';
        const display = memories.slice(-10).map((m, i) => `${i + 1}. [${m.type || 'general'}] ${m.content?.substring(0, 80) || 'empty'}`).join('\n');
        return `\uD83E\uDDE0 **Recent Soul Memories** (last ${Math.min(memories.length, 10)}):\n\`\`\`\n${display}\n\`\`\``;
    }
    return 'Unknown soul subcommand.';
}

async function handleAatrox(interaction) {
    const gifPath = path.join(process.cwd(), 'aatrox.gif');
    const attachment = new AttachmentBuilder(gifPath, { name: 'aatrox.gif' });
    return { files: [attachment] };
}

async function handleRoast(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const result = funFeatures.getRoastOrCompliment();
    const emoji = result.isRoast ? '\uD83D\uDD25' : '\uD83D\uDC9A';
    const title = result.isRoast ? 'ROASTED' : 'BLESSED';
    return `${emoji} **${title}** ${emoji}\n<@${target.id}>, ${result.text}`;
}

async function handleWiki(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const wiki = funFeatures.generateWikiEntry(target.displayName || target.username);
    const embed = new EmbedBuilder()
        .setTitle(wiki.title)
        .setDescription(wiki.description)
        .setColor(0x3498db)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setFooter({ text: wiki.footer });
    wiki.fields.forEach(f => embed.addFields(f));
    return { embeds: [embed] };
}

async function handleVibecheck(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const vibe = funFeatures.generateVibeCheck(target.displayName || target.username);
    const statsText = Object.entries(vibe.stats)
        .map(([stat, val]) => `**${stat}**: ${val}%`)
        .join('\n');
    const embed = new EmbedBuilder()
        .setTitle(`${vibe.emoji} Vibe Check: ${vibe.rating}`)
        .setDescription(`**${target.displayName || target.username}**\n${vibe.description}`)
        .setColor(vibe.overallScore > 50 ? 0x2ecc71 : 0xe74c3c)
        .addFields(
            { name: '\uD83D\uDCCA Overall Vibe Score', value: `${vibe.overallScore}/100`, inline: false },
            { name: '\uD83D\uDCC8 Detailed Stats', value: statsText, inline: false }
        )
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setFooter({ text: 'Vibe Check\u2122 - Results may vary' });
    return { embeds: [embed] };
}

async function handleWyr(interaction) {
    const wyr = funFeatures.getWouldYouRather();
    const embed = new EmbedBuilder()
        .setTitle('\uD83E\uDD14 Would You Rather...?')
        .setColor(0x9b59b6)
        .addFields(
            { name: '\uD83C\uDD70\uFE0F Option A', value: wyr.a, inline: false },
            { name: '\uD83C\uDD71\uFE0F Option B', value: wyr.b, inline: false }
        )
        .setFooter({ text: 'React with \uD83C\uDD70\uFE0F or \uD83C\uDD71\uFE0F to vote!' });
    return { embeds: [embed] };
}

async function handleProphecy(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const prophecy = funFeatures.generateProphecy(target.displayName || target.username);
    return `\uD83D\uDD2E **THE PROPHECY** \uD83D\uDD2E\n\n${prophecy}`;
}

async function handleTrial(interaction) {
    const target = interaction.options.getUser('user');
    if (!target) {
        return 'You must specify someone to put on trial! \uD83D\uDC68\u200D\u2696\uFE0F';
    }
    const crime = funFeatures.getFakeCrime();
    const isGuilty = Math.random() < 0.5;
    const verdict = funFeatures.getVerdict(isGuilty);
    const embed = new EmbedBuilder()
        .setTitle('\u2696\uFE0F MOCK TRIAL \u2696\uFE0F')
        .setDescription(`**Defendant:** <@${target.id}>`)
        .setColor(isGuilty ? 0xe74c3c : 0x2ecc71)
        .addFields(
            { name: '\uD83D\uDCCB Charges', value: crime, inline: false },
            { name: '\uD83D\uDD28 Verdict', value: verdict, inline: false }
        )
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setFooter({ text: 'The court of JARVIS has spoken.' });
    return { embeds: [embed] };
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

    collector.on('collect', async (msg) => {
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

async function handleRps(interaction) {
    const opponent = interaction.options.getUser('opponent');
    const choices = ['\uD83E\uDEA8 Rock', '\uD83D\uDCC4 Paper', '\u2702\uFE0F Scissors'];
    const userChoice = choices[Math.floor(Math.random() * 3)];
    const opponentChoice = choices[Math.floor(Math.random() * 3)];

    // Determine winner
    let result;
    if (userChoice === opponentChoice) {
        result = "It's a tie! \uD83E\uDD1D";
    } else if (
        (userChoice.includes('Rock') && opponentChoice.includes('Scissors')) ||
        (userChoice.includes('Paper') && opponentChoice.includes('Rock')) ||
        (userChoice.includes('Scissors') && opponentChoice.includes('Paper'))
    ) {
        result = `**${interaction.user.username}** wins! \uD83C\uDFC6`;
    } else {
        result = opponent ? `**${opponent.username}** wins! \uD83C\uDFC6` : '**JARVIS** wins! \uD83E\uDD16';
    }

    const embed = new EmbedBuilder()
        .setTitle('\uD83C\uDFAE Rock Paper Scissors!')
        .setColor(0x3498db)
        .addFields(
            { name: interaction.user.username, value: userChoice, inline: true },
            { name: 'VS', value: '\u2694\uFE0F', inline: true },
            { name: opponent ? opponent.username : 'JARVIS', value: opponentChoice, inline: true }
        )
        .setDescription(result);
    return { embeds: [embed] };
}

async function handleSocial(interaction) {
    const socialSubcommand = interaction.options.getSubcommand();
    let response;

    switch (socialSubcommand) {
        case 'ship': {
            const person1 = interaction.options.getUser('person1');
            const person2 = interaction.options.getUser('person2') || interaction.user;
            let compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
            const herId = process.env.SHIP_EASTER_EGG_1 || '';
            const himId = process.env.SHIP_EASTER_EGG_2 || '';
            if (interaction.user.id === herId) {
                const isTheShip = (person1.id === herId && person2.id === himId) ||
                                  (person1.id === himId && person2.id === herId);
                if (isTheShip) compatibility = 101;
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
            response = { embeds: [embed] };
            break;
        }
        case 'howgay': {
            const target = interaction.options.getUser('user') || interaction.user;
            const percentage = funFeatures.randomInt(0, 100);
            const bar = '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08'.repeat(Math.floor(percentage / 10)) + '\u2B1C'.repeat(10 - Math.floor(percentage / 10));
            response = `\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08 **${target.username}** is **${percentage}%** gay\n${bar}`;
            break;
        }
        case 'howbased': {
            const target = interaction.options.getUser('user') || interaction.user;
            const percentage = funFeatures.randomInt(0, 100);
            const bar = '\uD83D\uDDFF'.repeat(Math.floor(percentage / 10)) + '\u2B1C'.repeat(10 - Math.floor(percentage / 10));
            response = `\uD83D\uDDFF **${target.username}** is **${percentage}%** based\n${bar}`;
            break;
        }
        case 'pickupline': {
            const line = funFeatures.getPickupLine();
            response = `\uD83D\uDC95 **Pickup Line**\n\n${line}`;
            break;
        }
        case 'dadjoke': {
            const joke = funFeatures.getDadJoke();
            response = `\uD83D\uDC68 **Dad Joke**\n\n${joke}`;
            break;
        }
        case 'fight': {
            const opponent = interaction.options.getUser('opponent');
            if (!opponent) {
                response = 'You need to specify someone to fight! \uD83D\uDC4A';
                break;
            }
            if (opponent.id === interaction.user.id) {
                response = 'You can\'t fight yourself! ...or can you? \uD83E\uDD14';
                break;
            }
            const fight = funFeatures.generateFight(
                interaction.user.username,
                opponent.username
            );
            const embed = new EmbedBuilder()
                .setTitle('\u2694\uFE0F FIGHT! \u2694\uFE0F')
                .setColor(0xe74c3c)
                .setDescription(fight.moves.join('\n\n'))
                .addFields(
                    { name: `${interaction.user.username} HP`, value: `${fight.attackerHP}/100`, inline: true },
                    { name: `${opponent.username} HP`, value: `${fight.defenderHP}/100`, inline: true }
                )
                .setFooter({ text: `\uD83C\uDFC6 Winner: ${fight.winner}` });
            response = { embeds: [embed] };
            break;
        }
        case 'hug': {
            const target = interaction.options.getUser('user');
            if (!target) {
                response = 'You need to specify someone to hug! \uD83E\uDD17';
                break;
            }
            const gif = funFeatures.getHugGif();
            const embed = new EmbedBuilder()
                .setDescription(`**${interaction.user.username}** hugs **${target.username}**! \uD83E\uDD17`)
                .setColor(0xff69b4)
                .setImage(gif);
            response = { embeds: [embed] };
            break;
        }
        case 'slap': {
            const target = interaction.options.getUser('user');
            if (!target) {
                response = 'You need to specify someone to slap! \uD83D\uDC4B';
                break;
            }
            const gif = funFeatures.getSlapGif();
            const embed = new EmbedBuilder()
                .setDescription(`**${interaction.user.username}** slaps **${target.username}**! \uD83D\uDC4B`)
                .setColor(0xe74c3c)
                .setImage(gif);
            response = { embeds: [embed] };
            break;
        }
        default:
            response = '\u274C Unknown social subcommand.';
    }
    return response;
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
        if (isTheShip) compatibility = 101;
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

async function handleHowgay(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const percentage = funFeatures.randomInt(0, 100);
    const bar = '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08'.repeat(Math.floor(percentage / 10)) + '\u2B1C'.repeat(10 - Math.floor(percentage / 10));
    return `\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08 **${target.username}** is **${percentage}%** gay\n${bar}`;
}

async function handleHowbased(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const percentage = funFeatures.randomInt(0, 100);
    const bar = '\uD83D\uDDFF'.repeat(Math.floor(percentage / 10)) + '\u2B1C'.repeat(10 - Math.floor(percentage / 10));
    return `\uD83D\uDDFF **${target.username}** is **${percentage}%** based\n${bar}`;
}

async function handlePickupline(interaction) {
    const line = funFeatures.getPickupLine();
    return `\uD83D\uDC95 **Pickup Line**\n\n${line}`;
}

async function handleDadjoke(interaction) {
    const joke = funFeatures.getDadJoke();
    return `\uD83D\uDC68 **Dad Joke**\n\n${joke}`;
}

async function handleFight(interaction) {
    const opponent = interaction.options.getUser('opponent');
    if (!opponent) {
        return 'You need to specify someone to fight! \uD83D\uDC4A';
    }
    if (opponent.id === interaction.user.id) {
        return 'You can\'t fight yourself! ...or can you? \uD83E\uDD14';
    }

    const fight = funFeatures.generateFight(
        interaction.user.username,
        opponent.username
    );

    const embed = new EmbedBuilder()
        .setTitle('\u2694\uFE0F FIGHT! \u2694\uFE0F')
        .setColor(0xe74c3c)
        .setDescription(fight.moves.join('\n\n'))
        .addFields(
            { name: `${interaction.user.username} HP`, value: `${fight.attackerHP}/100`, inline: true },
            { name: `${opponent.username} HP`, value: `${fight.defenderHP}/100`, inline: true }
        )
        .setFooter({ text: `\uD83C\uDFC6 Winner: ${fight.winner}` });
    return { embeds: [embed] };
}

async function handleHug(interaction) {
    const target = interaction.options.getUser('user');
    if (!target) {
        return 'You need to specify someone to hug! \uD83E\uDD17';
    }
    const gif = funFeatures.getHugGif();
    const embed = new EmbedBuilder()
        .setDescription(`**${interaction.user.username}** hugs **${target.username}**! \uD83E\uDD17`)
        .setColor(0xff69b4)
        .setImage(gif);
    return { embeds: [embed] };
}

async function handleSlap(interaction) {
    const target = interaction.options.getUser('user');
    if (!target) {
        return 'You need to specify someone to slap! \uD83D\uDC4B';
    }
    const gif = funFeatures.getSlapGif();
    const embed = new EmbedBuilder()
        .setDescription(`**${interaction.user.username}** slaps **${target.username}**! \uD83D\uDC4B`)
        .setColor(0xe74c3c)
        .setImage(gif);
    return { embeds: [embed] };
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

async function handleRate(interaction) {
    const thing = interaction.options.getString('thing');
    const rating = funFeatures.randomInt(0, 10);
    const stars = '\u2B50'.repeat(rating) + '\u2606'.repeat(10 - rating);
    return `\uD83D\uDCCA **Rating for "${thing}":**\n${stars} **${rating}/10**`;
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
    handleSoul,
    handleAatrox,
    handleRoast,
    handleWiki,
    handleVibecheck,
    handleWyr,
    handleProphecy,
    handleTrial,
    handleTyperace,
    handleRps,
    handleSocial,
    handleShip,
    handleHowgay,
    handleHowbased,
    handlePickupline,
    handleDadjoke,
    handleFight,
    handleHug,
    handleSlap,
    handleDiceRoll,
    handleRate,
    handle8ball
};
