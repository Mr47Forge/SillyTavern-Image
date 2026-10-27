import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { buildDirectDrawTasks, buildDirectDrawInstruction, readDirectDrawDirectives } from '../direct-draw.js';
import { parseDrawImageDirectives } from '../image-marker-syntax.js';
import { mountImageCardAtVisibleAnchor } from '../visible-image-anchor.js';
import { buildRecentAppearanceLedger, pinImageCharacterAppearances } from '../character-appearance-ledger.js';
import { getDirectDrawReplyState } from '../direct-draw.js';
import {createSceneSource} from '../scene-source.js';
import {isUnclaimedImageSlot} from '../image-slot-validity.js';
import {prepareImageInput} from '../prepared-image-input.js';
import {createRequire} from 'node:module';
import {parseChatImageTags} from '../chat-message-image-markup.js';

const host=globalThis.__drawingChain={ctx:null,prompts:[],uploads:0,errors:[]};
globalThis.indexedDB=indexedDB;
globalThis.BroadcastChannel=undefined;
const stubs={
 'extensions.js':'export const getContext=()=>globalThis.__drawingChain.ctx;',
 'user.js':'export const getCurrentUserHandle=()=>"drawing-chain";',
 'script.js':`const h=globalThis.__drawingChain;export const getRequestHeaders=()=>({});
 export const syncMesToSwipe=()=>{};export const messageFormatting=t=>t;
 export const setExtensionPrompt=(...args)=>h.prompts.push(args);
 export const extension_prompt_types={IN_PROMPT:0,IN_CHAT:1};export const extension_prompt_roles={USER:1};`,
 'utils.js':`export const uuidv4=()=>crypto.randomUUID();
 export const saveBase64AsFile=async()=>'/user/images/fixture/image-'+(++globalThis.__drawingChain.uploads)+'.png';`,
 'debug-core.js':'export const xbLog={warn(){},error(){},info(){}};',
 'event-manager.js':'export const createModuleEvents=()=>({on(){},cleanup(){}});export const event_types={};',
 'image-diagnostics.js':'export const writeImageError=async e=>globalThis.__drawingChain.errors.push(e);export const openImageDiagnostics=()=>{};',
 'draw-run-recovery-runtime.js':'export const runDrawRunRecoveryPass=async()=>{};',
};
const result=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),contents:
 "export * from './draw-common.js'; export * from './gallery-cache.js'; export * from './prepared-chat-images.js'; export * from './slot-activity.js'; export * from './image-card-actions.js'; export * from './image-card-target.js'; export * from './prepared-slot-executor.js'; export * from './pending-image-jobs.js'; export * from './image-job-recovery-runtime.js'; export * from './image-job-reattach.js'; export * from './backend-image-jobs.js'; export * from './chat-image-placement.js';"},
 bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'host-only',setup(b){
 b.onResolve({filter:/\.js$/},({path})=>Object.hasOwn(stubs,path.split('/').at(-1))?{path:path.split('/').at(-1),namespace:'host'}:null);
 b.onLoad({filter:/.*/,namespace:'host'},({path})=>({contents:stubs[path]}));
 b.onLoad({filter:/[\\/]draw-common\.js$/},({path})=>({contents:fs.readFileSync(path,'utf8')+'\nexport {mountImageSlotShells};',loader:'js'}));
 }}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=drawing-chain-local.mjs').toString('base64'));
const sentences=['画家在窗边摆好画架。','画家把蓝色画笔放好。','画家拿出新的画纸。','画家在画布上画出山峰。'];
const narrative=sentences.join('\n\n');
const directives=()=>sentences.map((after,i)=>({prompt:`adult woman artist in studio, unique scene ${i}`,after,
 characters:[{name:'画家',type:'woman',appear:'black hair, brown eyes, oval face'}]}));
let seq=0;
function setup(source=narrative){
 const {document,window}=parseHTML('<html><head></head><body><div id="chat"><div class="mes" mesid="0"><div class="mes_text"></div></div></div></body></html>');
 globalThis.document=document;globalThis.window=window;globalThis.MutationObserver=window.MutationObserver;
 window.HTMLImageElement.prototype.decode=async()=>{};
 const message={name:'画家',mes:source,swipe_id:0,swipes:[source],extra:{}};
 let persisted;
 const ctx=host.ctx={chatId:'drawing-chain-'+(++seq),chat:[message],characterId:0,characters:[{name:'画家',avatar:'artist.png'}],getRequestHeaders:()=>({}),
 saveChat:async()=>{persisted=JSON.stringify([{chat_metadata:{}},...ctx.chat]);}};
 globalThis.fetch=async()=>new Response(persisted);
 const root=document.querySelector('.mes_text');
 return {ctx,message,root,window,document,get persisted(){return persisted;}};
}
function project(h,{dropSlots=false}={}){
 h.root.innerHTML='<div class="story">'+h.message.mes.replace(/\[image\s*:\s*[^\]]+\]/gi,dropSlots?'':'$&')+'</div>';
 api.mountImageSlotShells(h.root,0,h.message);
}
async function submit(h,tasks,{run}={}){
 let calls=0;
 const prepared=prepareImageInput('comfyui',tasks,{host:'http://comfy.fixture.invalid',workflowMode:'simple',
 params:{model:'fixture',width:768,height:1152,cfg:1,steps:8},timeout:1000,delayMs:0,
 seeds:tasks.map((_,i)=>i+1),knownCharacters:[]});
 await api.submitPreparedChatImages({ctx:h.ctx,message:h.message,messageId:0,sourceText:h.message.mes,tasks,
 metadata:prepared.metadata,backend:false,
 autoSaveToServer:true,run:async cb=>{calls++;for(let i=0;i<tasks.length;i++){
 await cb.onItemStarting({index:i});
 const base64=run?await run(prepared.compiledBatch,i):'YWJj';
 await cb.onItemReady({index:i,base64});}},onStateChange(){}});
 assert.equal(calls,1);
 return [...h.message.mes.matchAll(/\[image:(slot-[^\]]+)\]/g)].map(m=>m[1]);
}

test('unchanged recurring identity rejects model-invented hair changes',()=>{
 const ds=directives().slice(0,2);ds[0].characters[0].appear='long black hair, brown eyes, oval face';ds[1].characters[0].appear='short blonde hair, blue eyes, round face';
 const tasks=buildDirectDrawTasks(ds,{maxImages:2},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 assert.match(tasks[1].characterPrompts[0].prompt,/black hair/);assert.doesNotMatch(tasks[1].characterPrompts[0].prompt,/blonde hair/);
});
test('verified current worldbook quote overrides history, never its conflicting invented translation',()=>{
 const fact='画家有银色长发和棕色眼睛。';const ds=directives().slice(0,1);
 ds[0].characters[0].appear='invented blonde hair, blue eyes';ds[0].characters[0].appear_evidence=fact;
 const tasks=buildDirectDrawTasks(ds,{maxImages:1},{sourceText:narrative,appearanceSources:{worldbook:fact},recentAppearances:new Map([['画家','old long black hair, brown eyes']])});
 assert.ok(tasks[0].chars[0].appear.includes(fact));assert.doesNotMatch(tasks[0].characterPrompts[0].prompt,/blonde/);
});
test('invented evidence cannot authorize an appearance change',()=>{
 const ds=directives().slice(0,1);ds[0].characters[0].appear='random blonde hair';ds[0].characters[0].appear_evidence='画家现在有金色短发。';
 const out=buildDirectDrawTasks(ds,{maxImages:1},{sourceText:narrative,recentAppearances:new Map([['画家','confirmed black hair, brown eyes']])});
 assert.match(out[0].characterPrompts[0].prompt,/confirmed black hair/);
});
test('partial after is canonicalized once and reload stays at the accepted sentence boundary',async()=>{
 const whole='成年画家推开画室木门，然后把画架搬到窗边。';const partial='成年画家推开画室木门';
 const h=setup(whole+'\n\n'+sentences[3]);const ds=directives().slice(0,1);ds[0].after=partial;h.message.extra.sti_comfy_direct={directives:ds};
 const tasks=buildDirectDrawTasks(ds,{maxImages:1},{sourceText:h.message.mes,requireFemaleImage:true,skipInvalidImages:true});
 const slots=await submit(h,tasks);project(h,{dropSlots:true});await api.renderPreviewsForMessage(0,{refreshSlotIds:slots});
 const card=h.root.querySelector('.sti-nd-img');assert.ok(card.previousSibling.textContent.includes(whole));
 assert.ok(!card.nextSibling.textContent.startsWith('，然后'));
});
test('missing job and cache do not masquerade as permanent live generation',async()=>{
 const h=setup(narrative+'\n[image:slot-stuck]');
 h.message.extra.sti_comfy_slots={'slot-stuck':{imageIndex:0,after:sentences[0],prompt:'adult artist',status:'pending'}};
 project(h);await api.renderPreviewsForMessage(0,{refreshSlotIds:['slot-stuck']});
 const card=h.root.querySelector('.sti-nd-img');assert.equal(card.dataset.state,'failed');assert.ok(card.textContent.includes('未确认')||card.textContent.includes('未找到'));
});
test('failed portable attempt really retries with the saved characters and negative input',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives().slice(0,1)};
 const ds=directives().slice(0,1);ds[0].negative='extra blur';const tasks=buildDirectDrawTasks(ds,{maxImages:1},{sourceText:narrative});
 await assert.rejects(submit(h,tasks,{run:async()=>{throw Object.assign(new Error('节点不存在'),{imageRequestOutcome:'rejected'});}}));
 const slot=Object.keys(h.message.extra.sti_comfy_slots)[0];await api.deletePreview(h.message.extra.sti_comfy_slots[slot].imgId);
 h.ctx.chat[0]=h.message=JSON.parse(h.persisted)[1];project(h,{dropSlots:true});await api.renderPreviewsForMessage(0,{refreshSlotIds:[slot]});
 let captured;const release=api.registerPreparedImageProvider('comfyui',async input=>{captured=input;});
 try{await api.redrawImageCard('comfyui',h.root.querySelector('.sti-nd-img'));}finally{release();}
 assert.equal(captured.tasks[0].placement.slotId,slot);assert.match(captured.tasks[0].characterPrompts[0].prompt,/black hair/);
 assert.match(captured.tasks[0].negativePrompt,/extra blur/);
});
test('unowned source marker does not block a valid drawing directive',()=>{
 const d=directives()[0];const message={mes:narrative+'\n[image:slot-fake]\n<image>\nprompt: '+d.prompt+'\ncharacters: '+JSON.stringify(d.characters)+'\nafter: '+d.after+'\n</image>',extra:{}};
 assert.equal(getDirectDrawReplyState(message).state,'ready');
});
test('missing directive count is explicitly reported separately from filtered image errors',()=>{
 const notices=[];const tasks=buildDirectDrawTasks(directives().slice(0,2),{maxImages:4},{sourceText:narrative,skipInvalidImages:true,onCountMismatch:x=>notices.push(x)});
 assert.equal(tasks.length,2);assert.deepEqual(notices,[{expected:4,received:2}]);
});
test('one malformed character block is isolated and later image keeps its original index',()=>{
 const ds=directives();const block=d=>'<image>\nprompt: '+d.prompt+'\ncharacters: '+JSON.stringify(d.characters)+'\nafter: '+d.after+'\n</image>';
 const message={mes:block(ds[0])+'\n<image>\nprompt: adult woman at window\ncharacters: [{bad}]\n</image>\n'+block(ds[2])};
 const out=buildDirectDrawTasks(readDirectDrawDirectives(message),{maxImages:3},{sourceText:narrative,skipInvalidImages:true});
 assert.deepEqual(out.map(t=>t.imageIndex),[0,2]);
});
test('real slot removal deletes its owned state in the same saved edit',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives().slice(0,1)};
 const tasks=buildDirectDrawTasks(directives().slice(0,1),{maxImages:1},{sourceText:narrative});const slots=await submit(h,tasks);
 project(h);await api.renderPreviewsForMessage(0,{refreshSlotIds:slots});await api.removeChatImageSlot(h.root.querySelector('.sti-nd-img'));
 assert.equal(h.message.extra.sti_comfy_slots?.[slots[0]],undefined);assert.equal(JSON.parse(h.persisted)[1].extra.sti_comfy_slots?.[slots[0]],undefined);
});
test('newer server success supersedes an older failed device selection',async()=>{
 const h=setup(narrative+'\n[image:slot-stale]');
 await api.storePreview({slotId:'slot-stale',imgId:'img-old-failure',status:'failed',tags:'old scene',errorMessage:'旧失败',messageId:0,chatId:h.ctx.chatId});await api.setSlotSelection('slot-stale','img-old-failure');
 h.message.extra.stimageDrawSaved={'slot-stale':{imgId:'img-new-success',savedUrl:'/user/images/fixture/new.png',tags:'new scene',updatedAt:Date.now()+1000}};
 project(h);await api.renderPreviewsForMessage(0,{refreshSlotIds:['slot-stale']});const card=h.root.querySelector('.sti-nd-img');assert.notEqual(card.dataset.state,'failed');assert.equal(card.dataset.imgId,'img-new-success');
});
test('automatic path has one ownership guard and no obsolete result-status writer',()=>{
 const code=fs.readFileSync(new URL('../../providers/comfyui/comfy-draw.js',import.meta.url),'utf8');
 const auto=code.slice(code.indexOf('async function autoGenerateForLastAI()'),code.indexOf('async function getDirectDrawInstruction('));
 assert.doesNotMatch(auto,/includes\(result\?\.status\)/);assert.doesNotMatch(auto,/sti_comfy_auto_done = true/);
 assert.ok(auto.includes('getOwnedImageSlotIds'));
});
test('new persistence keeps one full input and no duplicated character identity envelopes',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives().slice(0,1)};const tasks=buildDirectDrawTasks(directives().slice(0,1),{maxImages:1},{sourceText:narrative});
 const slots=await submit(h,tasks),slot=slots[0];const owned=h.message.extra.sti_comfy_slots[slot];assert.ok(owned.input?.characterPrompts.length);
 assert.equal(owned.characters,undefined);assert.equal((await api.getPreview(owned.imgId)).directiveIdentity,undefined);
 assert.equal(h.message.extra.stimageDrawSaved[slot].directiveIdentity,undefined);
});
test('backend identity is saved before transport; cache loss restores the same existing job, never a second batch',async()=>{
 const h=setup(),ds=directives().slice(0,2);h.message.extra.sti_comfy_direct={directives:ds};
 const tasks=buildDirectDrawTasks(ds,{maxImages:2},{sourceText:narrative});
 const metadata=prepareImageInput('comfyui',tasks,{host:'http://fixture.invalid',workflowMode:'simple',
 params:{model:'fixture',width:768,height:1152,cfg:1,steps:8},seeds:[1,2],timeout:1000,delayMs:0}).metadata;
 const jobId='portable-owned-job';let posted=0;
 await assert.rejects(api.submitPreparedChatImages({ctx:h.ctx,message:h.message,messageId:0,sourceText:narrative,
  tasks,metadata,backend:true,autoSaveToServer:true,run:async cb=>{
   await cb.recoverable.commitPlacements({jobId});
   const beforePost=JSON.parse(h.persisted)[1];assert.ok(Object.values(beforePost.extra.sti_comfy_slots).every(p=>p.jobId===jobId));
   posted++;throw Object.assign(new Error('device detached'),{detached:true});
  }}));
 const ids=Object.keys(h.message.extra.sti_comfy_slots);for(const id of ids)await api.deletePreview(h.message.extra.sti_comfy_slots[id].imgId);
 h.ctx.chat[0]=h.message=JSON.parse(h.persisted)[1];
 const backend=[{id:jobId,state:'running',items:[{index:0,state:'running'},{index:1,state:'queued'}]}];
 await api.restorePortableImageJobs(h.ctx,[],backend);
 const record=await api.getPendingImageJob(jobId);assert.equal(record.jobId,jobId);assert.equal(record.items.length,2);
 assert.deepEqual(record.items.map(p=>p.slotId),ids);assert.equal(record.leaseExpiresAt,0);
 const plan=api.planImageJobReattach({records:[record],backendJobs:backend});assert.equal(plan.plan[0].action,'attach');
 const missing=api.planImageJobReattach({records:[record],backendJobs:[]});assert.equal(missing.plan[0].action,'fail');
 await api.restorePortableImageJobs(h.ctx,[],backend);assert.equal((await api.getPendingImageJob(jobId)).leaseId,record.leaseId);
 const calls=[];const client=api.createImageBackendJobsClient({getOwner:()=> 'drawing-chain',fetchImpl:async(url,options={})=>{
  calls.push([url,options.method]);return Response.json({ok:true,jobs:[]});
 }});
 api.startImageJobRecovery({client});try{await api.reconcilePendingImageJobs();}finally{api.stopImageJobRecovery();}
 assert.equal(await api.getPendingImageJob(jobId),null);assert.ok(ids.every(id=>h.message.extra.sti_comfy_slots[id].status==='failed'));
 assert.equal(posted,1);assert.ok(!calls.some(([url,method])=>method==='POST'&&url.endsWith('/v1/jobs')));
});
test('a saved completed sibling is not generated again when reconstructing a partial job',async()=>{
 const h=setup(narrative+'\n[image:slot-done]\n[image:slot-wait]');
 const input={tags:'adult artist at window',characterPrompts:[],negativePrompt:'blur'};
 h.message.extra.sti_comfy_slots={'slot-done':{jobId:'partial-portable',jobIndex:0,status:'success',imgId:'img-done',input},
  'slot-wait':{jobId:'partial-portable',jobIndex:2,status:'pending',imgId:'img-wait',input}};
 h.message.extra.stimageDrawSaved={'slot-done':{imgId:'img-done',savedUrl:'/user/images/fixture/done.png'}};
 await api.restorePortableImageJobs(h.ctx,[],[{id:'partial-portable',items:[{index:0,state:'consumed'},{index:1,state:'ready'},{index:2,state:'running'}]}]);
 const record=await api.getPendingImageJob('partial-portable');assert.equal(record.items.find(p=>p.index===0).deliveryCommitted,true);
 assert.equal(record.items.find(p=>p.index===1).discarded,true);assert.equal(record.items.find(p=>p.index===1).deliveryCommitted,true);
 assert.equal(record.items.find(p=>p.index===2).slotId,'slot-wait');
 await api.forgetPendingImageJob(record.jobId,record.leaseId);
});
test('removal rollback restores the same slot input and identity',()=>{
 const h=setup(narrative+'\n[image:slot-rollback]');const record={imageIndex:3,after:sentences[3],status:'failed',input:{tags:'artist',negativePrompt:'blur'}};
 h.message.extra.sti_comfy_slots={'slot-rollback':record};const before=h.message.mes;
 const change=api.commitChatImageRemoval({message:h.message,swipeIndex:0,slotId:'slot-rollback'});
 assert.equal(h.message.extra.sti_comfy_slots['slot-rollback'],undefined);
 api.rollbackChatImageRemoval(change);assert.equal(h.message.mes,before);assert.equal(h.message.extra.sti_comfy_slots['slot-rollback'],record);
});
test('native already-committed slots link and persist their backend id before transport',async()=>{
 const source='画家在窗边作画。 [img: adult woman artist painting]';const h=setup(source),tag=parseChatImageTags(source)[0];
 const tasks=[{scene:tag.tags,chars:[{name:'画家',type:'woman',appear:'black hair, brown eyes'}],
 placement:{mode:'replace',start:tag.start,end:tag.end,marker:tag.marker}}];
 await api.submitPreparedChatImages({ctx:h.ctx,message:h.message,messageId:0,sourceText:source,tasks,
 metadata:[{tags:tag.tags,positive:tag.tags,characterPrompts:[{name:'画家',prompt:'black hair'}],negativePrompt:'blur'}],
 nativeMessage:true,backend:true,autoSaveToServer:true,run:async cb=>{
   await cb.recoverable.commitPlacements({jobId:'native-owned-job'});
   const entries=Object.values(JSON.parse(h.persisted)[1].extra.sti_comfy_slots);assert.equal(entries[0].jobId,'native-owned-job');
   await cb.onItemReady({index:0,base64:'YWJj'});
 }});
 assert.equal(Object.values(h.message.extra.sti_comfy_slots)[0].status,'success');
});
