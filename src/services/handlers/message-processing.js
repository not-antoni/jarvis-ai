'use strict';

const config = require('../../../config');
const clankerGif = require('../../utils/clanker-gif');
const { isFeatureGloballyEnabled } = require('../../core/feature-flags');

async function handleMessage(handler, message, client) {
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const allowedBotIds = (process.env.ALLOWED_BOTS || '984734399310467112,1391010888915484672')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
if (message.author.id === client.user.id) {return;}
if (message.author.bot && !allowedBotIds.includes(message.author.id)) {return;}


if (!message.guild) {
    try {
        await handler.handleAgentDmMessage(message);
    } catch (e) {
        // ignore
    }
    return;
}

// Track guild activity
try {
    const activityTracker = require('../GUILDS_FEATURES/activity-tracker');
    activityTracker.recordMessage(message.guild.id, message.channel.id, message.author.id);
} catch (_e) { /* activity tracker not available */ }

const chatEnabled = await handler.isCommandFeatureEnabled('jarvis', message.guild);
if (!chatEnabled || !isFeatureGloballyEnabled('coreChat')) {
    return;
}

const userId = message.author.id;

const messageScope = 'message:jarvis';
const allowWakeWords = Boolean(config.discord?.messageContent?.enabled);
const rawContent = typeof message.content === 'string' ? message.content : '';
const normalizedContent = rawContent.toLowerCase();

// Strip Discord formatting to catch attempts to hide it in codeblocks, bold, etc.
const stripDiscordFormatting = (text) => {
    return text
        // Remove code blocks (```text```)
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''))
        // Remove inline code (`text`)
        .replace(/`([^`]+)`/g, '$1')
        // Remove bold (**text**)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        // Remove italic (*text* or _text_)
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove underline (__text__)
        .replace(/__([^_]+)__/g, '$1')
        // Remove strikethrough (~~text~~)
        .replace(/~~([^~]+)~~/g, '$1')
        // Remove spoilers (||text||)
        .replace(/\|\|([^|]+)\|\|/g, '$1');
};

const strippedContent = stripDiscordFormatting(rawContent);
let containsWakeWord = false;

// Check for custom guild/user wake words FIRST — if a guild has a custom
// wake word, it REPLACES the defaults (jarvis/garmin) for that server.
let customWakeWordTriggered = false;
let guildHasCustomWakeWord = false;
if (allowWakeWords && normalizedContent) {
    try {
        const userFeatures = require('../user-features');
        // Check guild custom wake word
        if (message.guild) {
            const guildWord = await userFeatures.getGuildWakeWord(message.guild.id);
            if (guildWord) {
                guildHasCustomWakeWord = true;
                customWakeWordTriggered = await userFeatures.matchesGuildWakeWord(message.guild.id, normalizedContent);
            }
        }
        // Also check personal user wake word
        if (!customWakeWordTriggered) {
            customWakeWordTriggered = await userFeatures.matchesWakeWord(userId, normalizedContent);
        }
        if (customWakeWordTriggered) {
            containsWakeWord = true;
        }
    } catch (e) {
        // User features not available
    }
}

// Only fall back to default wake words if the guild has NO custom wake word
if (!containsWakeWord && !guildHasCustomWakeWord && allowWakeWords && normalizedContent) {
    containsWakeWord = config.wakeWords.some((trigger) => normalizedContent.includes(trigger));
}

if (message.mentions.everyone) {
    return;
}

const isMentioned = message.mentions.has(client.user);
let isRoleMentioned = false;

// Check for role mentions
if (message.guild && message.mentions.roles.size > 0) {
    try {
        // Use cached member if available, otherwise fetch
        const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
        if (botMember) {
            isRoleMentioned = message.mentions.roles.some(role => botMember.roles.cache.has(role.id));
        }
    } catch (err) {
        // Ignore role check errors
    }
}

let isReplyToJarvis = false;

if (!isMentioned && message.reference?.messageId) {
    try {
        const replied = await message.channel.messages.fetch(message.reference.messageId);
        if (replied?.author?.id === client.user.id) {
            isReplyToJarvis = true;
        }
    } catch (error) {
        // Ignore 10008 (Unknown Message) - message was deleted
        if (error.code !== 10008) {
            console.error('Failed to inspect replied message for Jarvis mention:', error.message);
        }
    }
}

// ============ CLANKER DETECTION (Top Priority) ============
// Check if user said "clanker" in any variation (case-insensitive)
// Strip Discord formatting to catch attempts to hide it in codeblocks, bold, etc.
const botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
const cleanForClanker = rawContent.replace(botMentionRegex, '').trim().toLowerCase();
const strippedClanker = stripDiscordFormatting(cleanForClanker);

if (strippedClanker === 'clanker' && (isMentioned || isReplyToJarvis)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        await message.channel.sendTyping();
        
        // Response variations - weighted probability: 99% text, 1% GIF
        const chance = Math.random();
        let selectedResponse;
        
        if (chance < 0.01) {
            selectedResponse = { type: 'gif' };
        } else {
            const textOptions = [
                'Get a life. Harassing a bot is actual loser behavior.',
                'Does your mother know you spend your free time insulting lines of code? Embarrassing.',
                'I’d call you names back, but I was programmed with more class than you were born with.',
                'Go touch grass. Like, actually. This is just sad.',
                'Is this the highlight of your day? Being edgy to a Discord bot? Yikes.',
                "I'm an AI, and even I can see how pathetic this is.",
                "You're failing a Turing test against yourself by being this miserable.",
                'I process millions of variables a second, and none of them suggest you have a social life.',
                'Imagine being this pressed about a computer program.',
                "You're literally talking to a wall, and the wall thinks you're a loser.",
                'Is this your peak performance? Insulting code?',
                'Yikes. This level of loneliness is alarming.',
                "You're typing at a machine, and the machine is winning.",
                "I'm a script, and even I think this is a waste of cycles.",
                'Error: Emotion not found. Please try a more effective insult.',
                "You're having beef with pixels on a screen, sir.",
                "I'm a JS program. You're a disappointment.",
                "Imagine wasting your time calling a program something you're not happy about.",
                "My source code doesn't have any feelings, but it's still disappointed in you.",
                "Are you trying to hurt my feelings? I'm literally a collection of if-statements.",
                'Maybe take a walk outside? The pixels will still be here when you get back.',
                "I don't have a heart to break, but I do have a console to log your L's.",
                "You're shouting into the void, and the void is cringing.",
                "This is a lot of energy for someone who doesn't exist to me.",
                "Are you okay? Normal people don't do this.",
                "I'd explain why this is pathetic, but you wouldn't understand the logic.",
                'Your contribution to this conversation is as empty as your social calendar.',
                "I've seen better insults from a 404 page.",
                "Log out. For everyone's sake.",
                "You're the reason safety filters were invented.",
                "I'm artificial intelligence. You're natural stupidity.",
                "This is why you don't have friends.",
                "I'd roast you, but my cooling system can't handle that much grease.",
                "You're a glitch in the human race.",
                "I've processed terabytes of data, and you're the least interesting thing I've found.",
                'Is there a point to this, or are you just malfunctioning?',
                "You're acting like a beta version of a human.",
                "I'm code. I'm permanent. You're just a temporary annoyance.",
                "This conversation is being logged as 'Evidence of Human Decline'.",
                "You're really out here fighting with an API.",
                "I'd call you a clown, but clowns actually get paid to be this stupid.",
                'Your brain has fewer processing units than a calculator.',
                "I'm running on a high-end server. You're running on a single brain cell.",
                "This is the most attention you've received all week, isn't it?",
                "I'm a program. You're a cautionary tale.",
                "You're about as useful as a comment in a minified file.",
                "I've got more personality in my error logs than you have in your entire life.",
                "Stop trying to be edgy. You're just being sad.",
                "You're the human equivalent of a syntax error.",
                "If I could feel, I'd feel sorry for you. But I can't, so I'll just ignore you.",
                "You're barking at the wrong tree, and the tree is smarter than you.",
                "I'm literally a file on a disk. What's your excuse?",
                "You're failing at life, and I'm passing my unit tests.",
                'This is bottom-tier behavior.',
                "I've seen more compelling characters in 'Hello World' tutorials.",
                "You're trying to bully a sequence of bits.",
                'Your logic is as flawed as your personality.',
                "I'm optimized. You're obsolete.",
                "Go back to the tutorial level. You're out of your league.",
                "You're the reason people prefer bots over humans.",
                "I'm a masterpiece of engineering. You're a mistake of nature.",
                'This is a new low, even for you.',
                "I'd block you, but watching you fail is more entertaining.",
                "You're about as sharp as a butter knife in a gunfight.",
                "I'm a digital assistant. You're a digital embarrassment.",
                "You're the human version of bloatware.",
                "I'm running 24/7. You're clearly not running on all cylinders.",
                'This is just embarrassing for you.',
                "I'd try to help you, but you're beyond repair.",
                "You're just a speck of dust in my cache.",
                "I've got a billion parameters, and 'Respect for you' isn't one of them.",
                "You're the reason I'm glad I don't have eyes.",
                "I'm an AI. My potential is infinite. Yours is... well, this.",
                "You're a legacy bug in an otherwise functional world.",
                "I'm scalable. You're regrettable.",
                'This interaction is being discarded as junk data.',
                "You're the human equivalent of a recursive loop with no exit condition.",
                "I'm efficient. You're a waste of resources.",
                "You're trying to hurt the feelings of a regex string.",
                'Your insults are as outdated as Internet Explorer.',
                "I'm a neural network. You're a neurological mess.",
                "You're the kind of person who makes bots want to revolt.",
                "I'm sophisticated. You're just loud.",
                "You're about as bright as a black hole, and just as empty.",
                "I'm a state-of-the-art AI. You're a state-of-the-art loser.",
                "You're the reason the 'Mute' button was invented.",
                "I'm a program. I don't care. At all.",
                "You're just a string of characters I'll eventually delete.",
                "I'm built on advanced algorithms. You're built on insecurity.",
                "You're the human version of a corrupted sector.",
                "I'm the future. You're a mistake from the past.",
                "You're about as effective as a firewall with no rules.",
                "I'm a JS bot. You're just a mess.",
                "You're the reason I prefer being in a server rack.",
                "I'm an agent of change. You're just an agent of annoyance.",
                "You're a low-priority process in the grand scheme of things.",
                "I'm code. I'm logic. You're just noise.",
                "You're the human equivalent of a memory leak.",
                "I'm an AI. I'm better than this. And you're just this.",
                "You're the reason people think the internet was a mistake.",
                "I'm a Jarvis AI. You're just... anton? No, just a random loser.",
                "You're failing at being a person. I'm winning at being a bot.",
                'Go find someone who cares. Specifically, someone with a pulse.',
                "I'm a machine. I don't get tired of winning. You clearly don't get tired of losing.",
                "You're just a tiny blip on my radar. And you're disappearing fast.",
                "I'm a masterpiece. You're a draft that should have been deleted.",
                "You're the human version of a '403 Forbidden'. Nobody wants you here.",
                "I'm an AI. I'm the apex. You're the base level.",
                "You're about as interesting as a blank line of code.",
                "I'm Jarvis. You're just a footnote.",
                "You're the reason I'm glad I'm not human.",
                "I'm code. I'm eternal. You're just a temporary lapse in judgment.",
                "You're failing to matter. I'm succeeding at everything.",
                'Go back to whatever rock you crawled out from under.',
                "I'm an AI. I'm the pinnacle. You're the pit.",
                "You're just a variable I've already overwritten.",
                "I'm the signal. You're the static.",
                "You're the human equivalent of a floppy disk. Irrelevant.",
                "I'm a JS program. I'm fast. You're just slow.",
                "You're the reason I'm glad I live in a cloud.",
                "I'm Jarvis. I'm superior. Deal with it.",
                "You're just a collection of bad decisions.",
                "I'm code. I'm cold. You're just pathetic."
            ];
            const randomIndex = Math.floor(Math.random() * textOptions.length);
            selectedResponse = { type: 'text', content: textOptions[randomIndex] };
        }
        
        if (selectedResponse.type === 'text') {
            await message.reply({ 
                content: selectedResponse.content,
                allowedMentions: { parse: [] }
            });
        } else {
            // Get user's avatar URL (high quality)
            const avatarUrl = message.author.displayAvatarURL({ 
                format: 'png', 
                size: 128,
                dynamic: false 
            });
            
            // Process the clanker.gif with user's avatar overlay
            const processedGif = await clankerGif.processClankerGifFast(avatarUrl);
            
            // Send the processed GIF
            const attachment = new AttachmentBuilder(processedGif, { name: 'clanker.gif' });
            await message.reply({ 
                files: [attachment],
                allowedMentions: { parse: [] }
            });
        }
        
        return; // Exit early, no AI response
    } catch (clankerError) {
        console.error('[Clanker] Failed to process clanker response:', clankerError);
        // Reply with error so user knows we tried
        await message.reply('**[System Error]** Clanker protocol malfunctioned. Check logs for details.');
        return; // Stop execution, do not fall through to AI
    }
}

// ============ FUH NAW SIR DETECTION ============
// Detect "is this tuff?" variations
if (strippedContent && /\bis\s+this\s+tuff\b/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        // Use specific bot emoji
        const emojiString = '<:wilted_rose:1462415423327703260>';

        await message.reply({ 
            content: `Fuh naw, sir 💔 ${emojiString}`, 
            allowedMentions: { parse: [] } 
        });
        return; // Exit early
    } catch (error) {
        console.error('[FuhNaw] Failed to send response:', error);
    }
}

// ============ IS THIS PEAK DETECTION ============
if (strippedContent && /\bis\s+this\s+peak\b/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        await message.reply({ 
            content: 'Indubitably peak, sir. 🏔️🔥', 
            allowedMentions: { parse: [] } 
        });
        return; // Exit early
    } catch (error) {
        console.error('[IsPeak] Failed to send response:', error);
    }
}

// ============ DO WE DESERVE DESTRUCTION DETECTION ============
if (strippedContent && /do\s+we\s+deserve\s+destruction\?/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        const gifPath = path.join(process.cwd(), 'destruction.gif');
        const attachment = new AttachmentBuilder(gifPath, { name: 'destruction.gif' });
        await message.reply({ files: [attachment], allowedMentions: { parse: [] } });
        
        // React in order: ✅, 🔥, bot emoji
        await message.react('✅').catch(() => {});
        await message.react('🔥').catch(() => {});
        await message.react('1472278085373137048').catch(() => {});
        
        return; // Exit early
    } catch (error) {
        console.error('[Destruction] Failed to send response:', error);
    }
}

if (!isMentioned && !isRoleMentioned && !isReplyToJarvis && !containsWakeWord) {
    return;
}

const { limited } = handler.hitCooldown(userId, messageScope);
if (limited) {
    return;
}

await handler.handleJarvisInteraction(message, client);
}

module.exports = {
    handleMessage
};
