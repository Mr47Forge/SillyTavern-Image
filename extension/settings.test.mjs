import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedSettings, chatCharacter, latestMessageText, generationPayload } from './settings.mjs';

test('默认设置不含服务器地址、密钥或照片', () => {
  const cfg = normalizedSettings();
  assert.equal(cfg.host, '');
  assert.deepEqual(cfg.rolePhotos, {});
  assert.equal(cfg.mode, 'krea2');
});
test('第一位角色编号0可以读取，空角色安全回退', () => {
  const ctx = { characterId: 0, characters:[{name:'角色A',avatar:'a.png'}] };
  assert.deepEqual(chatCharacter(ctx), {key:'a.png',name:'角色A',avatar:'a.png'});
  assert.equal(chatCharacter({characterId:null,characters:[]}),null);
});
test('最后一条消息有过滤标签而不修改原聊天', () => {
  const chat=[{mes:'旧的'},{mes:'<b>雨天</b> 车站',is_system:false}];
  assert.equal(latestMessageText({chat}),'雨天 车站');
  assert.equal(chat[1].mes,'<b>雨天</b> 车站');
});
test('只在选择角色照片参考时携带私有照片编号', () => {
  const cfg=normalizedSettings({host:'http://host:8188',useReference:true});
  assert.equal(generationPayload(cfg,'场景','photoid').request.photoId,'photoid');
  cfg.useReference=false;
  assert.equal(generationPayload(cfg,'场景','photoid').request.photoId,'');
});
test('自定义工作流必须选择存在的预设', () => {
  const cfg=normalizedSettings({mode:'custom'});
  assert.throws(()=>generationPayload(cfg,'场景',''),/导入/);
  cfg.customPresets=[{id:'x',name:'x',workflow:{'1':{class_type:'SaveImage',inputs:{images:['2',0]}}}}];
  cfg.selectedCustomId='x';
  const request=generationPayload(cfg,'场景','').request;
  assert.equal(request.mode,'custom');
  assert.equal(request.nodeMap.save,'11');
});
