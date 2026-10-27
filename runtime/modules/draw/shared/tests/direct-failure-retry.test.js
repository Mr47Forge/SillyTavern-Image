import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readDirectDrawDirectives, rememberDirectDrawDirectives, stripDirectDrawSource } from '../direct-draw.js';

const source=readFileSync(new URL('../../providers/comfyui/comfy-draw.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('export async function generateAndInsertImages('),source.indexOf('export async function initComfyDraw(')).replace('export async','async');
function fixture({failed=false}={}){
 const story='画家打开画室。';
 const message={mes:story+'\n<image>\nprompt: adult woman painting\nafter: '+story+'\n</image>',extra:{}};
 if(failed){message.mes+='\n[image:slot-old]';message.extra.sti_comfy_slots={'slot-old':{status:'failed'}};}
 const host={chatId:'fixture',chat:[message]};let visible=message.mes,requests=0,finished=0;
 const container={querySelector:()=>failed?{}:null};
 const env={console,readDirectDrawDirectives,rememberDirectDrawDirectives,stripDirectDrawSource,
  setActiveMessageText:(m,s)=>{m.mes=s;},getContext:()=>host,findLastAIMessageId:()=>0,
  createGenerationJob:()=>({controller:new AbortController()}),observeFloorImageJob:()=>()=>{},
  ensureDrawImageStyles(){},openDB:async()=>{},loadSettings:async()=>{},loadSharedDrawSettings:async()=>{},
  cloneSettingsObject:structuredClone,getSettings:()=>({}),getSharedDrawSettings:()=>({}),
  resolveFloorImageJobTarget:()=>({ctx:host,message,messageId:0}),getOwnedImageSlotIds:async()=>new Set(failed?['slot-old']:[]),
  isMessageBeingEdited:()=>false,saveChatConditional:async()=>{},
  syncRenderedMessageFromState:async()=>{visible=stripDirectDrawSource(message.mes);},
  document:{querySelector:()=>Object.values(message.extra.sti_comfy_slots||{}).some(s=>s.status==='failed')?container:null},
  redrawFloorFailedImageCards:async()=>{requests++;return {submitted:1,skipped:0};},
  buildTasksFromMessage:async()=>{throw new Error('fixture invalid directive');},
  failFloorImageJob(){},writeImageError:async()=>{},releaseGenerationJob(){finished++;},classifyError(){}};
 vm.runInNewContext(code,env);
 return {env,message,get visible(){return visible;},get requests(){return requests;},get finished(){return finished;}};
}
test('directive source disappears even when task building fails; input remains available for retry',async()=>{
 const f=fixture();await assert.rejects(f.env.generateAndInsertImages({messageId:0}),/fixture invalid/);
 assert.ok(!f.visible.includes('prompt:'));assert.ok(!f.message.mes.includes('<image>'));
 assert.equal(readDirectDrawDirectives(f.message).length,1);assert.equal(f.finished,1);
});
test('manual generation reuses failed cards instead of blocking or creating another batch',async()=>{
 const f=fixture({failed:true});const r=await f.env.generateAndInsertImages({messageId:0});
 assert.equal(r.submitted,1);assert.equal(f.requests,1);assert.ok(f.message.mes.includes('[image:slot-old]'));
 assert.ok(!f.visible.includes('prompt:'));assert.equal(f.finished,1);
});
for(const status of ['success','pending','unknown'])test('existing '+status+' images still prevent a duplicate whole batch',async()=>{
 const f=fixture({failed:true});f.message.extra.sti_comfy_slots['slot-old'].status=status;
 await assert.rejects(f.env.generateAndInsertImages({messageId:0}),e=>e.code==='DUPLICATE_IMAGE_BATCH');
 assert.equal(f.requests,0);assert.ok(!f.visible.includes('prompt:'));
});
test('automatic events cannot resubmit old failed slots',async()=>{
 const f=fixture({failed:true});
 await assert.rejects(f.env.generateAndInsertImages({messageId:0,automatic:true}),e=>e.code==='DUPLICATE_IMAGE_BATCH');
 assert.equal(f.requests,0);
});
test('a stalled error logger cannot hold the failed floor job open',async()=>{
 const f=fixture();let release,failed;
 f.env.writeImageError=()=>new Promise(resolve=>{release=resolve;});
 const operation=f.env.generateAndInsertImages({messageId:0}).catch(error=>{failed=error;});
 try{
  for(let i=0;i<40;i++)await Promise.resolve();
  assert.equal(f.finished,1);
  assert.match(failed?.message||'',/fixture invalid/);
 }finally{release?.();await operation;}
});
test('switching messages during display refresh cannot retry the newly opened chat',async()=>{
 const f=fixture({failed:true});let renders=0;
 const refresh=f.env.syncRenderedMessageFromState;
 f.env.syncRenderedMessageFromState=async()=>{await refresh();if(++renders===2){
  f.env.resolveFloorImageJobTarget=()=>({ctx:{chatId:'new-chat'},message:{mes:'different reply'},messageId:0});
 }};
 await assert.rejects(f.env.generateAndInsertImages({messageId:0}),/回复分支.*变化/);
 assert.equal(f.requests,0);assert.equal(f.finished,1);
});
