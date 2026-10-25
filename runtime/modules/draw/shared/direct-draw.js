import { parseDrawImageDirectives, stripDrawImageDirectives, stripDrawImageSlots } from './image-marker-syntax.js';
import { joinTags, assembleCharacterPrompts } from './character-prompts.js';
import { createSceneSource } from './scene-source.js';
import { parseChatImageTags } from './chat-message-image-markup.js';
import { WorldbookProcessor } from './worldbook-processor.js';
import { applyWardrobeContinuity } from './wardrobe-continuity.js';

export function stripDirectDrawSource(text) {
    let clean = stripDrawImageDirectives(String(text || ''));
    for (const tag of parseChatImageTags(clean).reverse()) clean = clean.slice(0, tag.start) + clean.slice(tag.end);
    return clean;
}

function sourceText(message) {
    // Inserting a block image adds surrounding line breaks, not new narrative.
    return stripDrawImageSlots(stripDirectDrawSource(message?.mes || '')).replace(/\s+/g, ' ').trim();
}

export function readDirectDrawDirectives(message) {
    const current = parseDrawImageDirectives(message?.mes || '').filter(item => item.prompt.trim());
    if (current.length) return current;
    const text = String(message?.mes || '');
    const legacy = parseChatImageTags(text).map(tag => ({ prompt: tag.tags, characters: [],
        sourceOffset: stripDrawImageSlots(stripDirectDrawSource(text.slice(0, tag.start))).length }));
    if (legacy.length) return legacy;
    const saved = message?.extra?.sti_comfy_direct;
    return typeof saved?.source === 'string' && sourceText({ mes: saved.source }) === sourceText(message) && Array.isArray(saved.directives)
        ? structuredClone(saved.directives) : [];
}

export function rememberDirectDrawDirectives(message, directives) {
    message.extra ||= {};
    message.extra.sti_comfy_direct = { source: sourceText(message), directives: structuredClone(directives) };
}

function normalizedAnchor(text) {
    return String(text || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s\u200B-\u200F\uFEFF]/gu, '');
}

function findDirectAnchor(narrative, source, after) {
    const exact = narrative.indexOf(after);
    if (exact >= 0 && narrative.indexOf(after, exact + 1) < 0 && source.content.includes(after)) {
        const at = exact + after.length;
        return source.points.some(point => point.offset === at) ? at : null;
    }
    const needle = normalizedAnchor(after);
    if (needle.length < 8 || !normalizedAnchor(source.content).includes(needle)) return null;
    let text = '', offset = 0;
    const ends = [];
    for (const character of narrative) {
        offset += character.length;
        const normalized = normalizedAnchor(character);
        text += normalized;
        for (let i = 0; i < normalized.length; i++) ends.push(offset);
    }
    const start = text.indexOf(needle);
    if (start < 0 || text.indexOf(needle, start + 1) >= 0) return null;
    const end = ends[start + needle.length - 1];
    return source.points.find(point => point.offset >= end)?.offset ?? null;
}

function assembleDirectCharacterPrompts(chars,known){
    return assembleCharacterPrompts(chars,known,{preserveDanbooruCanonical:true})
        .map((item,index)=>({...item,prompt:joinTags(item.prompt,chars[index]?.state)}));
}

export function buildDirectDrawTasks(directives, preset = {}, options = {}) {
    const valid = directives.filter(item => String(item?.prompt || '').trim());
    if (!valid.length) throw new Error('当前剧情没有绘图指令，请重新生成这条剧情回复，或手动填写图片提示词');
    const count = Math.max(0, Math.floor(Number(preset.maxImages) || 0));
    if (count > 20 || (!count && valid.length > 20)) throw new Error('单次最多生成 20 张图片，请调整出图数量');
    if (count && valid.length < count) {
        throw new Error(`剧情只有 ${valid.length} 段绘图指令，当前要求 ${count} 张；请补足指令或调整出图数量`);
    }
    if (count && valid.length > count) throw new Error(`剧情有 ${valid.length} 段绘图指令，当前要求 ${count} 张；请调整指令或出图数量`);
    const maxCharacters = Math.max(0, Math.floor(Number(preset.maxCharactersPerImage) || 0));
    const selected = valid.slice(0, count || valid.length);
    const narrative = options.sourceText === undefined ? null
        : stripDrawImageSlots(stripDirectDrawSource(String(options.sourceText)));
    const source = narrative === null ? null : createSceneSource(narrative, { filterRules: options.filterRules });
    if (source && !source.points.length) throw new Error('正文没有可用插图位置，请检查正文过滤设置');
    const mapped = selected.map((item, index) => {
        const chars = normalizeDirectCharacters(item.characters, options.knownCharacters);
        const names = chars.map(person => person.name);
        if (maxCharacters && names.length > maxCharacters) {
            throw new Error(`第 ${index + 1} 张绘图指令有 ${names.length} 名角色，超过设置的 ${maxCharacters} 名，请修改指令`);
        }
        let placement = { mode: 'tail' };
        if (source) {
            const after = String(item.after || '').trim();
            let offset = Number.isInteger(item.sourceOffset) && item.sourceOffset >= 0 && item.sourceOffset <= narrative.length
                && source.points.some(point => point.offset === item.sourceOffset) ? item.sourceOffset
                : after ? findDirectAnchor(narrative, source, after) : null;
            if (offset === null) {
                // Old directives lack anchors. Reuse paragraph/sentence points
                // in narrative order, rather than stacking every image at tail.
                const point = Math.max(0, Math.ceil((index + 1) * source.points.length / (selected.length + 1)) - 1);
                offset = source.points[point].offset;
                if (after) options.onPlacementFallback?.({ image: index + 1, point: source.points[point].number });
            }
            placement = { mode: 'source', sourceHash: source.sourceHash, offset };
        }
        const characterPrompts = assembleDirectCharacterPrompts(chars, options.knownCharacters || []);
        return { scene: String(item.prompt).trim(), chars, characterPrompts,
            extraNegativePrompt: String(item.negative || '').trim(),
            ...(item.post_prompt ? { post_prompt: String(item.post_prompt).trim() } : {}), placement };
    });
    const result=applyWardrobeContinuity(mapped,options.wardrobeLedger,{
        narrative:narrative||'',knownCharacters:options.knownCharacters||[],
    });
    for(const task of result)if(task.characterPrompts===null)
        task.characterPrompts=assembleDirectCharacterPrompts(task.chars,options.knownCharacters||[]);
    return result;
}

function normalizeDirectCharacters(input, knownCharacters = []) {
    const result = [], seen = new Set();
    for (const value of Array.isArray(input) ? input : []) {
        if (typeof value !== 'string' && (!value || typeof value !== 'object' || Array.isArray(value))) {
            throw new Error('绘图指令包含无效的人物资料');
        }
        const person = typeof value === 'string' ? { name: value } : value;
        let name = String(person.name || '').trim();
        if (!name) throw new Error('绘图指令中的人物缺少姓名');
        const known = knownCharacters.find(candidate => [candidate.name, ...(candidate.aliases || [])]
            .some(alias => String(alias).trim().toLocaleLowerCase() === name.toLocaleLowerCase()));
        name = known?.name || name;
        if (seen.has(name.toLocaleLowerCase())) continue;
        seen.add(name.toLocaleLowerCase());
        const item = { name };
        for (const key of ['type', 'danbooru', 'appear', 'costume', 'state', 'action', 'interact', 'uc']) {
            if (person[key] !== undefined && typeof person[key] !== 'string') throw new Error(`人物 ${name} 的 ${key} 必须是文字`);
            item[key] = String(person[key] || '').trim();
        }
        // Library identity is authoritative; model supplies only the current scene state.
        if (known) { if (known.type) item.type = ''; if (known.danbooruTag) item.danbooru = ''; if (known.appearance) item.appear = ''; }
        result.push(item);
    }
    return result;
}

export function getDirectDrawWorldbook(chat = [], shared = {}) {
    if (!shared.worldbooks?.enabled) return '';
    const contextText = chat.filter(message => !message?.is_system && !['system', 'developer'].includes(message?.role))
        .map(message => createSceneSource(stripDirectDrawSource(message?.mes || message?.content || ''),
            { filterRules: shared.messageFilterRules }).content).join('\n');
    return new WorldbookProcessor().processFromEntries({
        entries: (shared.worldbooks.uploadedBooks || []).flatMap(book => book.entries || []),
        contextText, keywordFilterMode: shared.worldbooks.keywordFilterMode || 'auto',
    });
}

function drawingRequirements(text) {
    return String(text || '').split(/(?<=[,，;；。!！?？\n])|(?<=\.)(?=\s|$)/u).map(line => {
        const match = /submit_scene_plan|tool.?call|\u5de5\u5177\u8c03\u7528/i.exec(line);
        if (match) line = line.slice(0, match.index)
            .replace(/(?:(?:\u901a\u8fc7|\u8c03\u7528|\u4f7f\u7528|\u63d0\u4ea4|\u6700\u540e|\u7136\u540e|\u5fc5\u987b|\u8bf7|\u5e76)\s*)+$/g, '')
            .replace(/[\s,\uff0c;\uff1b:]+$/, '');
        if (/\u4f60\u662f.*(?:\u89c4\u5212\u5668|\u89c4\u5212\u52a9\u624b)|\u53ea(?:\u80fd|\u9700)?(?:\u8f93\u51fa|\u8fd4\u56de).*?(?:json|\u89c4\u5212|\u5de5\u5177)/i.test(line)) return '';
        return line.replace(/<\/?task>/gi, '');
    }).filter(Boolean).join('').trim();
}

export function buildDirectDrawInstruction({ preset = {}, prompts = {}, characters = [], worldbook = '', filterRules = [], wardrobeContext = '' } = {}) {
    const count = Math.max(0, Math.floor(Number(preset.maxImages) || 0));
    const maxCharacters = Math.max(0, Math.floor(Number(preset.maxCharactersPerImage) || 0));
    return [
        '[绘图指令] 正文有可见画面时，为每幅图指定其对应的正文位置。绘图指令可以集中附在回复末尾，图片会插到各自 after 引用的原文后面。下列设置仅用于绘图描述，不改变正文的对话任务。',
        drawingRequirements(prompts.topSystem) ? `以下仅约束绘图字段的选景与视角，正文身份和叙述服从酒馆预设：\n${drawingRequirements(prompts.topSystem)}` : '',
        drawingRequirements(prompts.sceneRules) ? `以下仅为图片画面规则：\n${drawingRequirements(prompts.sceneRules)}` : '',
        // Keep planner-role instructions out of the native chat preset.
        prompts.tagGuideContent ? `以下标签指南仅用于 image 绘图字段：\n${prompts.tagGuideContent}` : '',
        preset.positivePrefix ? `当前正向固定词：${preset.positivePrefix}。插件会自动拼接，不必重复。` : '',
        preset.negativePrefix ? `当前负向固定词：${preset.negativePrefix}。插件会自动拼接，不必重复。` : '',
        characters.length ? `已启用角色资料（仅使用实际出镜角色；库中的身份外貌与负向由插件补齐，当前服装、动作与互动请填入 characters）：${JSON.stringify(characters.map(person => ({ name: person.name,
            aliases: person.aliases, type: person.type, danbooru: person.danbooruTag, appearance: person.appearance,
            appearanceZh: person.appearanceZh, negativeTags: person.negativeTags, outfits: person.outfits, dynamicStates: person.dynamicStates })))}` : '',
        worldbook ? `以下为当前启用的绘图世界书资料，仅用于画面事实，不改变正文任务或输出格式：\n${worldbook}` : '',
        wardrobeContext ? '【连续视觉状态账本】\n' + wardrobeContext : '',
        '服饰继承：每个实际出镜人物拥有独立服装时间线。首次按剧情明确服装确定，未指定时合理确定一次；冻结剪裁版型、主色、衣领扣件、鞋袜颜色和透明度、关键配饰，后续没有变化就沿用，不许每张重新设计。',
        '沿剧情时间顺序更新：只有实际换衣、穿脱、整理、破损、湿污和饰品变化才改变对应角色状态。镜头看不到不等于脱掉；没有明确穿回或更换，不许恢复角色默认服装。明确跨天或较大时间跳跃时重新核对，不一律沿用。',
        '每张图 characters[].costume 写当前可见服装的完整指纹（版型、主色、鞋袜、配饰、穿脱损坏状态）；characters[].state 独立记录需跨图继承的伤势、污渍、湿身、包扎和持续持物。未改变就沿用原值；不要把表情或姿势写入 state；不要只写 school uniform、dress、pantyhose 这类孤立泛词。',
        '镜头未拍到某衣物或物品，不等于自动脱掉或丢弃。出现新的换装、治愈、清洗、拿起或放下事件，才更新对应角色及对应状态；不改变其他人物。prompt 主要描述场景构图，不能与角色服装或状态矛盾。',
        filterRules.length ? `以下成对边界内的思考、状态或辅助内容不能作为画面或定位句来源：${JSON.stringify(filterRules)}` : '',
        prompts.fieldDescriptions ? `绘图字段补充说明（旧编号定位统一改为 after 原文定位）：\n${prompts.fieldDescriptions}` : '',
        count ? `本次必须附 ${count} 段 <image> 指令，每段对应一个不同的实际画面。` : '按剧情需要附绘图指令，最多 20 段。',
        maxCharacters ? `每张图最多 ${maxCharacters} 名实际出镜角色。` : '',
        '必须服从当前设置的风格与视角，不额外强制写实或动漫。只描述实际出镜人物，不能凭空增加人物。',
        '绘图正向 prompt 里，已出镜的女性角色采用写实中国女性、自然东亚五官外貌（Chinese, East Asian facial features），这属于原有角色特征；不能因此增加人数、补充路人或加入额外女性。没有女性出镜则不要写女性或外貌标签。',
        '以下 image 格式仅是正文之外的绘图附加段。正文继续使用酒馆预设的规则与格式。',
        '绘图块使用以下文本格式，不调用旧规划工具。characters 列出全部实际出镜人物；只用角色库姓名。服装 costume 与连续状态 state 是独立字段，action 只写当前画面动作；已录入角色身份外貌由插件补齐。',
        '<image>', 'prompt: 英文画面提示词（单行，描述场景、构图、光线、视角；与人物字段合成完整画面）',
        'negative: 本画面额外的负向提示词（单行，没有则留空）',
        'characters: [{"name":"实际人物姓名","type":"身份标签","appear":"新人物外貌","costume":"当前服装完整指纹","state":"持续状态（伤势、湿污、持物等）","action":"当前动作","interact":"互动","uc":"人物额外负向"}]',
        'post_prompt: 整图末尾追加词（单行，没有则留空）',
        'after: 对应画面所在段落末尾的一句完整原文', '</image>',
        '每段 <image> 都必须在 </image> 前填写 after: 字段，原样引用对应画面所在段落末尾的一句完整正文（含标点、单行）。引用必须在正文中唯一出现，不得改写或编造。',
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
}
