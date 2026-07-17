const sessions = new Map();

function createSession(userId, data) {
    sessions.set(userId, {
        guildId: data.guildId,
        channelId: data.channelId,
        embed: { title: null, description: null, footer: null, imageUrl: null },
        buttons: [],
        draft: null,
        imageCollectorActive: false,
    });
    return sessions.get(userId);
}

function getSession(userId) {
    return sessions.get(userId) || null;
}

function deleteSession(userId) {
    sessions.delete(userId);
}

module.exports = { createSession, getSession, deleteSession };
