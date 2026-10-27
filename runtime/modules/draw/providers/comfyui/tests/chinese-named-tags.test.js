import test from 'node:test';
import assert from 'node:assert/strict';
import { namedTagsChineseText, reconcileChineseNamedLines } from '../chinese-named-tags.js';

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
test('Existing name-less English tags are preserved by Chinese preview save',()=>{
 const old=[{name:'',tags:'black boots'}];
 assert.deepEqual(reconcileChineseNamedLines(namedTagsChineseText(old),old),old);
});
test('Non-Chinese labels are not silently committed as Chinese',()=>{
 assert.throws(()=>reconcileChineseNamedLines('white shirt',[]),/中文/);
});
