const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    RoleSelectMenuBuilder,
    UserSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
} = require('discord.js');
const { isOwnerOrAdmin } = require('../utils/permissions');
const { parseEmojiInput } = require('../utils/emoji');
const { createSession, getSession, deleteSession } = require('./sessions');
const db = require('../database/db');

const MAX_BUTTONS = 25;
const IMAGE_WAIT_MS = 5 * 60 * 1000;

async function startPanelWizard(interaction) {
    if (!isOwnerOrAdmin(interaction)) {
        await interaction.reply({ content: 'Ta komenda jest dostepna tylko dla wlasciciela serwera lub administratorow.', ephemeral: true });
        return;
    }

    createSession(interaction.user.id, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
    });

    const modal = new ModalBuilder().setCustomId('panel_embed_modal').setTitle('Konfiguracja panelu ticketow (1/3)');

    const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Tytul embeda')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(true);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('embed_description')
        .setLabel('Tresc embeda')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true);

    const footerInput = new TextInputBuilder()
        .setCustomId('embed_footer')
        .setLabel('Stopka embeda (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(footerInput)
    );

    await interaction.showModal(modal);
}

async function handleEmbedModalSubmit(interaction) {
    const session = getSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasla. Uzyj ponownie /panel-tickets.', ephemeral: true });
        return;
    }

    session.embed.title = interaction.fields.getTextInputValue('embed_title');
    session.embed.description = interaction.fields.getTextInputValue('embed_description');
    const footer = interaction.fields.getTextInputValue('embed_footer');
    session.embed.footer = footer && footer.length > 0 ? footer : null;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_image_skip').setLabel('Pomin obrazek/gif').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content:
            'Krok 2/3: wyslij teraz na tym kanale obrazek lub gif jako zalacznik, ktory ma pojawic sie w embedzie panelu. ' +
            `Masz na to ${IMAGE_WAIT_MS / 60000} minut. Mozesz tez pominac ten krok.`,
        components: [row],
        ephemeral: true,
    });

    session.menuInteraction = interaction;
    startImageCollector(interaction, session);
}

function startImageCollector(interaction, session) {
    if (session.imageCollectorActive) return;
    session.imageCollectorActive = true;

    const channel = interaction.channel;
    const collector = channel.createMessageCollector({
        filter: (msg) => msg.author.id === interaction.user.id && msg.attachments.size > 0,
        max: 1,
        time: IMAGE_WAIT_MS,
    });

    collector.on('collect', async (message) => {
        const attachment = message.attachments.first();
        session.embed.imageUrl = attachment.url;
        session.imageCollectorActive = false;
        await message.delete().catch(() => {});
        await showMainMenu(interaction, session);
    });

    collector.on('end', async (collected) => {
        session.imageCollectorActive = false;
        if (collected.size === 0 && session.embed.imageUrl === null && !session.menuShown) {
            await showMainMenu(interaction, session);
        }
    });
}

async function handleImageSkip(interaction) {
    const session = getSession(interaction.user.id);
    if (!session) {
        await interaction.update({ content: 'Sesja konfiguracji wygasla. Uzyj ponownie /panel-tickets.', components: [] });
        return;
    }
    session.imageCollectorActive = false;
    await showMainMenu(interaction, session, true);
}

function buildPreviewEmbed(session) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(session.embed.title)
        .setDescription(session.embed.description);

    if (session.embed.footer) embed.setFooter({ text: session.embed.footer });
    if (session.embed.imageUrl) embed.setImage(session.embed.imageUrl);

    return embed;
}

function buildMenuContent(session) {
    if (session.buttons.length === 0) {
        return 'Krok 3/3: dodaj przynajmniej jeden przycisk ticketu, aby moc wyslac panel.';
    }
    const list = session.buttons
        .map((b, i) => `**${i + 1}.** ${b.emoji ? renderEmojiLabel(b.emoji) + ' ' : ''}${b.label}`)
        .join('\n');
    return `Krok 3/3: skonfigurowane przyciski (${session.buttons.length}/${MAX_BUTTONS}):\n${list}`;
}

function renderEmojiLabel(emoji) {
    if (!emoji) return '';
    return emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;
}

function buildMenuComponents(session) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('panel_menu_add')
            .setLabel('Dodaj przycisk')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(session.buttons.length >= MAX_BUTTONS),
        new ButtonBuilder()
            .setCustomId('panel_menu_finish')
            .setLabel('Zakoncz i wyslij panel')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(session.buttons.length === 0),
        new ButtonBuilder().setCustomId('panel_menu_cancel').setLabel('Anuluj').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );
    return [row];
}

async function showMainMenu(interaction, session, isComponentInteraction = false) {
    session.menuShown = true;
    const payload = {
        content: buildMenuContent(session),
        embeds: [buildPreviewEmbed(session)],
        components: buildMenuComponents(session),
    };

    if (isComponentInteraction) {
        await interaction.update(payload);
        session.menuInteraction = interaction;
    } else if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload);
        session.menuInteraction = interaction;
    } else {
        await interaction.reply({ ...payload, ephemeral: true });
        session.menuInteraction = interaction;
    }
}

async function refreshMainMenu(session) {
    if (!session.menuInteraction) return;
    await session.menuInteraction.editReply({
        content: buildMenuContent(session),
        embeds: [buildPreviewEmbed(session)],
        components: buildMenuComponents(session),
    }).catch(() => {});
}

async function handleMenuAdd(interaction) {
    const session = getSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasla. Uzyj ponownie /panel-tickets.', ephemeral: true });
        return;
    }

    const modal = new ModalBuilder().setCustomId('panel_button_modal').setTitle('Nowy przycisk ticketu');

    const labelInput = new TextInputBuilder()
        .setCustomId('button_label')
        .setLabel('Etykieta przycisku')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true);

    const emojiInput = new TextInputBuilder()
        .setCustomId('button_emoji')
        .setLabel('Emoji (opcjonalnie), np. 🎫 lub <:nazwa:id>')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(false);

    const contentInput = new TextInputBuilder()
        .setCustomId('button_content')
        .setLabel('Tresc wiadomosci na kanale ticketu')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1500)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(labelInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(contentInput)
    );

    await interaction.showModal(modal);
}

async function handleButtonModalSubmit(interaction) {
    const session = getSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasla. Uzyj ponownie /panel-tickets.', ephemeral: true });
        return;
    }

    const label = interaction.fields.getTextInputValue('button_label');
    const emojiRaw = interaction.fields.getTextInputValue('button_emoji');
    const content = interaction.fields.getTextInputValue('button_content');

    session.draft = {
        label,
        emoji: parseEmojiInput(emojiRaw),
        content: content && content.length > 0 ? content : null,
        pingRoles: [],
        accessRoles: [],
        accessUsers: [],
        categoryId: null,
    };

    await interaction.reply(buildPingStepPayload(session));
}

function buildPingStepPayload(session) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('panel_ping_roles')
        .setPlaceholder('Wybierz role do oznaczenia po utworzeniu ticketa (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_ping_next').setLabel('Dalej ➡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `Konfiguracja przycisku **${session.draft.label}** - krok 1/3: wybierz role do oznaczenia (ping) po utworzeniu ticketa.`,
        embeds: [],
        components: [new ActionRowBuilder().addComponents(roleSelect), nextRow],
        ephemeral: true,
    };
}

function buildAccessStepPayload(session) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('panel_access_roles')
        .setPlaceholder('Role z dostepem do ticketow tego przycisku (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('panel_access_users')
        .setPlaceholder('Konkretne osoby z dostepem do ticketow tego przycisku (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_access_next').setLabel('Dalej ➡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `Konfiguracja przycisku **${session.draft.label}** - krok 2/3: wybierz role i/lub osoby, ktore beda widziec i miec dostep do ticketow otwartych tym przyciskiem (poza osoba, ktora otworzy ticket).`,
        components: [new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(userSelect), nextRow],
    };
}

function buildCategoryStepPayload(session) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('panel_category_select')
        .setPlaceholder('Wybierz kategorie dla kanalow ticketow tego przycisku')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1);

    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `Konfiguracja przycisku **${session.draft.label}** - krok 3/3: wybierz kategorie, w ktorej beda tworzone kanaly ticketow.`,
        components: [new ActionRowBuilder().addComponents(channelSelect), cancelRow],
    };
}

async function handlePingRolesSelect(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.pingRoles = interaction.values;
    await interaction.deferUpdate();
}

async function handlePingNext(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }
    await interaction.update(buildAccessStepPayload(session));
}

async function handleAccessRolesSelect(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.accessRoles = interaction.values;
    await interaction.deferUpdate();
}

async function handleAccessUsersSelect(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.accessUsers = interaction.values;
    await interaction.deferUpdate();
}

async function handleAccessNext(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }
    await interaction.update(buildCategoryStepPayload(session));
}

async function handleCategorySelect(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }

    session.draft.categoryId = interaction.values[0];
    session.buttons.push(session.draft);
    session.draft = null;

    await interaction.update({
        content: `Przycisk dodany! Wroc do panelu glownego powyzej, aby dodac kolejny przycisk lub wyslac panel.`,
        components: [],
    });

    await refreshMainMenu(session);
}

async function handleDraftCancel(interaction) {
    const session = getSession(interaction.user.id);
    if (session) session.draft = null;
    await interaction.update({ content: 'Anulowano dodawanie przycisku.', components: [] });
    if (session) await refreshMainMenu(session);
}

async function handleMenuCancel(interaction) {
    deleteSession(interaction.user.id);
    await interaction.update({ content: 'Konfiguracja panelu ticketow zostala anulowana.', embeds: [], components: [] });
}

async function handleMenuFinish(interaction) {
    const session = getSession(interaction.user.id);
    if (!session || session.buttons.length === 0) {
        await interaction.reply({ content: 'Dodaj przynajmniej jeden przycisk przed wyslaniem panelu.', ephemeral: true });
        return;
    }

    await interaction.deferUpdate();

    const panelId = await db.createPanel({
        guildId: session.guildId,
        channelId: session.channelId,
        title: session.embed.title,
        description: session.embed.description,
        footer: session.embed.footer,
        imageUrl: session.embed.imageUrl,
    });

    const buttonRows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < session.buttons.length; i++) {
        const b = session.buttons[i];
        const buttonId = await db.addPanelButton({
            panelId,
            position: i,
            label: b.label,
            emoji: b.emoji ? JSON.stringify(b.emoji) : null,
            style: ButtonStyle.Primary,
            content: b.content,
            categoryId: b.categoryId,
            pingRoles: b.pingRoles,
            accessRoles: b.accessRoles,
            accessUsers: b.accessUsers,
        });

        const ticketButton = new ButtonBuilder()
            .setCustomId(`open_ticket:${buttonId}`)
            .setLabel(b.label)
            .setStyle(ButtonStyle.Primary);

        if (b.emoji) ticketButton.setEmoji(b.emoji.id ? { id: b.emoji.id, name: b.emoji.name } : b.emoji.name);

        if (currentRow.components.length === 5) {
            buttonRows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        currentRow.addComponents(ticketButton);
    }
    if (currentRow.components.length > 0) buttonRows.push(currentRow);

    const embed = buildPreviewEmbed(session);
    const channel = await interaction.client.channels.fetch(session.channelId);
    const panelMessage = await channel.send({ embeds: [embed], components: buttonRows.slice(0, 5) });

    await db.setPanelMessageId(panelId, panelMessage.id);

    await interaction.editReply({ content: 'Panel ticketow zostal wyslany na kanal! ✅', embeds: [], components: [] });
    deleteSession(interaction.user.id);
}

module.exports = {
    startPanelWizard,
    handleEmbedModalSubmit,
    handleImageSkip,
    handleMenuAdd,
    handleMenuFinish,
    handleMenuCancel,
    handleButtonModalSubmit,
    handlePingRolesSelect,
    handlePingNext,
    handleAccessRolesSelect,
    handleAccessUsersSelect,
    handleAccessNext,
    handleCategorySelect,
    handleDraftCancel,
};
