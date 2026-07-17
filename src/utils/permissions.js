const { PermissionFlagsBits } = require('discord.js');

function isOwnerOrAdmin(interaction) {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

module.exports = { isOwnerOrAdmin };
