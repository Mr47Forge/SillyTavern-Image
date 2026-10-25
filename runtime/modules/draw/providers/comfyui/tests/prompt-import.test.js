import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPromptImportSource, parseAiPromptCategory, combineAiPromptChunks, buildAiPromptCharacters, mergeAiPromptCharacters } from '../prompt-import.js';
const response=(name,appearance,appearanceZh)=>JSON.stringify({name,type:'woman',appearance,appearanceZh,outfits:[{name:'服装',tags:'white shirt, black skirt'}],dynamicStates:[{name:'表情',tags:'smile'}],negativeTags:'extra limbs',excluded:['studio light']});
test('splits large prompts into safe small chunks without classifying with keyword rules',()=>{
 const input='角色名：林雪\n'+'long black hair, '.repeat(185)+'\n---\n角色名：李雅\nshort brown hair, skirt, smile, extra fingers';
 const jobs=splitPromptImportSource(input,{chunkSize:600});
 assert.ok(jobs.length>3);
 assert.deepEqual([...new Set(jobs.map(x=>x.group))],[0,1]);
 assert.ok(jobs.every(x=>x.text.length<=600));
 assert.equal(jobs[0].name,'林雪');
});
test('AI parsed categories map to existing role fields',()=>{
 const parsed=parseAiPromptCategory(response('林雪','long black hair, oval face','黑色长发，鹅蛋脸'));
 assert.equal(parsed.appearance,'long black hair, oval face');
 assert.match(parsed.appearanceZh,/黑/);
 assert.deepEqual(parsed.outfits,[{name:'服装',tags:'white shirt, black skirt'}]);
 assert.equal(parsed.negativeTags,'extra limbs');
 assert.deepEqual(parsed.excluded,['studio light']);
});
test('rejects invalid or truncated AI JSON, bilingual omissions',()=>{
 assert.throws(()=>parseAiPromptCategory('Model response reached its outputlimit.'));
 assert.throws(()=>parseAiPromptCategory(JSON.stringify({appearance:'long black hair',appearanceZh:'long black hair'})));
 assert.throws(()=>parseAiPromptCategory(JSON.stringify({appearance:'long hair',appearanceZh:''})));
});
test('merges AI chunk fields belonging to one user named role',()=>{
 const jobs=[{group:0,part:0,name:'林雪'},{group:0,part:1,name:'林雪'}];
 const parts=[parseAiPromptCategory(response('','black hair','黑发')),
   parseAiPromptCategory(JSON.stringify({type:'woman',appearance:'oval face',appearanceZh:'鹅蛋脸',outfits:[],dynamicStates:[],negativeTags:'',excluded:[]}))];
 const result=combineAiPromptChunks(jobs,parts);
 assert.equal(result.length,1);
 assert.match(result[0].appearance,/oval face/);
 assert.match(result[0].appearanceZh,/鹅蛋脸/);
});
test('new role imports into original fields, negative stays opt-in',()=>{
 const original={characters:[],groups:[]};
 const parsed=parseAiPromptCategory(response('林雪','black hair, oval face','黑发、鹅蛋脸'));
 const entries=buildAiPromptCharacters([parsed],{includeNegative:false});
 assert.equal(entries[0].negativeTags,'');
 const merged=mergeAiPromptCharacters(original,entries);
 assert.equal(merged.created,1);
 assert.equal(merged.characters[0].appearanceZh,parsed.appearanceZh);
 assert.equal(merged.characters[0].outfits[0].tags,'white shirt, black skirt');
 assert.equal(original.characters.length,0);
});
test('existing role never loses its saved bilingual appearance under default strategy',()=>{
 const original={characters:[{id:'A',name:'林雪',aliases:[],type:'woman',appearance:'original round face',appearanceZh:'原来圆脸',outfits:[],dynamicStates:[],negativeTags:''}],groups:[]};
 const parsed=parseAiPromptCategory(response('林雪','oval face, black hair','鹅蛋脸、黑发'));
 const entries=buildAiPromptCharacters([parsed],{includeNegative:false});
 const merged=mergeAiPromptCharacters(original,entries);
 assert.equal(merged.created,0);
 assert.equal(merged.characters[0].appearance,'original round face');
 assert.equal(merged.characters[0].appearanceZh,'原来圆脸');
 assert.equal(merged.characters[0].outfits.length,1);
 assert.equal(merged.characters[0].negativeTags,'');
});
test('duplicate names within one batch fail instead of silently overwriting a person',()=>{
 const item=buildAiPromptCharacters([parseAiPromptCategory(response('林雪','black hair','黑发'))])[0];
 assert.throws(()=>mergeAiPromptCharacters({characters:[],groups:[]},[item,item]),/重复/);
});

test('AI output budget honors actual provider config instead of truncating at 1250 tokens', async () => {
  const {resolveAiOutputBudgets,isAiOutputTruncated} = await import('../prompt-import.js');
  assert.deepEqual(resolveAiOutputBudgets({maxTokens:32000}), {initial:8192,retry:16384});
  assert.deepEqual(resolveAiOutputBudgets({maxTokens:4096}), {initial:4096,retry:4096});
  assert.deepEqual(resolveAiOutputBudgets({maxTokens:1200}), {initial:1200,retry:1200});
  assert.deepEqual(resolveAiOutputBudgets({}), {initial:8192,retry:8192});
  assert.equal(isAiOutputTruncated({code:'AGENT_RESPONSE_TRUNCATED'}),true);
  assert.equal(isAiOutputTruncated({message:'Model response reached its output limit.'}),true);
  assert.equal(isAiOutputTruncated({code:'API_UNAVAILABLE'}),false);
});

test('image-generated profile replaces exactly one same-named role, preserving stable identity',async()=>{
 const {mergeImageCharacterByExactName}=await import('../prompt-import.js');
 const old={id:'stable-123',name:'林希雅',type:'girl',enabled:false,groupId:'g1',
  aliases:['小雅'],appearance:'old round face',appearanceZh:'原来圆脸',
  outfits:[{name:'红色长裙',tags:'red dress'}],
  dynamicStates:[{name:'哭泣',tags:'crying'}],
  negativeTags:'bad hands',danbooruTag:'existing_tag',customField:'untouched'};
 const source={characters:[old],groups:[{id:'g1',name:'家人'}]};
 const image={name:'林希雅',type:'woman',appearance:'new almond eyes, brown updo',
  appearanceZh:'新的杏眼、深棕盘发',outfits:[{name:'白色针织衫',tags:'white knit polo'}],
  dynamicStates:[{name:'微笑',tags:'soft smile'}]};
 const outcome=mergeImageCharacterByExactName(source,[image]);
 assert.equal(outcome.created,0);
 assert.equal(outcome.updated,1);
 assert.deepEqual(outcome.replacedNames,['林希雅']);
 const result=outcome.characters[0];
 assert.equal(outcome.characters.length,1);
 assert.equal(result.id,'stable-123');
 assert.equal(result.groupId,'g1');
 assert.equal(result.enabled,false);
 assert.deepEqual(result.aliases,['小雅']);
 assert.equal(result.negativeTags,'bad hands');
 assert.equal(result.danbooruTag,'existing_tag');
 assert.equal(result.customField,'untouched');
 assert.equal(result.appearance,image.appearance);
 assert.equal(result.appearanceZh,image.appearanceZh);
 assert.deepEqual(result.outfits,image.outfits);
 assert.deepEqual(result.dynamicStates,image.dynamicStates);
 assert.equal(result.outfits.some(x=>x.name==='红色长裙'),false);
 assert.equal(source.characters[0].appearance,'old round face');
 assert.deepEqual(outcome.groups,source.groups);
});
test('image import creates a new profile when the canonical name is not present',async()=>{
 const {mergeImageCharacterByExactName}=await import('../prompt-import.js');
 const result=mergeImageCharacterByExactName({characters:[],groups:[]},[{
  name:'新人物',type:'woman',appearance:'dark eyes',appearanceZh:'深色眼睛',
  outfits:[],dynamicStates:[],
 }]);
 assert.equal(result.created,1);
 assert.equal(result.updated,0);
 assert.equal(result.characters.length,1);
 assert.ok(result.characters[0].id.startsWith('comfy-image-'));
});
test('image replacement refuses ambiguous duplicate canonical names and alias collisions',async()=>{
 const {mergeImageCharacterByExactName}=await import('../prompt-import.js');
 const incoming=[{name:'林希雅',type:'woman',appearance:'new face',appearanceZh:'新面孔',outfits:[],dynamicStates:[]}];
 assert.throws(()=>mergeImageCharacterByExactName({characters:[{id:'a',name:'林希雅'},{id:'b',name:'林希雅'}]},incoming),/多名/);
 const viaAlias=[{...incoming[0],name:'小雅'}];
 assert.throws(()=>mergeImageCharacterByExactName({characters:[{id:'a',name:'林希雅',aliases:['小雅']}]},viaAlias),/别名/);
});
test('image replacement requires the full translated face, and does not overwrite existing records on error',async()=>{
 const {mergeImageCharacterByExactName}=await import('../prompt-import.js');
 const library={characters:[{id:'a',name:'林希雅',appearance:'original face',appearanceZh:'原来面容'}]};
 assert.throws(()=>mergeImageCharacterByExactName(library,[{name:'林希雅',appearance:'only english',appearanceZh:''}]),/中英文/);
 assert.equal(library.characters[0].appearance,'original face');
});
test('image replacement unchanged result remains detectable without clearing new preview',async()=>{
 const {mergeImageCharacterByExactName}=await import('../prompt-import.js');
 const x={id:'a',name:'林希雅',type:'woman',appearance:'brown hair',appearanceZh:'棕色头发',outfits:[],dynamicStates:[]};
 const result=mergeImageCharacterByExactName({characters:[x]},[x]);
 assert.equal(result.changed,false);
 assert.equal(result.skipped,1);
});
