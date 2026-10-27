'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {getCurrentUser}=require('../lib/user-context');
const {injectSavedRolePhotos,stripUnresolvedRolePhoto}=require('../runtime/providers/comfyui/role-photo-upload');
const {createAsyncImageJobManager}=require('../runtime/image-jobs/job-manager');
const {registerImageJobRoutes}=require('../runtime/image-jobs/routes');
const comfy=require('../runtime/providers/comfyui/adapter');
function router(){const routes=new Map();const r={routes};for(const m of ['get','post','put','patch','delete','use'])r[m]=(p,...handlers)=>routes.set(m.toUpperCase()+' '+p,handlers);return r;}
async function invoke(r,m,p,{user,body={},params={}}={}){const q=new EventEmitter();Object.assign(q,{user,body,params});const headers={};const a={statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;},end(){return this;},setHeader(k,v){headers[k.toLowerCase()]=v;},getHeader(k){return headers[k.toLowerCase()];}};for(const h of r.routes.get(m+' '+p)||[])await h(q,a,()=>{});return a;}
test('standalone exposes current recovery routes and removes the duplicate direct generation API',async t=>{
 const plugin=require('../index');t.after(()=>plugin.exit());const r=router();await plugin.init(r);
 assert.ok(r.routes.has('GET /status'));assert.ok(r.routes.has('POST /runtime/v1/jobs'));
 assert.ok(r.routes.has('GET /runtime/v1/jobs/:jobId/results/:index'));
 for(const key of ['POST /v1/generate','POST /v1/photos','GET /v1/photos/:id','POST /v1/check'])assert.equal(r.routes.has(key),false,key);
 const denied=await invoke(r,'USE','/runtime');assert.equal(denied.statusCode,403);
 const normalized=getCurrentUser({user:{profile:{handle:'alice'},directories:{userImages:path.resolve('fixture-images'),files:path.resolve('fixture-files')}}});
 assert.equal(normalized.directories.images,path.resolve('fixture-images'));assert.equal(normalized.directories.files,path.resolve('fixture-files'));
});
test('current role-photo resolver uploads only authenticated-user image references and keeps the workflow immutable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sti-photo-current-'));try{
  const images=path.join(root,'alice'),folder=path.join(images,'SillyTavernImage-role-photos');await fs.mkdir(folder,{recursive:true});
  const bytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(300)]);await fs.writeFile(path.join(folder,'artist.jpg'),bytes);
  const input={15:{class_type:'LoadImage',inputs:{image:'lwb-role-photo:user/images/SillyTavernImage-role-photos/artist.jpg'}}};let calls=0;
  const uploaded=await injectSavedRolePhotos(input,{url:'http://fixture.invalid/comfy',imagesDirectory:images,fetchImpl:async(u,o)=>{calls++;assert.equal(new URL(u).pathname,'/comfy/upload/image');assert.equal(o.method,'POST');return Response.json({name:'owned-photo.jpg'});}});
  assert.equal(calls,1);assert.equal(uploaded[15].inputs.image,'owned-photo.jpg');assert.ok(input[15].inputs.image.startsWith('lwb-role-photo:'));
  await assert.rejects(injectSavedRolePhotos(input,{url:'http://fixture.invalid',imagesDirectory:path.join(root,'bob'),fetchImpl:()=>{throw new Error('must not upload');}}),e=>e.code==='ENOENT');
  const evil={15:{class_type:'LoadImage',inputs:{image:'lwb-role-photo:user/images/../../settings.json'}}};await assert.rejects(injectSavedRolePhotos(evil,{imagesDirectory:images}),/Invalid character photo reference/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('current unresolved photo fallback preserves text and sampler parameters',()=>{
 const original={15:{class_type:'LoadImage',inputs:{image:'__LWB_ROLE_PHOTO__'}},5:{class_type:'TextEncodeKrea2Reference',inputs:{prompt:'studio sunlight'}},18:{class_type:'CLIPTextEncode',inputs:{text:'old'}},8:{class_type:'KSampler',inputs:{positive:['5',0],cfg:1,steps:8}}};
 const out=stripUnresolvedRolePhoto(original);assert.equal(out[15],undefined);assert.equal(out[5],undefined);assert.equal(out[18].inputs.text,'studio sunlight');assert.deepEqual(out[8].inputs.positive,['18',0]);assert.equal(out[8].inputs.cfg,1);assert.equal(out[8].inputs.steps,8);assert.ok(original[15]);
});
test('current ComfyUI job route submits, returns, isolates and acknowledges a generated image',async t=>{
 const previous=global.fetch;t.after(()=>global.fetch=previous);const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0h0AAAAASUVORK5CYII=','base64');const calls=[];
 global.fetch=async(u,o={})=>{const x=new URL(u);calls.push(x.pathname);if(x.pathname.endsWith('/prompt')){assert.equal(JSON.parse(o.body).prompt['9'].class_type,'SaveImage');return Response.json({prompt_id:'integration-current'});}if(x.pathname.endsWith('/history/integration-current'))return Response.json({'integration-current':{status:{status_str:'success'},outputs:{9:{images:[{filename:'fixture.png',type:'output'}]}}}});if(x.pathname.endsWith('/view'))return new Response(png);throw new Error('unexpected '+x.pathname);};
 const manager=createAsyncImageJobManager({adapters:{comfyui:comfy}});t.after(()=>manager.close());const r=router();registerImageJobRoutes(r,{manager,adapters:{comfyui:comfy}});
 const user={profile:{handle:'alice'}},params={jobId:'integration-current',index:'0'};
 const result=await invoke(r,'POST','/v1/jobs',{user,body:{provider:'comfyui',requestId:params.jobId,context:{url:'http://fixture.invalid/comfy'},delay:{min:1,max:1},items:[{timeout:1000,request:{workflow:{9:{class_type:'SaveImage',inputs:{}}}}}]}});assert.equal(result.statusCode,202);
 for(let i=0;i<100&&manager.getJob('alice',params.jobId).state!=='completed';i++)await new Promise(q=>setTimeout(q,2));
 const output=await invoke(r,'GET','/v1/jobs/:jobId/results/:index',{user,params});assert.equal(output.statusCode,200);assert.deepEqual(output.body,png);
 assert.equal((await invoke(r,'GET','/v1/jobs/:jobId/results/:index',{user:{profile:{handle:'bob'}},params})).statusCode,404);
 assert.equal((await invoke(r,'DELETE','/v1/jobs/:jobId/results/:index',{user,params})).statusCode,200);
 assert.equal((await invoke(r,'GET','/v1/jobs/:jobId/results/:index',{user,params})).statusCode,410);assert.deepEqual(calls,['/comfy/prompt','/comfy/history/integration-current','/comfy/view']);
});
