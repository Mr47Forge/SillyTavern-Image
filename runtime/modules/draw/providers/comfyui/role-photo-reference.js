// Krea2 reference-only workflow: bind scene character's saved photograph to image1.
// Non-Krea workflows remain untouched. Without a match use proper text-only conditioning.
export const ROLE_PHOTO_PLACEHOLDER = '__LWB_ROLE_PHOTO__';
export const ROLE_PHOTO_NODE = '15';
export const KREA_REFERENCE_NODE = '5';
const PHOTO_PATTERN = /^user\/images\/(?:SillyTavernImage|LittleWhiteBox)-role-photos\/[A-Za-z0-9_-]+\.jpg$/;

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

function toTextOnlyKrea2Edit(workflow, prompt) {
    // 没有可匹配的角色照片时，把身份编辑图自动退回纯文生图：
    // 加两个 CLIPTextEncode 接管正负提示词，模型改回裸 UNET，删掉所有参考图节点。
    const ids = Object.keys(workflow || {});
    const samplerId = ids.find(id => /^KSampler/i.test(String(workflow[id]?.class_type || '')));
    const unetId = ids.find(id => String(workflow[id]?.class_type || '') === 'UNETLoader');
    if (!samplerId || !unetId) {
        throw new Error('当前场景没有匹配的角色参考照片，且该工作流无法自动退回文生图');
    }
    const sampler = workflow[samplerId];
    const positiveLink = sampler?.inputs?.positive;
    const grounded = Array.isArray(positiveLink) ? workflow[String(positiveLink[0])] : null;
    const clipLink = grounded?.inputs?.clip;
    if (!Array.isArray(clipLink)) {
        throw new Error('当前场景没有匹配的角色参考照片，且该工作流缺少文本编码器，无法自动退回文生图');
    }
    const text = 'Photorealistic, realistic photography, natural skin texture. ' + String(prompt || '').trim();
    const negativeText = 'anime, CGI, exaggerated retouching, distorted anatomy';
    let counter = 900;
    const takeId = () => {
        while (ids.includes(String(counter))) counter += 1;
        ids.push(String(counter));
        return String(counter);
    };
    const positiveId = takeId();
    workflow[positiveId] = { class_type: 'CLIPTextEncode', inputs: { text, clip: clipLink } };
    const negativeId = takeId();
    workflow[negativeId] = { class_type: 'CLIPTextEncode', inputs: { text: negativeText, clip: clipLink } };
    sampler.inputs.positive = [positiveId, 0];
    sampler.inputs.negative = [negativeId, 0];
    sampler.inputs.cfg = 1.5;
    const modelId = Array.isArray(sampler.inputs.model) ? String(sampler.inputs.model[0]) : '';
    if (modelId && workflow[modelId]) workflow[modelId].inputs.model = [unetId, 0];
    else sampler.inputs.model = [unetId, 0];
    for (const id of Object.keys(workflow)) {
        const type = String(workflow[id]?.class_type || '');
        if (type === 'Krea2EditModelPatch' || type === 'Krea2EditGroundedEncode') delete workflow[id];
        else if (type === 'LoadImage' && workflow[id]?.inputs?.image === '__ST_IMAGE_ROLE__') delete workflow[id];
    }
    for (const id of Object.keys(workflow)) {
        if (String(workflow[id]?.class_type || '') !== 'VAEEncode') continue;
        const source = workflow[id]?.inputs?.pixels;
        if (!Array.isArray(source) || !workflow[String(source[0])]) delete workflow[id];
    }
    console.warn('[SillyTavernImage] 当前场景没有匹配的角色参考照片，已自动改用纯文生图（本次不锁脸）');
    return workflow;
}

export function applyRolePhotoReference(workflow, { prompt = '', knownCharacters = [], taskCharacters = [] } = {}) {
    // The tested identity-edit graph must never silently generate an unrelated face.
    if (workflow?.['72']?.class_type === 'LoadImage'
        && workflow['72'].inputs?.image === '__ST_IMAGE_ROLE__'
        && workflow?.['84']?.class_type === 'Krea2EditGroundedEncode') {
        const selected = selectPhotoCharacter({ prompt, knownCharacters, taskCharacters });
        if (!selected) {
            return toTextOnlyKrea2Edit(workflow, prompt);
        }
        workflow['72'].inputs.image = 'lwb-role-photo:' + String(selected.photoUrl).replace(/^\/+/, '');
        workflow['84'].inputs.prompt = 'Use the reference image as the same adult person. Preserve facial identity and hairstyle, but follow the scene for facial expression, outfit, pose, location and lighting. Photorealistic, realistic photography. ' + String(prompt).trim();
        workflow['84'].inputs.system_prompt = 'Extract only facial identity and hairstyle from the reference image. Ignore its facial expression, pose, clothing and background, which are fully determined by the prompt text.';
        return workflow;
    }
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
