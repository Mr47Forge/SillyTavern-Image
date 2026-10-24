import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCharacterAppearanceText, cleanImageCharacterProfile } from '../character-appearance-cleanup.js';
import { parseImageCharacterReply } from '../image-character-logic.js';
import { buildCharacterTestPrompt } from '../character-test-prompt.js';

test('Chinese visibility disclaimers are discarded while body traits survive', () => {
 const zh = '杏眼，身形偏纤细，其余身体部位不可见。画面仅露出大腿上部，不可判断身高与腿长。仅见肩颈以上部分，黑色长发';
 const clean = cleanCharacterAppearanceText(zh, 'zh');
 assert.match(clean, /杏眼/); assert.match(clean, /身形偏纤细/); assert.match(clean, /黑色长发/);
 assert.doesNotMatch(clean, /仅见|不可判断|不可见|仅露出/);
});
test('English cropped framing is excluded but real hair and eyes are not', () => {
 const en = 'almond eyes, only upper body visible, cropped at thighs, black long hair, height cannot be determined, narrow nose';
 const clean = cleanCharacterAppearanceText(en);
 assert.match(clean, /almond eyes/); assert.match(clean, /black long hair/); assert.match(clean, /narrow nose/);
 assert.doesNotMatch(clean, /only upper|cropped at|cannot be determined/);
});
test('vision import filters both languages before a user can save it', () => {
 const out = parseImageCharacterReply(JSON.stringify({
  name:'ignored', type:'woman', appearanceZh:'圆脸，画面仅露出大腿上部，不可判断身高与腿长，单眼皮',
  appearance:'round face, only upper body visible, monolid eyes', negativeTags:'',
  outfits:[{name:'蓝色上衣', tags:'blue top'}], dynamicStates:[], excluded:[]
 }));
 assert.equal(out.name,''); assert.match(out.appearanceZh,/单眼皮/);
 assert.doesNotMatch(out.appearanceZh,/仅露出|不可判断/);
 assert.doesNotMatch(out.appearance,/only upper body/);
});
test('full test ignores historical photo crop terms and preserves unique identity', () => {
 const a=buildCharacterTestPrompt({type:'woman',appearance:'wide-set almond eyes, cropped at waist, small pointed chin'}, {framing:'full'});
 const b=buildCharacterTestPrompt({type:'woman',appearance:'narrow-set round eyes, only upper body visible, square jaw'}, {framing:'full'});
 assert.match(a.positive,/wide-set almond eyes/);assert.match(b.positive,/narrow-set round eyes/);
 assert.doesNotMatch(a.positive,/cropped at waist/); assert.doesNotMatch(b.positive,/only upper/);
 assert.notEqual(a.positive,b.positive);assert.match(a.negative,/upper body only/);
 const half=buildCharacterTestPrompt({appearance:'oval face'}, {framing:'half'});
 assert.match(half.positive,/waist-up framing/); assert.doesNotMatch(half.positive,/full length standing photograph/);
});
test('cleaning image inventory preserves clothing and temporary expression', () => {
 const result=cleanImageCharacterProfile({appearanceZh:'杏眼，仅见肩颈以上部分',appearance:'almond eyes, cropped portrait',
  outfits:[{name:'白色针织衫',tags:'white ribbed top'}],dynamicStates:[{name:'微笑',tags:'soft smile'}]});
 assert.equal(result.appearanceZh,'杏眼');assert.equal(result.appearance,'almond eyes');
 assert.equal(result.outfits[0].tags,'white ribbed top');assert.equal(result.dynamicStates[0].name,'微笑');
});
