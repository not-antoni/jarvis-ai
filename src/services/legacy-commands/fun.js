/**
 * Legacy Fun Commands
 * Extracted from legacy-commands.js and implemented from help descriptions
 */

const { EmbedBuilder } = require('discord.js');
const funFeatures = require('../fun-features');
const terfWiki = require('../terf-wiki');
const selfhostFeatures = require('../selfhost-features');

const funCommands = {
    // ============ RANDOM ============

    // 8ball command
    '8ball': {
        description: 'Ask the magic 8-ball',
        usage: '*j 8ball <question>',
        aliases: ['eightball'],
        execute: async (message, args) => {
            const question = args.join(' ');
            if (!question) {
                await message.reply('Ask me a question, sir. Usage: `*j 8ball <question>`');
                return true;
            }
            const answer = funFeatures.get8BallResponse();
            const embed = new EmbedBuilder()
                .setTitle('🎱 Magic 8-Ball')
                .setColor(0x000000)
                .addFields(
                    { name: '❓ Question', value: question, inline: false },
                    { name: '🔮 Answer', value: answer, inline: false }
                );
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Roll command
    roll: {
        description: 'Roll dice',
        usage: '*j roll [sides]',
        aliases: ['dice'],
        execute: async (message, args) => {
            const sides = parseInt(args[0]) || 6;
            const result = Math.floor(Math.random() * sides) + 1;
            await message.reply(`🎲 You rolled a **${result}** (1-${sides})!`);
            return true;
        }
    },

    // Rate command
    rate: {
        description: 'Rate something 0-10',
        usage: '*j rate <thing>',
        execute: async (message, args) => {
            const thing = args.join(' ');
            if (!thing) {
                await message.reply('What should I rate, sir?');
                return true;
            }
            // Deterministic rating based on string hash
            let hash = 0;
            for (let i = 0; i < thing.length; i++) {
                hash = thing.charCodeAt(i) + ((hash << 5) - hash);
            }
            const rating = Math.abs(hash % 11); // 0-10

            let comment = '';
            if (rating === 10) comment = 'Perfection.';
            else if (rating >= 8) comment = 'Excellent.';
            else if (rating >= 5) comment = 'Acceptable.';
            else if (rating >= 2) comment = 'Poor.';
            else comment = 'Abysmal.';

            await message.reply(`🤔 I rate **${thing}** a **${rating}/10**. ${comment}`);
            return true;
        }
    },

    // Dad joke command
    dadjoke: {
        description: 'Tell a dad joke',
        usage: '*j dadjoke',
        aliases: ['joke'],
        execute: async (message, args) => {
            // Simple static list since no external API
            const jokes = [
                "I'm afraid for the calendar. Its days are numbered.",
                "My wife said I should do lunges to stay in shape. That would be a big step forward.",
                "Why do fathers take an extra pair of socks when they go golfing? In case they get a hole in one!",
                "Singing in the shower is fun until you get soap in your mouth. Then it's a soap opera.",
                "What do a tick and the Eiffel Tower have in common? They're both Paris sites.",
                "What do you call a fish wearing a bowtie? Sofishticated.",
                "How do you follow Will Smith in the snow? You follow the fresh prints.",
                "If April showers bring May flowers, what do May flowers bring? Pilgrims.",
                "I thought the dryer was shrinking my clothes. Turns out it was the refrigerator all along.",
                "What do you call a factory that makes okay products? A satisfactory."
            ];
            const joke = jokes[Math.floor(Math.random() * jokes.length)];
            await message.reply(`📢 ${joke}`);
            return true;
        }
    },

    // ============ SOCIAL / INTERACTION ============

    // Roast command
    roast: {
        description: 'Roast someone with British class',
        usage: '*j roast @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply(
                    'Please mention someone to roast, sir. Usage: `*j roast @user`'
                );
                return true;
            }

            if (target.id === message.client.user.id) {
                await message.reply(
                    'I appreciate the ambition, sir, but self-deprecation is beneath my programming.'
                );
                return true;
            }

            // Generate roast
            const roast = funFeatures.getRoast ? funFeatures.getRoast(target.username) :
                `Sir, ${target.username} appears to have the charisma of a damp spreadsheet.`;

            const embed = new EmbedBuilder()
                .setTitle('🔥 Roast Protocol Engaged')
                .setDescription(roast)
                .setColor(0xe74c3c)
                .setFooter({ text: `Requested by ${message.author.username}` })
                .setTimestamp();

            selfhostFeatures.jarvisSoul.evolve('roast', 'positive');
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Hug command
    hug: {
        description: 'Hug someone',
        usage: '*j hug @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Who needs a hug, sir?');
                return true;
            }
            const gifs = [
                'https://media.giphy.com/media/3M4NpbLCTxBqU/giphy.gif',
                'https://media.giphy.com/media/lrr9rHuoPAEQLU8d7/giphy.gif',
                'https://media.giphy.com/media/od5H3PmEG5EVq/giphy.gif'
            ];
            const gif = gifs[Math.floor(Math.random() * gifs.length)];

            const embed = new EmbedBuilder()
                .setDescription(`🤗 **${message.author.username}** hugs **${target.username}**!`)
                .setImage(gif)
                .setColor(0xe91e63);

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Slap command
    slap: {
        description: 'Slap someone',
        usage: '*j slap @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Who deserves a slap, sir?');
                return true;
            }
            const gifs = [
                'https://media.giphy.com/media/Gf3AUz3eBNbNsIqnk/giphy.gif',
                'https://media.giphy.com/media/Zau0yrl17uzdK/giphy.gif',
                'https://media.giphy.com/media/mEtSQlxqBtWWA/giphy.gif'
            ];
            const gif = gifs[Math.floor(Math.random() * gifs.length)];

            const embed = new EmbedBuilder()
                .setDescription(`👋 **${message.author.username}** slaps **${target.username}**!`)
                .setImage(gif)
                .setColor(0xe74c3c);

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Ship command
    ship: {
        description: 'Check compatibility between two users',
        usage: '*j ship @u1 @u2',
        execute: async (message, args) => {
            const u1 = message.mentions.users.first();
            const u2 = message.mentions.users.at(1) || message.author;

            if (!u1) {
                await message.reply('Mention at least one user to ship!');
                return true;
            }

            // Deterministic ship
            const combined = [u1.id, u2.id].sort().join('');
            let hash = 0;
            for (let i = 0; i < combined.length; i++) {
                hash = combined.charCodeAt(i) + ((hash << 5) - hash);
            }
            const score = Math.abs(hash % 101); // 0-100

            let desc = '';
            if (score > 90) desc = 'Match made in heaven! 💍';
            else if (score > 70) desc = 'Great couple! 💖';
            else if (score > 40) desc = 'It could work... maybe? 🤔';
            else desc = 'Run away! 🏃';

            const embed = new EmbedBuilder()
                .setTitle('💗 Ship Compatibility')
                .setDescription(`**${u1.username}** + **${u2.username}**\n\n**${score}%**\n${'█'.repeat(score / 10)}${'░'.repeat(10 - (score / 10))}\n\n${desc}`)
                .setColor(score > 50 ? 0xe91e63 : 0x95a5a6);

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Fight command
    fight: {
        description: 'Fight another user',
        usage: '*j fight @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Who do you want to fight?');
                return true;
            }

            const winner = Math.random() > 0.5 ? message.author : target;
            const loser = winner.id === message.author.id ? target : message.author;

            const scenarios = [
                `threw a toaster at ${loser.username}`,
                `unleashed a drone swarm on ${loser.username}`,
                `outsmarted ${loser.username} in 4D chess`,
                `hacked ${loser.username}'s suit`,
                `used the Repulsor Blast on ${loser.username}`
            ];
            const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

            await message.reply(`⚔️ **${winner.username}** ${scenario} and won the fight!`);
            return true;
        }
    },

    // ============ METERS ============

    // HowGay command
    howgay: {
        description: 'Gay meter',
        usage: '*j howgay [@user]',
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            // Deterministic
            let hash = 0;
            for (let i = 0; i < target.id.length; i++) {
                hash = target.id.charCodeAt(i) + ((hash << 5) - hash);
            }
            const score = Math.abs(hash % 101);

            await message.reply(`🏳️‍🌈 **${target.username}** is **${score}%** gay!`);
            return true;
        }
    },

    // HowBased command
    howbased: {
        description: 'Based meter',
        usage: '*j howbased [@user]',
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const score = Math.floor(Math.random() * 101);

            await message.reply(`😎 **${target.username}** is **${score}%** based!`);
            return true;
        }
    },

    // VibeCheck command
    vibecheck: {
        description: 'Check someone\'s vibe',
        usage: '*j vibecheck [@user]',
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const vibes = ['Chill', 'Cursed', 'Blessed', 'Chaotic', 'Wholesome', 'Toxic', 'Immaculate'];
            const vibe = vibes[Math.floor(Math.random() * vibes.length)];

            await message.reply(`✨ **${target.username}**'s vibe is: **${vibe}**`);
            return true;
        }
    },

    // ============ SPECIAL ============

    // Terf Wiki command
    terf: {
        description: 'Ask the TERF Wiki',
        usage: '*j terf <question>',
        guildLocked: '858444090374881301',
        async execute(message, args) {
            // Guild lock - only respond in specific guild
            const ALLOWED_GUILD = '858444090374881301';
            if (!message.guild || message.guild.id !== ALLOWED_GUILD) {
                return true; // Silently ignore
            }

            const question = args.join(' ').trim();
            if (!question) {
                await message.reply('❓ Usage: `*j terf <your question>`\nExample: `*j terf What is STFR?`');
                return true;
            }

            try {
                console.log(`[Terf] Legacy query from ${message.author.tag}: "${question}"`);
                const result = await terfWiki.query(question);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                let response = `**Answer:**\n${result.answer}`;

                if (result.sources && result.sources.length > 0) {
                    const sourceLinks = result.sources
                        .slice(0, 3)
                        .map(s => `• [${s.title}](${s.url})`)
                        .join('\n');
                    response += `\n\n**Sources:**\n${sourceLinks}`;
                }

                if (response.length > 1900) {
                    response = response.slice(0, 1900) + '...';
                }

                await message.reply(response);
            } catch (error) {
                console.error('[Terf] Legacy command error:', error);
                await message.reply('❌ Wiki system error. Please try again.');
            }
            return true;
        }
    },

    // Aatrox
    aatrox: {
        description: 'GYAATROX',
        usage: '*j aatrox',
        execute: async (message, args) => {
            await message.reply(
                'https://tenor.com/view/aatrox-gyattrox-gyaatrox-lol-league-of-legends-gif-16706958126825166451'
            );
            return true;
        }
    },

    // Soul status
    soul: {
        description: 'View Jarvis artificial soul',
        usage: '*j soul',
        execute: async (message, args) => {
            const soulStatus = selfhostFeatures.jarvisSoul.getStatus();

            const traitLines = Object.entries(soulStatus.traits)
                .map(([trait, value]) => {
                    const bar =
                        '█'.repeat(Math.floor(value / 10)) +
                        '░'.repeat(10 - Math.floor(value / 10));
                    return `**${trait}**: ${bar} ${value}%`;
                })
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🤖 Jarvis Artificial Soul')
                .setDescription('*"God said no, so I made my own soul."*')
                .setColor(0x9b59b6)
                .addFields(
                    { name: '⏳ Soul Age', value: soulStatus.age, inline: true },
                    { name: '😊 Current Mood', value: soulStatus.mood, inline: true },
                    {
                        name: '📊 Evolution Events',
                        value: String(soulStatus.evolutionCount),
                        inline: true
                    },
                    {
                        name: '🧬 Personality Traits',
                        value: traitLines || 'Calibrating...',
                        inline: false
                    }
                )
                .setFooter({ text: '🤖 Artificial Soul System' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }
    }
};

module.exports = { funCommands };
