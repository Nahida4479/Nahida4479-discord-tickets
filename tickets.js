require('dotenv').config();

const { createClient } = require('@libsql/client');
const {
    Client,
    GatewayIntentBits,
    Partials,
    MessageFlags,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
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
    StickerFormatType,
} = require('discord.js');

const token = process.env.bot;

if (!token) {
    console.error('Brak tokenu bota. Ustaw zmienną "bot" w pliku .env');
    process.exit(1);
}

const MAX_BUTTONS = 25;
const IMAGE_WAIT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Baza danych (Turso / libSQL)
// ---------------------------------------------------------------------------

const dbClient = createClient({
    url: process.env.turso_link,
    authToken: process.env.turso,
});

async function initDb() {
    await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS panels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT,
            embed_title TEXT,
            embed_description TEXT,
            embed_footer TEXT,
            embed_image_url TEXT,
            created_at INTEGER NOT NULL
        )
    `);

    await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS panel_buttons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            label TEXT NOT NULL,
            emoji TEXT,
            style INTEGER NOT NULL,
            message_content TEXT,
            category_id TEXT NOT NULL,
            ping_roles TEXT NOT NULL DEFAULT '[]',
            access_roles TEXT NOT NULL DEFAULT '[]',
            access_users TEXT NOT NULL DEFAULT '[]',
            ask_reason INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (panel_id) REFERENCES panels(id)
        )
    `);

    await dbClient.execute(`ALTER TABLE panel_buttons ADD COLUMN ask_reason INTEGER NOT NULL DEFAULT 1`).catch(() => {});

    await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            panel_button_id INTEGER NOT NULL,
            opener_id TEXT NOT NULL,
            reason TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            close_requested_by TEXT,
            close_requested_at INTEGER,
            close_request_message_id TEXT,
            created_at INTEGER NOT NULL,
            closed_at INTEGER,
            FOREIGN KEY (panel_button_id) REFERENCES panel_buttons(id)
        )
    `);
}

async function createPanel({ guildId, channelId, title, description, footer, imageUrl }) {
    const result = await dbClient.execute({
        sql: `INSERT INTO panels (guild_id, channel_id, embed_title, embed_description, embed_footer, embed_image_url, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [guildId, channelId, title, description, footer, imageUrl, Date.now()],
    });
    return Number(result.lastInsertRowid);
}

async function setPanelMessageId(panelId, messageId) {
    await dbClient.execute({
        sql: `UPDATE panels SET message_id = ? WHERE id = ?`,
        args: [messageId, panelId],
    });
}

async function addPanelButton({ panelId, position, label, emoji, style, content, categoryId, pingRoles, accessRoles, accessUsers, askReason }) {
    const result = await dbClient.execute({
        sql: `INSERT INTO panel_buttons (panel_id, position, label, emoji, style, message_content, category_id, ping_roles, access_roles, access_users, ask_reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [panelId, position, label, emoji, style, content, categoryId, JSON.stringify(pingRoles), JSON.stringify(accessRoles), JSON.stringify(accessUsers), askReason ? 1 : 0],
    });
    return Number(result.lastInsertRowid);
}

async function getPanelButton(buttonId) {
    const result = await dbClient.execute({
        sql: `SELECT * FROM panel_buttons WHERE id = ?`,
        args: [buttonId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
        id: Number(row.id),
        panelId: Number(row.panel_id),
        label: row.label,
        emoji: row.emoji ? JSON.parse(row.emoji) : null,
        style: Number(row.style),
        content: row.message_content,
        categoryId: row.category_id,
        pingRoles: JSON.parse(row.ping_roles),
        accessRoles: JSON.parse(row.access_roles),
        accessUsers: JSON.parse(row.access_users),
        askReason: Number(row.ask_reason) === 1,
    };
}

async function createTicket({ guildId, channelId, panelButtonId, openerId, reason }) {
    const result = await dbClient.execute({
        sql: `INSERT INTO tickets (guild_id, channel_id, panel_button_id, opener_id, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [guildId, channelId, panelButtonId, openerId, reason, Date.now()],
    });
    return Number(result.lastInsertRowid);
}

async function getTicket(ticketId) {
    const result = await dbClient.execute({
        sql: `SELECT * FROM tickets WHERE id = ?`,
        args: [ticketId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        channelId: row.channel_id,
        panelButtonId: Number(row.panel_button_id),
        openerId: row.opener_id,
        reason: row.reason,
        status: row.status,
        closeRequestedBy: row.close_requested_by,
        closeRequestedAt: row.close_requested_at ? Number(row.close_requested_at) : null,
        closeRequestMessageId: row.close_request_message_id,
        createdAt: Number(row.created_at),
        closedAt: row.closed_at ? Number(row.closed_at) : null,
    };
}

async function setCloseRequest(ticketId, requestedBy, messageId) {
    await dbClient.execute({
        sql: `UPDATE tickets SET close_requested_by = ?, close_requested_at = ?, close_request_message_id = ? WHERE id = ?`,
        args: [requestedBy, Date.now(), messageId, ticketId],
    });
}

async function clearCloseRequest(ticketId) {
    await dbClient.execute({
        sql: `UPDATE tickets SET close_requested_by = NULL, close_requested_at = NULL, close_request_message_id = NULL WHERE id = ?`,
        args: [ticketId],
    });
}

async function closeTicket(ticketId) {
    await dbClient.execute({
        sql: `UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?`,
        args: [Date.now(), ticketId],
    });
}

async function getPendingCloseRequests(olderThanMs) {
    const threshold = Date.now() - olderThanMs;
    const result = await dbClient.execute({
        sql: `SELECT id FROM tickets WHERE status = 'open' AND close_requested_at IS NOT NULL AND close_requested_at <= ?`,
        args: [threshold],
    });
    return result.rows.map((row) => Number(row.id));
}

// ---------------------------------------------------------------------------
// Funkcje pomocnicze
// ---------------------------------------------------------------------------

function isOwnerOrAdmin(interaction) {
    if (!interaction.guild) return false;
    if (interaction.guild.ownerId === interaction.user.id) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

function parseEmojiInput(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const customMatch = trimmed.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
    if (customMatch) {
        return { id: customMatch[2], name: customMatch[1] };
    }

    return { id: null, name: trimmed };
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

// ---------------------------------------------------------------------------
// Komenda /help
// ---------------------------------------------------------------------------

async function executeHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('System ticketów - jak to działa')
        .setDescription(
            'Poniżej znajdziesz pełny opis działania systemu ticketów na tym serwerze.'
        )
        .addFields(
            {
                name: '1. Konfiguracja panelu (administracja)',
                value:
                    'Osoba z uprawnieniami administratora lub właściciel serwera może użyć komendy `/panel-tickets`. ' +
                    'Uruchamia to kreator, w którym można ustawić: tytuł embeda, treść embeda, stopkę, ' +
                    'obrazek, gif, mp4 lub naklejkę (wysłaną jako załącznik lub naklejkę na czacie) oraz dowolną liczbę przycisków (do 25). ' +
                    'Dla każdego przycisku można określić: etykietę, emoji, treść wiadomości wysyłanej po utworzeniu ticketa, ' +
                    'role oznaczane (ping) przy tworzeniu ticketa, role/osoby mające dostęp do ticketów z tego przycisku, ' +
                    'kategorię, w której będą tworzone kanały ticketów oraz czy przy otwieraniu ticketa ma pojawić się ' +
                    'pytanie o powód (można to wyłączyć dla danego przycisku).',
            },
            {
                name: '2. Wysyłka panelu',
                value: 'Po zakończeniu konfiguracji embed z przyciskami zostaje wysłany na kanał, na którym użyto komendy.',
            },
            {
                name: '3. Tworzenie ticketa',
                value:
                    'Kliknięcie przycisku otwiera formularz z pytaniem o powód otwarcia ticketa (chyba że administrator wyłączył to pytanie dla danego przycisku). ' +
                    'Po jego wypełnieniu bot tworzy nowy kanał w wyznaczonej kategorii, widoczny tylko dla osoby, ' +
                    'która otworzyła ticket oraz dla zdefiniowanych dla danego przycisku ról/osób. ' +
                    'Na kanale wysyłana jest wiadomość z oznaczeniem odpowiednich ról/osób oraz podanym powodem (jeśli został podany).',
            },
            {
                name: '4. Zamykanie ticketa',
                value:
                    'Na górze kanału znajduje się wiadomość z przyciskiem "Zamknij ticket". ' +
                    'Jeśli kliknie go osoba, która otworzyła ticket - kanał zamyka się od razu. ' +
                    'Jeśli kliknie go administrator/osoba z dostępem - wysyłane jest pytanie do autora ticketa, ' +
                    'czy zgadza się na zamknięcie (przyciski Tak/Nie). Kliknięcie "Tak" zamyka ticket, ' +
                    '"Nie" usuwa pytanie i pozwala kontynuować rozmowę. Jeśli autor nie odpowie w ciągu 12 godzin, ' +
                    'ticket zamknie się automatycznie.',
            },
            {
                name: '5. Widoczność ticketów',
                value:
                    'Każdy przycisk ma własną listę ról/osób z dostępem - osoby przypisane tylko do jednego przycisku ' +
                    '(np. "Partnerstwo") nie zobaczą ticketów utworzonych przez inny przycisk (np. "Pomoc").',
            }
        )
        .setFooter({ text: 'W razie pytań skontaktuj się z administracją serwera.' });

    await interaction.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Kreator konfiguracji panelu ticketów (/panel-tickets)
// ---------------------------------------------------------------------------

const wizardSessions = new Map();

function createWizardSession(userId, data) {
    wizardSessions.set(userId, {
        guildId: data.guildId,
        channelId: data.channelId,
        embed: { title: null, description: null, footer: null, imageUrl: null, imageBuffer: null, imageFileName: null },
        buttons: [],
        draft: null,
        imageCollectorActive: false,
    });
    return wizardSessions.get(userId);
}

function getWizardSession(userId) {
    return wizardSessions.get(userId) || null;
}

function deleteWizardSession(userId) {
    wizardSessions.delete(userId);
}

async function startPanelWizard(interaction) {
    if (!isOwnerOrAdmin(interaction)) {
        await interaction.reply({ content: 'Ta komenda jest dostępna tylko dla właściciela serwera lub administratorów.', ephemeral: true });
        return;
    }

    createWizardSession(interaction.user.id, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
    });

    const modal = new ModalBuilder().setCustomId('panel_embed_modal').setTitle('Konfiguracja panelu ticketów (1/3)');

    const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Tytuł embeda')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(true);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('embed_description')
        .setLabel('Treść embeda')
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
    const session = getWizardSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasła. Użyj ponownie /panel-tickets.', ephemeral: true });
        return;
    }

    session.embed.title = interaction.fields.getTextInputValue('embed_title');
    session.embed.description = interaction.fields.getTextInputValue('embed_description');
    const footer = interaction.fields.getTextInputValue('embed_footer');
    session.embed.footer = footer && footer.length > 0 ? footer : null;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_image_skip').setLabel('Pomiń obrazek/gif').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content:
            'Krok 2/3: wyślij teraz na tym kanale obrazek, gif, mp4 (jako załącznik) lub naklejkę, ' +
            `która ma pojawić się w embedzie panelu. Masz na to ${IMAGE_WAIT_MS / 60000} minut. Możesz też pominąć ten krok.`,
        components: [row],
        ephemeral: true,
    });

    session.menuInteraction = interaction;
    startImageCollector(interaction, session);
}

function extractEmbedMedia(message) {
    const attachment = message.attachments.first();
    if (attachment) {
        return { url: attachment.url, name: attachment.name || 'zalacznik.png' };
    }

    const sticker = message.stickers.first();
    if (sticker) {
        if (sticker.format === StickerFormatType.Lottie) {
            return { unsupported: true };
        }
        const extension = sticker.url.split('.').pop().split('?')[0] || 'png';
        return { url: sticker.url, name: `${sanitizeChannelName(sticker.name || 'naklejka')}.${extension}` };
    }

    return null;
}

function startImageCollector(interaction, session) {
    if (session.imageCollectorActive) return;
    session.imageCollectorActive = true;

    const channel = interaction.channel;
    const collector = channel.createMessageCollector({
        filter: (msg) => msg.author.id === interaction.user.id && (msg.attachments.size > 0 || msg.stickers.size > 0),
        time: IMAGE_WAIT_MS,
    });

    collector.on('collect', async (message) => {
        const media = extractEmbedMedia(message);
        await message.delete().catch(() => {});

        if (media?.unsupported) {
            await interaction.followUp({
                content: 'Ta naklejka jest w formacie wektorowym (Lottie) i nie może być użyta jako obrazek embeda. Wyślij plik, gif, mp4 lub inną naklejkę (obrazkową/animowaną).',
                ephemeral: true,
            }).catch(() => {});
            return;
        }

        if (!media) return;

        session.embed.imageUrl = media.url;

        try {
            const response = await fetch(media.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            session.embed.imageBuffer = buffer;
            session.embed.imageFileName = media.name;
        } catch (error) {
            console.error('Nie udało się pobrać załącznika embeda:', error);
        }

        session.imageCollectorActive = false;
        collector.stop();
        await showMainMenu(interaction, session);
    });

    collector.on('end', async () => {
        session.imageCollectorActive = false;
        if (session.embed.imageUrl === null && !session.menuShown) {
            await showMainMenu(interaction, session);
        }
    });
}

async function handleImageSkip(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session) {
        await interaction.update({ content: 'Sesja konfiguracji wygasła. Użyj ponownie /panel-tickets.', components: [] });
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

function buildFinalPanelPayload(session) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(session.embed.title)
        .setDescription(session.embed.description);

    if (session.embed.footer) embed.setFooter({ text: session.embed.footer });

    const files = [];
    if (session.embed.imageBuffer) {
        embed.setImage(`attachment://${session.embed.imageFileName}`);
        files.push({ attachment: session.embed.imageBuffer, name: session.embed.imageFileName });
    } else if (session.embed.imageUrl) {
        embed.setImage(session.embed.imageUrl);
    }

    return { embed, files };
}

function renderEmojiLabel(emoji) {
    if (!emoji) return '';
    return emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name;
}

function buildMenuContent(session) {
    if (session.buttons.length === 0) {
        return 'Krok 3/3: dodaj przynajmniej jeden przycisk ticketu, aby móc wysłać panel.';
    }
    const list = session.buttons
        .map((b, i) => `**${i + 1}.** ${b.emoji ? renderEmojiLabel(b.emoji) + ' ' : ''}${b.label}`)
        .join('\n');
    return `Krok 3/3: skonfigurowane przyciski (${session.buttons.length}/${MAX_BUTTONS}):\n${list}`;
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
            .setLabel('Zakończ i wyślij panel')
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
    const session = getWizardSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasła. Użyj ponownie /panel-tickets.', ephemeral: true });
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
        .setLabel('Treść wiadomości na kanale ticketu')
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
    const session = getWizardSession(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: 'Sesja konfiguracji wygasła. Użyj ponownie /panel-tickets.', ephemeral: true });
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
        askReason: true,
    };

    await interaction.reply(buildPingStepPayload(session));
}

function buildPingStepPayload(session) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('panel_ping_roles')
        .setPlaceholder('Wybierz role do oznaczenia po utworzeniu ticketa (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('panel_reason_toggle')
            .setLabel(
                session.draft.askReason
                    ? 'Pytanie o powód: WŁĄCZONE ✅'
                    : 'Pytanie o powód: WYŁĄCZONE ❌'
            )
            .setStyle(session.draft.askReason ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_ping_next').setLabel('Dalej ➡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content:
            `Konfiguracja przycisku **${session.draft.label}** - krok 1/3: wybierz role do oznaczenia (ping) po utworzeniu ticketa.\n` +
            'Możesz też włączyć/wyłączyć pytanie o powód otwarcia ticketa poniżej.',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(roleSelect), toggleRow, nextRow],
        ephemeral: true,
    };
}

async function handleReasonToggle(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }
    session.draft.askReason = !session.draft.askReason;
    await interaction.update(buildPingStepPayload(session));
}

function buildAccessStepPayload(session) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('panel_access_roles')
        .setPlaceholder('Role z dostępem do ticketów tego przycisku (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('panel_access_users')
        .setPlaceholder('Konkretne osoby z dostępem do ticketów tego przycisku (opcjonalnie)')
        .setMinValues(0)
        .setMaxValues(25);

    const nextRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_access_next').setLabel('Dalej ➡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `Konfiguracja przycisku **${session.draft.label}** - krok 2/3: wybierz role i/lub osoby, które będą widzieć i mieć dostęp do ticketów otwartych tym przyciskiem (poza osobą, która otworzy ticket).`,
        components: [new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(userSelect), nextRow],
    };
}

function buildCategoryStepPayload(session) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('panel_category_select')
        .setPlaceholder('Wybierz kategorię dla kanałów ticketów tego przycisku')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1);

    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_draft_cancel').setLabel('Anuluj przycisk').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `Konfiguracja przycisku **${session.draft.label}** - krok 3/3: wybierz kategorię, w której będą tworzone kanały ticketów.`,
        components: [new ActionRowBuilder().addComponents(channelSelect), cancelRow],
    };
}

async function handlePingRolesSelect(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.pingRoles = interaction.values;
    await interaction.deferUpdate();
}

async function handlePingNext(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }
    await interaction.update(buildAccessStepPayload(session));
}

async function handleAccessRolesSelect(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.accessRoles = interaction.values;
    await interaction.deferUpdate();
}

async function handleAccessUsersSelect(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    session.draft.accessUsers = interaction.values;
    await interaction.deferUpdate();
}

async function handleAccessNext(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }
    await interaction.update(buildCategoryStepPayload(session));
}

async function handleCategorySelect(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || !session.draft) {
        await interaction.update({ content: 'Sesja wygasla.', components: [] });
        return;
    }

    session.draft.categoryId = interaction.values[0];
    session.buttons.push(session.draft);
    session.draft = null;

    await interaction.update({
        content: `Przycisk dodany! Wróć do panelu głównego powyżej, aby dodać kolejny przycisk lub wysłać panel.`,
        components: [],
    });

    await refreshMainMenu(session);
}

async function handleDraftCancel(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (session) session.draft = null;
    await interaction.update({ content: 'Anulowano dodawanie przycisku.', components: [] });
    if (session) await refreshMainMenu(session);
}

async function handleMenuCancel(interaction) {
    deleteWizardSession(interaction.user.id);
    await interaction.update({ content: 'Konfiguracja panelu ticketów została anulowana.', embeds: [], components: [] });
}

async function handleMenuFinish(interaction) {
    const session = getWizardSession(interaction.user.id);
    if (!session || session.buttons.length === 0) {
        await interaction.reply({ content: 'Dodaj przynajmniej jeden przycisk przed wysłaniem panelu.', ephemeral: true });
        return;
    }

    await interaction.deferUpdate();

    const panelId = await createPanel({
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
        const buttonId = await addPanelButton({
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
            askReason: b.askReason,
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

    const { embed, files } = buildFinalPanelPayload(session);
    const channel = await interaction.client.channels.fetch(session.channelId);
    const panelMessage = await channel.send({ embeds: [embed], components: buttonRows.slice(0, 5), files });

    await setPanelMessageId(panelId, panelMessage.id);

    await interaction.editReply({ content: 'Panel ticketów został wysłany na kanał! ✅', embeds: [], components: [] });
    deleteWizardSession(interaction.user.id);
}

// ---------------------------------------------------------------------------
// Logika ticketów (tworzenie, zamykanie, auto-zamknięcie po 12h)
// ---------------------------------------------------------------------------

function buildCloseControlEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Zarządzanie ticketem')
        .setDescription(
            'Kliknij poniższy przycisk, aby zamknąć ten ticket.\n' +
            'Jeśli zrobi to autor ticketa - kanał zamknie się od razu.\n' +
            'Jeśli zrobi to administrator - autor ticketa zostanie poproszony o potwierdzenie.'
        );
}

async function handleOpenTicketButton(interaction, buttonId) {
    const panelButton = await getPanelButton(buttonId);
    if (!panelButton) {
        await interaction.reply({ content: 'Ten przycisk nie jest już aktywny.', ephemeral: true });
        return;
    }

    if (!panelButton.askReason) {
        await interaction.deferReply({ ephemeral: true });
        await createTicketChannel(interaction, panelButton, null);
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`ticket_reason_modal:${buttonId}`)
        .setTitle(`Otwieranie ticketa: ${panelButton.label}`.slice(0, 45));

    const reasonInput = new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('Podaj powód otwarcia ticketa')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal);
}

async function handleTicketReasonModalSubmit(interaction, buttonId) {
    const panelButton = await getPanelButton(buttonId);
    if (!panelButton) {
        await interaction.reply({ content: 'Ten przycisk nie jest już aktywny.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const reason = interaction.fields.getTextInputValue('ticket_reason');
    await createTicketChannel(interaction, panelButton, reason);
}

async function createTicketChannel(interaction, panelButton, reason) {
    const guild = interaction.guild;
    const category = await guild.channels.fetch(panelButton.categoryId).catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply({ content: 'Kategoria ustawiona dla tego przycisku już nie istnieje. Skontaktuj się z administracją.' });
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

    const ticketId = await createTicket({
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
        .setDescription(panelButton.content ? panelButton.content : 'Dziękujemy za utworzenie ticketa. Ktoś z zespołu wkrótce się odezwie.')
        .setFooter({ text: `Ticket utworzony przez ${interaction.user.tag}` })
        .setTimestamp();

    if (reason) {
        infoEmbed.addFields({ name: 'Powód otwarcia', value: reason.slice(0, 1024) });
    }

    await channel.send({ content: mentions, embeds: [infoEmbed] });

    await interaction.editReply({ content: `Twój ticket został utworzony: ${channel}` });
}

function hasTicketAccess(interaction, panelButton) {
    if (isOwnerOrAdmin(interaction)) return true;
    if (panelButton.accessUsers.includes(interaction.user.id)) return true;
    return panelButton.accessRoles.some((roleId) => interaction.member.roles.cache.has(roleId));
}

async function handleCloseButton(interaction, ticketId) {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
        await interaction.reply({ content: 'Nie znaleziono tego ticketa.', ephemeral: true });
        return;
    }
    if (ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest już zamknięty.', ephemeral: true });
        return;
    }

    if (interaction.user.id === ticket.openerId) {
        await interaction.reply({ content: 'Zamykasz ticket...' });
        await closeTicketAndArchive(interaction.client, ticket, `Ticket zamknięty przez autora ${interaction.user.tag}.`);
        return;
    }

    const panelButton = await getPanelButton(ticket.panelButtonId);
    if (!panelButton || !hasTicketAccess(interaction, panelButton)) {
        await interaction.reply({ content: 'Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('Prośba o zamknięcie ticketa')
        .setDescription(
            `<@${ticket.openerId}>, administrator **${interaction.user.tag}** chce zamknąć ten ticket. Czy się zgadzasz?\n` +
            'Jeśli nie odpowiesz w ciągu 12 godzin, ticket zostanie zamknięty automatycznie.'
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close_confirm_yes:${ticketId}`).setLabel('Tak').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ticket_close_confirm_no:${ticketId}`).setLabel('Nie').setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.reply({ content: `<@${ticket.openerId}>`, embeds: [embed], components: [row], fetchReply: true });
    await setCloseRequest(ticketId, interaction.user.id, message.id);
}

async function handleCloseConfirmYes(interaction, ticketId) {
    const ticket = await getTicket(ticketId);
    if (!ticket || ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest już zamknięty.', ephemeral: true });
        return;
    }
    if (interaction.user.id !== ticket.openerId) {
        await interaction.reply({ content: 'Tylko osoba, która otworzyła ticket może to potwierdzić.', ephemeral: true });
        return;
    }

    await interaction.update({ content: 'Potwierdzono. Zamykanie ticketa...', embeds: [], components: [] });
    await closeTicketAndArchive(interaction.client, ticket, `Ticket zamknięty za zgodą autora ${interaction.user.tag}.`);
}

async function handleCloseConfirmNo(interaction, ticketId) {
    const ticket = await getTicket(ticketId);
    if (!ticket || ticket.status !== 'open') {
        await interaction.reply({ content: 'Ten ticket jest już zamknięty.', ephemeral: true });
        return;
    }
    if (interaction.user.id !== ticket.openerId) {
        await interaction.reply({ content: 'Tylko osoba, która otworzyła ticket może to potwierdzić.', ephemeral: true });
        return;
    }

    await interaction.update({ content: 'Prośba o zamknięcie ticketa została odrzucona. Korespondencja może być kontynuowana.', embeds: [], components: [] });
    await clearCloseRequest(ticketId);
}

async function closeTicketAndArchive(client, ticket, reasonText) {
    await closeTicket(ticket.id);

    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Ticket zamknięty')
        .setDescription(`${reasonText}\nKanał zostanie usunięty za 10 sekund.`);

    await channel.send({ embeds: [embed] }).catch(() => {});
    setTimeout(() => {
        channel.delete().catch(() => {});
    }, 10_000);
}

async function autoCloseExpiredRequests(client) {
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    const ticketIds = await getPendingCloseRequests(twelveHoursMs);

    for (const ticketId of ticketIds) {
        const ticket = await getTicket(ticketId);
        if (!ticket || ticket.status !== 'open') continue;
        await closeTicketAndArchive(client, ticket, 'Ticket zamknięty automatycznie po 12 godzinach braku odpowiedzi na prośbę o zamknięcie.');
    }
}

// ---------------------------------------------------------------------------
// Rejestracja komend slash
// ---------------------------------------------------------------------------

const slashCommands = [
    new SlashCommandBuilder()
        .setName('panel-tickets')
        .setDescription('Skonfiguruj i wyślij panel do tworzenia ticketów na tym kanale')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Wyjaśnia jak działa system ticketów na tym serwerze')
        .toJSON(),
];

async function deploySlashCommands() {
    const rest = new REST({ version: '10' }).setToken(token);
    const application = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(application.id), { body: slashCommands });
    console.log(`Zarejestrowano ${slashCommands.length} komend globalnych dla aplikacji ${application.id}.`);
}

// ---------------------------------------------------------------------------
// Klient Discord i router interakcji
// ---------------------------------------------------------------------------

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    await initDb();
    await deploySlashCommands().catch((error) => {
        console.error('Nie udało się zarejestrować komend:', error);
    });
    console.log(`Zalogowano jako ${client.user.tag}`);

    setInterval(() => {
        autoCloseExpiredRequests(client).catch((error) => {
            console.error('Błąd podczas automatycznego zamykania ticketów:', error);
        });
    }, 5 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'panel-tickets') {
                await startPanelWizard(interaction);
            } else if (interaction.commandName === 'help') {
                await executeHelp(interaction);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'panel_embed_modal') {
                await handleEmbedModalSubmit(interaction);
            } else if (interaction.customId === 'panel_button_modal') {
                await handleButtonModalSubmit(interaction);
            } else if (interaction.customId.startsWith('ticket_reason_modal:')) {
                const buttonId = Number(interaction.customId.split(':')[1]);
                await handleTicketReasonModalSubmit(interaction, buttonId);
            }
            return;
        }

        if (interaction.isButton()) {
            const [prefix, param] = interaction.customId.split(':');
            switch (prefix) {
                case 'panel_image_skip':
                    await handleImageSkip(interaction);
                    break;
                case 'panel_menu_add':
                    await handleMenuAdd(interaction);
                    break;
                case 'panel_menu_finish':
                    await handleMenuFinish(interaction);
                    break;
                case 'panel_menu_cancel':
                    await handleMenuCancel(interaction);
                    break;
                case 'panel_reason_toggle':
                    await handleReasonToggle(interaction);
                    break;
                case 'panel_ping_next':
                    await handlePingNext(interaction);
                    break;
                case 'panel_access_next':
                    await handleAccessNext(interaction);
                    break;
                case 'panel_draft_cancel':
                    await handleDraftCancel(interaction);
                    break;
                case 'open_ticket':
                    await handleOpenTicketButton(interaction, Number(param));
                    break;
                case 'ticket_close':
                    await handleCloseButton(interaction, Number(param));
                    break;
                case 'ticket_close_confirm_yes':
                    await handleCloseConfirmYes(interaction, Number(param));
                    break;
                case 'ticket_close_confirm_no':
                    await handleCloseConfirmNo(interaction, Number(param));
                    break;
                default:
                    break;
            }
            return;
        }

        if (interaction.isRoleSelectMenu()) {
            if (interaction.customId === 'panel_ping_roles') {
                await handlePingRolesSelect(interaction);
            } else if (interaction.customId === 'panel_access_roles') {
                await handleAccessRolesSelect(interaction);
            }
            return;
        }

        if (interaction.isUserSelectMenu()) {
            if (interaction.customId === 'panel_access_users') {
                await handleAccessUsersSelect(interaction);
            }
            return;
        }

        if (interaction.isChannelSelectMenu()) {
            if (interaction.customId === 'panel_category_select') {
                await handleCategorySelect(interaction);
            }
            return;
        }
    } catch (error) {
        console.error('Błąd obsługi interakcji:', error);
        const payload = { content: 'Wystąpił nieoczekiwany błąd podczas przetwarzania tej akcji.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

client.login(token);
