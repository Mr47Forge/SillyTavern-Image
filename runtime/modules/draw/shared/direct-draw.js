import { parseDrawImageDirectives, stripDrawImageDirectives, stripDrawImageSlots } from './image-marker-syntax.js';
import { joinTags, assembleCharacterPrompts, usesChineseAppearance } from './character-prompts.js';
import { createSceneSource, resolveSceneAnchor } from './scene-source.js';
import { hasOwnedImageSlots } from './image-directive-identity.js';
import {pinImageCharacterAppearances} from './character-appearance-ledger.js';
import { parseChatImageTags } from './chat-message-image-markup.js';
import { WorldbookProcessor } from './worldbook-processor.js';
import { applyWardrobeContinuity } from './wardrobe-continuity.js';
import { buildMaleImageOnlyRule, filterMaleImageDirective, containsMaleAnatomy, normalizeImagePerspective, anchorIsClearlyMaleOnly, storyMentionsFemale } from './male-image-exclusion.js';

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
    const current = parseDrawImageDirectives(message?.mes || '',{skipInvalid:true}).filter(item => item.prompt.trim()||item.parseError);
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

export function getDirectDrawReplyState(message,options={}){
    if(hasOwnedImageSlots(message,options))return {state:'placed',directives:[]};
    const directives=readDirectDrawDirectives(message);
    return {state:directives.length?'ready':'missing',directives};
}

function assembleDirectCharacterPrompts(chars,known){
    return assembleCharacterPrompts(chars,known,{preserveDanbooruCanonical:true})
        .map((item,index)=>({...item,prompt:joinTags(item.prompt,chars[index]?.state)}));
}

export function buildDirectDrawTasks(directives, preset = {}, options = {}) {
    if (!Array.isArray(directives) || directives.length === 0) {
        const error = new Error('\u5f53\u524d\u5267\u60c5\u6ca1\u6709\u7ed8\u56fe\u6307\u4ee4(<image>)\uff0c\u672c\u8f6e\u672a\u63d0\u4ea4 ComfyUI\uff1b\u8bf7\u68c0\u67e5\u6a21\u578b\u5de5\u5177\u8fd4\u56de\u7684\u5267\u60c5\u5b57\u6bb5\u3002');
        error.code = 'DRAW_DIRECTIVES_MISSING';
        throw error;
    }
    const skipInvalid = options.skipInvalidImages === true;
    const rejected = [];
    const reject = (index,error) => {
        if (!skipInvalid) throw error;
        const detail = { image:index+1, message:String(error?.message || error) };
        rejected.push(detail);
        options.onImageRejected?.(detail);
    };
    // Keep original source indices: rejected images must not renumber later scenes.
    const valid = [];
    for(const [ordinal,item] of directives.entries()){
        const index=Number.isInteger(item?.imageIndex)&&item.imageIndex>=0?item.imageIndex:ordinal;
        if(!String(item?.prompt || '').trim()){
            if(skipInvalid) reject(index,new Error('本张缺少有效绘图提示词'));
            continue;
        }
        try {
            if(item.parseError)throw new Error(item.parseError);
            valid.push({ item:filterMaleImageDirective(item,options.knownCharacters || [],
                {requireFemale:options.requireFemaleImage === true}), index,original:item });
        } catch(error){ reject(index,error); }
    }
    if (!valid.length) throw new Error(skipInvalid
        ? '本次没有可提交的绘图：'+rejected.map(e=>'第'+e.image+'张 '+e.message).join('；')
        : '当前剧情没有绘图指令，请重新生成这条剧情回复，或手动填写图片提示词');
    const count = Math.max(0, Math.floor(Number(preset.maxImages) || 0));
    if (count > 20 || (!count && valid.length > 20)) throw new Error('单次最多生成 20 张图片，请调整出图数量');
    const maxCharacters = Math.max(0, Math.floor(Number(preset.maxCharactersPerImage) || 0));
    if (!skipInvalid && count && valid.length !== count) {
        throw new Error('当前设置 ' + count + ' 张，但本次剧情只有 ' + valid.length +
            ' 段有效绘图指令。不能复制同一幅画面凑数，请重新生成剧情回复。');
    }
    if(count&&directives.length!==count)options.onCountMismatch?.({expected:count,received:directives.length});
    const selected = valid.slice(0,count||valid.length);
    const narrative = options.sourceText === undefined ? null
        : stripDrawImageSlots(stripDirectDrawSource(String(options.sourceText)));
    const source = narrative === null ? null : createSceneSource(narrative, { filterRules: options.filterRules, restrictToNarrativeBody:true });
    // Never invent a woman when the entire actual narrative is unmistakably
    // male-only. A male *sentence* in a story also featuring women is different.
    if(options.requireFemaleImage === true && source?.content?.trim()
        && anchorIsClearlyMaleOnly(source.content,options.knownCharacters||[]))
        throw new Error('本次剧情只有男性出镜，不能凭空添加女性凑图。');
    // Hidden-only narrative: keep the requested image, show it in a visible image gallery.
    const mapped = [];
    const appearanceLedger = new Map(options.recentAppearances instanceof Map ? options.recentAppearances : []);
    for (const {item,index,original} of selected) {
        try {
        const chars = pinImageCharacterAppearances(
            normalizeDirectCharacters(item.characters, options.knownCharacters),
            appearanceLedger, options.knownCharacters||[],{...options.appearanceSources,narrative:source?.content||''});
        // Keep verified source corrections for every later image in this batch.
        // The pinning step already rejects unsupported generated changes.
        for(const person of chars) {
            const identity=String(person.name||'').normalize('NFKC').trim().toLocaleLowerCase();
            if(identity && String(person.appear||'').trim())
                appearanceLedger.set(identity,person.appear);
        }
        const names = chars.map(person => person.name);
        if (maxCharacters && names.length > maxCharacters) {
            throw new Error(`第 ${index + 1} 张绘图指令有 ${names.length} 名角色，超过设置的 ${maxCharacters} 名，请修改指令`);
        }
        let placement = { mode: 'tail' };
        if (source?.points.length) {
            const after = String(item.after || '').trim();
            // Preserve the scene-to-picture relationship, never scatter to an unrelated point.
            let offset = after ? resolveSceneAnchor(source,after)?.offset??null
                : Number.isInteger(item.sourceOffset) && source.points.some(p=>p.offset===item.sourceOffset)
                    ? item.sourceOffset : null;
            if(offset!==null && options.requireFemaleImage === true) {
                const pointIndex=source.points.findIndex(p=>p.offset===offset);
                const start=pointIndex>0?source.points[pointIndex-1].offset:0;
                const chosenBeat=narrative.slice(start,offset);
                if(anchorIsClearlyMaleOnly(chosenBeat,options.knownCharacters||[])){
                    const candidates=source.points.filter((point,i)=>{
                        const from=i>0?source.points[i-1].offset:0;
                        return storyMentionsFemale(narrative.slice(from,point.offset),
                            options.knownCharacters||[]);
                    });
                    // Image content remains female-only. Move only its anchor
                    // to an actual female beat, never switch genders or invent
                    // content in a male-only sentence. Retain exact task index.
                    const closest=candidates.sort((a,b)=>
                        Math.abs(a.offset-offset)-Math.abs(b.offset-offset)||a.offset-b.offset)[0];
                    const fromOffset=offset;
                    offset=closest?.offset??null;
                    options.onPlacementFallback?.({image:index+1,
                        reason:'male-story-anchor-not-female',
                        originalOffset:fromOffset,recoveredOffset:offset});
                }
            }
            if(!after && offset === null) {
                // Legacy no-anchor images remain in a separate gallery; never
                // attach one to an arbitrary nearby character or story node.
            } else if(offset === null && after && narrative.includes(after) && !source.content.includes(after)) {
                // Quote is real but hidden by another preset. Keep this task in an
                // explicitly separate visible gallery without inventing an anchor.
                options.onHiddenAnchor?.({image:index+1});
            } else if(offset === null) {
                // A mismatched after is a placement problem, NOT a reason to
                // suppress a non-blacklisted image. The delivery pass will
                // place it immediately after the preceding image in source order.
                options.onPlacementFallback?.({image:index+1,reason:'after-not-matched'});
            }
            // The actual picture is still subject to strict female-only
            // character and positive-prompt validation below.
            if(offset !== null) placement = { mode: 'source', sourceHash: source.sourceHash, offset };
        }
        const characterPrompts = assembleDirectCharacterPrompts(chars, options.knownCharacters || []);
        mapped.push({ imageIndex:index,directiveIdentity:{imageIndex:index,
            after:String(original.after||'')},
            scene: String(item.prompt).trim(), chars, characterPrompts,
            extraNegativePrompt: String(item.negative || '').trim(),
            ...(item.post_prompt ? { post_prompt: String(item.post_prompt).trim() } : {}), placement });
        } catch(error) { reject(index,error); }
    }
    if(!mapped.length) throw new Error('本次所有绘图均被拦截：'+rejected.map(e=>'第'+e.image+'张 '+e.message).join('；'));
    const result=applyWardrobeContinuity(mapped,options.wardrobeLedger,{
        narrative:narrative||'',knownCharacters:options.knownCharacters||[],
    });
    for(const task of result)if(task.characterPrompts===null)
        task.characterPrompts=assembleDirectCharacterPrompts(task.chars,options.knownCharacters||[]);
    // Do not make an otherwise valid image fail because one item is unsafe.
    // Evaluate final merged character prompts, then deduplicate per image.
    const signatures = new Map();
    const accepted = [];

    for (const task of result) {
        const index = task.imageIndex;
        // Also sanitize character-library/wardrobe fields merged after initial filtering.
        task.scene=normalizeImagePerspective(task.scene);
        if(typeof task.post_prompt==='string')task.post_prompt=normalizeImagePerspective(task.post_prompt);
        if(Array.isArray(task.characterPrompts))task.characterPrompts=task.characterPrompts.map(person=>({
            ...person,prompt:normalizeImagePerspective(person?.prompt),
        }));
        const effectivePositive = [
            task.scene, task.post_prompt,
            ...(task.characterPrompts || []).map(person => person?.prompt),
        ].filter(Boolean).join(', ');
        if(containsMaleAnatomy(effectivePositive)){
            reject(index,new Error('最终正向提示词出现男性生殖器官，已跳过该图'));
            continue;
        }
        const key=JSON.stringify([
            String(task.scene || '').toLocaleLowerCase().replace(/\s+/g,' ').trim(),
            (task.characterPrompts||[]).map(p=>String(p?.prompt||'').toLocaleLowerCase().replace(/\s+/g,' ').trim()),
            String(task.post_prompt||'').toLocaleLowerCase().replace(/\s+/g,' ').trim()
        ]);
        if(signatures.has(key)){
            reject(index,new Error('与第 '+(signatures.get(key)+1)+' 张绘图提示词相同；不复制画面凑数'));
            continue;
        }
        signatures.set(key,index);
        // Validate pictures individually. A missing first anchor must NOT
        // poison later exact source anchors by forcing the whole batch to tail.
        accepted.push({...task});
    }
    if(!accepted.length)throw new Error('本次所有绘图均被拦截：'+rejected.map(e=>'第'+e.image+'张 '+e.message).join('；'));
    // Preserve order while retaining every later valid source placement.
    // First unanchored pictures go to the last real sentence boundary before
    // the next valid anchor. Later unanchored pictures follow the preceding
    // source picture. If there are no valid anchors, keep the gallery fallback.
    let previous=null;
    for(let i=0;i<accepted.length;i++){
        const task=accepted[i];
        let placement=task.placement;
        if(placement?.mode==='source'){
            if(previous?.mode==='source' && placement.offset<previous.offset)
                placement={...previous};
        }else if(previous?.mode==='source'){
            placement={...previous};
        }else if(source?.points?.length){
            const next=accepted.slice(i+1).find(item=>item.placement?.mode==='source');
            if(next){
                const preceding=source.points.filter(point=>point.offset<next.placement.offset).at(-1);
                placement={mode:'source',sourceHash:source.sourceHash,
                    offset:preceding?.offset??next.placement.offset};
            }
        }
        task.placement=placement;
        previous=placement;
        task.directiveIdentity={
            imageIndex:task.imageIndex,
            after:placement?.mode==='source'
                ?source.anchors.find(anchor=>anchor.offset===placement.offset)?.text||''
                :'',
            requestedAfter:task.directiveIdentity?.after||'',
        };
    }
    return accepted;
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
        for (const key of ['type', 'danbooru', 'appear', 'appear_evidence', 'costume', 'state', 'action', 'interact', 'uc']) {
            if (person[key] !== undefined && typeof person[key] !== 'string') throw new Error(`人物 ${name} 的 ${key} 必须是文字`);
            item[key] = String(person[key] || '').trim();
        }
        // Library identity is authoritative; model supplies only the current scene state.
        if (known) { if (known.type && !/[\u3400-\u9fff]/u.test(known.type)) item.type = ''; if (known.danbooruTag) item.danbooru = ''; if (known.appearance && !usesChineseAppearance(known)) item.appear = ''; }
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

export function buildDirectDrawInstruction({ preset = {}, prompts = {}, characters = [], worldbook = '', filterRules = [], wardrobeContext = '', recentAppearances = {} } = {}) {
    const count = Math.max(0, Math.floor(Number(preset.maxImages) || 0));
    const maxCharacters = Math.max(0, Math.floor(Number(preset.maxCharactersPerImage) || 0));
    return [
        '[绘图指令] 正文有可见画面时，为每幅图指定其对应的正文位置。绘图指令可以集中附在回复末尾，图片会插到各自 after 引用的原文后面。下列设置仅用于绘图描述，不改变正文的对话任务。',
        '当前预设若要求通过工具输出剧情，保留预设原有的工具名称、参数结构和正文标签；必须把完整 <image> 绘图块放进同一工具中承载最终剧情的文字字段末尾，与剧情一起返回，不得只在空的普通正文外追加，也不得放进思考或状态字段。无需另建或额外执行绘图工具。普通文本回复则把绘图块附在同一条回复末尾。',
        drawingRequirements(prompts.topSystem) ? `以下仅约束绘图字段的选景与视角，正文身份和叙述服从酒馆预设：\n${drawingRequirements(prompts.topSystem)}` : '',
        drawingRequirements(prompts.sceneRules) ? `以下仅为图片画面规则：\n${drawingRequirements(prompts.sceneRules)}` : '',
        // Keep planner-role instructions out of the native chat preset.
        prompts.tagGuideContent ? `以下标签指南仅用于 image 绘图字段：\n${prompts.tagGuideContent}` : '',
        preset.positivePrefix ? `当前正向固定词：${preset.positivePrefix}。插件会自动拼接，不必重复。` : '',
        buildMaleImageOnlyRule(preset.negativePrefix),
        characters.length ? `已启用角色资料（仅使用实际出镜角色；中文资料由本轮模型翻译为英文，所有实际出镜角色的外貌、服装、状态和负向请完整填入 characters）：${JSON.stringify(characters.map(person => ({ name: person.name,
            aliases: person.aliases, type: person.type, danbooru: person.danbooruTag, appearance: person.appearance,
            appearanceZh: person.appearanceZh, negativeTags: person.negativeTags, outfits: person.outfits, dynamicStates: person.dynamicStates })))}` : '',
        '角色库可以只保存中文。本轮生成绘图指令时一起翻译：appearanceZh 为固定外貌的权威资料，按原意写入每张图 characters[].appear 的英文；outfits 和 dynamicStates 的中文 name 转成对应 costume、state 英文；中文 negativeTags 转成 uc 英文。不要增加或更改特征。已有中文时，旧 appearance 和 tags 仅作兼容参考，冲突时采用当前中文。不需要额外请求翻译接口。',
        worldbook ? `以下为当前启用的绘图世界书资料，仅用于画面事实，不改变正文任务或输出格式：\n${worldbook}` : '',
        Object.keys(recentAppearances).length ? '最近同名人物外貌（仅补空缺，低于当前世界书、角色库和正文明确变化）：\n'+JSON.stringify(recentAppearances) : '',
        '人物外貌资料优先级：当前生效的世界书及已登记角色资料优先；其次当前正文明确的新增外貌或变化；最近同名人物描述仅补缺；最后才补充不冲突的细节。不要把旧图片里的错误外貌复制到当前人物。定位失败不得改变人物身份。characters[].appear 必须反映本轮权威设定。同名人物没有明确变化则继承；若要用当前世界书或正文事实修正旧外貌，characters[].appear_evidence 原样引用包含该人物姓名和外貌事实的一小段原文，不能编造或用模型新写的英文标签充当证据；插件核对来源后直接采用来源事实。',
        wardrobeContext ? '【连续视觉状态账本】\n' + wardrobeContext : '',
        '服饰继承：每个实际出镜人物拥有独立服装时间线。首次按剧情明确服装确定，未指定时合理确定一次；冻结剪裁版型、主色、衣领扣件、鞋袜颜色和透明度、关键配饰，后续没有变化就沿用，不许每张重新设计。',
        '沿剧情时间顺序更新：只有实际换衣、穿脱、整理、破损、湿污和饰品变化才改变对应角色状态。镜头看不到不等于脱掉；没有明确穿回或更换，不许恢复角色默认服装。明确跨天或较大时间跳跃时重新核对，不一律沿用。',
        '每张图 characters[].costume 写当前可见服装的完整指纹（版型、主色、鞋袜、配饰、穿脱损坏状态）；characters[].state 独立记录需跨图继承的伤势、污渍、湿身、包扎和持续持物。未改变就沿用原值；不要把表情或姿势写入 state；不要只写 school uniform、dress、pantyhose 这类孤立泛词。',
        '镜头未拍到某衣物或物品，不等于自动脱掉或丢弃。出现新的换装、治愈、清洗、拿起或放下事件，才更新对应角色及对应状态；不改变其他人物。prompt 主要描述场景构图，不能与角色服装或状态矛盾。',
        filterRules.length ? `以下成对边界内的思考、状态或辅助内容不能作为画面或定位句来源：${JSON.stringify(filterRules)}` : '',
        prompts.fieldDescriptions ? `绘图字段补充说明（旧编号定位统一改为 after 原文定位）：\n${prompts.fieldDescriptions}` : '',
        count ? 'MANDATORY IMAGE COUNT = ' + count + '. In this same story response, output EXACTLY ' + count + ' separate <image> blocks, not merely at most ' + count + '. Each block needs a DISTINCT English prompt grounded in a different actual visual moment of the narrative: action, interaction, setting, lighting, camera composition. Use appropriate characters and a genuine matching after anchor. Never clone an image prompt or only change the random seed. No second model call.' : '按剧情需要附绘图指令，最多 20 段。',
        maxCharacters ? `每张图最多 ${maxCharacters} 名实际出镜角色。` : '',
        '必须服从当前设置的风格与视角，不额外强制写实或动漫。只描述实际出镜人物，不能凭空增加人物。',
        '绘图正向 prompt 里，已出镜的女性角色采用写实中国女性、自然东亚五官外貌（Chinese, East Asian facial features），这属于原有角色特征；不能因此增加人数、补充路人或加入额外女性。没有女性出镜则不要写女性或外貌标签。',
        '以下 image 格式仅是正文之外的绘图附加段。正文继续使用酒馆预设的规则与格式。',
        '绘图块使用以下文本格式，不调用旧规划工具。characters 列出全部实际出镜人物；只用角色库姓名。服装 costume 与连续状态 state 是独立字段，action 只写当前画面动作；已录入角色也须依据当前中文资料填写英文 appear，不要留空。',
        '女性 NSFW 外阴外观：无阴毛，大阴唇饱满闭合，小阴唇自然状态不外露，外阴及阴唇肤色白皙浅粉，无深色素沉着。',
        'Only the drawing program writes bracketed slot IDs; model text must contain <image> blocks but no bracketed slot tokens.',
        '<image>', 'prompt: 英文画面提示词（单行，描述场景、构图、光线、视角；与人物字段合成完整画面）',
        'negative: 本画面额外的负向提示词（单行，没有则留空）',
        'characters: [{"name":"实际人物姓名","type":"身份标签","appear":"新人物外貌","costume":"当前服装完整指纹","state":"持续状态（伤势、湿污、持物等）","action":"当前动作","interact":"互动","uc":"人物额外负向"}]',
        'post_prompt: 整图末尾追加词（单行，没有则留空）',
        'after: 对应画面所在段落末尾的一句完整原文', '</image>',
        '每段 <image> 都必须在 </image> 前填写 after: 字段，原样引用对应画面所在段落末尾的一句完整正文（含标点、单行）。引用必须在正文中唯一出现，不得改写或编造。',
        count ? 'FINAL SELF CHECK: ' + count + ' pictures require ' + count + ' <image> blocks and ' + count + ' DISTINCT independent prompts in THIS ONE reply. Count the blocks and verify each describes a different true story beat BEFORE sending. No copies, no seed-only variants, no extra API calls.' : '',
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
}
