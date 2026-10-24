// Character appearance: Chinese is editable; ComfyUI always receives the English field.
export function collectChineseAppearanceEdits(characters = [], savedCharacters = []) {
    const savedById = new Map(
        (Array.isArray(savedCharacters) ? savedCharacters : [])
            .filter(item => item?.id)
            .map(item => [String(item.id), item])
    );
    const edits = [];
    for (const character of Array.isArray(characters) ? characters : []) {
        const id = String(character?.id || '').trim();
        const chinese = String(character?.appearanceZh || '').trim();
        if (!id || !chinese) continue;
        const previous = savedById.get(id);
        // Existing: convert only after Chinese is edited, or if English is missing.
        // New: imported bilingual pairs already agree and must not be retransformed.
        const changed = previous
            ? chinese !== String(previous.appearanceZh || '').trim() || !String(character.appearance || '').trim()
            : !String(character.appearance || '').trim();
        if (changed) edits.push({ id, name: String(character.name || ''), chinese });
    }
    return edits;
}

export function parseEnglishAppearanceTranslations(text, requests = []) {
    const raw = String(text || '');
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('\u0041\u0049\u672a\u8fd4\u56de\u53ef\u8bc6\u522b\u7684\u82f1\u6587\u63d0\u793a\u8bcd');
    let payload;
    try { payload = JSON.parse(raw.slice(first, last + 1)); }
    catch { throw new Error('\u0041\u0049\u8fd4\u56de\u7684\u82f1\u6587\u63d0\u793a\u8bcd\u683c\u5f0f\u9519\u8bef'); }
    const items = Array.isArray(payload?.translations) ? payload.translations : [];
    const outputs = new Map();
    const needed = new Set(requests.map(r => r.id));
    for (const value of items) {
        const id = String(value?.id || '');
        const english = String(value?.english || '').trim();
        if (!needed.has(id) || outputs.has(id)) continue;
        if (english.length < 4 || english.length > 1800 || /[\u3400-\u9fff]/u.test(english)) {
            throw new Error('\u89d2\u8272\u82f1\u6587\u5916\u8c8c\u751f\u6210\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u8bd5');
        }
        outputs.set(id, english);
    }
    for (const req of requests) {
        if (!outputs.has(req.id)) throw new Error('\u82f1\u6587\u5916\u8c8c\u4e0e\u4e2d\u6587\u89d2\u8272\u6570\u91cf\u4e0d\u5339\u914d\uff0c\u672a\u4fdd\u5b58');
    }
    return outputs;
}

export function applyEnglishAppearanceTranslations(characters = [], translated = new Map()) {
    return characters.map(character =>
        translated.has(String(character.id))
            ? { ...character, appearance: translated.get(String(character.id)) }
            : character
    );
}
