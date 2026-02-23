'use strict';

const { EmbedBuilder } = require('discord.js');
const database = require('../database');
const vaultClient = require('../vault-client');

async function handleMemoryCommand(handler, interaction) {
    try {
        const limitOption = interaction.options.getInteger('entries');
        const limit = Math.max(1, Math.min(limitOption || 5, 30));
        const user = interaction.user;
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

        let historyEntries = [];
        let usedSecureMemories = false;

        if (!isOptedOut) {
            try {
                const secureMemories = await vaultClient.decryptMemories(userId, { limit: 60 });
                if (secureMemories.length) {
                    usedSecureMemories = true;

                    const normalize = (entry) => {
                        const payload = entry?.data || entry?.value || entry?.payload || null;
                        return {
                            createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
                            prompt: payload?.userMessage || payload?.prompt || null,
                            reply: payload?.jarvisResponse || payload?.response || null,
                            isShortTerm: !!entry.isShortTerm
                        };
                    };

                    const normalized = secureMemories
                        .map(normalize)
                        .filter((e) => e.prompt || e.reply)
                        .sort((a, b) => b.createdAt - a.createdAt);

                    const longTerm = normalized.filter((e) => !e.isShortTerm).slice(0, 20);
                    const shortTerm = normalized.filter((e) => e.isShortTerm).slice(0, 10);
                    historyEntries = [...longTerm, ...shortTerm].slice(0, limit);
                }
            } catch (error) {
                console.error('Failed to decrypt secure memories for memory command:', error);
            }

            if (!historyEntries.length) {
                try {
                    const conversations = await database.getRecentConversations(userId, limit);
                    historyEntries = conversations
                        .map((conv) => ({
                            createdAt: conv.createdAt ? new Date(conv.createdAt) : (conv.timestamp ? new Date(conv.timestamp) : new Date()),
                            prompt: conv.userMessage || null,
                            reply: conv.jarvisResponse || null,
                            isShortTerm: false
                        }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                } catch (error) {
                    console.error('Failed to load recent conversations for memory command:', error);
                }
            }
        }

        const formatSnippet = (text) => {
            if (!text) {
                return '—';
            }
            const clean = text.replace(/\s+/g, ' ').trim();
            return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
        };

        const lines = historyEntries.slice(0, limit).map((entry) => {
            const timestamp = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:R>`;
            const prompt = formatSnippet(entry.prompt);
            const reply = formatSnippet(entry.reply);
            const tag = usedSecureMemories ? (entry.isShortTerm ? ' (short-term)' : ' (long-term)') : '';
            return `• ${timestamp}${tag}\n  • Prompt: ${prompt}\n  • Reply: ${reply}`;
        });

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
        } else if (lines.length) {
            let memoryValue = lines.join('\n\n');
            if (memoryValue.length > 1020) {
                const truncatedLines = [];
                let totalLength = 0;
                for (const line of lines) {
                    if (totalLength + line.length + 2 > 1000) break;
                    truncatedLines.push(line);
                    totalLength += line.length + 2;
                }
                memoryValue = truncatedLines.length ? truncatedLines.join('\n\n') + '\n\n*...more entries truncated*' : 'Memory entries too long to display.';
            }
            embed.addFields({
                name: `Recent Memories ${usedSecureMemories ? '(secure vault)' : ''}`,
                value: memoryValue || 'No entries to display.'
            });
        } else {
            embed.addFields({ name: 'Recent Memories', value: 'No stored entries yet, sir.' });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('handleMemoryCommand failed:', error);
        try {
            await interaction.editReply('Memory diagnostics failed internally, sir. Please try again shortly.');
        } catch {}
    }
}

async function handlePersonaCommand(handler, interaction) {
    await interaction.editReply('Persona switching has been disabled. Jarvis primary protocol is now fixed, sir.');
    return;
    const requested = interaction.options.getString('mode');
    const previewOnly = interaction.options.getBoolean('preview') || false;
    const catalogue = handler.jarvis.getPersonaCatalogue();

    const user = interaction.user;
    const userId = user.id;
    const userName = user.displayName || user.username;

    if (!catalogue.size) {
        await interaction.editReply('Persona modules unavailable, sir.');
        return;
    }

    let profile = null;
    if (database.isConnected) {
        profile = await database.getUserProfile(userId, userName);
    }

    const currentKeyRaw = profile?.preferences?.persona || 'jarvis';
    const currentKey = String(currentKeyRaw).toLowerCase();
    const currentPersona = catalogue.get(currentKey) || catalogue.get('jarvis');

    if (!requested) {
        const embed = new EmbedBuilder()
            .setTitle('Persona Alignment')
            .setColor(0x8b5cf6)
            .setDescription(`Active persona: **${currentPersona?.label || 'Jarvis'}**`)
            .addFields({ name: 'Directive', value: currentPersona?.directive || 'Maintain default Jarvis protocol.' })
            .setFooter({ text: 'Run /persona mode:<persona> to switch styles.' });

        if (currentPersona?.sample) {
            embed.addFields({ name: 'Sample Cadence', value: currentPersona.sample });
        }

        await interaction.editReply({ embeds: [embed], ephemeral: true });
        return;
    }

    const requestedKey = String(requested).toLowerCase();
    const personaDetails = catalogue.get(requestedKey);

    if (!personaDetails) {
        await interaction.editReply('Unknown persona requested, sir. Try jarvis, stark, friday, or ultron.');
        return;
    }

    if (!database.isConnected && !previewOnly) {
        await interaction.editReply('Unable to persist persona preference right now, sir. Database offline.');
        return;
    }

    if (!previewOnly && requestedKey === currentKey) {
        await interaction.editReply(`Already aligned with the **${personaDetails.label}** persona, sir.`);
        return;
    }

    if (!previewOnly && database.isConnected) {
        try {
            await database.setUserPreference(userId, 'persona', requestedKey);
        } catch (error) {
            console.error('Failed to save persona preference:', error);
            await interaction.editReply('Unable to update persona preference right now, sir.');
            return;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(previewOnly ? 'Persona Preview' : 'Persona Updated')
        .setColor(previewOnly ? 0x22d3ee : 0xa855f7)
        .setDescription(previewOnly
            ? `Previewing **${personaDetails.label}** directives. Preference unchanged.`
            : `Future replies will follow the **${personaDetails.label}** directive.`)
        .addFields({ name: 'Directive', value: personaDetails.directive });

    if (personaDetails.sample) {
        embed.addFields({ name: 'Sample Cadence', value: personaDetails.sample });
    }

    embed.setFooter({ text: previewOnly ? 'Run /persona without preview to commit the change.' : 'Persona preference stored. Use /persona to review or switch.' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
}

module.exports = { handleMemoryCommand, handlePersonaCommand };
