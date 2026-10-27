import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildDirectDrawTasks} from '../direct-draw.js';
import {getImageSlotRecord} from '../image-directive-identity.js';

test('a verified current appearance remains authoritative for later images in the same batch',()=>{
 const quote='画家阿青现在有黑色长发和棕色眼睛。';
 const tasks=buildDirectDrawTasks([
  {prompt:'adult woman artist in sunny studio',characters:[{name:'阿青',type:'adult woman',appear:'black hair, brown eyes',appear_evidence:quote}],after:'阿青推开画室窗户。'},
  {prompt:'adult woman artist painting mountains at dusk',characters:[{name:'阿青',type:'adult woman',appear:'blue hair, silver eyes'}],after:'阿青在画布上画出山峰。'}
 ],{maxImages:2},{sourceText:'阿青推开画室窗户。\n阿青在画布上画出山峰。',recentAppearances:new Map([['阿青','red hair, green eyes, pale skin']]),appearanceSources:{worldbook:quote}});
 assert.equal(tasks[0].chars[0].appear,quote);assert.equal(tasks[1].chars[0].appear,quote);
});

test('floor retry uses the same portable complete input reader as individual retry after cache loss',async()=>{
 const source=fs.readFileSync(new URL('../image-card-actions.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function redrawFloorFailed('),source.indexOf('async function redraw(provider,'));
 const input={tags:'artist',negativePrompt:'keep-negative',postPrompt:'warm light',characterPrompts:[{name:'阿青',prompt:'black hair',uc:'blue hair'}]};
 const message={mes:'画家正在工作。 [image:slot-one]',swipe_id:0,extra:{sti_comfy_slots:{'slot-one':{imgId:'img-one',status:'failed',input}}}};
 const ctx={chatId:'fixture',chat:[message]},card={dataset:{mesid:'0',slotId:'slot-one',imgId:'img-one',tags:'artist'}};let captured,reads=0;
 const cards=[card,...['unknown','pending'].map(status=>{
  const slotId='slot-'+status;message.mes+=' [image:'+slotId+']';
  message.extra.sti_comfy_slots[slotId]={imgId:'img-'+status,status,input};
  return {dataset:{...card.dataset,slotId}};
 })];
 const env={getContext:()=>ctx,DRAW_SLOT_COPY:{},collectFailedImageCards:()=>cards,isSceneSlotAlive:()=>true,resumeOwnedJobs:async()=>{},getPendingImageJobSlots:async()=>new Set(),redraws:new Map(),getSlotActivity:()=>null,
 getCardPreview:async()=>null,getDrawSavedPreview:()=>null,captureImageCardTarget:card=>({message,slotId:card.dataset.slotId,assertCurrent(){}}),
 readImageCardTarget:async target=>{reads++;return getImageSlotRecord(target.message,target.slotId);},
 generatePreparedChatImages:async(_p,args)=>{captured=args.tasks;},renderPreviewsForMessage:async()=>{}};
 await new Function(...Object.keys(env),'return ('+fn.trim()+')("comfyui",arguments[arguments.length-1],0);')(...Object.values(env),card);
 assert.equal(reads,3);assert.equal(captured.length,1);assert.equal(captured[0].placement.slotId,'slot-one');
 assert.deepEqual(captured[0].characterPrompts,input.characterPrompts);assert.equal(captured[0].negativePrompt,input.negativePrompt);assert.equal(captured[0].post_prompt,input.postPrompt);
});
