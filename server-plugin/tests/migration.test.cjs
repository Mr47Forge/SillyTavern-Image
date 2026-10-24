'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('配置导入仅复制当前用户绘图设置，保留原文件并备份独立版', async () => {
  const { importLegacySettings } = require('../lib/migration.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-migrate-'));
  try {
    const old = { settings: { characterTags: [{ name: '角色甲' }], cacheDays: 5, apiKey: 'unrelated-provider-key' } };
    await fs.writeFile(path.join(dir, 'LittleWhiteBox_NovelDraw.json'), JSON.stringify(old));
    await fs.writeFile(path.join(dir, 'SillyTavernImage_NovelDraw.json'), '{"old":true}');
    const result = await importLegacySettings({ directories: { files: dir } });
    assert.equal(result.imported.length, 1);
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'SillyTavernImage_NovelDraw.json')));
    assert.deepEqual(saved.settings.characterTags, old.settings.characterTags);
    assert.equal(saved.settings.apiKey, undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'LittleWhiteBox_NovelDraw.json'))), old);
    assert.equal((await fs.readdir(dir)).some(x => x.includes('.before-import-')), true);
    await assert.rejects(importLegacySettings({ directories: {} }), /用户/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('新锁脸工作流按姓名别名绑定参考图，并在无照片时阻止误生其他人', async () => {
  const { applyRolePhotoReference } = await import('../../runtime/modules/draw/providers/comfyui/role-photo-reference.js');
  const workflow = JSON.parse(await fs.readFile(path.join(__dirname, '../workflows/krea2-identity-api.json')));
  const person = { name: '甲', aliases: ['测试角色甲'], photoUrl: 'user/images/LittleWhiteBox-role-photos/a.jpg' };
  const { normalizeCharacter } = await import('../../runtime/modules/draw/shared/character-library.js');
  assert.equal(normalizeCharacter(person).photoUrl, person.photoUrl);
  const bound = applyRolePhotoReference(structuredClone(workflow), { prompt: '晴天公园全身照', taskCharacters: [{ name: '测试角色甲' }], knownCharacters: [person] });
  assert.match(bound['72'].inputs.image, /a\.jpg$/);
  assert.equal(bound['79'].inputs.ref_boost, 4);
  assert.equal(bound['84'].inputs.grounding_px, 1024);
  assert.match(bound['84'].inputs.prompt, /晴天公园/);
  assert.throws(() => applyRolePhotoReference(structuredClone(workflow), { prompt: '公园', knownCharacters: [] }), /参考照片/);
});

test('独立后台完整注册任务接口，且不占用旧插件地址', async () => {
  const runtime = require('../runtime/index.js');
  const plugin = require('../index.js');
  const paths = [];
  const router = Object.fromEntries(['get','post','delete','put','patch','use'].map(method => [method, (...args) => paths.push([method, args[0]])]));
  try {
    await plugin.init(router);
    assert(paths.some(([m,p]) => m === 'post' && p === '/runtime/v1/draw-runs'));
    assert(paths.some(([m,p]) => m === 'get' && p === '/runtime/v1/jobs/:jobId'));
    assert(paths.some(([m,p]) => m === 'post' && p === '/v1/migrate-x'));
    assert(paths.every(([,p]) => !String(p).includes('littlewhitebox')));
  } finally { await plugin.exit?.(); await runtime.exit(); }
});

test('上传参考图必须指定当前用户目录，不可默认读取别的用户', async () => {
  const { injectSavedRolePhotos } = require('../runtime/providers/comfyui/role-photo-upload.js');
  const workflow = { 72: { class_type: 'LoadImage', inputs: { image: 'lwb-role-photo:user/images/LittleWhiteBox-role-photos/a.jpg' } } };
  await assert.rejects(injectSavedRolePhotos(workflow, { url: 'http://invalid.test' }), /用户/);
});

test('浏览器与后台使用相同锁脸编译结果，不残留个人照片或旧缓存哈希', async () => {
  const { compile } = await import('../../runtime/modules/draw/providers/comfyui/compiler.js');
  const runtime = require('../runtime/draw-runs/vendor/draw-run-runtime.cjs');
  const graph = JSON.parse(await fs.readFile(path.join(__dirname,'../workflows/krea2-identity-api.json')));
  const tasks = [{scene:'明亮公园',chars:[{name:'测试角色甲'}]}];
  const recipe = { workflowMode:'custom',customWorkflow:{json:JSON.stringify(graph),nodePositive:'84',nodeSeed:'53',nodeWidth:'82',nodeHeight:'82',nodeSaveImage:'29'},
    params:{width:768,height:1152},seeds:[123],delayMs:1000,timeout:120000,host:'http://fixture.invalid',
    knownCharacters:[{name:'测试角色甲',photoUrl:'user/images/LittleWhiteBox-role-photos/fixture.jpg'}] };
  assert.deepEqual(runtime.compileDrawRunImages('comfyui',tasks,recipe), compile(tasks,recipe));
  assert.equal(graph['72'].inputs.image,'__ST_IMAGE_ROLE__');
  assert.equal(Object.values(graph).some(node=>Object.hasOwn(node,'is_changed')),false);
});
