'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const diagnostics=require('../diagnostics-routes.js');
test('H28K logs persist on disk, isolate users, redact URLs and credentials', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lwb-diagnostic-'));
  try{
    await diagnostics.append('owner-A',{stage:'模型列表拉取',errorType:'FETCH_FAILED',message:'GET https://example.invalid/v1/models?key=abc returned 405 Bearer secret-abcdefghijklmnop',provider:'OpenAI compatible'},dir);
    await diagnostics.append('owner-A',{stage:'ComfyUI',errorType:'MODEL_REJECTED',message:'failed'},dir);
    const a=await diagnostics.read('owner-A',dir),b=await diagnostics.read('owner-B',dir);
    assert.equal(a.length,2);assert.equal(b.length,0);
    assert.equal(a[0].errorType,'MODEL_REJECTED');
    assert(!JSON.stringify(a).includes('https://example.invalid'));
    assert(!JSON.stringify(a).includes('Bearer secret'));
    assert(!JSON.stringify(a).includes('key=abc'));
    const persisted=await fs.readdir(dir);
    assert.equal(persisted.length,1);
    assert.equal(persisted[0].endsWith('.json'),true);
    assert(!persisted[0].includes('owner-A'));
    await diagnostics.clear('owner-A',dir);
    assert.equal((await diagnostics.read('owner-A',dir)).length,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Concurrent writes for the same owner are not lost',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lwb-concurrent-'));
  try{
    await Promise.all(Array.from({length:18},(_,n)=>diagnostics.append('owner-C',{stage:'test',errorType:'TEST',message:'entry '+n},dir)));
    const records=await diagnostics.read('owner-C',dir);
    assert.equal(records.length,18);
    assert.equal(new Set(records.map(r=>r.message)).size,18);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
