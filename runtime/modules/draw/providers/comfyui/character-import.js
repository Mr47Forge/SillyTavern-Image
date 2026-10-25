import { findCharacterByName } from '../../shared/character-selection.js';

function trimText(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeNamedTags(value) {
    return (Array.isArray(value) ? value : []).slice(0, 12).map((item) => {
        if (typeof item === 'string') return { name: trimText(item, 35), tags: '' };
        return {
            name: trimText(item?.name, 35),
            tags: trimText(item?.tags, 350),
        };
    }).filter(item => item.name && item.tags);
}

export function parseImportedCharacters(text) {
    const content = String(text || '').trim();
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('AI 没有返回可识别的角色资料，请重试');
    let object;
    try { object = JSON.parse(content.slice(start, end + 1)); }
    catch { throw new Error('AI 返回的角色资料格式不完整，请重试'); }
    const items = Array.isArray(object?.characters) ? object.characters : [];
    if (!items.length) throw new Error('当前剧情中未识别到具名角色，请检查聊天内容');
    const names = new Set();
    const result = [];
    for (const item of items.slice(0, 25)) {
        const name = trimText(item?.name, 50);
        if (name.length < 2 || names.has(name.toLocaleLowerCase())) continue;
        names.add(name.toLocaleLowerCase());
        const aliases = (Array.isArray(item.aliases) ? item.aliases : [])
            .map(value => trimText(value, 50)).filter(Boolean).slice(0, 10);
        const type = ['girl', 'boy', 'woman', 'man', 'other'].includes(item?.type)
            ? item.type : 'other';
        const appearance = trimText(item?.appearance, 1600);
        const appearanceZh = trimText(item?.appearanceZh, 1600);
        if (!appearance || !appearanceZh || !/[\u3400-\u9fff]/u.test(appearanceZh)) continue;
        result.push({
            name, aliases, type, appearance, appearanceZh, basis: item?.basis === '\u5267\u60c5\u660e\u786e' ? '\u5267\u60c5\u660e\u786e' : 'AI\u8865\u5145', negativeTags: '',
            danbooruTag: '', outfits: normalizeNamedTags(item?.outfits),
            dynamicStates: normalizeNamedTags(item?.dynamicStates),
        });
    }
    if (!result.length) throw new Error('AI 没有返回完整的中文外貌与英文绘图描述，请重试；没有保存任何内容');
    return result;
}

export function mergeImportedCharacters(library, imported, makeId = () => 'comfy-import-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)) {
    const characters = (Array.isArray(library?.characters) ? library.characters : []).map(item => ({ ...item }));
    const groups = Array.isArray(library?.groups) ? library.groups : [];
    const created = [];
    const filled = [];
    const skipped = [];
    for (const candidate of imported) {
        const existing = findCharacterByName(candidate.name, characters);
        if (existing) {
            let changed = false;
            // The English prompt is an identity anchor: never overwrite it.
            if (!existing.appearance && candidate.appearance) {
                existing.appearance = candidate.appearance;
                if (!existing.aliases?.length) existing.aliases = [...(candidate.aliases || [])];
                if (!existing.outfits?.length) existing.outfits = candidate.outfits || [];
                if (!existing.dynamicStates?.length) existing.dynamicStates = candidate.dynamicStates || [];
                changed = true;
            }
            // A previously auto-learned English-only record can gain Chinese notes.
            if (!existing.appearanceZh && candidate.appearanceZh
                && (!existing.appearance || existing.appearance.trim() === String(candidate.appearance || '').trim())) {
                existing.appearanceZh = candidate.appearanceZh;
                changed = true;
            }
            if (changed) filled.push(existing.name);
            else skipped.push(candidate.name);
            continue;
        }
        const hasAliasCollision = candidate.aliases.some(alias => findCharacterByName(alias, characters));
        if (hasAliasCollision) { skipped.push(candidate.name); continue; }
        characters.push({ id: makeId(), enabled: true, ...candidate });
        created.push(candidate.name);
    }
    return { characters, groups, created, filled, skipped, changed: Boolean(created.length || filled.length) };
}

export function collectChatCharacterSource(chat, { maxMessages = 120, maxChars = 50000 } = {}) {
    const all = Array.isArray(chat) ? chat : [];
    const recent = all.slice(-maxMessages);
    const records = [];
    let remaining = maxChars;
    for (let index = recent.length - 1; index >= 0; index--) {
        const item = recent[index];
        if (!item || item.is_system) continue;
        let raw = String(item.mes || '').trim();
        if (!raw) continue;
        raw = raw.replace(/<img\b[^>]*>/gi, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
        if (!raw) continue;
        const excerpt = raw.length > 3000
            ? raw.slice(0, 2200) + '\n[省略本条消息中段]\n' + raw.slice(-700)
            : raw;
        if (remaining < 120) break;
        const content = excerpt.slice(0, remaining);
        if (content.length < 30) continue;
        records.push({
            index: all.length - recent.length + index,
            speaker: item.is_user ? 'user' : 'narrator',
            text: content,
        });
        remaining -= content.length;
    }
    records.reverse();
    return {
        messages: records,
        totalMessages: all.length,
        truncated: all.length > recent.length || records.length < recent.filter(item => item?.mes && !item.is_system).length,
    };
}
