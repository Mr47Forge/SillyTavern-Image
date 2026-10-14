'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { materialize } = require('../lib/workflow');
const { storePhoto, readPhoto } = require('../lib/photos');
const { endpoint, runGeneration, checkConnection } = require('../lib/transport');

test('Krea2有照片时从采样前就读取人物身份，不进行换脸', () => {
  const { workflow } = materialize({ prompt: '城市夜景', width: 768, height: 1152, seed: 123 }, 'face.jpg');
  assert.equal(workflow['15'].inputs.image, 'face.jpg');
  assert.deepEqual(workflow['5'].inputs.image1, ['15', 0]);
  assert.deepEqual(workflow['8'].inputs.positive, ['5', 0]);
  assert.match(workflow['5'].inputs.prompt, /城市夜景/);
  assert.equal(Object.values(workflow).some(x => x.class_type === 'FaceFusionSwapNode'), false);
});

test('没有照片时删除人脸参考节点并改走纯文本编码', () => {
  const { workflow } = materialize({ prompt: '雨天咖啡馆', seed: 2 });
  assert.equal(workflow['15'], undefined);
  assert.equal(workflow['5'], undefined);
  assert.deepEqual(workflow['8'].inputs.positive, ['18', 0]);
  assert.equal(workflow['18'].inputs.text, '雨天咖啡馆');
});

test('无效尺寸、空提示词、错误节点映射会拒绝', () => {
  assert.throws(() => materialize({ prompt: '', width: 768 }), /提示词/);
  assert.throws(() => materialize({ prompt: '室内', width: 777 }), /64/);
  assert.throws(() => materialize({ mode: 'custom', prompt: '室内', workflow: {}, nodeMap: {} }), /工作流节点/);
});

test('自定义 API 工作流只改用户指定节点', () => {
  const { workflow: original } = materialize({ prompt: '原', seed: 3 });
  const custom = structuredClone(original);
  const map = { positive: '18', negative: '6', seed: '8', size: '7', save: '11' };
  const result = materialize({ mode: 'custom', workflow: custom, nodeMap: map, prompt: '新场景', negative: '负向', seed: 2 }).workflow;
  assert.equal(result['18'].inputs.text, '新场景');
  assert.equal(result['6'].inputs.text, '负向');
  assert.equal(result['8'].inputs.seed, 2);
  assert.equal(custom['18'].inputs.text, '原');
});

test('上传照片按用户私有目录隔离，拒绝路径穿越', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-test-'));
  try {
    const alice = { directories: { images: path.join(root, 'alice') } };
    const bob = { directories: { images: path.join(root, 'bob') } };
    const bytes = Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(300),Buffer.from([0xff,0xd9])]);
    const saved = await storePhoto(alice, 'data:image/jpeg;base64,' + bytes.toString('base64'));
    assert.match(saved.id, /^[a-f0-9]{32}$/);
    const loaded = await readPhoto(alice, saved.id);
    assert.deepEqual(loaded.bytes, bytes);
    await assert.rejects(() => readPhoto(bob, saved.id), /不存在/);
    await assert.rejects(() => readPhoto(alice, '../../config.yaml'), /无效/);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('服务器 ComfyUI 任务接口完整提交并返回图片', async () => {
  const calls = [];
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(320)]);
  async function mockFetch(url, options) {
    const u = new URL(String(url)); calls.push({ path: u.pathname + u.search, options });
    if (u.pathname.endsWith('/system_stats')) return Response.json({ system: { comfyui_version: '0.test' } });
    if (u.pathname.endsWith('/prompt')) {
      const req=JSON.parse(options.body);assert.ok(req.prompt['8']);
      return Response.json({ prompt_id: 'fake-test-prompt-1234' });
    }
    if (u.pathname.endsWith('/history/fake-test-prompt-1234'))
      return Response.json({ 'fake-test-prompt-1234': { status: { status_str: 'success' }, outputs: { '11': { images: [{filename:'output.png',type:'output',subfolder:''}] } } } });
    if (u.pathname.endsWith('/view'))
      return new Response(png, { status: 200, headers:{ 'Content-Type':'image/png' } });
    throw Error('Unexpected: '+u);
  }
  const ok = await checkConnection({host:'http://127.0.0.1:8188', fetchImpl:mockFetch});
  assert.equal(ok.ok,true);
  const result = await runGeneration({
    host:'http://127.0.0.1:8188',request:{prompt:'大堂',seed:123},
    fetchImpl:mockFetch, pollMs:5
  });
  assert.equal(result.ok,true);
  assert.match(result.dataUrl,/^data:image\/png;base64,/);
  assert.equal(result.seed,123);
  assert.ok(calls.some(x=>x.path.includes('/view?filename=output.png')));
});

test('实际照片上传给 ComfyUI 后再采样', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sti-photo-'));
  try {
    const user={directories:{images:root}};
    const bytes=Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(300)]);
    const saved=await storePhoto(user,'data:image/jpeg;base64,'+bytes.toString('base64'));
    const calls=[];
    async function mockFetch(url,options){
      const u=new URL(String(url));calls.push(u.pathname);
      if(u.pathname.endsWith('/upload/image')) {assert.equal(options.method,'POST');return Response.json({name:'stimage-face.jpg',subfolder:''});}
      if(u.pathname.endsWith('/prompt')) {
        const req=JSON.parse(options.body);
        assert.equal(req.prompt['15'].inputs.image,'stimage-face.jpg');
        assert.deepEqual(req.prompt['8'].inputs.positive,['5',0]);
        return Response.json({prompt_id:'photo-demo-1234'});
      }
      if(u.pathname.endsWith('/history/photo-demo-1234'))return Response.json({'photo-demo-1234':{status:{status_str:'success'},outputs:{'11':{images:[{filename:'z.png',type:'output'}]}}}});
      if(u.pathname.endsWith('/view'))return new Response(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200)]));
      throw Error(u.pathname);
    }
    const result=await runGeneration({host:'http://127.0.0.1:8188',request:{prompt:'下雨',photoId:saved.id},user,fetchImpl:mockFetch,pollMs:5});
    assert.equal(result.ok,true);
    assert.deepEqual(calls.slice(0,2),['/upload/image','/prompt']);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
