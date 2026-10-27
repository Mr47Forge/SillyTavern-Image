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
};
const result=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),contents:
 "export * from './draw-common.js'; export * from './gallery-cache.js'; export * from './prepared-chat-images.js'; export * from './slot-activity.js';"},
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
test('DOM inserts at the sentence text boundary inside one story DIV, not after the entire DIV',()=>{
 const h=setup();h.root.innerHTML='<div class="story">'+sentences.join('<br>')+'</div>';
 const card=h.document.createElement('div');card.className='sti-nd-img';
 assert.equal(mountImageCardAtVisibleAnchor(h.root,card,sentences[0]),true);
 assert.equal(card.parentElement.className,'story');
 assert.ok(card.nextSibling.textContent.includes(sentences[1])||card.nextSibling.nextSibling?.textContent.includes(sentences[1]));
 assert.equal(h.root.querySelector('.story').textContent,narrative.replace(/\n/g,''));
});
test('4 images persist exact directive identity through actual save, empty device cache and DOM recovery',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives()};
 const tasks=buildDirectDrawTasks(directives(),{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 const slots=await submit(h,tasks);
 assert.equal(slots.length,4);
 for(let i=0;i<slots.length;i++){
  assert.equal(h.message.extra.sti_comfy_slots?.[slots[i]]?.imageIndex,i);
  const saved=api.getDrawSavedEntry(h.message,slots[i]);assert.ok(saved?.savedUrl);
  await api.deletePreview(saved.imgId);
 }
 h.ctx.chat[0]=h.message=JSON.parse(h.persisted)[1];
 project(h,{dropSlots:true});await api.renderPreviewsForMessage(0,{refreshSlotIds:slots});
 assert.equal(h.root.querySelectorAll('.sti-nd-img img').length,4);
 assert.deepEqual([...h.root.querySelectorAll('.sti-nd-img')].map(e=>e.dataset.slotId),slots);
 const html=h.root.innerHTML;
 for(let i=0;i<4;i++)assert.ok(html.indexOf(sentences[i])<html.indexOf(slots[i]));
 for(let i=0;i<3;i++)assert.ok(html.indexOf(slots[i])<html.indexOf(sentences[i+1]));
 const cards=[...h.root.querySelectorAll('.sti-nd-img')];api.mountImageSlotShells(h.root,0,h.message);
 assert.deepEqual([...h.root.querySelectorAll('.sti-nd-img')],cards);
});
test('filtering original image 2 does not reassign image 3 to directive 2 on reload',async()=>{
 const h=setup();const ds=directives();ds[1]={...ds[1],prompt:'1boy, adult man in studio',characters:[{name:'男画家',type:'man'}]};
 h.message.extra.sti_comfy_direct={directives:ds};
 const tasks=buildDirectDrawTasks(ds,{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 assert.deepEqual(tasks.map(t=>t.imageIndex),[0,2,3]);
 const slots=await submit(h,tasks);project(h,{dropSlots:true});await api.renderPreviewsForMessage(0,{refreshSlotIds:slots});
 const html=h.root.innerHTML;assert.ok(html.indexOf(slots[1])>html.indexOf(sentences[2]));
 assert.equal(h.message.extra.sti_comfy_slots[slots[1]].imageIndex,2);
});
test('unmatched second after retains original identity and follows first image',async()=>{
 const h=setup();const ds=directives();ds[1].after='另一段根本不存在的剧情原文。';h.message.extra.sti_comfy_direct={directives:ds};
 const tasks=buildDirectDrawTasks(ds,{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 const slots=await submit(h,tasks);project(h,{dropSlots:true});await api.renderPreviewsForMessage(0,{refreshSlotIds:slots});
 const html=h.root.innerHTML;assert.ok(html.indexOf(slots[0])<html.indexOf(slots[1]));
 assert.ok(html.indexOf(slots[1])<html.indexOf(sentences[1]));assert.equal(h.root.querySelectorAll('.sti-nd-img img').length,4);
});
test('legacy filtered chat recovers by unique saved scene prompt, never survivor array index',()=>{
 const h=setup();const ds=directives();h.message.extra.sti_comfy_direct={directives:ds};
 const slots=['slot-old-a','slot-old-c','slot-old-d'];h.message.mes+='\n'+slots.map(s=>'[image:'+s+']').join('\n');
 h.message.extra.stimageDrawSaved=Object.fromEntries(slots.map((s,i)=>[s,{imgId:'old-'+i,savedUrl:'/user/images/fixture/'+i+'.png',tags:ds[[0,2,3][i]].prompt}]));
 project(h,{dropSlots:true});const html=h.root.innerHTML;
 assert.ok(html.indexOf(slots[1])>html.indexOf(sentences[2]));assert.ok(html.indexOf(slots[1])<html.indexOf(sentences[3]));
});
test('current worldbook/story appearance wins over stale history; history only fills missing facts',()=>{
 const current='画家 has confirmed short silver hair and brown eyes.';
 const old=new Map([['画家','old wrong blonde hair and green eyes']]);
 assert.equal(pinImageCharacterAppearances([{name:'画家',appear:current,appear_evidence:current}],old,[],{worldbook:current})[0].appear,current);
 assert.equal(pinImageCharacterAppearances([{name:'画家',appear:''}],old,[])[0].appear,old.get('画家'));
 const before={extra:{sti_comfy_direct:{directives:[{characters:[{name:'画家',appear:current}]}]}}};
 const now={mes:'current'};const future={extra:{sti_comfy_direct:{directives:[{characters:[{name:'画家',appear:'future white hair and blue eyes'}]}]}}};
 const ledger=buildRecentAppearanceLedger([before,now,future],{excludeMessage:now,readDirectives:m=>m.extra?.sti_comfy_direct?.directives||[]});
 assert.equal(ledger.get('画家'),current);
});
test('real interceptor installs this-turn drawing instructions before parsed reply starts one prepared batch',async()=>{
 const h=setup();h.window.stimageComfyDraw={getDirectDrawInstruction:async()=>buildDirectDrawInstruction({preset:{maxImages:4}})};
 api.setupDrawGenerateInterceptor({shouldStrip:()=>true});
 await globalThis.stimageGenerateInterceptor([{mes:'测试画室剧情'}],8192,()=>{},'normal');
 const sent=host.prompts.filter(p=>p[1]).at(-1);assert.ok(sent[1].includes('<image>'));assert.equal(sent[2],1);
 const reply=narrative+'\n'+directives().map(d=>'<image>\nprompt: '+d.prompt+'\ncharacters: '+JSON.stringify(d.characters)+'\nafter: '+d.after+'\n</image>').join('\n');
 const parsed=parseDrawImageDirectives(reply);assert.equal(parsed.length,4);
 h.message.extra.sti_comfy_direct={directives:parsed};
 const tasks=buildDirectDrawTasks(parsed,{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 assert.equal((await submit(h,tasks)).length,4);api.cleanupDrawGenerateInterceptor();
});
test('missing image blocks produce a precise automatic-draw diagnostic without any model or GPU retry',async()=>{
 const file=new URL('../../providers/comfyui/comfy-draw.js',import.meta.url);
 const code=fs.readFileSync(file,'utf8');
 const fn=code.slice(code.indexOf('async function autoGenerateForLastAI()'),code.indexOf('async function getActiveDrawingWorldbook('));
 const errors=[];let submissions=0;
 const context={chatId:'no-image',chat:[{mes:'画家拿出画笔。',extra:{}}]};
 const env={window:{},moduleInitialized:true,moduleLifecycleGeneration:1,injectedDrawingFacts:null,autoPendingTargets:[],autoBusy:false,isGenerating:()=>false,
 getSettings:()=>({mode:'auto'}),getContext:()=>context,
 readDirectDrawDirectives,getDirectDrawReplyState,getOwnedImageSlotIds:api.getOwnedImageSlotIds,stripDrawImageDirectives:t=>t,stripDrawImageSlots:t=>t,
 autoDrawDiagnostics:new WeakMap(),writeImageError:async e=>errors.push(e),
 generateAndInsertImages:async()=>{submissions++;},console:{info(){},warn(){},error(){}},
 globalThis:{toastr:{warning(){},error(){}}}};
 await new Function(...Object.keys(env),fn+';return autoGenerateForLastAI();')(...Object.values(env));
 assert.equal(submissions,0);assert.equal(errors.length,1);assert.equal(errors[0].errorType,'DRAW_DIRECTIVES_MISSING');
 errors.length=0;
 env.getOwnedImageSlotIds=async()=>{context.chat=[{mes:'另一条回复。',extra:{}}];return new Set();};
 await new Function(...Object.keys(env),fn+';return autoGenerateForLastAI();')(...Object.values(env));
 assert.equal(submissions,0);assert.equal(errors.length,0,'changing reply during ownership lookup must stop the original automatic run');
});
test('already placed replies are terminal for whole-batch automatic generation',()=>{
 const reply={mes:narrative+'\n[image:slot-existing]',extra:{sti_comfy_direct:{directives:directives()},sti_comfy_slots:{'slot-existing':{imageIndex:0,after:sentences[0]}}}};
 assert.equal(getDirectDrawReplyState(reply).state,'placed');
 assert.equal(getDirectDrawReplyState({mes:narrative}).state,'missing');
});
test('parser keeps original block numbers even when an empty directive precedes valid images',()=>{
 const parsed=parseDrawImageDirectives('<image>\nnegative: blur\n</image>\n<IMAGE>\nprompt: adult woman artist painting\ncharacters: []\n</IMAGE>');
 const read=readDirectDrawDirectives({mes:'<image>\nnegative: blur\n</image>\n<IMAGE>\nprompt: adult woman artist painting\ncharacters: []\n</IMAGE>'});
 assert.equal(parsed.at(-1).imageIndex,1);assert.equal(read.at(-1).imageIndex,1);
 const tasks=buildDirectDrawTasks(read,{}, {skipInvalidImages:true});assert.equal(tasks[0].imageIndex,1);
});
test('persisted owned slot awaiting recovery is not an orphan or a successful image',async()=>{
 const h=setup(narrative+'\n[image:slot-awaiting]');
 h.message.extra.sti_comfy_slots={'slot-awaiting':{imageIndex:0,after:sentences[0],prompt:'artist waiting',status:'pending'}};
 assert.equal(isUnclaimedImageSlot({slotIdentity:h.message.extra.sti_comfy_slots['slot-awaiting']}),false);
 project(h);await api.renderPreviewsForMessage(0);
 const card=h.root.querySelector('[data-slot-id="slot-awaiting"]');assert.ok(card);
 assert.equal(card.querySelector('img'),null);assert.equal(card.dataset.state,'failed');
+ assert.ok(card.textContent.includes('未确认')||card.textContent.includes('未找到'));
});
test('portable failure remains a concrete failure when local image cache is empty',async()=>{
 const h=setup(narrative+'\n[image:slot-failed]');
 h.message.extra.sti_comfy_slots={'slot-failed':{imageIndex:0,after:sentences[0],prompt:'artist portrait',status:'failed',errorType:'连接失败',errorMessage:'本轮工作流节点不存在'}};
 project(h);await api.renderPreviewsForMessage(0);const card=h.root.querySelector('[data-slot-id="slot-failed"]');
 assert.ok(card?.textContent.includes('本轮工作流节点不存在'));assert.equal(card.dataset.state,'failed');
});
test('whole-body visible hidden wrapper does not authorize nested hidden status text as an anchor',()=>{
 const story='<content><hidden>'+sentences[0]+'<status_block>状态内容不得作为插图定位。</status_block>'+sentences[1]+'</hidden></content>';
 const src=createSceneSource(story,{restrictToNarrativeBody:true});
 assert.ok(src.content.includes(sentences[0]));assert.ok(!src.content.includes('状态内容不得'));
});
test('host regex output with a visible original slot keeps its exact DOM node and paragraph',()=>{
 const h=setup(narrative+'\n[image:slot-fixed]');
 h.message.extra.sti_comfy_slots={'slot-fixed':{imageIndex:0,after:sentences[3]}};
 h.root.innerHTML='<maintext><p>'+sentences[0]+'[image:slot-fixed]</p><p>'+sentences[3]+'</p></maintext>';
 api.mountImageSlotShells(h.root,0,h.message);const card=h.root.querySelector('.sti-nd-img'),parent=card.parentElement;
 api.mountImageSlotShells(h.root,0,h.message);assert.equal(card.parentElement,parent);
 assert.equal(h.root.querySelectorAll('.sti-nd-img').length,1);assert.ok(parent.textContent.includes(sentences[0]));
});
test('single-image redraw retains all original slots and does not change other image identities',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives()};
 const tasks=buildDirectDrawTasks(directives(),{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 const slots=await submit(h,tasks);const before=structuredClone(h.message.extra.sti_comfy_slots);
 const saved=structuredClone(h.message.extra.stimageDrawSaved);
 await submit(h,[{scene:'adult artist painting a new mountain',chars:tasks[0].chars,placement:{mode:'existing',slotId:slots[0]}}]);
 assert.deepEqual([...h.message.mes.matchAll(/\[image:(slot-[^\]]+)\]/g)].map(m=>m[1]),slots);
 for(let i=1;i<4;i++){
  assert.deepEqual(h.message.extra.sti_comfy_slots[slots[i]],before[slots[i]]);
  assert.deepEqual(h.message.extra.stimageDrawSaved[slots[i]],saved[slots[i]]);
 }
 assert.equal(h.message.extra.sti_comfy_slots[slots[0]].imageIndex,0);
});
test('actual Comfy compiler and backend adapter receive four distinct workflows and deliver to saved chat slots',async()=>{
 const require=createRequire(import.meta.url);
 const {createAsyncImageJobManager}=require('../../../../../server-plugin/runtime/image-jobs/job-manager.js');
 const adapter=require('../../../../../server-plugin/runtime/providers/comfyui/adapter.js');
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives()};
 const realFetch=globalThis.fetch;const workflows=[];let history=0;
 globalThis.fetch=async(url,opts)=>{
  if(!String(url).startsWith('http://comfy.fixture.invalid'))return realFetch(url,opts);
  const u=new URL(url);
  if(u.pathname==='/prompt'){
   const workflow=JSON.parse(opts.body).prompt;workflows.push(workflow);
   assert.equal(Object.values(workflow).find(n=>n.class_type==='KSampler').inputs.cfg,1);
   return Response.json({prompt_id:'fixture-'+workflows.length});
  }
  if(u.pathname.startsWith('/history/')){
   history++;const id=u.pathname.split('/').at(-1);
   const workflow=workflows[Number(id.split('-').at(-1))-1];
   const save=Object.entries(workflow).find(([,n])=>n.class_type==='SaveImage')[0];
   return Response.json({[id]:{status:{completed:true,status_str:'success'},outputs:{[save]:{images:[{filename:id+'.png',type:'output'}]}}}});
  }
  if(u.pathname==='/view')return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0h0AAAAASUVORK5CYII=','base64'));
  throw new Error('unexpected mock endpoint');
 };
 const manager=createAsyncImageJobManager({adapters:{comfyui:adapter}});
 try{
  const tasks=buildDirectDrawTasks(directives(),{maxImages:4},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
  const slots=await submit(h,tasks,{run:async(batch,index)=>{
   const job=manager.createJob({owner:'fixture',provider:'comfyui',requestId:'chain-'+index,context:batch.context,delay:{min:0,max:0},items:[{...batch.items[index],kind:'image'}]});
   for(let tries=0;tries<100;tries++){
    const result=manager.getResult('fixture',job.id,0);
    if(result?.state==='ready')return result.buffer.toString('base64');
    if(result?.state==='failed')throw new Error(result.error.message);
    await new Promise(r=>setTimeout(r,2));
   }
   throw new Error('mock job did not finish');
  }});
  assert.equal(workflows.length,4);assert.equal(history,4);assert.equal(slots.length,4);
  assert.equal(Object.keys(h.message.extra.stimageDrawSaved).length,4);
 }finally{manager.close();globalThis.fetch=realFetch;}
});
test('a rejected real prepared delivery saves its own error before cache loss and chat reload',async()=>{
 const h=setup();h.message.extra.sti_comfy_direct={directives:directives().slice(0,1)};
 const tasks=buildDirectDrawTasks(directives().slice(0,1),{maxImages:1},{sourceText:narrative,requireFemaleImage:true,skipInvalidImages:true});
 await assert.rejects(submit(h,tasks,{run:async()=>{throw Object.assign(new Error('工作流校验未通过'),{imageRequestOutcome:'rejected'});}}));
 const slot=Object.keys(h.message.extra.sti_comfy_slots)[0];
 assert.equal(h.message.extra.sti_comfy_slots[slot].status,'failed');
 const id=h.message.extra.sti_comfy_slots[slot].imgId;await api.deletePreview(id);
 h.ctx.chat[0]=h.message=JSON.parse(h.persisted)[1];project(h,{dropSlots:true});
 await api.renderPreviewsForMessage(0,{refreshSlotIds:[slot]});
 assert.ok(h.root.querySelector('.sti-nd-img').textContent.includes('工作流校验未通过'));
});
test('forced tool output carries image blocks inside the same story text argument, with no second model call',()=>{
 const instruction=buildDirectDrawInstruction({preset:{maxImages:1}});
 assert.ok(instruction.includes('承载最终剧情的文字字段'));
 assert.ok(instruction.includes('保留预设原有的工具名称、参数结构和正文标签'));
 const d=directives()[0];
 const response={content:'',tool_calls:[{function:{name:'fixture_story_output',arguments:JSON.stringify({
  story:narrative+'\n<image>\nprompt: '+d.prompt+'\ncharacters: '+JSON.stringify(d.characters)+'\nafter: '+d.after+'\n</image>'})}}]};
 // Host-owned tool renderer supplies its existing story argument; STI reads
 // that resulting chat text and does not modify the host tool or its schema.
 const message={mes:JSON.parse(response.tool_calls[0].function.arguments).story};
 const parsed=readDirectDrawDirectives(message);
 assert.equal(parsed.length,1);assert.equal(parsed[0].after,d.after);
 assert.equal(buildDirectDrawTasks(parsed,{maxImages:1},{sourceText:message.mes,requireFemaleImage:true}).length,1);
});
