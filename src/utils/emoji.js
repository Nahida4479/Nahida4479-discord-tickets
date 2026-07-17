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

module.exports = { parseEmojiInput };
