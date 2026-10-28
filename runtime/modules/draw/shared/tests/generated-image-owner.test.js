import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';

const host=globalThis.__codexImageOwnerTest={owner:'account-a',calls:{'account-a':0,'account-b':0},block:null};
globalThis.indexedDB=new IDBFactory();
globalThis.window={stimageDraw:{getProvider:()=> 'comfyui',prepareGeneration:input=>({
    fingerprint:{version:1,provider:'comfyui',promptData:{positive:input.prompt},config:{model:'fixture'}},
    execute:async()=>{
        const owner=host.owner;
        host.calls[owner]++;
        if (host.block && owner==='account-a') await host.block;
        return owner==='account-a'?'fixture-result-A':'fixture-result-B';
    },
})}};
const bundle=await build({
    stdin:{contents:"export * from './generated-image-runtime.js';",
        resolveDir:fileURLToPath(new URL('..',import.meta.url))},
    bundle:true,write:false,platform:'node',format:'esm',
    plugins:[{name:'mock-sillytavern-user',setup(b){
        b.onResolve({filter:/^\/scripts\/user\.js$/},()=>({path:'user',namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:
            'export const getCurrentUserHandle=()=>globalThis.__codexImageOwnerTest.owner;'}));
    }}],
});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('account B never receives account A cached result for identical prompt and generation fingerprint',async()=>{
    host.owner='account-a';
    const first=await api.generateSharedImage({prompt:'an adult woman in a quiet garden'});
    host.owner='account-b';
    const second=await api.generateSharedImage({prompt:'an adult woman in a quiet garden'});
    assert.equal(first,'fixture-result-A');
    assert.equal(second,'fixture-result-B');
    assert.deepEqual(host.calls,{'account-a':1,'account-b':1});
    assert.equal(await api.checkGeneratedImageCache({prompt:'an adult woman in a quiet garden'}),'fixture-result-B');
    host.owner='account-a';
    assert.equal(await api.checkGeneratedImageCache({prompt:'an adult woman in a quiet garden'}),'fixture-result-A');
    const databases=await indexedDB.databases();
    assert.ok(databases.some(x=>x.name==='sti_draw_generated_images::account-a'));
    assert.ok(databases.some(x=>x.name==='sti_draw_generated_images::account-b'));
});

test('account switch while old generation is in flight rejects old delivery, not old/new dedup',async()=>{
    let release;
    host.block=new Promise(resolve=>release=resolve);
    host.owner='account-a';
    const old=api.generateSharedImage({prompt:'unique scene during an account switch'});
    // Let the old request pass the cache probe and enter the generation stage.
    for(let i=0;i<15 && host.calls['account-a']<2;i++)await setImmediate();
    assert.ok(host.calls['account-a']>=2,'old account request entered generation');
    host.owner='account-b';
    const current=await api.generateSharedImage({prompt:'unique scene during an account switch'});
    assert.equal(current,'fixture-result-B');
    release();
    await assert.rejects(old,/账号已切换|账户已切换|账号|已切换/);
    host.block=null;
    assert.equal(await api.checkGeneratedImageCache({prompt:'unique scene during an account switch'}),'fixture-result-B');
});
