import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildDirectDrawInstruction,buildDirectDrawTasks} from '../../../shared/direct-draw.js';
import {normalizeCharacter,parseCharacterImport,planCharacterImport} from '../../../shared/character-library.js';
import {compile} from '../compiler.js';
import {buildCharacterTestPrompt} from '../character-test-prompt.js';
const source=fs.readFileSync(new URL('../comfy-draw.js',import.meta.url),'utf8');
const role={appearanceSource:'chinese',danbooruTag:'',id:'one',name:'林安',type:'woman',appearanceZh:'林安是30岁成年女性，黑色长发、棕色眼睛。',appearance:'red hair, green eyes',negativeTags:'男性，额外人物',outfits:[{name:'白色衬衫和蓝色长裤',tags:''}],dynamicStates:[{name:'右手拿着画笔',tags:''}]};
function execute(start,end,env,args=[]){const fn=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));return new Function(...Object.keys(env),'return ('+fn.trim()+')(...arguments[arguments.length-1]);')(...Object.values(env),args);}
function environment(){let saved;const env={getSharedCharacterTagsFromForm:()=>{const input=structuredClone(role);delete input.appearanceSource;return [input];},characterDraftSignature:x=>JSON.stringify(x),getSharedDrawSettings:()=>({characterTags:[role],worldbooks:{uploadedBooks:[]}}),
 translateChineseAppearanceDrafts:()=>{throw new Error('unexpected translation call');},translateChineseNamedTagDrafts:()=>{throw new Error('unexpected translation call');},
 updateSharedDrawSettingsPersistent:async updater=>{const state={characterTags:[]};await updater(state);saved=state;return true;},querySettings:()=>null,querySettingsAll:()=>[],CSS:{escape:x=>x},
 toastr:{success(){},error(){}},getSharedCharacterGroupsFromForm:()=>[],getChecked:()=>false,collectFilterRules:()=>[],getValue:()=>''};return {env,get saved(){return saved;}};}
test('saving one Chinese role never calls a translation model and preserves legacy values',async()=>{const h=environment();assert.equal(await execute('async function saveSingleComfyCharacterCard(','function openCharacterTestPreview(',h.env,['one']),true);assert.deepEqual(h.saved.characterTags[0],role);});
test('saving the complete Chinese role library is a pure persistent save',async()=>{const h=environment();assert.equal(await execute('async function saveSharedDrawSettings(','async function saveAllSettings(',h.env,[{}]),true);assert.deepEqual(h.saved.characterTags[0],role);});
test('this-turn English translation takes precedence over stale English when Chinese authority exists',()=>{
 const tasks=buildDirectDrawTasks([{prompt:'adult female painter, sunny studio',after:'林安推开了画室的窗户。',characters:[{name:'林安',appear:'black long hair, brown eyes',costume:'white shirt, blue trousers',state:'holding a paintbrush',uc:'male, extra people'}]}],{maxImages:1},{knownCharacters:[role],sourceText:'林安推开了画室的窗户。'});
 const p=tasks[0].characterPrompts[0];assert.match(p.prompt,/black long hair/);assert.doesNotMatch(p.prompt,/red hair|green eyes/);assert.doesNotMatch(p.prompt,/[\u3400-\u9fff]/u);assert.match(p.uc,/male/);assert.doesNotMatch(p.uc,/[\u3400-\u9fff]/u);
 const compiled=compile(tasks,{host:'http://fixture.invalid',workflowMode:'simple',params:{model:'fixture',width:768,height:1024,cfg:1,steps:8},knownCharacters:[role],seeds:[1],timeout:1000,delayMs:0});
 const final=compiled.artifacts[0].promptData;assert.match(final.positive,/black long hair/);assert.doesNotMatch(final.positive,/red hair|green eyes/);assert.doesNotMatch(final.positive,/[\u3400-\u9fff]/u);assert.doesNotMatch(final.negative,/[\u3400-\u9fff]/u);
});
test('old roles without Chinese descriptions retain the canonical English identity',()=>{const old={...role,appearanceZh:'',negativeTags:'bad hands'};const tasks=buildDirectDrawTasks([{prompt:'artist at window',characters:[{name:'林安',appear:'random new hair'}]}],{maxImages:1},{knownCharacters:[old]});assert.match(tasks[0].characterPrompts[0].prompt,/red hair, green eyes/);assert.doesNotMatch(tasks[0].characterPrompts[0].prompt,/random/);});
test('generation instructions request English character fields in the same reply from saved Chinese facts',()=>{const instruction=buildDirectDrawInstruction({characters:[role]});assert.match(instruction,/本轮.*翻译/);assert.match(instruction,/appearanceZh/);assert.match(instruction,/林安是30岁/);assert.match(instruction,/不.*额外.*(?:请求|调用)/);});
test('Chinese-only manual role preview does not require a saved English translation',()=>{const prompt=buildCharacterTestPrompt({...role,appearance:''});assert.match(prompt.positive,/黑色长发/);assert.match(prompt.positive,/白色衬衫和蓝色长裤/);});


test('Chinese authority survives normalization and replacing the same imported role without losing legacy English',()=>{
 const normalized=normalizeCharacter(role);assert.equal(normalized.appearanceSource,'chinese');
 const incoming=parseCharacterImport({type:"novel-draw-characters",version:4,characters:[role],groups:[]});
 const result=planCharacterImport({characters:[{...role,appearanceSource:undefined,appearanceZh:'旧中文'}],groups:[]},incoming);
 assert.equal(result.library.characters[0].appearanceSource,'chinese');assert.equal(result.library.characters[0].appearance,role.appearance);
});

test('Chinese description stays visible but never replaces the English drawing prompt', async () => {
    const { normalizeCharacter, exportCharacters, parseCharacterImport } = await import('../../../shared/character-library.js');
    const original = {
        id: 'alice-1', name: 'Alice', type: 'woman',
        appearance: 'short brown hair, softly rounded face',
        appearanceZh: '\u68d5\u8272\u77ed\u53d1\uff0c\u5706\u6da6\u7684\u8138\u578b',
        negativeTags: '', aliases: [], outfits: [], dynamicStates: [],
    };
    const normalized = normalizeCharacter(original);
    assert.equal(normalized.appearance, original.appearance);
    assert.equal(normalized.appearanceZh, original.appearanceZh);
    const exported = exportCharacters({characters:[normalized],groups:[]});
    const imported = parseCharacterImport(exported);
    assert.equal(imported.entries[0].character.appearance, original.appearance);
    assert.equal(imported.entries[0].character.appearanceZh, original.appearanceZh);
});

