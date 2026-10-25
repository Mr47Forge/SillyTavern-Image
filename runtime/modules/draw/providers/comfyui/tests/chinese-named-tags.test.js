import test from 'node:test';
import assert from 'node:assert/strict';
import { namedTagsChineseText, reconcileChineseNamedLines, collectUntranslatedNamedTags, applyNamedTagTranslations } from '../chinese-named-tags.js';
import { normalizeCharacter } from '../../../shared/character-library.js';

test('Chinese preview does not expose English image-generation tags',()=>{
 const originals=[{name:'白色衬衫',tags:'white shirt'},{name:'黑色半身裙',tags:'black midi skirt'}];
 assert.equal(namedTagsChineseText(originals),'白色衬衫\n黑色半身裙');
 assert.deepEqual(reconcileChineseNamedLines('白色衬衫\n黑色半身裙',originals),originals);
});
test('Editing Chinese only empties affected English tag and keeps unchanged tags',()=>{
 const src=[{name:'灰色卫衣',tags:'grey hoodie'},{name:'黑色短裙',tags:'black skirt'}];
 const next=reconcileChineseNamedLines('白色卫衣\n黑色短裙',src);
 assert.deepEqual(next,[{name:'白色卫衣',tags:''},{name:'黑色短裙',tags:'black skirt'}]);
});
test('Adding Chinese wardrobe and dynamic changes queues English generation',()=>{
 const chars=[{id:'id1',name:'林雪',outfits:[{name:'白色衬衫',tags:''}],dynamicStates:[{name:'害羞脸红',tags:''}]}];
 const requests=collectUntranslatedNamedTags(chars);
 assert.equal(requests.length,2);
 const result=applyNamedTagTranslations(chars,new Map(requests.map((r,i)=>[r.id,i===0?'white blouse':'blush, shy'])));
 assert.deepEqual(result[0].outfits,[{name:'白色衬衫',tags:'white blouse'}]);
 assert.deepEqual(result[0].dynamicStates,[{name:'害羞脸红',tags:'blush, shy'}]);
 const normalized=normalizeCharacter(result[0]);
 assert.equal(normalized.outfits[0].tags,'white blouse');
 assert.equal(normalized.dynamicStates[0].tags,'blush, shy');
});
test('Existing name-less English tags are preserved by Chinese preview save',()=>{
 const old=[{name:'',tags:'black boots'}];
 assert.deepEqual(reconcileChineseNamedLines(namedTagsChineseText(old),old),old);
});
test('Unrelated character outfit tags remain untouched',()=>{
 const chars=[{id:'A',name:'甲',outfits:[{name:'蓝裙',tags:'blue dress'}],dynamicStates:[]},{id:'B',name:'乙',outfits:[{name:'红裙',tags:''}],dynamicStates:[]}];
 const requests=collectUntranslatedNamedTags(chars);
 assert.equal(requests.length,1);
 const revised=applyNamedTagTranslations(chars,new Map([[requests[0].id,'red dress']]));
 assert.equal(revised[0].outfits[0].tags,'blue dress');
 assert.equal(revised[1].outfits[0].tags,'red dress');
});
test('Non-Chinese labels are not silently committed as Chinese',()=>{
 assert.throws(()=>reconcileChineseNamedLines('white shirt',[]),/中文/);
});
