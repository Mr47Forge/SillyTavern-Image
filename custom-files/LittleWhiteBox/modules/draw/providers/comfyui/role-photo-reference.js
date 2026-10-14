// Krea2 reference-only workflow: bind scene character's saved photograph to image1.
// Non-Krea workflows remain untouched. Without a match use proper text-only conditioning.
export const ROLE_PHOTO_PLACEHOLDER = '__LWB_ROLE_PHOTO__';
export const ROLE_PHOTO_NODE = '15';
export const KREA_REFERENCE_NODE = '5';
const PHOTO_PATTERN = /^user\/images\/LittleWhiteBox-role-photos\/[A-Za-z0-9_-]+\.jpg$/;

function normalizedName(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function namesFromTask(chars) {
    if (!Array.isArray(chars)) return [];
    return chars.map((entry) => {
        if (typeof entry === 'string') return normalizedName(entry);
        return normalizedName(entry?.name || entry?.character || entry?.char || entry?.characterName || '');
    }).filter(Boolean);
}

function identityNames(character) {
    return [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])]
        .map(normalizedName).filter(Boolean);
}

export function selectPhotoCharacter({ prompt = '', taskCharacters = [], knownCharacters = [] } = {}) {
    const characters = (Array.isArray(knownCharacters) ? knownCharacters : [])
        .filter(person => person?.enabled !== false
            && PHOTO_PATTERN.test(String(person?.photoUrl || '').replace(/^\/+/, '')));
    if (!characters.length) return null;
    const sceneNames = namesFromTask(taskCharacters);
    if (sceneNames.length) {
        return characters.find(person => identityNames(person).some(name => sceneNames.includes(name))) || null;
    }
    const text = normalizedName(prompt);
    const mentioned = characters.filter(person => identityNames(person)
        .some(name => name.length >= 2 && text.includes(name)));
    return mentioned.length === 1 ? mentioned[0] : null;
}

export function applyRolePhotoReference(workflow, { prompt = '', knownCharacters = [], taskCharacters = [] } = {}) {
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)
        || workflow[ROLE_PHOTO_NODE]?.class_type !== 'LoadImage'
        || workflow[ROLE_PHOTO_NODE]?.inputs?.image !== ROLE_PHOTO_PLACEHOLDER
        || workflow[KREA_REFERENCE_NODE]?.class_type !== 'TextEncodeKrea2Reference') {
        return workflow;
    }
    const selected = selectPhotoCharacter({ prompt, knownCharacters, taskCharacters });
    if (selected) {
        const photo = String(selected.photoUrl).replace(/^\/+/, '');
        workflow[ROLE_PHOTO_NODE].inputs.image = 'lwb-role-photo:' + photo;
        const nodeInputs = workflow[KREA_REFERENCE_NODE].inputs;
        const name = String(selected.name || '').replace(/[\r\n<>]/g, ' ').slice(0, 48);
        nodeInputs.prompt = 'character1 from image1 is the same person as ' + name
          + '. Preserve their facial identity and hairstyle only; obey the scene for clothing, pose, location and other people. '
          + String(prompt).trim();
        nodeInputs.image1_detail = 'high';
        nodeInputs.layout_split = 0.25;
        return workflow;
    }
    // Comfy validates all node inputs, so delete the unavailable reference nodes.
    if (workflow['18']?.class_type !== 'CLIPTextEncode'
        || workflow['8']?.class_type !== 'KSampler') {
        throw new Error('Krea2 reference workflow has no safe text-only fallback');
    }
    workflow['18'].inputs.text = String(prompt).trim();
    workflow['8'].inputs.positive = ['18', 0];
    delete workflow[ROLE_PHOTO_NODE];
    delete workflow[KREA_REFERENCE_NODE];
    return workflow;
}
