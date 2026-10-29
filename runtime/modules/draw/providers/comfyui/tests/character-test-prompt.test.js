import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCharacterTestPrompt } from '../character-test-prompt.js';

const src=fs.readFileSync(new URL('../comfy-draw.js',import.meta.url),'utf8');
test('role test builds single-person prompt without using story/worldbook or other roles',()=>{
 const out=buildCharacterTestPrompt({
  id:'one',name:'单人',type:'woman',appearanceZh:'椭圆脸，黑色长直发，眼神清澈',
  negativeTags:'bad hands',
  outfits:[{name:'蓝色毛衣',tags:'blue wool sweater'}],
 });
 assert.match(out.positive,/one female person, solo/);
 assert.match(out.positive,/椭圆脸/);
 assert.match(out.positive,/蓝色毛衣/);
 assert.match(out.positive,/full length standing photograph/);
 assert.match(out.negative,/bad hands/);
 assert.match(out.negative,/multiple people/);
 assert.equal(out.framing,'full');
});
test('test uses body framing requested and preserves already specified hair without overriding it',()=>{
 const out=buildCharacterTestPrompt({name:'someone',type:'man',appearanceZh:'棕色中长发，方形下颌',outfits:[]},{framing:'full'});
 assert.match(out.positive,/棕色中长发/);
 assert.doesNotMatch(out.positive,/natural black long hair/);
 assert.match(out.positive,/full length standing photograph/);
});
test('test requires a saved appearance when both Chinese and legacy English are empty',()=>{
 assert.throws(()=>buildCharacterTestPrompt({name:'blank',appearanceZh:''}),/外貌/);
});
test('role card binds per-card save and test, and hides Danbooru input and button',()=>{
 const card=src.slice(src.indexOf('function renderCharacterCard('),src.indexOf('function createChineseNamedTagField('));
 assert.match(card,/dataset\.sdCharSave/);
 assert.match(card,/dataset\.sdCharTest/);
 assert.doesNotMatch(card,/data-sd-char-danbooru|sdCharDanbooru|Danbooru Tag|danbooru-panel/);
 assert.match(src,/async function saveSingleComfyCharacterCard/);
 assert.match(src,/getSharedCharacterTagsFromForm\(\)\.find/);
 assert.doesNotMatch(src,/translateChineseAppearanceDrafts\(/);
 assert.doesNotMatch(src,/translateChineseNamedTagDrafts\(/);
 assert.match(src,/updateSharedDrawSettingsPersistent\(draft =>/);
 assert.match(src,/openCharacterTestPreview/);
 assert.match(src,/generateImagesFromText\(\{/);
 assert.match(src,/source:'character-test'/);
 assert.match(src,/getSharedDrawSettings\(\)\.characterTags\.find/);
 assert.match(card,/testButton\.addEventListener\('click'/);
 assert.match(card,/saveButton\.addEventListener\('click'/);
});
