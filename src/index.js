require('dotenv').config();
const { Client, GatewayIntentBits, Partials, MessageFlags } = require('discord.js');
const db = require('./database/db');
const help = require('./commands/help');
const wizard = require('./wizard/panelWizard');
const ticketService = require('./tickets/ticketService');

const token = process.env.bot;

if (!token) {
    console.error('Brak tokenu bota. Ustaw zmienna "bot" w pliku .env');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    await db.init();
    console.log(`Zalogowano jako ${client.user.tag}`);

    setInterval(() => {
        ticketService.autoCloseExpiredRequests(client).catch((error) => {
            console.error('Blad podczas automatycznego zamykania ticketow:', error);
        });
    }, 5 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'panel-tickets') {
                await wizard.startPanelWizard(interaction);
            } else if (interaction.commandName === 'help') {
                await help.execute(interaction);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'panel_embed_modal') {
                await wizard.handleEmbedModalSubmit(interaction);
            } else if (interaction.customId === 'panel_button_modal') {
                await wizard.handleButtonModalSubmit(interaction);
            } else if (interaction.customId.startsWith('ticket_reason_modal:')) {
                const buttonId = Number(interaction.customId.split(':')[1]);
                await ticketService.handleTicketReasonModalSubmit(interaction, buttonId);
            }
            return;
        }

        if (interaction.isButton()) {
            const [prefix, param] = interaction.customId.split(':');
            switch (prefix) {
                case 'panel_image_skip':
                    await wizard.handleImageSkip(interaction);
                    break;
                case 'panel_menu_add':
                    await wizard.handleMenuAdd(interaction);
                    break;
                case 'panel_menu_finish':
                    await wizard.handleMenuFinish(interaction);
                    break;
                case 'panel_menu_cancel':
                    await wizard.handleMenuCancel(interaction);
                    break;
                case 'panel_ping_next':
                    await wizard.handlePingNext(interaction);
                    break;
                case 'panel_access_next':
                    await wizard.handleAccessNext(interaction);
                    break;
                case 'panel_draft_cancel':
                    await wizard.handleDraftCancel(interaction);
                    break;
                case 'open_ticket':
                    await ticketService.handleOpenTicketButton(interaction, Number(param));
                    break;
                case 'ticket_close':
                    await ticketService.handleCloseButton(interaction, Number(param));
                    break;
                case 'ticket_close_confirm_yes':
                    await ticketService.handleCloseConfirmYes(interaction, Number(param));
                    break;
                case 'ticket_close_confirm_no':
                    await ticketService.handleCloseConfirmNo(interaction, Number(param));
                    break;
                default:
                    break;
            }
            return;
        }

        if (interaction.isRoleSelectMenu()) {
            if (interaction.customId === 'panel_ping_roles') {
                await wizard.handlePingRolesSelect(interaction);
            } else if (interaction.customId === 'panel_access_roles') {
                await wizard.handleAccessRolesSelect(interaction);
            }
            return;
        }

        if (interaction.isUserSelectMenu()) {
            if (interaction.customId === 'panel_access_users') {
                await wizard.handleAccessUsersSelect(interaction);
            }
            return;
        }

        if (interaction.isChannelSelectMenu()) {
            if (interaction.customId === 'panel_category_select') {
                await wizard.handleCategorySelect(interaction);
            }
            return;
        }
    } catch (error) {
        console.error('Blad obslugi interakcji:', error);
        const payload = { content: 'Wystapil nieoczekiwany blad podczas przetwarzania tej akcji.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

client.login(token);
