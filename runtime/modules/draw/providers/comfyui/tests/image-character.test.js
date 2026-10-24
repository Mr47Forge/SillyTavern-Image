import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImageCharacterReply } from '../image-character-logic.js';
import { buildAiPromptCharacters, mergeAiPromptCharacters } from '../prompt-import.js';
import { normalizeCharacter } from '../../../shared/character-library.js';
import { buildNativeMessages } from '../../../../agent-core/adapters/openai-compatible.js';

const observation={
  name:'hallucinated name must be ignored',type:'woman',
  appearance:'oval face, shoulder length black hair, almond eyes',
  appearanceZh:'鹅蛋脸、黑色齐肩发、杏眼',
  outfits:[{name:'灰色连帽卫衣',tags:'grey hoodie'}],
  dynamicStates:[{name:'害羞脸红',tags:'shy, blushing'}],
  negativeTags:'low quality',excluded:['月台场景','景深摄影']
};
test('single image returns Chinese and English role fields without inventing a name',()=>{
 const result=parseImageCharacterReply(JSON.stringify(observation));
 assert.equal(result.name,'');
 assert.equal(result.appearanceZh,'鹅蛋脸、黑色齐肩发、杏眼');
 assert.equal(result.outfits[0].tags,'grey hoodie');
 assert.equal(result.negativeTags,'');
 const saved=buildAiPromptCharacters([{...result,name:'人物A'}]);
 const library=mergeAiPromptCharacters({characters:[],groups:[]},saved);
 const normalized=normalizeCharacter(library.characters[0]);
 assert.equal(normalized.name,'人物A');
 assert.equal(normalized.appearance,observation.appearance);
 assert.equal(normalized.appearanceZh,observation.appearanceZh);
 assert.equal(normalized.outfits[0].name,'灰色连帽卫衣');
 assert.equal(normalized.outfits[0].tags,'grey hoodie');
});
test('multiple/no-person/unsupported images explicitly fail',()=>{
 for(const code of ['multiple_people','no_person','not_supported'])
  assert.throws(()=>parseImageCharacterReply(JSON.stringify({error:code})));
});
test('a text model claiming an image description without json cannot import a fake character',()=>{
 assert.throws(()=>parseImageCharacterReply('I am a text-only model and cannot see images'),/识图/);
});
test('must have both accurate Chinese and English fixed face information',()=>{
 assert.throws(()=>parseImageCharacterReply(JSON.stringify({...observation,appearance:''})));
 assert.throws(()=>parseImageCharacterReply(JSON.stringify({...observation,appearanceZh:''})));
});
test('adapter forwards actual image bytes as a multimodal message rather than reducing them to text',()=>{
 const data='data:image/jpeg;base64,/9j/AA==';
 const messages=buildNativeMessages({systemPrompt:'Look at this image',messages:[{
    role:'user',content:[{type:'text',text:'describe the character'},{type:'image_url',image_url:{url:data}}]
 }]},'gpt-4o-mini');
 assert.equal(messages[1].content[1].type,'image_url');
 assert.equal(messages[1].content[1].image_url.url,data);
});

test('detailed visual prompt explicitly asks for individual identity and garment construction', async()=>{
  const {buildImageCharacterAnalysisPrompt,evaluateImageCharacterDetail}=await import('../image-character-logic.js');
  const prompt=buildImageCharacterAnalysisPrompt();
  for(const needle of ['脸部','眉形','鼻梁','唇形','盘发','罗纹','领口','腰带','不能由上半身照片推断腿长','appearanceZh','outfits'])
   assert.ok(prompt.includes(needle),'missing visual detail '+needle);
  const underDetailed={appearanceZh:'年轻女性，鹅蛋脸，大眼睛，棕色长发',outfits:[{name:'白色上衣',tags:'white top'}]};
  assert.ok(evaluateImageCharacterDetail(underDetailed).length>=2);
  const rich={
    appearanceZh:'年轻成年女性，脸颊柔和，下颌轻柔收拢，深色大眼睛，眉毛自然，鼻梁小巧，淡粉色嘴唇，深棕发色向后盘起，侧分细碎刘海，两侧有垂落发丝，肤色自然，肩腰线条纤细匀称，发丝蓬松有细微光泽，眼尾柔和微扬，双颊圆润自然，下巴轻微收窄，细致但不过度修饰的面部结构。',
    outfits:[{name:'白色罗纹短袖翻领针织衫，领口带黑色波浪饰边，深灰色格纹百褶裙，黑色皮带与金色扣环，小巧耳钉',tags:'white ribbed polo, black trim, plaid skirt, black belt, gold buckle, small earrings'}],
  };
  assert.equal(evaluateImageCharacterDetail(rich).length,0);
  assert.ok(buildImageCharacterAnalysisPrompt({strictDetails:true}).length>prompt.length);
});

test('first-install image analysis instruction remains available for image-visibility recovery',async()=>{
 const {buildImageCharacterCompatibilityPrompt,buildImageCharacterAnalysisPrompt}=await import('../image-character-logic.js');
 const first=buildImageCharacterCompatibilityPrompt();
 const detailed=buildImageCharacterAnalysisPrompt();
 assert.ok(first.length>400);
 assert.ok(detailed.length>first.length);
 for(const key of ['appearance','appearanceZh','outfits','dynamicStates','multiple_people','not_supported'])assert.ok(first.includes(key),key);
});
test('model image-not-visible is classified as a retryable delivery failure',()=>{
 try{
  parseImageCharacterReply(JSON.stringify({error:'not_supported'}));
  assert.fail('should throw');
 }catch(error){
  assert.equal(error.code,'IMAGE_NOT_VISIBLE');
 }
});
test('image visibility recovery retries once with initial-install prompt and retains recognized profile',async()=>{
 const {runImageCharacterCompatibilityRetry}=await import('../image-character-logic.js');
 const calls=[];
 const image=JSON.stringify(observation);
 const outcome=await runImageCharacterCompatibilityRetry(
  async()=>{calls.push('detailed');return parseImageCharacterReply(JSON.stringify({error:'not_supported'}));},
  async()=>{calls.push('initial-install');return parseImageCharacterReply(image);},
  ()=>calls.push('progress'),
 );
 assert.deepEqual(calls,['detailed','progress','initial-install']);
 assert.equal(outcome.appearanceZh,observation.appearanceZh);
 assert.equal(outcome.outfits[0].name,observation.outfits[0].name);
});
test('vision recovery does not retry no-person or malformed character results',async()=>{
 const {runImageCharacterCompatibilityRetry}=await import('../image-character-logic.js');
 let called=0;
 for(const value of [{error:'no_person'},{error:'multiple_people'},{appearance:'incomplete'}]){
  await assert.rejects(runImageCharacterCompatibilityRetry(
   async()=>parseImageCharacterReply(JSON.stringify(value)),
   async()=>{called++;return observation;},
  ));
 }
 assert.equal(called,0);
});
test('image visibility recovery fails safely after one unsuccessful original-prompt retry',async()=>{
 const {runImageCharacterCompatibilityRetry}=await import('../image-character-logic.js');
 let attempts=0;
 await assert.rejects(runImageCharacterCompatibilityRetry(
  async()=>{attempts++;return parseImageCharacterReply(JSON.stringify({error:'not_supported'}));},
  async()=>{attempts++;return parseImageCharacterReply(JSON.stringify({error:'not_supported'}));},
 ),e=>e.code==='IMAGE_NOT_VISIBLE');
 assert.equal(attempts,2);
});
