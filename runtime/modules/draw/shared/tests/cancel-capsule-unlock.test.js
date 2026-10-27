import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {runDrawCancellationAction,resolveDrawRunUiState} from '../draw-run-ui-state.js';

const path=new URL('../../providers/comfyui/floating-panel.js',import.meta.url);
const source=readFileSync(path,'utf8');
const names=['SUBMITTING','ACCEPTED','UNCERTAIN','QUEUED','LLM','GEN','COOLDOWN',
    'RECONNECTING','CANCELLING','SUCCESS','PARTIAL','ERROR'];
const FloatState=Object.fromEntries(names.map(k=>[k,k.toLowerCase()]));
const target={chatId:'test',messageId:0,swipeIndex:0,provider:'comfyui',runId:'draw-1'};
const states={...target};

test('global cancel capsule in cancelling state is actionable, not a no-op',()=>{
    const start=source.indexOf('function routeFloatingClick(target) {');
    const end=source.indexOf('\n}\n',start)+2;
    assert.ok(start>=0&&end>start);
    let attempts=0;
    const scope={FloatState,floatingState:FloatState.CANCELLING,
        handleFloatingAbort:()=>{attempts++;},
        floatingEl:{classList:{remove(){},toggle(){},contains(){return false}}},
        updateFloatingDetailPopup:()=>{},refreshFloatingPresetSelect:()=>{},
        refreshFloatingSizeSelect:()=>{},handleFloatingDrawClick:()=>{}};
    vm.createContext(scope);
    vm.runInContext(source.slice(start,end)+';routeFloatingClick({closest: sel => sel === ".nd-layer-active" ? {} : null});',scope);
    assert.equal(attempts,1);
});

test('actual floating pointerdown/up invokes cancel even in cancelling state',()=>{
    const a=source.indexOf('function onFloatingPointerDown(e) {');
    const b=source.indexOf('async function handleFloatingDrawClick()',a);
    assert.ok(a>=0&&b>a);
    let attempts=0;
    const capsule={setPointerCapture(){},releasePointerCapture(){}};
    const active={closest:sel=>sel==='.nd-layer-active'?{}:null};
    const scope={FloatState,floatingState:FloatState.CANCELLING,
        active,capsule,floatingDragState:null,
        floatingEl:{getBoundingClientRect:()=>({left:10,top:10}),
            offsetWidth:101,offsetHeight:34,style:{},
            classList:{remove(){},toggle(){},contains(){return false}}},
        window:{innerWidth:800,innerHeight:600},
        handleFloatingAbort:()=>{attempts++;},saveFloatingPosition:()=>{},
        handleFloatingDrawClick:()=>{},refreshFloatingPresetSelect:()=>{},
        refreshFloatingSizeSelect:()=>{},updateFloatingDetailPopup:()=>{}};
    vm.createContext(scope);
    const simulate=';onFloatingPointerDown({button:0,clientX:30,clientY:30,pointerId:9,'
        +'target:active,currentTarget:capsule,preventDefault(){}});'
        +'onFloatingPointerUp({pointerId:9,currentTarget:capsule});';
    vm.runInContext(source.slice(a,b)+simulate,scope);
    assert.equal(attempts,1);
});
test('floor cancel capsule includes cancelling state in its click branch',()=>{
    const start=source.indexOf("el.querySelector('.nd-layer-active')?.addEventListener('click'");
    assert.ok(start>=0);
    const excerpt=source.slice(start,start+650);
    assert.match(excerpt,/FloatState\.CANCELLING\]\.includes\(panelData\.state\)/);
});
test('cached cancelling state is replaced by an authoritative backend active state',()=>{
    assert.equal(resolveDrawRunUiState({currentState:'cancelling',pending:true,
        detail:{...target,phase:'active'},...states}),'accepted');
});
test('true pending cancellation still shows cancelling',()=>{
    assert.equal(resolveDrawRunUiState({currentState:'accepted',pending:true,
        detail:{...target,phase:'cancelling'},...states}),'cancelling');
});
test('finished cancellation with no pending backend is idle',()=>{
    assert.equal(resolveDrawRunUiState({currentState:'cancelling',pending:false,
        detail:{},...states}),'idle');
});
test('no matching backend work never strands cancel UI',async()=>{
    let state='cancelling';
    const result=await runDrawCancellationAction({cancel:async()=>false,
        isCurrent:()=>true,getState:()=>state,setState:x=>{state=x}});
    assert.equal(result,false);
    assert.equal(state,'uncertain');
});
test('failed repeated cancellation stays retryable',async()=>{
    let state='cancelling';
    await assert.rejects(()=>runDrawCancellationAction({cancel:async()=>{throw Error('offline')},
        isCurrent:()=>true,getState:()=>state,setState:x=>{state=x}}),/offline/);
    assert.equal(state,'uncertain');
});
test('successful cancellation still reports cancelling until backend confirms settlement',async()=>{
    let state='accepted';
    const result=await runDrawCancellationAction({cancel:async()=>true,
        isCurrent:()=>true,getState:()=>state,setState:x=>{state=x}});
    assert.equal(result,true);
    assert.equal(state,'cancelling');
});
