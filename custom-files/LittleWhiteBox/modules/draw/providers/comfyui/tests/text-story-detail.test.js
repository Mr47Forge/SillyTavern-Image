import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDetailedTextImportInstruction,shouldAuditTextImport,detailScoreForTextImport,
  buildStoryIndexInstruction,parseStoryIndex,selectCharacterStoryEvidence,buildStoryDetailInstruction}
 from '../text-story-detail.js';

test('text detail instruction preserves listed character traits, not generic beauty templates',()=>{
 const rules=buildDetailedTextImportInstruction();
 for(const key of ['脸部轮廓','眉形','眼型','鼻梁','唇','分缝','盘扎','体型','饰边','appearanceZh','negativeTags'])
  assert.ok(rules.includes(key),key);
 assert.ok(buildDetailedTextImportInstruction({audit:true}).includes('遗漏核查'));
});
test('rich source with lost facial detail triggers AI source-grounded audit, not keyword classification',()=>{
 const source='一名年轻女性，柔和鹅蛋脸，自然平眉，略微上扬的深色杏眼，细小鼻尖，浅粉色双唇，深棕色侧分盘发，碎刘海垂落耳际，白色罗纹翻领上衣，领口黑色波浪饰边，胸前小巧刺绣，深灰格纹百褶裙，黑色腰带金色扣环。';
 const weak={appearanceZh:'鹅蛋脸，深棕色头发',outfits:[{name:'白色上衣'}],dynamicStates:[]};
 assert.equal(shouldAuditTextImport(source,weak),true);
 const strong={appearanceZh:'柔和鹅蛋脸，自然平眉，略微上扬的深色杏眼，细小鼻尖，浅粉色双唇，深棕色侧分盘发，碎刘海垂落耳际，自然肤色，纤细身材',outfits:[{name:'白色罗纹翻领上衣，黑色波浪饰边，小巧刺绣，深灰格纹百褶裙，黑色腰带金色扣环'}],dynamicStates:[]};
 assert.ok(detailScoreForTextImport(strong)>detailScoreForTextImport(weak));
 assert.equal(shouldAuditTextImport('1girl, long hair',weak),false);
});
test('story index extracts only named characters literally found in actual recent story',()=>{
 const story=[{index:0,text:'林雪望着窗外，黑色长发扎成马尾。',speaker:'narrator'},
  {index:1,text:'张琪走进咖啡厅，短发，圆脸。',speaker:'narrator'},
  {index:2,text:'{{user}}轻声回答，然后离开。',speaker:'user'}];
 const response=JSON.stringify({characters:[{name:'林雪',aliases:[]},{name:'张琪',aliases:[]},
  {name:'虚构人物',aliases:[]},{name:'{{user}}',aliases:[]}]});
 const names=parseStoryIndex(response,story);
 assert.deepEqual(names.map(x=>x.name),['林雪','张琪']);
 assert.ok(buildStoryIndexInstruction().includes('具名角色'));
});
test('story evidence preserves character-specific scene and nearby pronoun context in chronological order',()=>{
 const story=[{index:0,text:'远处的雨落在站台',speaker:'narrator'},
 {index:1,text:'林雪有鹅蛋脸、棕色卷发，张琪是短发圆脸',speaker:'narrator'},
 {index:2,text:'她说自己穿着蓝色上衣',speaker:'narrator'},
 {index:3,text:'没有角色姓名的路人走过去',speaker:'narrator'},
 {index:4,text:'张琪回头看林雪',speaker:'narrator'}];
 const evidence=selectCharacterStoryEvidence(story,[{name:'林雪',aliases:[]}],{maxChars:1000,maxMessages:7});
 assert.ok(evidence.some(x=>x.text.includes('鹅蛋脸')));
 assert.ok(evidence.some(x=>x.text.includes('蓝色上衣')));
 assert.deepEqual(evidence.map(x=>x.index),[...evidence.map(x=>x.index)].sort((a,b)=>a-b));
 assert.ok(buildStoryDetailInstruction().includes('existingProfiles'));
 assert.ok(buildStoryDetailInstruction().includes('AI补充'));
});
test('story index malformed reply fails explicitly rather than creating fake role',()=>{
 assert.throws(()=>parseStoryIndex('story says hi',[]),/索引/);
});
