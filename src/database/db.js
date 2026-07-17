const { createClient } = require('@libsql/client');

const client = createClient({
    url: process.env.turso_link,
    authToken: process.env.turso,
});

async function init() {
    await client.execute(`
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

    await client.execute(`
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
            FOREIGN KEY (panel_id) REFERENCES panels(id)
        )
    `);

    await client.execute(`
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
    const result = await client.execute({
        sql: `INSERT INTO panels (guild_id, channel_id, embed_title, embed_description, embed_footer, embed_image_url, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [guildId, channelId, title, description, footer, imageUrl, Date.now()],
    });
    return Number(result.lastInsertRowid);
}

async function setPanelMessageId(panelId, messageId) {
    await client.execute({
        sql: `UPDATE panels SET message_id = ? WHERE id = ?`,
        args: [messageId, panelId],
    });
}

async function addPanelButton({ panelId, position, label, emoji, style, content, categoryId, pingRoles, accessRoles, accessUsers }) {
    const result = await client.execute({
        sql: `INSERT INTO panel_buttons (panel_id, position, label, emoji, style, message_content, category_id, ping_roles, access_roles, access_users)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [panelId, position, label, emoji, style, content, categoryId, JSON.stringify(pingRoles), JSON.stringify(accessRoles), JSON.stringify(accessUsers)],
    });
    return Number(result.lastInsertRowid);
}

async function getPanelButton(buttonId) {
    const result = await client.execute({
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
    };
}

async function createTicket({ guildId, channelId, panelButtonId, openerId, reason }) {
    const result = await client.execute({
        sql: `INSERT INTO tickets (guild_id, channel_id, panel_button_id, opener_id, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [guildId, channelId, panelButtonId, openerId, reason, Date.now()],
    });
    return Number(result.lastInsertRowid);
}

async function getTicket(ticketId) {
    const result = await client.execute({
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

async function getTicketByChannel(channelId) {
    const result = await client.execute({
        sql: `SELECT * FROM tickets WHERE channel_id = ?`,
        args: [channelId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return getTicket(Number(row.id));
}

async function setCloseRequest(ticketId, requestedBy, messageId) {
    await client.execute({
        sql: `UPDATE tickets SET close_requested_by = ?, close_requested_at = ?, close_request_message_id = ? WHERE id = ?`,
        args: [requestedBy, Date.now(), messageId, ticketId],
    });
}

async function clearCloseRequest(ticketId) {
    await client.execute({
        sql: `UPDATE tickets SET close_requested_by = NULL, close_requested_at = NULL, close_request_message_id = NULL WHERE id = ?`,
        args: [ticketId],
    });
}

async function closeTicket(ticketId) {
    await client.execute({
        sql: `UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?`,
        args: [Date.now(), ticketId],
    });
}

async function getPendingCloseRequests(olderThanMs) {
    const threshold = Date.now() - olderThanMs;
    const result = await client.execute({
        sql: `SELECT id FROM tickets WHERE status = 'open' AND close_requested_at IS NOT NULL AND close_requested_at <= ?`,
        args: [threshold],
    });
    return result.rows.map((row) => Number(row.id));
}

module.exports = {
    client,
    init,
    createPanel,
    setPanelMessageId,
    addPanelButton,
    getPanelButton,
    createTicket,
    getTicket,
    getTicketByChannel,
    setCloseRequest,
    clearCloseRequest,
    closeTicket,
    getPendingCloseRequests,
};
