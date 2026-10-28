import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectDrawTasks, readDirectDrawDirectives, rememberDirectDrawDirectives, buildDirectDrawInstruction } from '../direct-draw.js';
import { buildWardrobeLedger, formatWardrobeLedger } from '../wardrobe-continuity.js';
import { compile as compileComfy, compileComfyPromptForTask } from '../../providers/comfyui/compiler.js';

const alice={name:'Alice',enabled:true,aliases:['\u5c0f\u827e'],type:'woman',appearance:'brown eyes'};
const bob={name:'Bob',enabled:true,type:'man'};
const known=[alice,bob,{name:'Beth',type:'woman',enabled:true}];
const fingerprint='navy blazer, white shirt, black pleated skirt, opaque black tights';
function historical(narrative,characters,after=narrative) {
    const m={is_user:false,mes:narrative+'\n<image>\nprompt: 1girl, bright room\ncharacters: '+JSON.stringify(characters)+'\nafter: '+after+'\n</image>'};
    rememberDirectDrawDirectives(m,readDirectDrawDirectives(m));
    m.mes=narrative+'\n[image:oldslot]\n';
    return m;
}
function built(source,images,extra={}) {
    return buildDirectDrawTasks(images,{maxImages:0,maxCharactersPerImage:0},{
        sourceText:source,knownCharacters:known,...extra,
    });
}
function image(after,people,prompt='bright room, 1girl') {
    return {after,prompt,characters:people};
}
test('saved image directives recover the exact last clothing fingerprint',()=>{
    const msg=historical('Alice stands in a studio.',[{name:'Alice',costume:fingerprint}]);
    const state=buildWardrobeLedger([msg],{knownCharacters:known,readDirectives:readDirectDrawDirectives});
    assert.deepEqual(state,[{name:'Alice',costume:fingerprint}]);
    assert.match(formatWardrobeLedger(state),/opaque black tights/);
});
test('missing new costume inherits earlier clothing and reaches ComfyUI compilation',()=>{
    const sentence='Alice stands beside a window.';
    const state=[{name:'Alice',costume:fingerprint}];
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:''}])],{wardrobeLedger:state});
    assert.equal(tasks[0].chars[0].costume,fingerprint);
    assert.match(tasks[0].characterPrompts[0].prompt,/navy blazer/);
    const out=compileComfyPromptForTask(tasks[0],{knownCharacters:known,positivePrefix:'photo',negativePrefix:''});
    assert.match(out.positive,/opaque black tights/);
});
test('hallucinated wardrobe swap is rejected when story has no clothing event',()=>{
    const sentence='Alice looks out the window.';
    const tasks=built(sentence,[image(sentence,[{name:'\u5c0f\u827e',costume:'red dress'}])],{wardrobeLedger:[{name:'Alice',costume:fingerprint}]});
    assert.equal(tasks[0].chars[0].name,'Alice');
    assert.equal(tasks[0].chars[0].costume,fingerprint);
});
test('explicit clothing change updates only the named role',()=>{
    const sentence='Alice changed clothes and put on a red coat. Beth waits beside her.';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'red coat'},{name:'Beth',costume:'different hat'}],'2people, indoors')],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint},{name:'Beth',costume:'gray coat, brown hat'}],
    });
    assert.equal(tasks[0].chars[0].costume,'red coat');
    assert.equal(tasks[0].chars[1].costume,'gray coat, brown hat');
});
test('time leap invalidates inherited outfit instead of resetting to a default',()=>{
    const sentence='The next day Alice arrives in a green jacket.';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'green jacket'}])],{wardrobeLedger:[{name:'Alice',costume:fingerprint}]});
    assert.equal(tasks[0].chars[0].costume,'green jacket');
    const chat=[historical('Alice starts painting.',[{name:'Alice',costume:fingerprint}]),
      {is_user:true,mes:'The next day Alice goes back to the studio.'}];
    assert.equal(buildWardrobeLedger(chat,{knownCharacters:known,readDirectives:readDirectDrawDirectives}).length,0);
});
test('single reply with two images freezes clothing chosen at its first image',()=>{
    const a='Alice enters the studio.';
    const b='Alice stands by the easel.';
    const tasks=built(a+'\n\n'+b,[
        image(a,[{name:'Alice',costume:fingerprint}],'Alice entering the studio, front wide shot'),
        image(b,[{name:'Alice',costume:'random blue gown'}],'Alice working at an easel, over shoulder view'),
    ]);
    assert.equal(tasks[1].chars[0].costume,fingerprint);
    assert.match(tasks[1].characterPrompts[0].prompt,/black pleated skirt/);
});
test('same reply allows clothing change after a clear story event',()=>{
    const a='Alice enters the studio.';
    const b='Alice changed clothes and put on a red coat.';
    const tasks=built(a+'\n\n'+b,[
        image(a,[{name:'Alice',costume:fingerprint}]),
        image(b,[{name:'Alice',costume:'red coat'}]),
    ]);
    assert.equal(tasks[0].chars[0].costume,fingerprint);
    assert.equal(tasks[1].chars[0].costume,'red coat');
});
test('camera change or new pose does not modify the wardrobe',()=>{
    const sentence='Alice turns around for a better camera angle.';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'new white top',action:'looking aside'}])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint}],
    });
    assert.equal(tasks[0].chars[0].costume,fingerprint);
    assert.equal(tasks[0].chars[0].action,'looking aside');
});
test('no humans means no extra person or clothing, and inputs are not mutated',()=>{
    const sentence='Empty living room with a chair.';
    const raw=[image(sentence,[],'no humans, empty room')];
    const before=JSON.stringify(raw);
    const tasks=built(sentence,raw,{wardrobeLedger:[{name:'Alice',costume:fingerprint}]});
    assert.equal(tasks[0].chars.length,0);
    assert.equal(JSON.stringify(raw),before);
});
test('previous outfit from a different chat branch cannot leak into this one',()=>{
    const withBlue=historical('Alice in a blue coat.',[{name:'Alice',costume:'blue coat'}]);
    const withPink=historical('Alice in a pink coat.',[{name:'Alice',costume:'pink coat'}]);
    const args={knownCharacters:known,readDirectives:readDirectDrawDirectives};
    assert.equal(buildWardrobeLedger([withBlue],args)[0].costume,'blue coat');
    assert.equal(buildWardrobeLedger([withPink],args)[0].costume,'pink coat');
});
test('native instructions contain wardrobe continuity and model-facing fingerprint rules',()=>{
    const text=buildDirectDrawInstruction({preset:{maxImages:2},wardrobeContext:formatWardrobeLedger([{name:'Alice',costume:fingerprint}])});
    assert.match(text,/characters\[\]\.costume/);
    assert.match(text,/opaque black tights/);
    assert.match(text,/school uniform/);
});

test('Chinese dressing verbs with color between verb and garment count as a real change',()=>{
    const sentence='Alice\u6362\u4e0a\u4e00\u4ef6\u7ea2\u8272\u8fde\u8863\u88d9\u3002';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'red dress'}])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint}],
    });
    assert.equal(tasks[0].chars[0].costume,'red dress');
});
test('a hypothetical clothing mention does not create a new role or state',()=>{
    const sentence='Alice sees a dress in the store, but does not change clothes.';
    const tasks=built(sentence,[image(sentence,[])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint}],
    });
    assert.deepEqual(tasks[0].chars,[]);
});

test('ongoing injury and carried object persist independently from clothing changes',()=>{
    const sentence='Alice changed clothes and put on a red coat.';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'red coat',state:''}])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint,state:'bandaged arm, holding umbrella'}],
    });
    assert.equal(tasks[0].chars[0].costume,'red coat');
    assert.equal(tasks[0].chars[0].state,'bandaged arm, holding umbrella');
    assert.match(tasks[0].characterPrompts[0].prompt,/bandaged arm, holding umbrella/);
});
test('putting down an object changes ongoing state without changing clothing',()=>{
    const sentence='Alice put down the umbrella beside the window.';
    const tasks=built(sentence,[image(sentence,[{name:'Alice',costume:'different coat',state:''}])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint,state:'holding umbrella'}],
    });
    assert.equal(tasks[0].chars[0].costume,fingerprint);
    assert.equal(tasks[0].chars[0].state,'');
});
test('new temporary visual state persists across following image within same reply',()=>{
    const a='Alice is wounded and bandaged.';
    const b='Alice sits down by the window.';
    const tasks=built(a+'\n\n'+b,[
        image(a,[{name:'Alice',costume:fingerprint,state:'bandaged arm'}],'Alice receiving a bandage, close view'),
        image(b,[{name:'Alice',costume:fingerprint,state:''}],'Alice sitting beside the window, side shot'),
    ]);
    assert.equal(tasks[1].chars[0].state,'bandaged arm');
    assert.match(tasks[1].characterPrompts[0].prompt,/bandaged arm/);
});
test('saved ongoing state travels with the active outfit ledger, not global memory',()=>{
    const previous=historical('Alice rests in the studio.',[{name:'Alice',costume:fingerprint,state:'scar on left hand'}]);
    const ledger=buildWardrobeLedger([previous],{knownCharacters:known,readDirectives:readDirectDrawDirectives});
    assert.equal(ledger[0].state,'scar on left hand');
    assert.match(formatWardrobeLedger(ledger),/scar on left hand/);
});
test('current ComfyUI compiler retains frozen temporary-state tags',()=>{
    const narrative='Alice stands by a window.';
    const tasks=built(narrative,[image(narrative,[{name:'Alice',costume:'other top',state:''}])],{
        wardrobeLedger:[{name:'Alice',costume:fingerprint,state:'bandaged arm'}],
    });
    const recipe={knownCharacters:known,host:'http://127.0.0.1:8188',auth:'',seeds:[1234],
        workflowMode:'simple',params:{model:'fixture',width:512,height:768,steps:8,cfg:4},
        positivePrefix:'photo',negativePrefix:'blur',timeout:1000,delayMs:0};
    const frontend=compileComfy(tasks,recipe);
    assert.match(frontend.artifacts[0].promptData.positive,/bandaged arm/);
});
