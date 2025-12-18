
    // ============ RAP BATTLE SYSTEM ============
    /**
     * Scan rapping_comebacks folder for available content
     */
    scanRapBattleComebacks() {
        const comebacks = {
            lines: [],
            gifs: [],
            videos: [],
            mp3s: [],
            images: [],      // Local image files
            imagesBase64: [] // Base64 encoded images
        };

        try {
            // Read lines.txt
            const linesPath = path.join(this.rapBattleComebacksPath, 'lines.txt');
            if (fs.existsSync(linesPath)) {
                const content = fs.readFileSync(linesPath, 'utf8');
                comebacks.lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
            }

            // Read gif_links.txt
            const gifsPath = path.join(this.rapBattleComebacksPath, 'gif_links.txt');
            if (fs.existsSync(gifsPath)) {
                const content = fs.readFileSync(gifsPath, 'utf8');
                comebacks.gifs = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && line.startsWith('http'));
            }

            // Scan videos_and_mp3 folder
            const mediaPath = path.join(this.rapBattleComebacksPath, 'videos_and_mp3');
            if (fs.existsSync(mediaPath)) {
                const files = fs.readdirSync(mediaPath);
                for (const file of files) {
                    const filePath = path.join(mediaPath, file);
                    const ext = path.extname(file).toLowerCase();
                    if (ext === '.mp4' || ext === '.webm' || ext === '.mov') {
                        comebacks.videos.push(filePath);
                    } else if (ext === '.mp3' || ext === '.wav' || ext === '.ogg') {
                        comebacks.mp3s.push(filePath);
                    }
                }
            }

            // Scan images folder for local images
            const imagesPath = path.join(this.rapBattleComebacksPath, 'images');
            if (fs.existsSync(imagesPath)) {
                const files = fs.readdirSync(imagesPath);
                for (const file of files) {
                    const ext = path.extname(file).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
                        comebacks.images.push(path.join(imagesPath, file));
                    }
                }
            }

            // Read base64 encoded images
            const base64Path = path.join(this.rapBattleComebacksPath, 'images_base64.json');
            if (fs.existsSync(base64Path)) {
                try {
                    const base64Data = JSON.parse(fs.readFileSync(base64Path, 'utf8'));
                    if (base64Data.images && Array.isArray(base64Data.images)) {
                        comebacks.imagesBase64 = base64Data.images;
                    }
                } catch (e) {
                    console.error('Failed to parse images_base64.json:', e);
                }
            }
        } catch (error) {
            console.error('Failed to scan rap battle comebacks:', error);
        }

        return comebacks;
    }

    /**
     * Fetch a random GIF from Tenor API based on keyword
     * @param {string} keyword - Search term for GIF
     * @returns {Promise<string|null>} - GIF URL or null if failed
     */
    async fetchTenorGif(keyword) {
        const TENOR_API_KEY = 'LIVDSRZULELA';
        try {
            const url = `https://g.tenor.com/v1/search?q=${encodeURIComponent(keyword)}&key=${TENOR_API_KEY}&limit=20`;
            const response = await fetch(url);
            if (!response.ok) return null;
            
            const data = await response.json();
            if (!data.results || data.results.length === 0) return null;
            
            // Pick random result and get gif URL
            const result = data.results[Math.floor(Math.random() * data.results.length)];
            // Get the gif URL from media array
            const gifUrl = result.media?.[0]?.gif?.url || result.media?.[0]?.tinygif?.url;
            return gifUrl || null;
        } catch (error) {
            console.error('Tenor API error:', error);
            return null;
        }
    }

    /**
     * Get unhinged keyword for fire mode (progressively crazier)
     */
    getUnhingedKeyword(fireMode) {
        const UNHINGED_KEYWORDS = {
            1: ['fire rap', 'hip hop beat', 'rap battle', 'mic drop'],
            2: ['hot fire', 'burning flames', 'heat wave', 'spicy'],
            3: ['cooking chef', 'roasting', 'burned', 'toasted'],
            4: ['thunder lightning', 'electric shock', 'storm', 'zap'],
            5: ['speed fast', 'zoom sonic', 'turbo', 'flash'],
            6: ['volcano lava', 'magma explosion', 'eruption', 'molten'],
            7: ['explosion boom', 'blast destroy', 'kaboom', 'nuke'],
            8: ['skull death', 'grim reaper', 'rip dead', 'cemetery'],
            9: ['boss battle', 'final boss', 'monster', 'beast mode'],
            10: ['king crown', 'royal throne', 'legend goat', 'champion'],
            11: ['god mode', 'divine power', 'immortal', 'ascended'],
            12: ['supernova star', 'cosmic explosion', 'galaxy brain', 'universe'],
            13: ['alien space', 'void abyss', 'dimension', 'multiverse'],
            14: ['infinite loop', 'eternal forever', 'never ending', 'matrix'],
            15: ['ultimate victory', 'winner champion', 'goat legend', 'perfection'],
        };
        const keywords = UNHINGED_KEYWORDS[fireMode] || UNHINGED_KEYWORDS[1];
        return keywords[Math.floor(Math.random() * keywords.length)];
    }

    /**
     * Get a random comeback from available content (no repeats within a battle)
     */
    getRandomComeback(comebacks, usedComebacks = null) {
        const allTypes = [];
        
        if (comebacks.lines.length > 0) allTypes.push('line');
        if (comebacks.gifs.length > 0) allTypes.push('gif');
        if (comebacks.videos.length > 0) allTypes.push('video');
        if (comebacks.mp3s.length > 0) allTypes.push('mp3');
        if (comebacks.images.length > 0) allTypes.push('image');
        if (comebacks.imagesBase64.length > 0) allTypes.push('imageBase64');

        if (allTypes.length === 0) {
            return { type: 'line', content: 'Your bars are weak, human! 💀' };
        }

        // Helper to get unique item from array
        const getUniqueItem = (arr, prefix) => {
            if (!usedComebacks) {
                return arr[Math.floor(Math.random() * arr.length)];
            }
            // Filter out used items
            const available = arr.filter((item, idx) => {
                const key = `${prefix}:${typeof item === 'object' ? item.name || idx : item}`;
                return !usedComebacks.has(key);
            });
            // If all used, reset and pick any
            if (available.length === 0) {
                return arr[Math.floor(Math.random() * arr.length)];
            }
            const picked = available[Math.floor(Math.random() * available.length)];
            const idx = arr.indexOf(picked);
            const key = `${prefix}:${typeof picked === 'object' ? picked.name || idx : picked}`;
            usedComebacks.add(key);
            return picked;
        };

        const randomType = allTypes[Math.floor(Math.random() * allTypes.length)];

        switch (randomType) {
            case 'line':
                return {
                    type: 'line',
                    content: getUniqueItem(comebacks.lines, 'line')
                };
            case 'gif':
                return {
                    type: 'gif',
                    content: getUniqueItem(comebacks.gifs, 'gif')
                };
            case 'image':
                return {
                    type: 'image',
                    content: getUniqueItem(comebacks.images, 'image')
                };
            case 'imageBase64':
                return {
                    type: 'imageBase64',
                    content: getUniqueItem(comebacks.imagesBase64, 'imgb64')
                };
            case 'video':
                return {
                    type: 'video',
                    content: getUniqueItem(comebacks.videos, 'video')
                };
            case 'mp3':
                return {
                    type: 'mp3',
                    content: getUniqueItem(comebacks.mp3s, 'mp3')
                };
        }
    }

    /**
     * Download a file and return the path
     */
    async downloadFile(filePath, tempDir) {
        // File is already local, just return it
        return filePath;
    }

    /**
     * Send a comeback message
     * @param {boolean} forceMulti - Force multi-line output (2-4 lines)
     */
    async sendComeback(channel, comeback, comebacks, isFireMode = false, forceMulti = false) {
        try {
            if (comeback.type === 'line') {
                // In fire mode or forced, send multiple lines (2-4)
                const shouldMulti = forceMulti || (isFireMode && Math.random() < 0.5);
                if (shouldMulti) {
                    // 2-4 lines: 30% for 2, 40% for 3, 30% for 4
                    const rand = Math.random();
                    const numLines = rand < 0.3 ? 2 : (rand < 0.7 ? 3 : 4);
                    const lines = [comeback.content];
                    for (let i = 1; i < numLines; i++) {
                        const extra = comebacks.lines[Math.floor(Math.random() * comebacks.lines.length)];
                        if (extra && !lines.includes(extra)) lines.push(extra);
                    }
                    return await channel.send(lines.join('\n'));
                }
                return await channel.send(comeback.content);
            } else if (comeback.type === 'gif') {
                return await channel.send(comeback.content);
            } else if (comeback.type === 'image') {
                // Local image file
                const filePath = comeback.content;
                const fileName = path.basename(filePath);
                
                if (!fs.existsSync(filePath)) {
                    console.error(`Image not found: ${filePath}`);
                    const fallback = this.getRandomComeback({ ...comebacks, images: [], imagesBase64: [] });
                    return await channel.send(fallback.content || 'Your bars are weak!');
                }

                const attachment = new AttachmentBuilder(filePath, { name: fileName });
                return await channel.send({ files: [attachment] });
            } else if (comeback.type === 'imageBase64') {
                // Base64 encoded image
                const img = comeback.content;
                const ext = img.mimeType.split('/')[1] || 'png';
                const buffer = Buffer.from(img.data, 'base64');
                const attachment = new AttachmentBuilder(buffer, { name: `${img.name}.${ext}` });
                return await channel.send({ files: [attachment] });
            } else if (comeback.type === 'video' || comeback.type === 'mp3') {
                const filePath = comeback.content;
                const fileName = path.basename(filePath);
                
                // Check if file exists and is readable
                if (!fs.existsSync(filePath)) {
                    console.error(`File not found: ${filePath}`);
                    // Fallback to a line
                    const fallback = this.getRandomComeback({ ...comebacks, videos: [], mp3s: [] });
                    return await channel.send(fallback.content);
                }

                const attachment = new AttachmentBuilder(filePath, { name: fileName });
                return await channel.send({ files: [attachment] });
            }
        } catch (error) {
            console.error('Failed to send comeback:', error);
            // Fallback to a text line
            const fallback = this.getRandomComeback({ ...comebacks, videos: [], mp3s: [], gifs: [], images: [], imagesBase64: [] });
            return await channel.send(fallback.content);
        }
    }

    /**
     * Score a user's rap bar based on various criteria
     */
    scoreUserBar(content) {
        let score = 0;
        const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        
        // Base points for length (longer = more effort)
        if (words.length >= 3) score += 5;
        if (words.length >= 6) score += 5;
        if (words.length >= 10) score += 10;
        if (words.length >= 15) score += 10;
        
        // Rhyme detection (simple end-sound matching)
        const rhymeEndings = ['ay', 'ee', 'ow', 'ight', 'ine', 'ame', 'ade', 'ake', 'ate', 'ound', 'ick', 'ot', 'op', 'ack', 'an', 'it', 'ip', 'ock', 'unk', 'ash'];
        let rhymeCount = 0;
        for (const word of words) {
            for (const ending of rhymeEndings) {
                if (word.endsWith(ending)) {
                    rhymeCount++;
                    break;
                }
            }
        }
        if (rhymeCount >= 2) score += 10;
        if (rhymeCount >= 4) score += 15;
        
        // Fire keywords bonus
        const fireWords = ['fire', 'flame', 'heat', 'hot', 'burn', 'lit', 'sick', 'cold', 'ice', 'freeze', 'kill', 'dead', 'rip', 'bars', 'flow', 'spit', 'rap', 'beat', 'rhyme', 'mic', 'drop', 'bomb', 'explode', 'goat', 'king', 'queen', 'crown', 'throne', 'win', 'champ'];
        for (const word of words) {
            if (fireWords.includes(word)) {
                score += 5;
            }
        }
        
        // Diss bonus (targeting the bot)
        const dissWords = ['bot', 'robot', 'machine', 'ai', 'jarvis', 'humanoid', 'computer', 'code', 'program', 'algorithm', 'cpu', 'binary'];
        for (const word of words) {
            if (dissWords.includes(word)) {
                score += 8;
            }
        }
        
        // Emoji bonus (shows creativity)
        const emojiCount = (content.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        score += Math.min(emojiCount * 2, 10);
        
        // Caps lock bonus (INTENSITY)
        const capsWords = words.filter(w => w === w.toUpperCase() && w.length > 2);
        if (capsWords.length >= 2) score += 5;
        
        return score;
    }

    /**
     * Check if user is blocked from chat due to rap battle
     */
    isRapBattleBlocked(userId) {
        const unblockTime = this.rapBattleBlockedUsers.get(userId);
        if (!unblockTime) return false;
        
        if (Date.now() >= unblockTime) {
            // Time has passed, unblock user
            this.rapBattleBlockedUsers.delete(userId);
            return false;
        }
        
        return true;
    }

    /**
     * End a rap battle with tiered cooldowns based on fire mode reached (1-15)
     */
    endRapBattle(userId, channel, userWon, userScore = 0) {
        const battle = this.rapBattles.get(userId);
        if (!battle) return;

        // IMMEDIATELY mark as ended to stop all events
        battle.ended = true;
        battle.finalQuestionActive = false;

        // Stop collector FIRST to prevent any more message processing
        if (battle.collector && !battle.collector.ended) {
            try { battle.collector.stop(); } catch (e) {}
        }

        // Clean up ALL timers
        if (battle.timeoutId) {
            clearTimeout(battle.timeoutId);
            battle.timeoutId = null;
        }
        // Clean up all fire mode transition timers
        if (battle.fireModeTimeouts && Array.isArray(battle.fireModeTimeouts)) {
            battle.fireModeTimeouts.forEach(tid => clearTimeout(tid));
            battle.fireModeTimeouts = [];
        }
        // Clean up final question timers
        if (battle.finalQuestionTimeout) {
            clearTimeout(battle.finalQuestionTimeout);
            battle.finalQuestionTimeout = null;
        }
        if (battle.spamTimeout) {
            clearTimeout(battle.spamTimeout);
            battle.spamTimeout = null;
        }

        // Get fire mode config for cooldown
        const fireMode = battle.fireMode || 1;
        const fmConfig = battle.FIRE_MODES?.find(fm => fm.mode === fireMode);
        const cooldownMinutes = fmConfig?.cooldown || 1;
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const fmEmoji = fmConfig?.emoji || '🔥';
        const fmName = fmConfig?.name || 'FIRE';
        
        // Set the cooldown based on fire mode reached
        this.rapBattleCooldowns.set(userId, Date.now() + cooldownMs);
        
        // Remove from battles map immediately
        this.rapBattles.delete(userId);

        // Block chat for 3 seconds after battle ends
        const CHAT_UNBLOCK_DELAY = 3 * 1000;
        const unblockTime = Date.now() + CHAT_UNBLOCK_DELAY;
        this.rapBattleBlockedUsers.set(userId, unblockTime);

        // Dynamic win/lose messages based on fire mode tier
        let winMessages, loseMessages;
        
        if (fireMode === 15) {
            // ULTIMATE - Only reachable via final question (this shouldn't trigger normally)
            loseMessages = [
                `<@${userId}> reached **ULTIMATE** but failed the final test! 🏆💀\nThe answer was 21...`,
                `🏆 SO CLOSE! <@${userId}> made it to FM15 but couldn't answer 9+10! 🏆`,
                `<@${userId}> was at the PINNACLE but fell! 🏆💔\nIncredible run though!`
            ];
            winMessages = loseMessages; // Shouldn't happen - winners handled separately
        } else if (fireMode >= 13) {
            // COSMIC/INFINITE (13-14)
            loseMessages = [
                `<@${userId}> reached **${fmName}** but the universe had other plans ${fmEmoji}💀\nFM${fireMode} is INSANE!`,
                `${fmEmoji} <@${userId}> fell at Fire Mode ${fireMode}! ${fmEmoji}\nBeyond legendary effort!`,
                `<@${userId}> touched the ${fmName} realm but couldn't hold on! ${fmEmoji}💀\nRespect!`
            ];
            winMessages = loseMessages;
        } else if (fireMode >= 11) {
            // GODLIKE/SUPERNOVA (11-12)
            loseMessages = [
                `<@${userId}> reached **${fmName}** but fell at FM${fireMode}! ${fmEmoji}💀\nGodlike effort!`,
                `${fmEmoji} Fire Mode ${fireMode} claimed <@${userId}>! ${fmEmoji}\nYou almost ascended!`,
                `<@${userId}> was ${fmName} but couldn't finish! ${fmEmoji}💔\nIncredible run!`
            ];
            winMessages = loseMessages;
        } else if (fireMode === 10) {
            // LEGENDARY
            loseMessages = [
                `<@${userId}> reached LEGENDARY but fell! 👑💀\n5 more levels to go!`,
                `👑 Fire Mode 10 claimed <@${userId}>! 👑\nYou were getting close!`,
                `<@${userId}> touched LEGENDARY but couldn't hold it 👑💔\nSolid effort!`
            ];
            winMessages = loseMessages;
        } else if (fireMode >= 8) {
            // Death Zone (8-9)
            winMessages = [
                `💀💀 <@${userId}> SURVIVED THE **DEATH ZONE** AND WON! 💀💀\nFIRE MODE ${fireMode}! INSANE!`,
                `💀 **DEATH ZONE SURVIVOR**: <@${userId}>! 💀\nYou're built different fr fr!`,
                `<@${userId}> conquered FIRE MODE ${fireMode}! 💀🔥\nFew humans make it this far!`
            ];
            loseMessages = [
                `<@${userId}> died in the **DEATH ZONE** 💀\nFire Mode ${fireMode} claims another victim!`,
                `💀 The Death Zone was too much for <@${userId}> 💀\nBut respect for making it there!`,
                `<@${userId}> fell at Fire Mode ${fireMode}! 💀\nThe Death Zone is unforgiving!`
            ];
        } else if (fireMode >= 6) {
            // Volcanic (6-7)
            winMessages = [
                `🌋 <@${userId}> SURVIVED THE **VOLCANIC ERUPTION**! 🌋\nFire Mode ${fireMode} champion!`,
                `🌋🌋 **ERUPTION SURVIVOR**: <@${userId}>! 🌋🌋\nThe lava couldn't burn you!`,
                `<@${userId}> conquered the volcano at Fire Mode ${fireMode}! 🌋🔥`
            ];
            loseMessages = [
                `<@${userId}> got buried by the **VOLCANIC ERUPTION** 🌋💀\nFire Mode ${fireMode} too hot!`,
                `🌋 The volcano claimed <@${userId}> at Fire Mode ${fireMode}! 🌋`,
                `<@${userId}> couldn't handle the ERUPTION! 🌋\nSolid effort though!`
            ];
        } else if (fireMode >= 4) {
            // Thunder/Lightning (4-5)
            winMessages = [
                `⚡ <@${userId}> conquered **THUNDER MODE**! ⚡\nFire Mode ${fireMode} complete!`,
                `⚡⚡ **LIGHTNING FAST**: <@${userId}>! ⚡⚡\nYou matched my speed!`,
                `<@${userId}> survived the storm at Fire Mode ${fireMode}! ⚡🏆`
            ];
            loseMessages = [
                `<@${userId}> got struck by **LIGHTNING** ⚡💀\nFire Mode ${fireMode} too fast!`,
                `⚡ Thunder claimed <@${userId}> at Fire Mode ${fireMode}! ⚡`,
                `<@${userId}> couldn't keep up with the storm! ⚡\nGood attempt though!`
            ];
        } else {
            // Fire modes 1-3 (warm up / getting hot / on fire)
            winMessages = [
                `🏆 <@${userId}> won at Fire Mode ${fireMode}! 🔥`,
                `W for <@${userId}>! 🔥 Solid bars!`,
                `<@${userId}> took the crown! 👑🔥`,
                `gg <@${userId}>, your flow was clean 💯`
            ];
            loseMessages = [
                `<@${userId}> lost at Fire Mode ${fireMode} 💀`,
                `L for <@${userId}>... try again! 😂`,
                `<@${userId}> got cooked early 🔥💀`,
                `gg ez <@${userId}>, HUMANOID wins 🏆`
            ];
        }

        const randomWin = winMessages[Math.floor(Math.random() * winMessages.length)];
        const randomLose = loseMessages[Math.floor(Math.random() * loseMessages.length)];
        
        // Build result message with score and fire mode info
        const barsDropped = battle.userBars || 0;
        const fireModeText = `${fmEmoji} Fire Mode Reached: **${fireMode}/15 (${fmName})**`;
        const scoreText = barsDropped > 0 ? `\n📊 Stats: ${barsDropped} bars | Score: ${userScore}` : '';
        const cooldownInfo = `\n⏱️ Cooldown: ${cooldownMinutes} minute${cooldownMinutes > 1 ? 's' : ''}`;
        const message = (userWon ? randomWin : randomLose) + `\n${fireModeText}${scoreText}${cooldownInfo}`;
        
        channel.send(message).catch(err => {
            console.error('Failed to send rap battle end message:', err);
        });
    }

    // ============ USER FEATURES HANDLERS ============

    async handleRemindCommand(interaction) {
        const userFeatures = require('./user-features');
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const channelId = interaction.channelId;

        try {
            if (subcommand === 'set') {
                const message = interaction.options.getString('message');
                const timeInput = interaction.options.getString('time');
                
                const result = await userFeatures.createReminder(userId, channelId, message, timeInput);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply(
                    `⏰ Reminder set, sir.\n**Message:** ${message}\n**When:** ${result.formattedTime}\n**ID:** \`${result.reminder.id}\``
                );
            } else if (subcommand === 'list') {
                const reminders = await userFeatures.getUserReminders(userId);
                
                if (reminders.length === 0) {
                    await interaction.editReply('No pending reminders, sir. Use `/remind set` to create one.');
                    return;
                }
                
                const lines = await Promise.all(reminders.map(async (r, i) => {
                    const time = await userFeatures.formatTimeForUser(userId, new Date(r.scheduledFor));
                    return `${i + 1}. **${r.message}**\n   ⏰ ${time} | ID: \`${r.id}\``;
                }));
                
                await interaction.editReply(`📋 **Your Reminders:**\n\n${lines.join('\n\n')}`);
            } else if (subcommand === 'cancel') {
                const reminderId = interaction.options.getString('id');
                const result = await userFeatures.cancelReminder(userId, reminderId);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply('✅ Reminder cancelled, sir.');
            }
        } catch (error) {
            console.error('[/remind] Error:', error);
            await interaction.editReply('Failed to process reminder command, sir.');
        }
    }

    async handleTimezoneCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const zone = interaction.options.getString('zone');

        try {
            if (!zone) {
                const currentZone = await userFeatures.getTimezone(userId);
                const currentTime = await userFeatures.formatTimeForUser(userId);
                await interaction.editReply(
                    `🌍 **Your Timezone:** ${currentZone}\n🕐 **Current Time:** ${currentTime}\n\nUse \`/timezone zone:America/New_York\` to change.`
                );
                return;
            }

            const result = await userFeatures.setTimezone(userId, zone);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            const currentTime = await userFeatures.formatTimeForUser(userId);
            await interaction.editReply(`✅ Timezone set to **${result.timezone}**\n🕐 Current time: ${currentTime}`);
        } catch (error) {
            console.error('[/timezone] Error:', error);
            await interaction.editReply('Failed to update timezone, sir.');
        }
    }

    async handleWakewordCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const word = interaction.options.getString('word');

        try {
            if (!word) {
                const currentWord = await userFeatures.getWakeWord(userId);
                if (currentWord) {
                    await interaction.editReply(`🎯 **Your Custom Wake Word:** "${currentWord}"\n\nUse \`/wakeword word:newword\` to change, or say "${currentWord}" to summon me.`);
                } else {
                    await interaction.editReply(`No custom wake word set, sir.\n\nUse \`/wakeword word:yourword\` to set one. I'll respond when you say it!`);
                }
                return;
            }

            const result = await userFeatures.setWakeWord(userId, word);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            await interaction.editReply(`✅ Custom wake word set to **"${result.wakeWord}"**\n\nNow you can summon me by saying "${result.wakeWord}" in any message!`);
        } catch (error) {
            console.error('[/wakeword] Error:', error);
            await interaction.editReply('Failed to update wake word, sir.');
        }
    }

    async handleMyStatsCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;

        try {
            const stats = await userFeatures.getUserStats(userId);
            const timezone = await userFeatures.getTimezone(userId);
            const wakeWord = await userFeatures.getWakeWord(userId);
            
            const firstDate = new Date(stats.firstInteraction);
            const daysSince = Math.floor((Date.now() - stats.firstInteraction) / (1000 * 60 * 60 * 24));
            
            const embed = {
                color: 0x3498db,
                title: `📊 ${interaction.user.username}'s Jarvis Stats`,
                fields: [
                    { name: '💬 Messages', value: `${stats.messageCount || 0}`, inline: true },
                    { name: '🔍 Searches', value: `${stats.searchesPerformed || 0}`, inline: true },
                    { name: '⚡ Commands', value: `${stats.commandsUsed || 0}`, inline: true },
                    { name: '⏰ Reminders Created', value: `${stats.remindersCreated || 0}`, inline: true },
                    { name: '🌍 Timezone', value: timezone, inline: true },
                    { name: '🎯 Wake Word', value: wakeWord || 'None set', inline: true },
                    { name: '📅 First Interaction', value: `${firstDate.toLocaleDateString()} (${daysSince} days ago)`, inline: false },
                ],
                footer: { text: 'Stats are approximate and may reset periodically' },
                timestamp: new Date().toISOString()
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[/mystats] Error:', error);
            await interaction.editReply('Failed to retrieve stats, sir.');
        }
    }
}

module.exports = new DiscordHandlers();
