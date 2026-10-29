import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDirectDrawInstruction, buildDirectDrawTasks } from '../../../shared/direct-draw.js';
import { normalizeCharacter, parseCharacterImport, planCharacterImport, exportCharacters } from '../../../shared/character-library.js';
import { compile } from '../compiler.js';
import { buildCharacterTestPrompt } from '../character-test-prompt.js';

const source=fs.readFileSync(new URL('../comfy-draw.js',import.meta.url),'utf8');
const role={danbooruTag:'',id:'one',name:'林安',type:'woman',appearanceZh:'林安是30岁成年女性，黑色长发、棕色眼睛',
  negativeTags:'男性，额外人物',outfits:[{name:'白色衬衫和蓝色长裤'}],dynamicStates:[{name:'右手拿着画笔'}]};
function execute(start,end,env,args=[]){
  const begin=source.indexOf(start),finish=source.indexOf(end,begin+start.length);
  assert.ok(begin>=0 && finish>begin,'save entrypoint must exist');
  const fn=source.slice(begin,finish);
  return new Function(...Object.keys(env),'return ('+fn.trim()+')(...arguments[arguments.length-1]);')(...Object.values(env),args);
}
function environment(){
  let saved;
  const env={getSharedCharacterTagsFromForm:()=>[structuredClone(role)],characterDraftSignature:x=>JSON.stringify(x),
    getSharedDrawSettings:()=>({characterTags:[role],worldbooks:{uploadedBooks:[]}}),
    updateSharedDrawSettingsPersistent:async updater=>{const state={characterTags:[]};await updater(state);saved=state;return true;},
    querySettings:()=>null,querySettingsAll:()=>[],CSS:{escape:x=>x},
    toastr:{success(){},error(){}},getSharedCharacterGroupsFromForm:()=>[],getChecked:()=>false,collectFilterRules:()=>[],getValue:()=>''};
  return {env,get saved(){return saved;}};
}
test('single role save persists only Chinese descriptions',async()=>{
  const h=environment();
  assert.equal(await execute('async function saveSingleComfyCharacterCard(','function openCharacterTestPreview(',h.env,['one']),true);
  assert.deepEqual(h.saved.characterTags[0],role);
});
test('complete role library save persists only Chinese descriptions',async()=>{
  const h=environment();
  assert.equal(await execute('async function saveSharedDrawSettings(','async function saveAllSettings(',h.env,[{}]),true);
  assert.deepEqual(h.saved.characterTags[0],role);
});
test('this-turn English translation wins without any stale English library field',()=>{
  const withLegacy={...role,appearance:'red hair, green eyes',outfits:[{name:'白色衬衫和蓝色长裤',tags:'red coat'}]};
  const tasks=buildDirectDrawTasks([{prompt:'adult female painter, sunny studio',after:'林安推开了画室的窗户。',
    characters:[{name:'林安',appear:'black long hair, brown eyes',costume:'white shirt, blue trousers',state:'holding a paintbrush',uc:'male, extra people'}]}],
    {maxImages:1},{knownCharacters:[withLegacy],sourceText:'林安推开了画室的窗户。'});
  const p=tasks[0].characterPrompts[0];
  assert.match(p.prompt,/black long hair/);assert.doesNotMatch(p.prompt,/red hair|green eyes|red coat/);
  const compiled=compile(tasks,{host:'http://fixture.invalid',workflowMode:'simple',params:{model:'fixture',width:768,height:1024,cfg:1,steps:8},
    knownCharacters:[withLegacy],seeds:[1],timeout:1000,delayMs:0});
  assert.doesNotMatch(compiled.artifacts[0].promptData.positive,/red hair|green eyes|red coat/);
});
test('legacy English-only role cannot override current scene description',()=>{
  const old={...role,appearanceZh:'',appearance:'red hair, green eyes'};
  const tasks=buildDirectDrawTasks([{prompt:'artist at window',characters:[{name:'林安',appear:'black hair, brown eyes'}]}],{maxImages:1},{knownCharacters:[old]});
  assert.match(tasks[0].characterPrompts[0].prompt,/black hair, brown eyes/);
  assert.doesNotMatch(tasks[0].characterPrompts[0].prompt,/red hair|green eyes/);
});
test('generation instructions supply Chinese facts but no old English tags',()=>{
  const instruction=buildDirectDrawInstruction({characters:[{...role,appearance:'red hair',outfits:[{name:'白色衬衫',tags:'red coat'}]}]});
  assert.match(instruction,/appearanceZh/);
  assert.match(instruction,/黑色长发/);
  assert.doesNotMatch(instruction,/red hair|red coat/);
});
test('manual role preview uses Chinese without saved English translation',()=>{
  const prompt=buildCharacterTestPrompt({...role,appearance:'red hair',outfits:[{name:'白色衬衫和蓝色长裤',tags:'red coat'}]});
  assert.match(prompt.positive,/黑色长发/);
  assert.match(prompt.positive,/白色衬衫和蓝色长裤/);
  assert.doesNotMatch(prompt.positive,/red hair|red coat/);
});
test('normalization and import drop legacy English while preserving Chinese facts',()=>{
  const old={...role,appearance:'red hair, green eyes',appearanceSource:'chinese',
    outfits:[{name:'白色衬衫和蓝色长裤',tags:'red coat'}],
    dynamicStates:[{name:'右手拿着画笔',tags:'left hand'}]};
  const normalized=normalizeCharacter(old);
  assert.equal(normalized.appearanceZh,role.appearanceZh);
  assert.equal(Object.hasOwn(normalized,'appearance'),false);
  assert.equal(Object.hasOwn(normalized,'appearanceSource'),false);
  assert.deepEqual(normalized.outfits,[{name:'白色衬衫和蓝色长裤'}]);
  assert.deepEqual(normalized.dynamicStates,[{name:'右手拿着画笔'}]);
  const legacyImport=parseCharacterImport({type:'novel-draw-characters',version:4,characters:[old],groups:[]});
  assert.ok(legacyImport.warnings.some(w=>w.code==='legacy-english-ignored'));
  assert.equal(Object.hasOwn(legacyImport.entries[0].character,'appearance'),false);
  assert.deepEqual(legacyImport.entries[0].character.outfits,[{name:'白色衬衫和蓝色长裤'}]);
  const incoming=parseCharacterImport(exportCharacters({characters:[normalized],groups:[]}));
  const result=planCharacterImport({characters:[{...old,appearanceZh:'旧中文'}],groups:[]},incoming);
  assert.equal(result.library.characters[0].appearanceZh,role.appearanceZh);
  assert.equal(Object.hasOwn(result.library.characters[0],'appearance'),false);
});
