// Match character names/aliases as independent mentions, not substrings.
import { selectEnabledCharacters } from './character-library.js';
import { isCharacterEnabled } from './character-selection.js';

function normalizeNamedTagList(list = []) {
    return (Array.isArray(list) ? list : [])
        .map(item => ({
            name: String(item?.name || '').trim(),
            tags: String(item?.tags || '').trim(),
        }))
        .filter(item => item.name || item.tags);
}

function getWordBoundaries(text) {
    if (typeof Intl?.Segmenter !== 'function') return null;
    const boundaries = new Set([0, text.length]);
    const standaloneHan = new Set();
    for (const part of new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)) {
        boundaries.add(part.index);
        boundaries.add(part.index + part.segment.length);
        if (part.isWordLike !== false && /^\p{Script=Han}$/u.test(part.segment)) {
            standaloneHan.add(part.index);
        }
    }
    return { boundaries, standaloneHan };
}

function hasNameBoundaries(text, name, index, words) {
    const end = index + name.length;
    if (/\p{Script=Han}/u.test(name)) {
        if (words) {
            if (!words.boundaries.has(index) || !words.boundaries.has(end)) return false;
            return !/^\p{Script=Han}$/u.test(name) || words.standaloneHan.has(index);
        }
        // Without a Chinese segmenter, be conservative for single-character
        // Han names instead of treating arbitrary words as character names.
        if (/^\p{Script=Han}$/u.test(name)) {
            return (index === 0 || !/\p{Script=Han}/u.test(text[index - 1]))
                && (end === text.length || !/\p{Script=Han}/u.test(text[end]));
        }
        return true;
    }
    const asciiWord = char => /[a-z0-9_]/i.test(char || '');
    return (index === 0 || !asciiWord(text[index - 1]))
        && (end === text.length || !asciiWord(text[end]));
}

function findMatchedCharacterIndexes(text, candidates) {
    const words = getWordBoundaries(text);
    const mentions = [];
    for (let i = 0; i < candidates.length; i++) {
        const char = candidates[i];
        if (!isCharacterEnabled(char) || !String(char.name || '').trim()) continue;
        const names = new Set([char.name, ...(Array.isArray(char.aliases) ? char.aliases : [])]
            .map(name => String(name || '').trim().toLocaleLowerCase()).filter(Boolean));
        for (const name of names) {
            let offset = 0;
            for (;;) {
                const index = text.indexOf(name, offset);
                if (index < 0) break;
                if (hasNameBoundaries(text, name, index, words)) {
                    mentions.push({ i, index, end: index + name.length, size: name.length });
                }
                offset = index + 1;
            }
        }
    }
    // Prefer complete longer names to a smaller name embedded inside them.
    mentions.sort((a, b) => b.size - a.size || a.index - b.index || a.i - b.i);
    const accepted = [];
    for (const hit of mentions) {
        if (accepted.some(previous => previous.i !== hit.i
            && hit.index < previous.end && previous.index < hit.end)) continue;
        accepted.push(hit);
    }
    return new Set(accepted.map(hit => hit.i));
}

/** Return only effectively enabled characters named in this scene. */
export function detectPresentCharacters(messageText, characterLibrary) {
    const candidates = Array.isArray(characterLibrary)
        ? characterLibrary
        : selectEnabledCharacters(characterLibrary);
    if (!messageText || !candidates.length) return [];
    const found = findMatchedCharacterIndexes(String(messageText).toLocaleLowerCase(), candidates);
    return candidates.filter((_char, i) => found.has(i)).map(char => ({
        name: char.name,
        aliases: char.aliases || [],
        type: char.type || 'girl',
        appearance: char.appearance || '',
        danbooruTag: char.danbooruTag || '',
        negativeTags: char.negativeTags || '',
        outfits: normalizeNamedTagList(char.outfits),
        dynamicStates: normalizeNamedTagList(char.dynamicStates),
    }));
}
