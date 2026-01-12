const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../../services/database');
const { isDjAdmin, isDj, isBlocked } = require('../../utils/dj-system');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dj')
        .setDescription('Manage DJ system settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Toggle DJ-only mode (everything restricted to DJs/Admins)')
                .addBooleanOption(option =>
                    option.setName('enabled').setDescription('Enable or disable DJ mode').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Add or remove a user from the specific DJ list')
                .addStringOption(option =>
                    option.setName('action').setDescription('Add or remove').setRequired(true).addChoices(
                        { name: 'Add', value: 'add' },
                        { name: 'Remove', value: 'remove' }
                    )
                )
                .addUserOption(option =>
                    option.setName('target').setDescription('The user to manage').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('role')
                .setDescription('Add or remove a role from the DJ roles list')
                .addStringOption(option =>
                    option.setName('action').setDescription('Add or remove').setRequired(true).addChoices(
                        { name: 'Add', value: 'add' },
                        { name: 'Remove', value: 'remove' }
                    )
                )
                .addRoleOption(option =>
                    option.setName('target').setDescription('The role to manage').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('block')
                .setDescription('Block a user from using music commands')
                .addUserOption(option =>
                    option.setName('target').setDescription('The user to block').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unblock')
                .setDescription('Unblock a user from using music commands')
                .addUserOption(option =>
                    option.setName('target').setDescription('The user to unblock').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List current DJ settings')
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const guildConfig = await database.getGuildConfig(guildId);
        const subcommand = interaction.options.getSubcommand();

        // LIST command is available to everyone (view only)
        if (subcommand === 'list') {
            const djMode = guildConfig.features?.dj_mode ? '✅ Enabled' : '❌ Disabled';

            const djRoles = (guildConfig.djRoleIds || [])
                .map(id => `<@&${id}>`)
                .join(', ') || 'None';

            const djUsers = (guildConfig.djUserIds || [])
                .map(id => `<@${id}>`)
                .join(', ') || 'None';

            const blockedUsers = (guildConfig.blockedUserIds || [])
                .map(id => `<@${id}>`)
                .join(', ') || 'None';

            const embed = new EmbedBuilder()
                .setTitle('🎧 DJ System Configuration')
                .setColor(0x3498db)
                .addFields(
                    { name: 'Status', value: `DJ Mode: ${djMode}`, inline: false },
                    { name: 'DJ Roles', value: djRoles, inline: false },
                    { name: 'DJ Users', value: djUsers, inline: false },
                    { name: 'Blocked Users', value: blockedUsers, inline: false }
                )
                .setFooter({ text: 'Admins & True Mods always have access' });

            return interaction.reply({ embeds: [embed] });
        }

        // For all other commands, require DJ Admin permissions
        if (!isDjAdmin(interaction.member, guildConfig)) {
            return interaction.reply({
                content: '❌ You do not have permission to configure the DJ system.\nRequires: Admin, Server Owner, Bot Owner, or True Mod permissions.',
                ephemeral: true
            });
        }

        // TOGGLE DJ MODE
        if (subcommand === 'toggle') {
            const enabled = interaction.options.getBoolean('enabled');
            await database.updateGuildFeatures(guildId, { dj_mode: enabled });

            return interaction.reply({
                content: enabled
                    ? '🔒 **DJ Mode Enabled**: Only Admins and DJs can control music.'
                    : '🔓 **DJ Mode Disabled**: Everyone can control music (unless blocked).',
                ephemeral: false
            });
        }

        // MANAGE USERS
        if (subcommand === 'user') {
            const action = interaction.options.getString('action');
            const target = interaction.options.getUser('target');
            const currentUsers = guildConfig.djUserIds || [];

            if (action === 'add') {
                if (currentUsers.includes(target.id)) {
                    return interaction.reply(`ℹ️ ${target} is already a DJ user.`);
                }
                const newUsers = [...currentUsers, target.id];
                await database.setGuildDjUsers(guildId, newUsers);
                return interaction.reply(`✅ Added ${target} to the DJ list.`);
            } else {
                if (!currentUsers.includes(target.id)) {
                    return interaction.reply(`ℹ️ ${target} is not in the DJ list.`);
                }
                const newUsers = currentUsers.filter(id => id !== target.id);
                await database.setGuildDjUsers(guildId, newUsers);
                return interaction.reply(`✅ Removed ${target} from the DJ list.`);
            }
        }

        // MANAGE ROLES
        if (subcommand === 'role') {
            const action = interaction.options.getString('action');
            const target = interaction.options.getRole('target');
            const currentRoles = guildConfig.djRoleIds || [];

            if (action === 'add') {
                if (currentRoles.includes(target.id)) {
                    return interaction.reply(`ℹ️ ${target} is already a DJ role.`);
                }
                const newRoles = [...currentRoles, target.id];
                await database.setGuildDjRoles(guildId, newRoles);
                return interaction.reply(`✅ Added ${target} to the DJ roles.`);
            } else {
                if (!currentRoles.includes(target.id)) {
                    return interaction.reply(`ℹ️ ${target} is not in the DJ roles list.`);
                }
                const newRoles = currentRoles.filter(id => id !== target.id);
                await database.setGuildDjRoles(guildId, newRoles);
                return interaction.reply(`✅ Removed ${target} from the DJ roles.`);
            }
        }

        // BLOCK USER
        if (subcommand === 'block') {
            const target = interaction.options.getUser('target');

            // Prevent blocking admins/owners
            const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (targetMember && isDjAdmin(targetMember, guildConfig)) {
                return interaction.reply({ content: '❌ You cannot block an Admin/Mod.', ephemeral: true });
            }

            if (isBlocked(target.id, guildConfig)) {
                return interaction.reply(`ℹ️ ${target} is already blocked.`);
            }

            await database.addGuildBlockedUser(guildId, target.id);
            return interaction.reply(`🚫 Blocked ${target} from using music commands.`);
        }

        // UNBLOCK USER
        if (subcommand === 'unblock') {
            const target = interaction.options.getUser('target');

            if (!isBlocked(target.id, guildConfig)) {
                return interaction.reply(`ℹ️ ${target} is not blocked.`);
            }

            await database.removeGuildBlockedUser(guildId, target.id);
            return interaction.reply(`✅ Unblocked ${target}.`);
        }
    }
};
