'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const adapter=require('../providers/comfyui/adapter.js');
const root='/home/node/app';
const cfg=JSON.parse(fs.readFileSync(root+'/data/default-user/user/files/LittleWhiteBox_ComfyDraw.json','utf8')).config;
const workflow=JSON.parse(fs.readFileSync(root+'/data/default-user/user/workflows/Krea2_纯脸参考_角色照片自动匹配.json','utf8'));
assert.equal(workflow['15'].inputs.image,'__LWB_ROLE_PHOTO__');
workflow['5'].inputs.prompt='Realistic photograph of a fully clothed adult woman reading a book in a quiet library, warm indoor lamps, one adult woman, natural human anatomy.';
workflow['8'].inputs.seed=584944;
workflow['11'].inputs.filename_prefix='Krea2_Test_Placeholder_Guard_20261014';
(async()=>{
 const result=await adapter.execute({
  context:{url:cfg.host,auth:cfg.auth||''},
  item:{request:{workflow,preferredSaveImageNodeId:'11'}},
  signal:new AbortController().signal,
 });
 assert.equal(result.mime,'image/png');
 assert.ok(result.buffer.length>20000);
 console.log('RAW_PLACEHOLDER_LIVE_SUCCESS','image_bytes='+result.buffer.length);
})().catch(e=>{console.error(e);process.exitCode=1});
