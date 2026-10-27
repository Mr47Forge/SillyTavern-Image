import {buildRecentAppearanceLedger} from '../character-appearance-ledger.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { buildDirectDrawInstruction, buildDirectDrawTasks, readDirectDrawDirectives,
    rememberDirectDrawDirectives, stripDirectDrawSource, getDirectDrawWorldbook } from '../direct-draw.js';
import { parseDrawImageDirectives, stripDrawImageSlots } from '../image-marker-syntax.js';
import { compile } from '../../providers/comfyui/compiler.js';
import { selectPhotoCharacter } from '../../providers/comfyui/role-photo-reference.js';
import { buildWardrobeLedger, formatWardrobeLedger } from '../wardrobe-continuity.js';
import { characterLibraryFromSettings, selectEnabledCharacters } from '../character-library.js';

const painter = { name: 'Alice', aliases: ['画师'], enabled: true, type: 'adult female artist',
    appearance: 'silver hair', appearanceZh: '银发成年画师', negativeTags: 'red hair',
    outfits: [{ name: '工作服', tags: 'blue apron' }], dynamicStates: [{ name: '雨后', tags: 'wet hair' }],
    photoUrl: 'user/images/SillyTavernImage-role-photos/alice.jpg' };
const text = '成年画师推开画室的门。\n\n她在窗边整理画具。\n\n傍晚时分，她放下画笔。';
const directive = { prompt: 'studio, warm light', negative: 'blur', characters: [{ name: '画师', costume: 'blue apron', action: 'painting', uc: 'gloves' }], after: '她在窗边整理画具。', post_prompt: 'soft shadows' };
const preset = { maxImages: 1, maxCharactersPerImage: 1, positivePrefix: 'quality', negativePrefix: 'low quality' };
const recipe = { positivePrefix: preset.positivePrefix, negativePrefix: preset.negativePrefix, knownCharacters: [painter],
    workflowMode: 'simple', params: { model: 'fixture', width: 1024, height: 1024, cfg: 4, steps: 8 }, timeout: 1000, delayMs: 0, seeds: [123] };
const build = (items = [directive], params = preset, extra = {}) => buildDirectDrawTasks(items, params,
    { sourceText: text, knownCharacters: [painter], ...extra });

test('structured direct fields parse and keep the final append field', () => {
    const block = `<image>\nprompt: studio\ncharacters: ${JSON.stringify(directive.characters)}\npost_prompt: soft shadows\nafter: 她在窗边整理画具。\n</image>`;
    const parsed = parseDrawImageDirectives(block)[0];
    assert.equal(parsed.characters[0].action, 'painting'); assert.equal(parsed.post_prompt, 'soft shadows');
});
test('legacy comma-separated people still work', () => {
    const parsed = parseDrawImageDirectives('<image>\nprompt: studio\ncharacters: 画师\n</image>');
    assert.equal(build(parsed)[0].chars[0].name, 'Alice');
});
test('invalid structured people fail before submission', () => {
    assert.throws(() => parseDrawImageDirectives('<image>\nprompt: studio\ncharacters: [{bad}]\n</image>'), /格式/);
    assert.throws(() => build([{ ...directive, characters: [{ name: 'Alice', action: {} }] }]), /必须是文字/);
});
test('canonical names, costumes, action and extra negatives reach final request', () => {
    const tasks = build(); const batch = compile(tasks, recipe); const out = batch.artifacts[0].promptData;
    assert.equal(tasks[0].chars[0].name, 'Alice');
    for (const term of ['quality', 'silver hair', 'blue apron', 'painting', 'soft shadows']) assert.ok(out.positive.includes(term));
    for (const term of ['low quality', 'blur', 'red hair', 'gloves']) assert.ok(out.negative.includes(term));
    assert.ok(out.positive.endsWith('soft shadows'));
    assert.equal(batch.items[0].request.workflow['3'].inputs.cfg, 4);
    assert.equal(batch.items[0].request.workflow['5'].inputs.width, 1024);
});
test('model cannot replace registered identity with conflicting appearance', () => {
    const tasks = build([{ ...directive, characters: [{ name: 'Alice', type: 'other identity', appear: 'green hair' }] }]);
    const out = compile(tasks, recipe).artifacts[0].promptData;
    assert.ok(out.positive.includes('silver hair')); assert.ok(!out.positive.includes('green hair'));
});
test('declared names deterministically select the saved photo', () => {
    assert.equal(selectPhotoCharacter({ prompt: directive.prompt, taskCharacters: build()[0].chars, knownCharacters: [painter] }).name, 'Alice');
});
test('direct negative composition honors effective overrides and keeps character negatives', () => {
    const out = compile(build(), { ...recipe, negativePrefix: 'OVERRIDE GLOBAL', negativePromptOverride: 'OVERRIDE EXTRA' }).artifacts[0].promptData;
    for (const term of ['OVERRIDE GLOBAL', 'OVERRIDE EXTRA', 'red hair', 'gloves', 'blur']) assert.ok(out.negative.includes(term));
    assert.ok(!out.negative.includes('low quality'));
});
test('aliases cannot bypass character limits, duplicates do not double count', () => {
    assert.throws(() => build([{ ...directive, characters: ['Alice', 'Beatrice'] }]), /超过/);
    assert.equal(build([{ ...directive, characters: ['Alice', '画师'] }])[0].chars.length, 1);
});
test('strict settings count never clones missing Gemini image prompts', () => {
    assert.throws(() => build([], preset), /\u7ed8\u56fe\u6307\u4ee4/);
    assert.throws(() => build([directive], { maxImages: 2 }), /\u4e0d\u80fd\u590d\u5236/);
    assert.throws(() => build([directive, directive], { maxImages: 2 }), /\u63d0\u793a\u8bcd\u76f8\u540c/);
    assert.throws(() => build([directive], { maxImages: 21 }), /20/);
    assert.throws(() => build(Array(21).fill(directive), { maxImages: 0 }), /20/);
});
test('one Gemini response with three separate story beats schedules exactly three different scenes', () => {
    const scenes=[
        {...directive,prompt:'woman opens the studio door, wide shot',after:'\u6210\u5e74\u753b\u5e08\u63a8\u5f00\u753b\u5ba4\u7684\u95e8\u3002'},
        {...directive,prompt:'woman paints at a window, medium shot',after:'\u5979\u5728\u7a97\u8fb9\u6574\u7406\u753b\u5177\u3002'},
        {...directive,prompt:'woman lays brushes down at sunset, side view',after:'\u508d\u665a\u65f6\u5206\uff0c\u5979\u653e\u4e0b\u753b\u7b14\u3002'}
    ];
    const old=JSON.stringify(scenes);
    const tasks=build(scenes,{...preset,maxImages:3});
    assert.equal(tasks.length,3);
    assert.equal(new Set(tasks.map(x=>x.scene)).size,3);
    const compiled=compile(tasks,{...recipe,seeds:[101,102,103]});
    assert.equal(compiled.items.length,3);
    assert.deepEqual(compiled.items.map(x=>x.request.workflow['3'].inputs.seed),[101,102,103]);
    assert.equal(new Set(compiled.artifacts.map(x=>x.promptData.positive)).size,3);
    assert.ok(compiled.artifacts.every(x=>x.promptData.positive.includes('blue apron')));
    assert.ok(compiled.artifacts.every(x=>x.promptData.negative.includes('blur')));
    assert.equal(JSON.stringify(scenes),old);
});
test('duplicate effective positive prompts must not be submitted as separate images',()=>{
    const duplicate=[{...directive,after:'\u6210\u5e74\u753b\u5e08\u63a8\u5f00\u753b\u5ba4\u7684\u95e8\u3002'},
        {...directive,after:'\u508d\u665a\u65f6\u5206\uff0c\u5979\u653e\u4e0b\u753b\u7b14\u3002'}];
    assert.throws(()=>build(duplicate,{...preset,maxImages:2}),/\u63d0\u793a\u8bcd\u76f8\u540c/);
    const unique=duplicate.map((x,i)=>({...x,prompt:i?'woman at sunset, view from behind':'woman at studio door, front view'}));
    assert.equal(build(unique,{...preset,maxImages:2}).length,2);
});
test('female NSFW appearance rule is short and appears in image instructions',()=>{
    const instruction = buildDirectDrawInstruction({preset:{maxImages:2}});
    assert.match(instruction, /女性 NSFW 外阴外观统一为白虎馒头穴。/);
    assert.doesNotMatch(instruction, /未成年人、年龄不明确|普通或未展示该部位/);
});

test('the original single-pass model prompt requests the exact number of unique image blocks',()=>{
    const instruction=buildDirectDrawInstruction({preset:{maxImages:3}});
    assert.match(instruction,/EXACTLY 3/);
    assert.match(instruction,/3 DISTINCT independent prompts/);
    assert.match(instruction,/No copies/);
    assert.match(instruction,/No copies, no seed-only variants/);
});
test('anchors keep semantic position and tolerate typographic punctuation', () => {
    assert.equal(build()[0].placement.offset, text.indexOf('她在窗边整理画具。') + '她在窗边整理画具。'.length);
    const story = '成年画师说：“窗外的玫瑰开了。”\n\n她开始画画。';
    const tasks = build([{ ...directive, after: '成年画师说："窗外的玫瑰开了。"' }], preset, { sourceText: story });
    assert.ok(tasks[0].placement.offset < story.length);
});
test('unmatched after keeps image and follows preceding image rather than scattering',()=>{
    const raw='<think>Not a visual beat.</think>\n\n'+text;
    const directives=[
        {...directive,after:'\u5979\u5728\u7a97\u8fb9\u6574\u7406\u753b\u5177\u3002'},
        {...directive,prompt:'second portrait, alternate camera',after:'This sentence does not exist in source.'}
    ];
    const issues=[];
    const tasks=buildDirectDrawTasks(directives,{maxImages:2},{sourceText:raw,
        knownCharacters:[painter],filterRules:[{start:'<think>',end:'</think>'}],
        skipInvalidImages:true,onImageRejected:e=>issues.push(e),
    });
    assert.equal(tasks.length,2);
    assert.deepEqual(issues,[]);
    assert.equal(tasks[1].placement.mode,'source');
    assert.equal(tasks[1].placement.offset,tasks[0].placement.offset);
});
test('old inline tags use the same tasks and original paragraph', () => {
    const raw = '成年画师走进画室。[img: studio, adult painter]\n\n她开始画画。';
    const directives = readDirectDrawDirectives({ mes: raw });
    const tasks = buildDirectDrawTasks(directives, { maxImages: 1 }, { sourceText: raw });
    assert.equal(tasks.length, 1); assert.equal(tasks[0].placement.offset, '成年画师走进画室。'.length);
    assert.ok(!stripDirectDrawSource(raw).includes('[img:'));
});
test('saved direct commands survive slot insertion but not story changes', () => {
    const message = { mes: text + '<image>\nprompt: studio\n</image>' };
    rememberDirectDrawDirectives(message, readDirectDrawDirectives(message));
    message.mes = text + '\n[image:slot-test]\n'; assert.equal(readDirectDrawDirectives(message).length, 1);
    message.mes = '不同的成年画师剧情。'; assert.equal(readDirectDrawDirectives(message).length, 0);
});
test('uploaded worldbook honors keywords, disabled entries and filters', () => {
    const shared = { worldbooks: { enabled: true, uploadedBooks: [{ entries: [
        { key: ['画室'], content: 'MATCHED' }, { constant: true, content: 'CONSTANT' },
        { key: ['不存在'], content: 'UNMATCHED' }, { constant: true, disable: true, content: 'DISABLED' },
        { key: ['思考关键词'], content: 'THOUGHT' },
    ] }] }, messageFilterRules: [{ start: '<think>', end: '</think>' }] };
    const result = getDirectDrawWorldbook([{ mes: '<think>思考关键词</think>' + text }], shared);
    assert.ok(result.includes('MATCHED')); assert.ok(result.includes('CONSTANT'));
    for (const term of ['UNMATCHED', 'DISABLED', 'THOUGHT']) assert.ok(!result.includes(term));
    assert.equal(getDirectDrawWorldbook([{ mes: text }], { worldbooks: { ...shared.worldbooks, enabled: false } }), '');
});
test('picture rules, full character references, worldbook and field descriptions are migrated', () => {
    const result = buildDirectDrawInstruction({ preset, characters: [painter], worldbook: 'WORLD',
        prompts: { topSystem: 'VIEWPOINT\n通过 submit_scene_plan 提交\n可在工具调用前说明', sceneRules: 'PICTURE_RULE',
            tagGuideContent: 'GUIDE', jailbreak: 'DO_NOT_INJECT', fieldDescriptions: '{"images[].scene":"CUSTOM_FIELD"}' } });
    for (const term of ['VIEWPOINT', 'PICTURE_RULE', 'GUIDE', 'WORLD', 'CUSTOM_FIELD', 'blue apron', 'wet hair', 'red hair']) assert.ok(result.includes(term));
    for (const term of ['submit_scene_plan', 'DO_NOT_INJECT', '可在工具调用前说明']) assert.ok(!result.includes(term));
});

const main = readFileSync(new URL('../../providers/comfyui/comfy-draw.js', import.meta.url), 'utf8');
const common = readFileSync(new URL('../draw-common.js', import.meta.url), 'utf8');
function fn(src, name) {
    const start = src.search(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'));
    assert.ok(start >= 0, name);
    const end = src.slice(start).search(/\n}\r?(?=\n|$)/);
    return src.slice(start, start + end + 2).replace(/^export /, '');
}
test('draw instruction uses independent extension channel without modifying any chat messages', async () => {
    const injected = [];
    const ctx = {
        window: { stimageComfyDraw: { getDirectDrawInstruction: async () => 'DRAW ONLY' } },
        setDrawPrompt: value => injected.push(value),
    };
    vm.runInNewContext(fn(common, 'injectDrawDirectiveInstruction'), ctx);
    const chat = [
        {role:'system',mes:'NATIVE SYSTEM'},
        {mes:'<hidden>original protocol</hidden><content>USER TEXT</content>'},
        {role:'developer',mes:'NATIVE DEVELOPER'},
    ];
    const original=JSON.stringify(chat);
    await ctx.injectDrawDirectiveInstruction(chat);
    await ctx.injectDrawDirectiveInstruction(chat);
    assert.equal(JSON.stringify(chat),original);
    assert.equal(JSON.stringify(injected),JSON.stringify(['','DRAW ONLY','','DRAW ONLY']));
    assert.ok(!JSON.stringify(chat).includes('<sti-draw-instruction>'));
});
test('disabled plugin clears independent image instruction and does not clean chat',async()=>{
    let handler=null,used=0;
    const ctx={
        registerGenerateInterceptor:(_key,callback)=>{handler=callback;},
        GENERATE_INTERCEPTOR_ORDER:{DRAW:100},
        setDrawPrompt:()=>{used++;},
        window:{stimageComfyDraw:{getDirectDrawInstruction:async()=>{throw Error('must not call');}}},
    };
    vm.runInNewContext(fn(common,'setupDrawGenerateInterceptor'),ctx);
    ctx.setupDrawGenerateInterceptor({shouldStrip:()=>false});
    assert.equal(typeof handler,'function');
    const original=[{mes:'<hidden><image>preserve me</image></hidden>'}];
    const before=JSON.stringify(original);
    await handler(original);
    assert.equal(used,1);
    assert.equal(JSON.stringify(original),before);
});
test('legacy image cleaning preserves hidden bodies and other plugins image markers',()=>{
    const ctx={
        stripDrawImageHtml:value=>value,
    };
    vm.runInNewContext(fn(common,'stripDrawArtifactsFromMessage'),ctx);
    const sample='<hidden>protected <image>other extension</image> [image:custom-tag]</hidden>'
        +'\n<content>outside [image:slot-own] [image:foreign] <image>third party</image></content>';
    const result=ctx.stripDrawArtifactsFromMessage(sample);
    assert.ok(result.includes('<hidden>protected <image>other extension</image> [image:custom-tag]</hidden>'));
    assert.ok(result.includes('[image:foreign]'));
    assert.ok(result.includes('<image>third party</image>'));
    assert.ok(!result.includes('[image:slot-own]'));
    const unclosed='<hidden>important [image:slot-own] <image>keep</image>';
    assert.equal(ctx.stripDrawArtifactsFromMessage(unclosed),unclosed);
});
test('draw interceptor no longer mutates chat or appends instruction to last message',()=>{
    const setup=fn(common,'setupDrawGenerateInterceptor');
    assert.ok(!setup.includes('stripDrawArtifactsFromChat(chat)'));
    assert.ok(!setup.includes('last.mes'));
    const install=fn(common,'injectDrawDirectiveInstruction');
    assert.ok(install.includes('setDrawPrompt(currentInstruction)'));
    assert.ok(!install.includes('last.mes'));
    assert.ok(common.includes('extension_prompt_roles.USER'));
    assert.ok(common.includes('extension_prompt_types.IN_CHAT'));
});
test('real instruction builder resolves enabled native worldbook and macros without a model call', async () => {
    let scans = 0, expanded = 0;
    const shared = { useWorldInfo: true, characterTags: [painter] };
    const ctx = { loadSharedDrawSettings: async () => {}, getSettings: () => ({}), getSharedDrawSettings: () => shared,
        getActivePromptPreset: () => ({ topSystem: 'POV', sceneRules: 'RULE', tagGuideContent: 'GUIDE' }),
        getActivePreset: () => preset, characterLibraryFromSettings, selectEnabledCharacters,
        buildDirectDrawInstruction, getDirectDrawWorldbook, stripDirectDrawSource, buildWardrobeLedger, buildRecentAppearanceLedger, formatWardrobeLedger, readDirectDrawDirectives, DEFAULT_MESSAGE_FILTER_RULES: [],
        loadScenePromptRuntime: async () => ({}), expandScenePromptText: async text => { expanded++; return text; },
        readNativeForTest: async () => ({ getWorldInfoPrompt: async (messages, _size, dryRun) => {
            scans++; assert.equal(dryRun, true); assert.equal(messages.length, 1);
            return { worldInfoBefore: 'NATIVE BEFORE', worldInfoDepth: [{ entries: ['NATIVE DEPTH'] }], worldInfoAfter: 'NATIVE AFTER' };
        } }),
    };
    vm.runInNewContext((fn(main,'getActiveDrawingWorldbook')+'\n'+fn(main, 'getDirectDrawInstruction')).replace("await import('/scripts/world-info.js')", 'await readNativeForTest()'), ctx);
    const text = await ctx.getDirectDrawInstruction([{ role: 'system', mes: 'NATIVE PRESET' }, { is_user: true, mes: '成年画师走进画室。' }]);
    for (const value of ['NATIVE BEFORE', 'NATIVE DEPTH', 'NATIVE AFTER', 'GUIDE', 'RULE']) assert.ok(text.includes(value));
    assert.equal(scans, 1); assert.equal(expanded, 1);
});
test('single-picture regeneration uses saved direct card and no planner', async () => {
    let calls = 0;
    const ctx = { redrawImageCard: async (provider, input) => { assert.equal(provider, 'comfyui'); calls++; }, console };
    vm.runInNewContext(fn(main, 'refreshSingleImage'), ctx); await ctx.refreshSingleImage({ dataset: {} });
    assert.equal(calls, 1);
});
test('new direct-only entry has no planner submission or fallback', () => {
    assert.ok(!/generateAndParseScenePlan|prepareScenePlannerInput|submitProviderDrawRun|buildComfyScenePlannerOptions/.test(main));
    assert.ok(!existsSync(new URL('../scene-planner.js', import.meta.url)));
    const tags = readFileSync(new URL('../chat-message-images.js', import.meta.url), 'utf8');
    assert.ok(!/session\.(received|observe|requesting|retry)\(/.test(tags));
    assert.match(tags, /generateAndInsertImages\(\{ messageId: index \}\)/);
});
test('both old planner settings and direct settings normalize to direct without changing prompt values', () => {
    const ctx = { normalizePresets: x => structuredClone(x), normalizeWorkflowPresets: x => structuredClone(x),
        BUILTIN_WORKFLOWS: [], DEFAULT_COMFY_DRAW_SETTINGS: { timeout: 120000 },
        normalizeNumber: (n, fallback) => Number(n) || fallback, getPromptPresetDefaults: () => ({}),
        createDefaultWorkflowPreset: () => ({}), DEFAULT_PROMPT_CONFIG: {}, console };
    vm.runInNewContext(fn(main, 'normalizeSettings'), ctx);
    const original = { drawSource: 'planner', presets: [{ id: 'p', positivePrefix: 'USER POSITIVE', negativePrefix: 'USER NEGATIVE' }],
        workflowPresets: [{ id: 'w', json: '{"saved":true}' }], selectedPresetId: 'p', selectedWorkflowPresetId: 'w',
        promptPresets: [{ id: 'u', name: '用户的预设', topSystem: 'USER VIEW', sceneRules: 'USER RULE', tagGuideContent: 'USER GUIDE', fieldDescriptions: '' }],
        selectedPromptPresetId: 'u', jailbreaks: [{ id: 'j', content: 'ARCHIVED' }], selectedJailbreakId: 'j' };
    const before = JSON.stringify(original); const actual = ctx.normalizeSettings(original);
    assert.equal(actual.drawSource, 'direct'); assert.equal(actual.selectedPromptPresetId, 'u');
    assert.equal(actual.presets[0].positivePrefix, 'USER POSITIVE'); assert.equal(actual.presets[0].negativePrefix, 'USER NEGATIVE');
    assert.equal(actual.customPrompts.topSystem, 'USER VIEW'); assert.equal(actual.customPrompts.sceneRules, 'USER RULE');
    assert.equal(actual.customWorkflow.json, '{"saved":true}'); assert.equal(actual.jailbreaks, undefined); assert.equal(actual.customPrompts.jailbreak, undefined);
    assert.equal(JSON.stringify(original), before);
});

for (const scenario of [{ backend: true }, { backend: false }, { backend: true, switchDuringSave: true }]) test(`direct pipeline owns captured branch ${JSON.stringify(scenario)}`, async () => {
    const { backend, switchDuringSave = false } = scenario;
    let submitted, saves = 0;
    const message = { is_user: false, mes: text + '\n<image>\nprompt: studio, warm light\ncharacters: [{"name":"Alice","action":"painting"}]\nnegative: blur\nafter: 她在窗边整理画具。\n</image>' };
    const settings = { presets: [{ ...preset, id: 'p', width: 1024, height: 1024, cfg: 4, steps: 8, model: 'fixture' }],
        selectedPresetId: 'p', useImageBackendJobs: backend };
    const shared = { characterTags: [painter], characterGroups: [], messageFilterRules: [] };
    const host = { chatId: 'synthetic', chat: [message] };
    const ctx = { readDirectDrawDirectives, rememberDirectDrawDirectives, stripDirectDrawSource, buildDirectDrawTasks,
        characterLibraryFromSettings, selectEnabledCharacters, buildWardrobeLedger, buildRecentAppearanceLedger:()=>new Map(), structuredClone, AbortController, console,
        getSettings: () => settings, getSharedDrawSettings: () => shared,getOwnedImageSlotIds:async()=>new Set(),setActiveMessageText:(m,s)=>{m.mes=s;},syncRenderedMessageFromState:async()=>{},getActiveDrawingWorldbook:async()=>'',
        getActivePreset: s => s.presets[0], cloneSettingsObject: structuredClone, DEFAULT_MESSAGE_FILTER_RULES: [],
        normalizeNumber: (n, fallback) => Number(n) || fallback, createComfySeed: () => 123, COMFY_REQUEST_DELAY_MS: 0,
        createGenerationJob: () => ({ controller: new AbortController() }), getContext: () => host,
        findLastAIMessageId: () => 0, resolveFloorImageJobTarget: () => ({ ctx: host, message, messageId: 0 }),
        observeFloorImageJob: () => () => {}, classifyError: () => {}, ensureDrawImageStyles() {}, openDB: async () => {},
        isMessageBeingEdited: () => false,
        loadSettings: async () => {}, loadSharedDrawSettings: async () => {}, maybeComfyAutoLearn: async () => {},
        saveChatConditional: async () => { saves++; if (switchDuringSave) message.swipe_id = 1; }, backendJobMonitors: { captureGeneration: () => 0 },
        prepareImageInput: (_provider, tasks, captured) => ({ compiledBatch: compile(tasks, captured), requests: [], metadata: [] }),
        submitPreparedChatImages: async input => { submitted = input; return { status: 'done' }; },
        releaseGenerationJob() {}, failFloorImageJob() {}, writeImageError: async () => {},
    };
    vm.runInNewContext(['getEffectiveParams', 'createComfyGenerationRecipe', 'buildTasksFromMessage', 'runPreparedComfySlots', 'generateAndInsertImages']
        .map(name => fn(main, name)).join('\n'), ctx);
    if (switchDuringSave) {
        await assert.rejects(() => ctx.generateAndInsertImages({ messageId: 0 }), /回复分支.*变化/);
        assert.equal(submitted, undefined); return;
    }
    await ctx.generateAndInsertImages({ messageId: 0 });
    assert.equal(saves, 1); assert.equal(submitted.backend, backend); assert.equal(submitted.tasks[0].chars[0].name, 'Alice');
    assert.equal(submitted.swipeIndex, 0);
    assert.ok(!message.mes.includes('<image>')); assert.ok(message.extra.sti_comfy_direct);
    assert.ok(submitted.tasks[0].characterPrompts[0].uc.includes('red hair'));
});

test('native generation uses the actual chat with saved outfits, not a stripped request clone', async () => {
    const old={is_user:false,mes:'Alice visits the studio.\n<image>\nprompt: studio\ncharacters: [{"name":"Alice","costume":"navy blazer, black skirt"}]\nafter: Alice visits the studio.\n</image>'};
    rememberDirectDrawDirectives(old,readDirectDrawDirectives(old));
    old.mes='Alice visits the studio.\n[image:oldslot]';
    const context={
        loadSharedDrawSettings:async()=>{},
        getSettings:()=>({}),
        getSharedDrawSettings:()=>({characterTags:[painter],useWorldInfo:false}),
        getActivePromptPreset:()=>({topSystem:'',sceneRules:'',tagGuideContent:''}),
        getActivePreset:()=>preset,
        getContext:()=>({chat:[old]}),
        characterLibraryFromSettings,selectEnabledCharacters,
        buildDirectDrawInstruction,getDirectDrawWorldbook,stripDirectDrawSource,
        buildWardrobeLedger,formatWardrobeLedger,readDirectDrawDirectives,buildRecentAppearanceLedger,
        DEFAULT_MESSAGE_FILTER_RULES:[],
        loadScenePromptRuntime:async()=>({}),
        expandScenePromptText:async x=>x,
    };
    vm.runInNewContext(fn(main,'getActiveDrawingWorldbook')+'\n'+fn(main,'getDirectDrawInstruction'),context);
    const requestChat=[{is_user:true,mes:'Generation request with no saved metadata'}];
    const instruction=await context.getDirectDrawInstruction(requestChat);
    assert.match(instruction,/navy blazer, black skirt/);
});


test('missing image directives is diagnosed separately from a rejected image task', () => {
    assert.throws(() => buildDirectDrawTasks([],{maxImages:4},{skipInvalidImages:true}),
        e=>e.code==='DRAW_DIRECTIVES_MISSING' && /\u7ed8\u56fe\u6307\u4ee4/.test(e.message));
    let rejected=null;
    try {buildDirectDrawTasks([{prompt:'sketch a male',characters:[{name:'Bob',type:'male'}]}],
        {maxImages:1},{skipInvalidImages:true,requireFemaleImage:true})}
    catch(e){rejected=e}
    assert.ok(rejected);
    assert.notEqual(rejected.code,'DRAW_DIRECTIVES_MISSING');
});

test('existing tool transport receives image rule as active guide, ordinary mode remains independent',async()=>{
    const script=fn(common,'injectDrawDirectiveInstruction');
    const injected=[];
    const active={installed:true,enabled:true};
    const win={stimageComfyDraw:{getDirectDrawInstruction:async()=>'<image>4 items</image>'},
        __antiTruncationEngine:active};
    const ctx={window:win,setDrawPrompt:x=>injected.push(x),console:{info:()=>{}}};
    vm.runInNewContext(script,ctx);
    const chat=[{mes:'one story request'}],before=JSON.stringify(chat);
    await ctx.injectDrawDirectiveInstruction(chat);
    const guide=injected.at(-1);
    assert.ok(guide.startsWith('\u3010ToolCall\u5f15\u5bfc\u3011[UserDrawingInstructions]'));
    assert.match(guide,/<image>4 items<\/image>/);
    active.enabled=false;
    await ctx.injectDrawDirectiveInstruction(chat);
    assert.equal(injected.at(-1),'<image>4 items</image>');
    delete win.__antiTruncationEngine;
    await ctx.injectDrawDirectiveInstruction(chat);
    assert.equal(injected.at(-1),'<image>4 items</image>');
    assert.equal(JSON.stringify(chat),before);
});
