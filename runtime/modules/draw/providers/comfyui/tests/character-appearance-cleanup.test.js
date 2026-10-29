import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCharacterAppearanceText, cleanImageCharacterProfile } from '../character-appearance-cleanup.js';
import { buildCharacterTestPrompt } from '../character-test-prompt.js';

test('Chinese visibility disclaimers are discarded while body traits survive', () => {
  const zh='杏眼，鼻梁偏细，受图片裁剪影响无法看见其肩颈以下部位，黑色长发';
  const clean=cleanCharacterAppearanceText(zh,'zh');
  assert.match(clean,/杏眼/);assert.match(clean,/鼻梁偏细/);assert.match(clean,/黑色长发/);
  assert.doesNotMatch(clean,/裁剪|无法看见/);
});

test('generic English image-text cleanup still removes framing disclaimers',()=>{
  const clean=cleanCharacterAppearanceText('almond eyes, only upper body visible, cropped at thighs, black long hair','en');
  assert.match(clean,/almond eyes/);assert.match(clean,/black long hair/);
  assert.doesNotMatch(clean,/only upper|cropped at/);
});

test('manual role test requires Chinese appearance and ignores old English identity',()=>{
  const a=buildCharacterTestPrompt({type:'woman',appearanceZh:'黑色长发，杏眼，瓜子脸',appearance:'red hair, green eyes'},{framing:'full'});
  const b=buildCharacterTestPrompt({type:'woman',appearanceZh:'棕色短发，圆眼，方形下颌',appearance:'red hair, green eyes'},{framing:'full'});
  assert.match(a.positive,/黑色长发/);assert.match(b.positive,/棕色短发/);
  assert.doesNotMatch(a.positive,/red hair|green eyes/);
  assert.notEqual(a.positive,b.positive);
  assert.match(a.negative,/upper body only/);
  const half=buildCharacterTestPrompt({appearanceZh:'椭圆脸'},{framing:'half'});
  assert.match(half.positive,/waist-up framing/);
  assert.throws(()=>buildCharacterTestPrompt({appearance:'legacy only'}),/外貌|中文/);
});

test('profile cleanup preserves Chinese clothes and states but discards hidden English fields',()=>{
  const result=cleanImageCharacterProfile({appearanceZh:'杏眼，仅见肩颈以上部位',appearance:'almond eyes, cropped portrait',appearanceSource:'chinese',
    outfits:[{name:'白色针织衫',tags:'white ribbed top'}],dynamicStates:[{name:'微笑',tags:'soft smile'}]});
  assert.equal(result.appearanceZh,'杏眼');
  assert.equal(Object.hasOwn(result,'appearance'),false);
  assert.equal(Object.hasOwn(result,'appearanceSource'),false);
  assert.deepEqual(result.outfits,[{name:'白色针织衫'}]);
  assert.deepEqual(result.dynamicStates,[{name:'微笑'}]);
});
