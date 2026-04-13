'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const database = require('../database');
const vaultClient = require('../vault-client');

async function handleMemoryCommand(handler, interaction) {
    try {
        const limitOption = interaction.options.getInteger('entries');
        const limit = Math.max(1, Math.min(limitOption || 50, 50));
        const { user } = interaction;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!database.isConnected) {
            await interaction.editReply('Memory subsystem offline, sir. Please try again later.');
            return;
        }

        const profile = await database.getUserProfile(userId, userName);
        const memoryPreferenceRaw = profile?.preferences?.memoryOpt ?? 'opt-in';
        const preference = String(memoryPreferenceRaw).toLowerCase();
        const isOptedOut = preference === 'opt-out';

        let allMemories = [];

        if (!isOptedOut) {
            try {
                allMemories = await vaultClient.decryptMemories(userId, { limit });
            } catch (error) {
                console.error('Failed to decrypt secure memories for memory command:', error);
            }
        }

        const normalize = (entry) => {
            const payload = entry?.data || entry?.value || entry?.payload || null;
            return {
                createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
                prompt: payload?.userMessage || payload?.prompt || null,
                reply: payload?.jarvisResponse || payload?.response || null,
                userName: payload?.userName || 'User',
                isShortTerm: !!entry.isShortTerm
            };
        };

        const normalized = allMemories
            .map(normalize)
            .filter((e) => e.prompt || e.reply)
            .sort((a, b) => b.createdAt - a.createdAt);

        const embed = new EmbedBuilder()
            .setTitle('Memory Diagnostics')
            .setColor(isOptedOut ? 0x64748b : 0x38bdf8)
            .addFields(
                {
                    name: 'Preference',
                    value: isOptedOut
                        ? 'Opted **out** — no long-term memories retained.'
                        : 'Opted **in** — long-term memory active.',
                    inline: true
                },
                { name: 'Interactions Logged', value: String(profile?.interactions ?? 0), inline: true }
            )
            .setFooter({ text: 'Use /opt to change your memory preference.' });

        if (isOptedOut) {
            embed.addFields({ name: 'Status', value: 'All stored memories have been purged per your preference, sir.' });
        } else {
            embed.addFields({ name: 'Vault Entries', value: String(normalized.length), inline: true });
        }

        await interaction.editReply({ embeds: [embed] });

        // Send full memory dump as text file via DM
        if (!isOptedOut && normalized.length) {
            const sorted = [...normalized].sort((a, b) => a.createdAt - b.createdAt);
            const dumpLines = sorted.map((entry, idx) => {
                const prompt = entry.prompt || '(no prompt)';
                const response = entry.reply || '(no response)';
                return `[${idx + 1}] User (${entry.userName}): ${prompt}\nJarvis: ${response}`;
            });

            const fileContent = `JARVIS MEMORY DUMP\nUser: ${userName} (${userId})\nEntries: ${sorted.length}\nGenerated: ${new Date().toISOString()}\n\n${dumpLines.join('\n\n')}`;

            try {
                const buffer = Buffer.from(fileContent, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: 'jarvis-memory-dump.txt' });
                const dmChannel = await interaction.user.createDM();
                await dmChannel.send({
                    content: `Here are your ${sorted.length} memory entries, sir.`,
                    files: [attachment]
                });
            } catch (dmError) {
                console.warn('[Memory] DM send failed:', dmError.message);
            }
        }
    } catch (error) {
        console.error('handleMemoryCommand failed:', error);
        try {
            await interaction.editReply('Memory diagnostics failed internally, sir. Please try again shortly.');
        } catch (replyErr) { console.debug('[Memory] Failed to send error reply:', replyErr.message); }
    }
}

module.exports = { handleMemoryCommand };
