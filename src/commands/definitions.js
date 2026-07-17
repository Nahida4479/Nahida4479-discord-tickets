const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('panel-tickets')
        .setDescription('Skonfiguruj i wyslij panel do tworzenia ticketow na tym kanale')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Wyjasnia jak dziala system ticketow na tym serwerze')
        .toJSON(),
];

module.exports = { commands };
