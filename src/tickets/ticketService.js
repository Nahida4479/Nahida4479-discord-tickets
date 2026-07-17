const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
} = require('discord.js');
const db = require('../database/db');
const { isOwnerOrAdmin } = require('../utils/permissions');

function buildCloseControlEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Zarzadzanie ticketem')
        .setDescription(
            'Kliknij ponizszy przycisk, aby zamknac ten ticket.\n' +
            'Jesli zrobi to autor ticketa - kanal zamknie sie od razu.\n' +
            'Jesli zrobi to administrator - autor ticketa zostanie poproszony o potwierdzenie.'
        );
}

function sanitizeChannelName(name) {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'ticket';
}

async function handleOpenTicketButton(interaction, buttonId) {
    const panelButton = await db.getPanelButton(buttonId);
    if (!panelButton) {
        await interaction.reply({ content: 'Ten przycisk nie jest juz aktywny.', ephemeral: true });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`ticket_reason_modal:${buttonId}`)
        .setTitle(`Otwieranie ticketa: ${panelButton.label}`.slice(0, 45));

    const reasonInput = new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('Podaj powod otwarcia ticketa')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal);
}

async function handleTicketReasonModalSubmit(interaction, buttonId) {
    const panelButton = await db.getPanelButton(buttonId);
    if (!panelButton) {
        await interaction.reply({ content: 'Ten przycisk nie jest juz aktywny.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const reason = interaction.fields.getTextInputValue('ticket_reason');
    const guild = interaction.guild;
    const category = await guild.channels.fetch(panelButton.categoryId).catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply({ content: 'Kategoria ustawiona dla tego przycisku juz nie istnieje. Skontaktuj sie z administracja.' });
        return;
    }

    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
        },
        {
            id: interaction.client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
        },
    ];

    for (const roleId of panelButton.accessRoles) {
        overwrites.push({
            id: roleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
    }
    for (const userId of panelButton.accessUsers) {
        overwrites.push({
            id: userId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
    }

    const channelName = sanitizeChannelName(`ticket-${panelButton.label}-${interaction.user.username}`);

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites,
    });

    const ticketId = await db.createTicket({
        guildId: guild.id,
        channelId: channel.id,
        panelButtonId: panelButton.id,
        openerId: interaction.user.id,
        reason,
    });

    await channel.setName(sanitizeChannelName(`ticket-${ticketId}-${interaction.user.username}`)).catch(() => {});

    const controlEmbed = buildCloseControlEmbed();
    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close:${ticketId}`).setLabel('Zamknij ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [controlEmbed], components: [closeRow] });

    const mentions = [
        ...panelButton.pingRoles.map((id) => `<@&${id}>`),
        `<@${interaction.user.id}>`,
    ].join(' ');

    const infoEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Nowy ticket: ${panelButton.label}`)
        .setDescription(panelButton.content ? panelButton.content : 'Dziekujemy za utworzenie ticketa. Ktos z zespolu wkrotce sie odezwie.')
        .addFields({ name: 'Powod otwarcia', value: reason.slice(0, 1024) })
        .setFooter({ text: `Ticket utworzony przez ${interaction.user.tag}` })
        .setTimestamp();

    await channel.send({ content: mentions, embeds: [infoEmbed] });

    await interaction.editReply({ content: `Twoj ticket zostal utworzony: ${channel}` });
}

function hasTicketAccess(interaction, panelButton) {
    if (isOwnerOrAdmin(interaction)) return true;
    if (panelButton.accessUsers.includes(interaction.user.id)) return true;
    return panelButton.accessRoles.some((roleId) => interaction.member.roles.cache.has(roleId));
}

async function handleCloseButton(interaction, ticketId) {
    const ticket = await db.getTicket(ticketId);
    if (!ticket) {
        await interaction.reply({ content: 'Nie znaleziono tego ticketa.', ephemeral: true });
        return;
    }
    if (ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest juz zamkniety.', ephemeral: true });
        return;
    }

    if (interaction.user.id === ticket.openerId) {
        await interaction.reply({ content: 'Zamykasz ticket...' });
        await closeTicketAndArchive(interaction.client, ticket, `Ticket zamkniety przez autora ${interaction.user.tag}.`);
        return;
    }

    const panelButton = await db.getPanelButton(ticket.panelButtonId);
    if (!panelButton || !hasTicketAccess(interaction, panelButton)) {
        await interaction.reply({ content: 'Nie masz uprawnien do zamkniecia tego ticketa.', ephemeral: true });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('Prosba o zamkniecie ticketa')
        .setDescription(
            `<@${ticket.openerId}>, administrator **${interaction.user.tag}** chce zamknac ten ticket. Czy sie zgadzasz?\n` +
            'Jesli nie odpowiesz w ciagu 12 godzin, ticket zostanie zamkniety automatycznie.'
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close_confirm_yes:${ticketId}`).setLabel('Tak').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ticket_close_confirm_no:${ticketId}`).setLabel('Nie').setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.reply({ content: `<@${ticket.openerId}>`, embeds: [embed], components: [row], fetchReply: true });
    await db.setCloseRequest(ticketId, interaction.user.id, message.id);
}

async function handleCloseConfirmYes(interaction, ticketId) {
    const ticket = await db.getTicket(ticketId);
    if (!ticket || ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest juz zamkniety.', ephemeral: true });
        return;
    }
    if (interaction.user.id !== ticket.openerId) {
        await interaction.reply({ content: 'Tylko osoba, ktora otworzyla ticket moze to potwierdzic.', ephemeral: true });
        return;
    }

    await interaction.update({ content: 'Potwierdzono. Zamykanie ticketa...', embeds: [], components: [] });
    await closeTicketAndArchive(interaction.client, ticket, `Ticket zamkniety za zgoda autora ${interaction.user.tag}.`);
}

async function handleCloseConfirmNo(interaction, ticketId) {
    const ticket = await db.getTicket(ticketId);
    if (!ticket || ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest juz zamkniety.', ephemeral: true });
        return;
    }
    if (interaction.user.id !== ticket.openerId) {
        await interaction.reply({ content: 'Tylko osoba, ktora otworzyla ticket moze to potwierdzic.', ephemeral: true });
        return;
    }

    await interaction.update({ content: 'Prosba o zamkniecie ticketa zostala odrzucona. Korespondencja moze byc kontynuowana.', embeds: [], components: [] });
    await db.clearCloseRequest(ticketId);
}

async function closeTicketAndArchive(client, ticket, reasonText) {
    await db.closeTicket(ticket.id);

    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Ticket zamkniety')
        .setDescription(`${reasonText}\nKanal zostanie usuniety za 10 sekund.`);

    await channel.send({ embeds: [embed] }).catch(() => {});
    setTimeout(() => {
        channel.delete().catch(() => {});
    }, 10_000);
}

async function autoCloseExpiredRequests(client) {
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    const ticketIds = await db.getPendingCloseRequests(twelveHoursMs);

    for (const ticketId of ticketIds) {
        const ticket = await db.getTicket(ticketId);
        if (!ticket || ticket.status !== 'open') continue;
        await closeTicketAndArchive(client, ticket, 'Ticket zamkniety automatycznie po 12 godzinach braku odpowiedzi na prosbe o zamkniecie.');
    }
}

module.exports = {
    handleOpenTicketButton,
    handleTicketReasonModalSubmit,
    handleCloseButton,
    handleCloseConfirmYes,
    handleCloseConfirmNo,
    autoCloseExpiredRequests,
};
