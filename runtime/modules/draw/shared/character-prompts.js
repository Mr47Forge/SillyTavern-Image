import { findEnabledCharacterByName } from './character-selection.js';
import { toSceneCharacterPromptTag } from './scene-plan-contract.js';

const GRID_COL = Object.freeze({ A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 });
const GRID_ROW = Object.freeze({ 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 });

export function joinTags(...parts) {
    return parts
        .filter(Boolean)
        .map(part => String(part).trim().replace(/[，、]/g, ',').replace(/^,+|,+$/g, ''))
        .filter(part => part.length > 0)
        .join(', ');
}

function formatDanbooruTag(tag, options = {}) {
    const value = String(tag || '').trim();
    return options.preserveDanbooruCanonical ? value : value.replace(/_/g, ' ');
}

export function usesChineseAppearance(character = {}) {
    return Boolean(String(character.appearanceZh || '').trim());
}

export function buildKnownCharacterPrompt(character = {}, options = {}) {
    const danbooruTag = character.danbooruTag ? formatDanbooruTag(character.danbooruTag, options) : '';
    // [K2] type 提到最前：type 是角色的自然语言身份短句（K2 下可携带画面方位），应当作为角色提示词的开头。
    // 上游同步时注意保留此顺序调整。
    return joinTags(toSceneCharacterPromptTag(character.type), danbooruTag);
}

function normalizeCharacterCenter(center, { acceptGrid = true } = {}) {
    if (center && typeof center === 'object' && !Array.isArray(center)) {
        const x = Number(center.x);
        const y = Number(center.y);
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            return { x, y };
        }
    }
    if (acceptGrid && typeof center === 'string') {
        const match = center.trim().toUpperCase().match(/^([A-E])([1-5])$/);
        if (match) return { x: GRID_COL[match[1]], y: GRID_ROW[match[2]] };
    }
    return { x: 0.5, y: 0.5 };
}

export const IMAGE_POSITIONS = new Map([
    ['left', 'on the left'], ['center-left', 'at center-left'], ['center', 'in the center'],
    ['center-right', 'at center-right'], ['right', 'on the right'], ['foreground', 'in the foreground'],
    ['background', 'in the background'], ['left foreground', 'in the left foreground'],
    ['right foreground', 'in the right foreground'], ['left background', 'in the left background'],
    ['right background', 'in the right background'],
]);

function naturalList(parts) {
    if (parts.length < 2) return parts[0] || '';
    if (parts.length === 2) return parts.join(' and ');
    return parts.slice(0, -1).join(', ') + ', and ' + parts.at(-1);
}

function nounPhrase(value) {
    if (/^(?:a|an|the|and|her|his|their|some|no)\b/iu.test(value)
        || /(?:[^s]s|hair|skin|makeup|denim|jewelry|clothing|lipstick|eyeliner|waistwear)$/iu.test(value)
        || !/^[a-z]/iu.test(value)) return value;
    return (/^[aeiou]/iu.test(value) ? 'an ' : 'a ') + value;
}

const splitDescription = value => String(value || '').split(/[,，;；、]+/u)
    .map(part => part.trim().replace(/[.。]+$/u, '')).filter(Boolean);

function describingAction(value) {
    const action = String(value || '').trim().replace(/[.。]+$/u, '');
    if (!action) return '';
    if (/^(?:is|has|holds|looks|stands|sits|walks|wears|leans|faces|smiles|rests|reaches|turns)\b/iu.test(action)) return action;
    return /^[a-z-]+ing\b/iu.test(action) ? 'is ' + action : 'is shown ' + action;
}

// Build from the effective character fields after appearance and wardrobe
// continuity have resolved. A model-authored second copy could use stale traits.
export function buildDirectCharacterSentence(character, knownCharacters, { includePosition = false } = {}) {
    const known = findEnabledCharacterByName(character.name, knownCharacters);
    const [type, ...typeDetails] = splitDescription(character.type || known?.type);
    const subjectType = { '1girl':'girl', '1boy':'boy', female:'woman', male:'man' };
    const typeKey = type?.toLowerCase();
    const subject = Object.hasOwn(subjectType, typeKey) ? subjectType[typeKey] : type || 'person';
    const location = includePosition && IMAGE_POSITIONS.get(String(character.position || '').toLowerCase().trim());
    const appearance = String(character.appear || known?.appearanceZh || '').trim();
    const quotedAppearance = appearance === String(character.appear_evidence || '').trim() && appearance;
    const physical = naturalList([...typeDetails, ...splitDescription(quotedAppearance ? '' : appearance)].map(nounPhrase));
    const clothes = naturalList(splitDescription(character.costume).map(nounPhrase));
    const predicates = [
        clothes && 'wears ' + clothes,
        describingAction(character.action),
        describingAction(character.interact),
    ].filter(Boolean);
    const first = location ? location[0].toUpperCase() + location.slice(1) + ', ' + nounPhrase(subject)
        : nounPhrase(subject).replace(/^./u, char => char.toUpperCase());
    const state = naturalList(splitDescription(character.state).map(nounPhrase));
    const designTag = String(known?.danbooruTag || character.danbooru || '').trim();
    const sentence = first + (physical ? ' with ' + physical : '') + ' '
        + (naturalList(predicates) || 'appears in the scene') + (state ? ', with ' + state : '') + '.';
    return sentence
        + (quotedAppearance ? ' The same person matches this appearance description: “' + quotedAppearance + '”.' : '')
        + (designTag ? ' This character is depicted as ' + designTag.replace(/[.。]+$/u, '') + '.' : '');
}

export function assembleCharacterPrompts(sceneCharacters = [], knownCharacters = [], options = {}) {
    const characters = Array.isArray(sceneCharacters) ? sceneCharacters : [];
    return characters.map((character) => {
        const known = findEnabledCharacterByName(character?.name, knownCharacters);
        const center = normalizeCharacterCenter(character?.center, options);
        if (known) {
            const chineseAuthority = String(known.appearanceZh || '').trim();
            const identity = String(character?.appear || '').trim() || chineseAuthority;
            // [K2] 场景 type（可携带方位）非空时打头并顶替库 type；为空（原生合同会清空已录入
            // 角色的场景 type）时回落 buildKnownCharacterPrompt 内的库 type，原生行为不变。
            const sceneType = toSceneCharacterPromptTag(character?.type);
            return {
                name: known.name || character.name,
                prompt: joinTags(
                    sceneType,
                    buildKnownCharacterPrompt(sceneType ? { ...known, type: '' } : known, options),
                    identity,
                    !known.danbooruTag && character?.danbooru ? formatDanbooruTag(character.danbooru, options) : '',
                    identity ? '' : character?.appear,
                    character.costume,
                    character.action,
                    character.interact,
                ),
                uc: /[\u3400-\u9fff]/u.test(String(known.negativeTags || ''))
                    ? String(character.uc || known.negativeTags || '').trim()
                    : joinTags(known.negativeTags, character.uc),
                center,
            };
        }

        const danbooruTag = character?.danbooru
            ? formatDanbooruTag(character.danbooru, options)
            : '';
        return {
            name: character?.name,
            // [K2] type 提到最前
            prompt: joinTags(
                toSceneCharacterPromptTag(character?.type),
                danbooruTag,
                character?.appear,
                character?.costume,
                character?.action,
                character?.interact,
            ),
            uc: character?.uc || '',
            center,
        };
    });
}
