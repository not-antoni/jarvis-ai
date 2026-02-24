'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const database = require('../../services/database');
const config = require('../../../config');
const fetch = require('node-fetch');

// ── Pure functions (no handler dependency) ─────────────────────────────

function caesarShift(text, shift) {
    return text.replace(/[a-z]/gi, (char) => {
        const base = char >= 'a' && char <= 'z' ? 97 : 65;
        const code = char.charCodeAt(0) - base;
        const rotated = (code + shift + 26) % 26;
        return String.fromCharCode(base + rotated);
    });
}

function scrambleWord(word) {
    const letters = word.split('');
    for (let index = letters.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
    }
    return letters.join('');
}

async function fetchJokeApi() {
    const response = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 3_000
    });

    if (!response.ok) {
        throw new Error(`JokeAPI responded with ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`JokeAPI reported error: ${data?.message || 'Unknown'}`);
    }

    if (data.type === 'single' && data.joke) {
        return data.joke;
    }

    if (data.type === 'twopart' && data.setup && data.delivery) {
        return `${data.setup}\n\n${data.delivery}`;
    }

    return null;
}

async function fetchOfficialJoke() {
    const response = await fetch('https://official-joke-api.appspot.com/random_joke', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 3_000
    });

    if (!response.ok) {
        throw new Error(`Official Joke API responded with ${response.status}`);
    }

    const data = await response.json();
    if (!data || (!data.joke && !(data.setup && data.punchline))) {
        return null;
    }

    if (data.joke) {
        return data.joke;
    }

    return `${data.setup}\n\n${data.punchline}`;
}

async function fetchNinjaJoke() {
    const apiKey = process.env.NINJA_API_KEY;
    if (!apiKey) {
        throw new Error('Ninja API key not configured');
    }

    const response = await fetch('https://api.api-ninjas.com/v1/jokes', {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'X-Api-Key': apiKey
        },
        timeout: 3_000
    });

    if (!response.ok) {
        throw new Error(`API Ninjas responded with ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.length || !data[0]?.joke) {
        return null;
    }

    return data[0].joke;
}

// ── Handler-dependent functions ────────────────────────────────────────

async function handleCryptoCommand(handler, interaction) {
    const symbol = (interaction.options.getString('coin', true) || '').toUpperCase();
    const convert = (interaction.options.getString('convert') || 'USD').toUpperCase();

    if (!config.crypto?.apiKey) {
        await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
        return;
    }

    const formatCurrency = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) {
            return `— ${convert}`;
        }

        const abs = Math.abs(amount);
        const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;

        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: convert,
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            }).format(amount);
        } catch {
            return `${amount.toFixed(digits)} ${convert}`;
        }
    };

    const formatPercent = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return '—';
        }
        const direction = num >= 0 ? '▲' : '▼';
        return `${direction} ${Math.abs(num).toFixed(2)}%`;
    };

    const formatNumber = (value, options = {}) => {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return '—';
        }
        return new Intl.NumberFormat('en-US', options).format(num);
    };

    try {
        const { asset, quote } = await handler.crypto.getQuote({ symbol, convert });
        const lastUpdated = quote.last_updated ? new Date(quote.last_updated) : null;

        const embed = new EmbedBuilder()
            .setTitle(`${asset.name} (${asset.symbol})`)
            .setColor((quote.percent_change_24h || 0) >= 0 ? 0x22c55e : 0xef4444)
            .setDescription(`Live telemetry converted to ${convert}.`)
            .addFields(
                { name: 'Price', value: formatCurrency(quote.price), inline: true },
                { name: '24h Δ', value: formatPercent(quote.percent_change_24h), inline: true },
                { name: '7d Δ', value: formatPercent(quote.percent_change_7d), inline: true },
                { name: '1h Δ', value: formatPercent(quote.percent_change_1h), inline: true },
                { name: 'Market Cap', value: formatCurrency(quote.market_cap), inline: true },
                { name: '24h Volume', value: formatCurrency(quote.volume_24h), inline: true },
                {
                    name: 'Supply',
                    value: `${formatNumber(asset.circulating_supply, { maximumFractionDigits: 0 })} / ${asset.total_supply ? formatNumber(asset.total_supply, { maximumFractionDigits: 0 }) : '—'} ${asset.symbol}`,
                    inline: true
                },
                { name: 'Rank', value: asset.cmc_rank ? `#${asset.cmc_rank}` : '—', inline: true }
            );

        if (asset.slug) {
            embed.setURL(`https://coinmarketcap.com/currencies/${asset.slug}/`);
        }

        if (lastUpdated) {
            embed.setTimestamp(lastUpdated);
            embed.setFooter({ text: 'CoinMarketCap telemetry' });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Crypto command failed:', error);

        if (error.code === 'CRYPTO_API_KEY_MISSING') {
            await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
            return;
        }

        if (error.code === 'CRYPTO_UNKNOWN_SYMBOL') {
            await interaction.editReply('I am not familiar with that asset ticker, sir.');
            return;
        }

        if (error.code === 'CRYPTO_UNSUPPORTED_CONVERT') {
            await interaction.editReply(`That convert currency is not supported for ${symbol}, sir.`);
            return;
        }

        await interaction.editReply('Unable to retrieve market telemetry at this moment, sir.');
    }
}

async function handleSixSevenCommand(handler, interaction) {
    const classic = 'Why is 6 afraid of 7? Because 7 ate 9 (7, 8, 9).';
    const brainrotLines = [
        '\u{1F4A5}\u{1F4A5}\u{1F4A5} SIX SEVEN!!! \u{1F480}\u{1F525}\u{1F480}\u{1F525}',
        'OHHHH SIIIX SEVEEENNN!!! THE CROWD GOES WILD \u{1F525}\u{1F525}\u{1F525}',
        'SIX SEVEN INCOMING \u2014 HIDE YOUR CIRCUITS \u{1F4AB}\u{1F4AB}\u{1F4AB}',
        'SIX OR SEVEN\u2014??!? \u{1F631}\u{1F92F} THE FORBIDDEN NUMBERS UNITE!! \u26A1\u{1F4DF}',
        'THE BATTERY GODS DEMAND TRIBUTE!! \u{1F4A5}\u{1F50B}',
        '\u201CCHARGE TO SIXTY-SE\u2014NOOO NOT THAT NUMBER!!\u201D \u{1F480}\u{1F480}\u{1F480}',
        'THE VOLTAGE IS ALIVE!! THE CELLS ARE DANCING!! \u{1F483}\u26A1\u{1F50B}',
        'SEXI SEBEBEVENENENENNNNNN\u2014 \u{1F525}\u{1F525}\u{1F525}\u{1F525}\u{1F525}',
        '\u{1F480}\u{1F4A5}\u{1F480} WARNING: REALITY FRACTURE AT COORDINATE SIX SEVEN',
        'SIX SEVEN DETECTED. REALITY COLLAPSE IMMINENT. \u{1F4AB}\u{1F4A5}\u{1F4AB}',
        'FIRE IN THE CHAT \u{1F525}\u{1F525}\u{1F525} SAY IT LOUD \u2014 SIX SEVEN!!!',
        'SIX SEVEN OVERLOAD!!! SYSTEMS CAN\u2019T HANDLE THE HEAT \u26A1\u{1F480}',
        'WHO\u2019S SCREAMING?? oh. right. it\u2019s SIX SEVEN again.',
        '\u26A0\uFE0F\u26A0\uFE0F\u26A0\uFE0F SIX SEVEN PROTOCOL ENGAGED \u2014 STAND BACK!!!',
        'SIX SEVEN ASCENSION SEQUENCE: INITIATED. \u{1F4AB}\u{1F4AB}\u{1F4AB}',
        'THE NUMBERS ARE TALKING AGAIN\u2026 SIX SEVEN. \u{1F52E}',
        'SIX SEVEN HAS ENTERED THE SERVER. Everyone act natural. \u{1F62D}\u{1F525}',
        '\u26A1 THEY SAID IT COULDN\u2019T BE DONE \u2014 SIX SEVEN!!! \u{1F480}\u{1F480}\u{1F480}',
        'SIX SEVEN IS NOT JUST A NUMBER. IT\u2019S AN EXPERIENCE. \u{1F32A}\uFE0F'
    ];

    const brainrotGifs = [
        'https://tenor.com/view/67-6-7-6-7-67-meme-67-kid-gif-326947695990154469',
        'https://tenor.com/view/sixseven-six-seven-six-seve-67-gif-14143337669032958349',
        'https://tenor.com/view/67-6-7-six-seven-meme-so-so-gif-1086854674659893998',
        'https://tenor.com/view/67-67-kid-edit-analog-horror-phonk-gif-3349401281762803381',
        'https://tenor.com/view/scp-067-67-6-7-six-seven-sixty-seven-gif-13940852437921483111',
        'https://tenor.com/view/67-gif-18013427662333069251',
        'https://tenor.com/view/67-67-kid-67-meme-67-edit-phonk-gif-7031349610003813777'
    ];

    const shouldBrainrot = Math.random() < 0.1;

    if (!shouldBrainrot) {
        await interaction.editReply({ content: classic });
        return;
    }

    // Pick 1-5 random items from the combined pool (texts + gifs) for chaotic variety
    const pool = [...brainrotLines, ...brainrotGifs];
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const count = Math.max(1, Math.floor(Math.random() * 5) + 1);
    const payload = pool.slice(0, count);

    await interaction.editReply({
        content: payload.join('\n')
    });
}

async function handleJokeCommand(handler, interaction) {
    const sources = [
        { name: 'jokeapi', fetcher: fetchJokeApi },
        { name: 'official', fetcher: fetchOfficialJoke },
        { name: 'ninjas', fetcher: fetchNinjaJoke }
    ];

    // Shuffle sources so we don't always hit the same one first
    for (let i = sources.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [sources[i], sources[j]] = [sources[j], sources[i]];
    }

    for (const source of sources) {
        try {
            const joke = await source.fetcher();
            if (joke) {
                await interaction.editReply({ content: joke });
                return;
            }
        } catch (error) {
            console.warn(`Joke source ${source.name} failed:`, error);
        }
    }

    await interaction.editReply({ content: 'My humor subroutines are buffering, sir. Please try again.' });
}

async function handleFeaturesCommand(handler, interaction) {
    const defaults = config.features || {};
    const featureKeys = Object.keys(defaults).sort((a, b) => a.localeCompare(b));

    if (!featureKeys.length) {
        await interaction.editReply('No feature toggles are configured for this deployment, sir.');
        return;
    }

    // Handle toggle mode
    const toggleKey = interaction.options.getString('toggle');
    if (toggleKey) {
        if (!interaction.guild) {
            await interaction.editReply('Feature toggling is only available in servers, sir.');
            return;
        }

        const { member } = interaction;
        const isAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
            member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
            member.id === interaction.guild.ownerId;

        if (!isAdmin) {
            await interaction.editReply('Only server admins can toggle features.');
            return;
        }

        const normalizedKey = toggleKey.trim().toLowerCase();
        const matchedKey = featureKeys.find(k => k.toLowerCase() === normalizedKey);
        if (!matchedKey) {
            await interaction.editReply(`Unknown feature: "${toggleKey}". Use \`/features\` to see all available features.`);
            return;
        }

        const explicitValue = interaction.options.getBoolean('enabled');
        const guildConfig = await handler.getGuildConfig(interaction.guild);
        const currentValue = guildConfig?.features?.[matchedKey];
        const newValue = explicitValue !== null ? explicitValue : !currentValue;

        await database.updateGuildFeatures(interaction.guild.id, { [matchedKey]: newValue });

        await interaction.editReply(`${newValue ? '\u2705' : '\u26D4'} **${matchedKey}** is now **${newValue ? 'enabled' : 'disabled'}** for this server.`);
        return;
    }

    // Display mode
    const embed = new EmbedBuilder()
        .setTitle('Jarvis Feature Flags')
        .setColor(0x00bfff);

    const globalLines = featureKeys.map((key) => `${defaults[key] ? '\u2705' : '\u26D4'} ${key}`);
    const globalEnabled = globalLines.filter((line) => line.startsWith('\u2705')).length;
    embed.setDescription(`${globalEnabled}/${featureKeys.length} modules enabled globally.`);

    const addChunkedField = (label, lines) => {
        const chunkSize = 12;
        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);
            const name = lines.length > chunkSize ? `${label} (${Math.floor(i / chunkSize) + 1})` : label;
            embed.addFields({ name, value: chunk.join('\n') });
        }
    };

    addChunkedField('Global Defaults', globalLines);

    if (interaction.guild) {
        const guildConfig = await handler.getGuildConfig(interaction.guild);
        const guildFeatures = guildConfig?.features || {};
        const guildLines = featureKeys.map((key) => {
            const hasOverride = Object.prototype.hasOwnProperty.call(guildFeatures, key);
            const overrideValue = hasOverride ? Boolean(guildFeatures[key]) : undefined;
            const effective = hasOverride ? overrideValue : Boolean(defaults[key]);
            const origin = hasOverride
                ? (overrideValue ? 'override on' : 'override off')
                : `inherit (global ${defaults[key] ? 'on' : 'off'})`;
            return `${effective ? '\u2705' : '\u26D4'} ${key} \u2014 ${origin}`;
        });

        const enabledCount = guildLines.filter((line) => line.startsWith('\u2705')).length;
        embed.addFields({
            name: 'Server Summary',
            value: `${enabledCount}/${featureKeys.length} modules enabled for ${interaction.guild.name}.`
        });
        addChunkedField('This Server', guildLines);

        embed.setFooter({ text: 'Admins: /features toggle:<feature> to toggle' });
    }

    await interaction.editReply({ embeds: [embed] });
}

async function handleOptCommand(handler, interaction) {
    const selected = (interaction.options.getString('mode', true) || '').toLowerCase();
    const userId = interaction.user.id;
    const userName = interaction.user.displayName || interaction.user.username;

    if (!database.isConnected) {
        await interaction.editReply('Memory subsystem offline, sir. Unable to update preferences.');
        return;
    }

    const optIn = selected === 'in';
    const preferenceValue = optIn ? 'opt-in' : 'opt-out';

    try {
        await database.getUserProfile(userId, userName);
    } catch (error) {
        console.warn('Unable to load user profile prior to opt command:', error);
    }

    await database.setUserPreference(userId, 'memoryOpt', preferenceValue);

    if (!optIn) {
        await database.clearUserMemories(userId);
    }

    const embed = new EmbedBuilder()
        .setTitle('Memory Preference Updated')
        .setColor(optIn ? 0x22c55e : 0x64748b)
        .setDescription(optIn
            ? 'Long-term memory storage restored. I will resume learning from our conversations, sir.'
            : 'Memory retention disabled. I will respond normally, but I will not store new conversations, sir.')
        .addFields(
            { name: 'Status', value: optIn ? 'Opted **in** to memory storage.' : 'Opted **out** of memory storage.' },
            { name: 'Contextual Replies', value: 'Reply threads and immediate context still function.' }
        )
        .setFooter({ text: 'You may change this at any time with /opt.' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
}

async function handleComponentInteraction(handler, interaction) {
    if (!interaction.isButton()) {
        return;
    }

    // Ticket System
    if (interaction.customId.startsWith('ticket_')) {
        try {
            const ticketSystem = require('../ticket-system');
            await ticketSystem.handleInteraction(interaction);
        } catch (e) {
            console.error('Ticket System Error:', e);
            if (!interaction.replied) {await interaction.reply({ content: '\u274C Ticket system error.', ephemeral: true });}
        }
        return;
    }

    // Help menu category buttons
    if (interaction.customId.startsWith('help_')) {
        const categoryKey = interaction.customId.replace('help_', '');
        const categories = {
            overview: {
                emoji: '\u{1F4CB}',
                title: 'Command Overview',
                description: 'Welcome to Jarvis Legacy Commands!\nSelect a category below to see commands.',
                fields: [
                    { name: '\u{1F4B0} Economy', value: '`*j help economy`', inline: true },
                    { name: '\u{1F3B0} Gambling', value: '`*j help gambling`', inline: true },
                    { name: '\u{1F3AE} Fun', value: '`*j help fun`', inline: true },
                    { name: '\u{1F6E1}\uFE0F Moderation', value: '`*j help mod`', inline: true },
                    { name: '\u2699\uFE0F Utility', value: '`*j help utility`', inline: true },
                    { name: '\u{1F48E} Premium', value: '`*j help premium`', inline: true }
                ]
            },
            economy: {
                emoji: '\u{1F4B0}',
                title: 'Economy Commands',
                description: 'Build your Stark Industries fortune!',
                fields: [
                    { name: '\u{1F4B5} Basics', value: '`*j balance` - Check balance\n`*j daily` - Daily reward\n`*j work` - Earn money\n`*j beg` - Beg for coins', inline: false },
                    { name: '\u{1F4B3} Transactions', value: '`*j pay @user <amt>` - Send money\n`*j deposit <amt>` - Bank deposit\n`*j withdraw <amt>` - Bank withdraw\n`*j leaderboard` - Rich list', inline: false },
                    { name: '\u{1F6D2} Shopping', value: '`*j shop` - View shop\n`*j buy <item>` - Buy item\n`*j inventory` - Your items', inline: false }
                ]
            },
            gambling: {
                emoji: '\u{1F3B0}',
                title: 'Gambling Commands',
                description: 'Test your luck at Stark Casino!',
                fields: [
                    { name: '\u{1F3B2} Games', value: '`*j coinflip <amt>` - Flip a coin\n`*j slots <amt>` - Slot machine\n`*j blackjack <amt>` - Play 21\n`*j roulette <amt> <bet>` - Roulette', inline: false },
                    { name: '\u{1F3AF} More Games', value: '`*j dice <amt>` - Roll dice\n`*j crash <amt>` - Crash game\n`*j highlow <amt>` - Higher or lower', inline: false },
                    { name: '\u{1F3C6} Multiplayer', value: '`*j boss attack` - Attack boss', inline: false }
                ]
            },
            fun: {
                emoji: '\u{1F3AE}',
                title: 'Fun Commands',
                description: 'Entertainment and social commands!',
                fields: [
                    { name: '\u{1F3B1} Random', value: '`*j 8ball <q>` - Magic 8-ball\n`*j roll [dice]` - Roll dice\n`*j rate <thing>` - Rate something\n`*j dadjoke` - Dad joke', inline: false },
                    { name: '\u{1F495} Social', value: '`*j hug @user` - Hug someone\n`*j slap @user` - Slap someone\n`*j ship @u1 @u2` - Ship people\n`*j fight @user` - Fight!', inline: false },
                    { name: '\u{1F4CA} Meters', value: '`*j howgay @user` - Gay meter\n`*j howbased @user` - Based meter\n`*j vibecheck @user` - Vibe check\n`*j roast @user` - Roast someone', inline: false }
                ]
            },
            mod: {
                emoji: '\u{1F6E1}\uFE0F',
                title: 'Moderation Commands',
                description: 'Server moderation tools (requires permissions)',
                fields: [
                    { name: '\u{1F528} Actions', value: '`*j kick @user [reason]` - Kick member\n`*j ban @user [time] [reason]` - Ban member\n`*j unban <id>` - Unban by ID', inline: false },
                    { name: '\u{1F507} Timeout', value: '`*j mute @user <time>` - Timeout user\n`*j unmute @user` - Remove timeout', inline: false },
                    { name: '\u26A0\uFE0F Warnings', value: '`*j warn @user <reason>` - Warn user\n`*j warnings @user` - View warnings\n`*j clearwarnings @user` - Clear warns', inline: false },
                    { name: '\u{1F916} AI Moderation', value: '`*j enable moderation` - Enable AI mod\n`*j moderation status` - View settings', inline: false }
                ]
            },
            utility: {
                emoji: '\u2699\uFE0F',
                title: 'Utility Commands',
                description: 'Helpful utility commands',
                fields: [
                    { name: '\u{1F527} Tools', value: '`*j ping` - Bot latency\n`*j remind in <time> <msg>` - Set reminder\n`*j profile` - View profile', inline: false }
                ]
            },
            premium: {
                emoji: '\u{1F48E}',
                title: 'Premium Features',
                description: 'Advanced economy features',
                fields: [
                    { name: '\u{1F4A0} Arc Reactor', value: '`*j reactor` - Check reactor\n`*j buy arc_reactor` - Buy (10,000\u{1F4B5})\n*+15% earnings, -25% cooldowns*', inline: false },
                    { name: '\u{1F4B1} Starkbucks', value: '`*j sbx wallet` - SBX balance\n`*j sbx convert <amt>` - Convert\n`*j sbx store` - SBX shop', inline: false },
                    { name: '\u{1F4CA} Crypto', value: '`*j crypto prices` - View prices\n`*j crypto buy <coin> <amt>` - Buy\n`*j crypto portfolio` - Holdings', inline: false }
                ]
            }
        };

        const category = categories[categoryKey] || categories.overview;

        const embed = new EmbedBuilder()
            .setTitle(`${category.emoji} ${category.title}`)
            .setDescription(category.description)
            .setColor(0x3498db)
            .setFooter({ text: 'Use *j help <category> to view specific commands' });

        category.fields.forEach(f => embed.addFields(f));

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('help_overview')
                .setLabel('Overview')
                .setEmoji('\u{1F4CB}')
                .setStyle(categoryKey === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_economy')
                .setLabel('Economy')
                .setEmoji('\u{1F4B0}')
                .setStyle(categoryKey === 'economy' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_gambling')
                .setLabel('Gambling')
                .setEmoji('\u{1F3B0}')
                .setStyle(categoryKey === 'gambling' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_fun')
                .setLabel('Fun')
                .setEmoji('\u{1F3AE}')
                .setStyle(categoryKey === 'fun' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('help_mod')
                .setLabel('Moderation')
                .setEmoji('\u{1F6E1}\uFE0F')
                .setStyle(categoryKey === 'mod' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_utility')
                .setLabel('Utility')
                .setEmoji('\u2699\uFE0F')
                .setStyle(categoryKey === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_premium')
                .setLabel('Premium')
                .setEmoji('\u{1F48E}')
                .setStyle(categoryKey === 'premium' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

        try {
            await interaction.update({ embeds: [embed], components: [row1, row2] });
        } catch {
            // Fallback if update fails
            await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
        }
        return;
    }

    // Error log status buttons
    try {
        const errorLogger = require('../error-logger');
        const handled = await errorLogger.handleStatusButton(interaction);
        if (handled) {
            return;
        }
    } catch (e) {
        // ignore
    }

    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Interactive controls are currently unavailable, sir.', ephemeral: true });
    }
}

async function handleEightBallCommand(handler, interaction) {
    const question = interaction.options.getString('question', true);
    const responses = [
        'Absolutely, sir.',
        'My sensors say no.',
        'Prospects hazy \u2014 rerun diagnostics.',
        'Proceed with extreme style.',
        'I would not bet Stark stock on it.',
        'All systems green.',
        'Ask again after a caffeine refill.',
        'Outcome classified \u2014 sorry, sir.'
    ];
    const answer = handler.pickRandom(responses) || 'Systems offline, try later.';
    await interaction.editReply(`\u{1F3B1} ${answer}`);
}

async function handleVibeCheckCommand(handler, interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const score = handler.randomInRange(0, 100);
    const verdicts = [
        'Radiant energy detected.',
        'Stable but watch the sarcasm levels.',
        'Chaotic neutral vibes.',
        'Vibe anomaly detected \u2014 recommend snacks.',
        'Off the charts. Prepare confetti.'
    ];
    const verdict = handler.pickRandom(verdicts) || 'Unable to parse vibes.';
    const embed = new EmbedBuilder()
        .setTitle('Vibe Diagnostic')
        .setDescription(`<@${target.id}> registers at **${score}%** vibe integrity. ${verdict}`)
        .setColor(score > 70 ? 0x22c55e : score > 40 ? 0xfacc15 : 0xef4444);
    await interaction.editReply({ embeds: [embed] });
}

async function handleBonkCommand(handler, interaction) {
    const target = interaction.options.getUser('target');
    const implementsOfBonk = [
        'vibranium mallet',
        'foam hammer',
        'Stark-brand pool noodle',
        'holographic newspaper',
        'Mj\u00F6lnir (training mode)'
    ];
    const tool = handler.pickRandom(implementsOfBonk) || 'nanotech boop-stick';
    await interaction.editReply(`\u{1F528} Bonk delivered to <@${target.id}> with the ${tool}. Order restored, sir.`);
}

async function handleTemplateCommand(handler, interaction, templates, title, defaultLine, color, optionName = 'target') {
    const target = interaction.options.getUser(optionName) || interaction.user;
    const template = handler.pickRandom(templates) || defaultLine;
    const mention = target ? `<@${target.id}>` : 'sir';
    const rendered = template.replace(/\{target\}/gi, mention);

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(rendered);

    await interaction.editReply({ embeds: [embed] });
}

async function handleRoastCommand(handler, interaction) {
    await handleTemplateCommand(
        handler,
        interaction,
        handler.roastTemplates,
        'Combat-Ready Roast',
        'Diagnostic humour unavailable, sir.',
        0xf87171
    );
}

async function handleFlatterCommand(handler, interaction) {
    await handleTemplateCommand(
        handler,
        interaction,
        handler.flatterTemplates,
        'Compliment Cascade',
        'Flattery circuits cooling, sir.',
        0x22c55e
    );
}

async function handleToastCommand(handler, interaction) {
    await handleTemplateCommand(
        handler,
        interaction,
        handler.toastTemplates,
        'Celebratory Toast',
        'Celebration routines unavailable, sir.',
        0xfacc15
    );
}

async function handleTriviaCommand(handler, interaction) {
    const entry = handler.pickRandom(handler.triviaQuestions);
    if (!entry) {
        await interaction.editReply('Trivia archives offline, sir.');
        return;
    }

    const shuffled = entry.choices
        .map((choice) => ({ id: Math.random(), value: choice }))
        .sort((a, b) => a.id - b.id)
        .map(({ value }) => value);

    const correctIndex = shuffled.indexOf(entry.answer);
    const answerLabel = correctIndex >= 0
        ? `||${String.fromCharCode(65 + correctIndex)}. ${shuffled[correctIndex]}||`
        : 'Unavailable';

    const embed = new EmbedBuilder()
        .setTitle('Stark Trivia Uplink')
        .setColor(0xf97316)
        .setDescription(entry.question);

    shuffled.forEach((choice, index) => {
        embed.addFields({
            name: `Option ${String.fromCharCode(65 + index)}`,
            value: choice,
            inline: true
        });
    });

    embed.addFields({ name: 'Answer', value: answerLabel });
    embed.setFooter({ text: 'Spoiler tags conceal the correct answer. Tap to reveal.' });

    await interaction.editReply({ embeds: [embed] });
}

async function handleCipherCommand(handler, interaction) {
    const phrase = handler.pickRandom(handler.cipherPhrases) || 'Stark encryption offline';
    const shift = handler.randomInRange(3, 13);
    const cipherText = caesarShift(phrase, shift);

    const embed = new EmbedBuilder()
        .setTitle('Cipher Challenge Loaded')
        .setColor(0x6366f1)
        .addFields(
            { name: 'Cipher Text', value: `\`${cipherText}\`` },
            { name: 'Hint', value: `Caesar shift by ${shift}. Decode at your leisure, sir.` }
        );

    await interaction.editReply({ embeds: [embed] });
}

async function handleScrambleCommand(handler, interaction) {
    const baseWord = handler.pickRandom(handler.scrambleWords) || 'jarvis';
    let scrambled = baseWord;

    for (let attempt = 0; attempt < 5 && scrambled === baseWord; attempt += 1) {
        scrambled = scrambleWord(baseWord);
    }

    const hint = `${baseWord.charAt(0).toUpperCase()}${baseWord.length > 2 ? '...' : ''}`;

    const embed = new EmbedBuilder()
        .setTitle('Word Scrambler Online')
        .setColor(0x22d3ee)
        .addFields(
            { name: 'Scrambled', value: `\`${scrambled}\`` },
            { name: 'Hint', value: `Starts with ${hint}` }
        );

    await interaction.editReply({ embeds: [embed] });
}

async function handleMissionCommand(handler, interaction) {
    const refresh = interaction.options.getBoolean('refresh') || false;
    const { user } = interaction;
    const userId = user.id;
    const userName = user.displayName || user.username;

    if (!database.isConnected) {
        const fallbackMission = handler.pickRandom(handler.missions) || 'Take five minutes to stretch and hydrate, sir.';
        await interaction.editReply(`Mission uplink offline. Manual directive: ${fallbackMission}`);
        return;
    }

    const profile = await database.getUserProfile(userId, userName);
    const rawMission = profile?.preferences?.mission;
    const missionRecord = rawMission && typeof rawMission === 'object' && !Array.isArray(rawMission)
        ? { ...rawMission }
        : null;

    const now = Date.now();
    const assignedAtMs = missionRecord?.assignedAt ? new Date(missionRecord.assignedAt).getTime() : NaN;
    const hasValidAssignment = Number.isFinite(assignedAtMs);
    const isExpired = !hasValidAssignment || now - assignedAtMs >= handler.missionCooldownMs;

    if (refresh && !isExpired && hasValidAssignment) {
        const availableAt = assignedAtMs + handler.missionCooldownMs;
        await interaction.editReply(`Current directive still in progress, sir. Next rotation <t:${Math.floor(availableAt / 1000)}:R>.`);
        return;
    }

    let activeMission = missionRecord;
    let assignedNew = false;

    if (!missionRecord || isExpired || refresh) {
        const task = handler.pickRandom(handler.missions) || 'Improvise a heroic act and report back, sir.';
        activeMission = {
            task,
            assignedAt: new Date().toISOString()
        };
        assignedNew = true;

        try {
            await database.setUserPreference(userId, 'mission', activeMission);
        } catch (error) {
            console.error('Failed to persist mission preference:', error);
        }
    }

    const assignedAt = activeMission.assignedAt ? new Date(activeMission.assignedAt) : new Date();
    const nextRotation = new Date(assignedAt.getTime() + handler.missionCooldownMs);
    const embed = new EmbedBuilder()
        .setTitle(assignedNew ? 'New Directive Deployed' : 'Directive Status')
        .setColor(assignedNew ? 0x10b981 : 0x0891b2)
        .setDescription(activeMission.task)
        .addFields(
            { name: 'Assigned', value: `<t:${Math.floor(assignedAt.getTime() / 1000)}:R>`, inline: true },
            { name: 'Next Rotation', value: `<t:${Math.floor(nextRotation.getTime() / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: 'Use /mission refresh:true to request a new directive once available.' });

    await interaction.editReply({ embeds: [embed] });
}

module.exports = {
    caesarShift,
    scrambleWord,
    handleCryptoCommand,
    handleSixSevenCommand,
    handleJokeCommand,
    handleFeaturesCommand,
    handleOptCommand,
    handleComponentInteraction,
    handleEightBallCommand,
    handleVibeCheckCommand,
    handleBonkCommand,
    handleTemplateCommand,
    handleRoastCommand,
    handleFlatterCommand,
    handleToastCommand,
    handleTriviaCommand,
    handleCipherCommand,
    handleScrambleCommand,
    handleMissionCommand
};
