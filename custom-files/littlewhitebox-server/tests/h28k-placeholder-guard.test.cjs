'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { stripUnresolvedRolePhoto, injectSavedRolePhotos }=require('../providers/comfyui/role-photo-upload.js');
const workflowPath=path.join(__dirname,'../../../data/default-user/user/workflows/Krea2_纯脸参考_角色照片自动匹配.json');
const original=JSON.parse(fs.readFileSync(workflowPath,'utf8'));
assert.equal(original['15'].inputs.image,'__LWB_ROLE_PHOTO__');
let raw=structuredClone(original);
raw['5'].inputs.prompt='a woman in a cozy bookstore; test no photo';
const plain=stripUnresolvedRolePhoto(raw);
assert.equal(plain['15'],undefined);
assert.equal(plain['5'],undefined);
assert.deepEqual(plain['8'].inputs.positive,['18',0]);
assert.match(plain['18'].inputs.text,/bookstore/);
assert.equal(original['15'].inputs.image,'__LWB_ROLE_PHOTO__');
console.log('PASS unresolved placeholder => no-photo text-only conditioning');
assert.throws(()=>stripUnresolvedRolePhoto({'15':{class_type:'LoadImage',inputs:{image:'__LWB_ROLE_PHOTO__'}}}),/safe text-only fallback/);
console.log('PASS invalid template rejected before ComfyUI');
async function photoTest(){
 const matching=structuredClone(original);
 matching['15'].inputs.image='lwb-role-photo:user/images/LittleWhiteBox-role-photos/role-comfy-import-1791835840439-fi1tpg-1791910622793-14fcl0.jpg';
 let uploaded=false;
 const prepared=await injectSavedRolePhotos(matching,{
  url:'http://fake:8188',signal:new AbortController().signal,
  userDataRoot:'/home/node/app/data/default-user',
  fetchImpl:async (_url,opts)=>{
   assert.equal(opts.method,'POST');uploaded=true;
   return Response.json({name:'lwb-role-resolved-test.jpg',subfolder:''});
  }
 });
 assert.equal(uploaded,true);
 assert.equal(prepared['15'].inputs.image,'lwb-role-resolved-test.jpg');
 assert.deepEqual(stripUnresolvedRolePhoto(prepared)['8'].inputs.positive,['5',0]);
 console.log('PASS saved role photo uploaded and identity reference preserved');
}
photoTest().catch(e=>{console.error(e);process.exitCode=1});
