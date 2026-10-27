import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';
const host=globalThis.__imageStorageFixture={owner:'fixture',ctx:{chatId:'fixture',chat:[]}};
const stubs={
 'extensions.js':'export const getContext=()=>globalThis.__imageStorageFixture.ctx;',
 'user.js':'export const getCurrentUserHandle=()=>globalThis.__imageStorageFixture.owner;',
 'utils.js':'export const saveBase64AsFile=(...args)=>globalThis.__imageStorageFixture.upload(...args);export const debounce=fn=>fn;',
 'script.js':'export const getRequestHeaders=()=>({});',
};
const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),contents:
 "export * from './gallery-cache.js';export * from './image-diagnostics.js';export * from '../../../core/server-storage.js';"},
 bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'host',setup(b){
 b.onResolve({filter:/\.js$/},({path})=>stubs[path.split('/').at(-1)]?{path:path.split('/').at(-1),namespace:'host'}:null);
 b.onLoad({filter:/.*/,namespace:'host'},({path})=>({contents:stubs[path]}));}}]});
let seq=0;
async function setup(){
 host.owner='fixture';host.ctx={chatId:'fixture',chat:[]};
 host.upload=async()=>'/user/images/fixture.png';
 globalThis.indexedDB=new IDBFactory();globalThis.BroadcastChannel=undefined;
 globalThis.document={getElementById:()=>null};
 globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,items:[],item:{time:Date.now()}})});
 return newApi();
}
function newApi(){return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=image-storage-fixture.mjs\n// fixture '+seq++).toString('base64'));}
const flush=async()=>{for(let i=0;i<30;i++)await setImmediate();};
function open(name,version,upgrade){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrade?.(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function hold(database,store){const tx=database.transaction(store,'readwrite');let active=true;
 const loop=()=>{tx.objectStore(store).get('absent').onsuccess=()=>{if(active)loop();};};loop();
 return ()=>{active=false;try{tx.abort();}catch{}};
}
test('active configuration reads have a bounded deadline',async t=>{
 const api=await setup();t.mock.timers.enable({apis:['setTimeout']});
 globalThis.fetch=()=>new Promise(()=>{});
 const outcomes=[api.NovelDrawStorage,api.ComfyDrawStorage].map(storage=>storage.getStrict('settings').then(()=>null,error=>error));
 await flush();t.mock.timers.tick(5001);await flush();
 for(const result of await Promise.all(outcomes))assert.ok(result instanceof Error);
});
test('a blocked gallery upgrade rejects on time and can reopen without a late connection',async t=>{
 const api=await setup();const blocker=await open('sti_novel_draw_previews::fixture',2,db=>db.createObjectStore('previews',{keyPath:'imgId'}));
 blocker.onversionchange=()=>{};t.mock.timers.enable({apis:['setTimeout']});
 let error;const pending=api.openDB().catch(e=>{error=e;});
 await flush();t.mock.timers.tick(15001);await flush();
 try{assert.ok(error,'blocked opening must reject');}finally{blocker.close();await pending;}
 assert.ok(await api.openDB());
});
test('a stalled gallery write aborts and cannot commit after the caller has timed out',async t=>{
 const api=await setup();const db=await api.openDB();const release=hold(db,'previews');
 t.mock.timers.enable({apis:['setTimeout']});let error;
 const pending=api.storePreview({imgId:'late-image',slotId:'late-slot',base64:'YWJj'}).catch(e=>{error=e;});
 await flush();t.mock.timers.tick(15001);await flush();
 try{assert.ok(error,'queued gallery work must reject');}finally{release();await pending;}
 assert.equal(await api.getPreview('late-image'),undefined);
});
test('server-confirmed diagnostics finish even when the local database is locked',async t=>{
 const api=await setup();await api.writeImageError({errorMessage:'seed'});
 const names=await indexedDB.databases();const db=await open(names.find(e=>e.name.startsWith('sti_comfy_draw_error_logs')).name,1);
 const release=hold(db,'errors');t.mock.timers.enable({apis:['setTimeout']});let settled=false;
 const pending=api.writeImageError({errorMessage:'late diagnostic'}).then(()=>{settled=true;},()=>{settled=true;});
 await flush();t.mock.timers.tick(15001);await flush();
 try{assert.equal(settled,true);}finally{release();await pending;db.close();}
 assert.ok(!(await api.readImageErrors()).some(e=>e.message==='late diagnostic'));
});
test('gallery memory, selections and diagnostics remain separated after an account switch',async()=>{
 const api=await setup();host.owner='alice';
 await api.storePreview({imgId:'private-a',slotId:'slot-a',base64:'YWJj',characterName:'fixture'});
 await api.setSlotSelection('slot-a','private-a');await api.getPreviewsBySlot('slot-a');
 await api.writeImageError({errorMessage:'private-a-error'});
 host.owner='bob';
 assert.equal(await api.getPreview('private-a'),undefined);assert.deepEqual(await api.getPreviewsBySlot('slot-a'),[]);
 assert.equal(await api.getSlotSelection('slot-a'),null);assert.deepEqual(await api.getGallerySummary(),{});
 assert.ok(!(await api.readImageErrors()).some(e=>e.message==='private-a-error'));
 host.owner='alice';assert.equal((await api.getPreview('private-a')).base64,'YWJj');
 assert.ok((await api.readImageErrors()).some(e=>e.message==='private-a-error'));
});
test('legacy cache migration claims only slot IDs proven by this accounts current chat and keeps originals',async()=>{
 const api=await setup();const legacy=await open('sti_novel_draw_previews',3,db=>{
  const s=db.createObjectStore('previews',{keyPath:'imgId'});s.createIndex('slotId','slotId');db.createObjectStore('selections',{keyPath:'slotId'});
 });
 await new Promise((resolve,reject)=>{const tx=legacy.transaction('previews','readwrite');
  for(const [imgId,slotId] of [['legacy-own','own-slot'],['legacy-foreign','foreign-slot']])tx.objectStore('previews').put({imgId,slotId,base64:'YWJj',status:'success'});
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 host.ctx.chat=[{mes:'画家走进画室。 [image:own-slot]'}];
 assert.equal((await api.getPreview('legacy-own')).base64,'YWJj');assert.equal(await api.getPreview('legacy-foreign'),undefined);
 const originals=await new Promise((resolve,reject)=>{const r=legacy.transaction('previews').objectStore('previews').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 assert.equal(originals.length,2);legacy.close();
 await api.clearAllCache();assert.equal(await api.getPreview('legacy-own'),undefined);
 const reloaded=await newApi();assert.equal(await reloaded.getPreview('legacy-own'),undefined,'cleared legacy images must not return after refresh');
});
test('a delayed manual pull cannot write the previous accounts image into the new account',async t=>{
 const api=await setup();host.owner='alice';let respond;
 await api.storePreview({imgId:'download-a',slotId:'download-slot',savedUrl:'/user/images/a.png',positive:'private-a'});
 globalThis.fetch=()=>new Promise(resolve=>{respond=resolve;});
 const oldReader=globalThis.FileReader;
 globalThis.FileReader=class{readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:image/png;base64,'+Buffer.from(bytes).toString('base64');this.onload();});}};
 t.after(()=>{if(oldReader)globalThis.FileReader=oldReader;else delete globalThis.FileReader;});
 let outcome;const pending=api.pullServerImageManually({imgId:'download-a',slotId:'download-slot',savedUrl:'/user/images/a.png',positive:'private-a'}).catch(error=>{outcome=error;});
 await flush();host.owner='bob';host.ctx={chatId:'bob',chat:[]};respond(new Response('fixture',{headers:{'Content-Type':'image/png'}}));
 await pending;assert.ok(outcome);assert.equal(await api.getPreview('download-a'),undefined);
});
test('a delayed image upload cannot patch the newly opened accounts gallery',async()=>{
 const api=await setup();host.owner='alice';await api.storePreview({imgId:'upload-a',slotId:'upload-slot',base64:'YWJj'});
 let respond;host.upload=()=>new Promise(resolve=>{respond=resolve;});
 let outcome;const pending=api.savePreviewImage('upload-a').catch(error=>{outcome=error;});
 await flush();host.owner='bob';respond('/user/images/alice.png');await pending;
 assert.ok(outcome);assert.equal(await api.getPreview('upload-a'),undefined);
 host.owner='alice';assert.equal((await api.getPreview('upload-a')).savedUrl,null);
});
