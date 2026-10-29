import assert from 'node:assert/strict';
import test from 'node:test';
import {buildRecentAppearanceLedger,pinImageCharacterAppearances} from '../character-appearance-ledger.js';
import {buildDirectDrawTasks} from '../direct-draw.js';
const recent=(name,appear)=>({extra:{sti_comfy_direct:{directives:[{characters:[{name,appear}]}]}}});
const readDirectives=m=>m?.extra?.sti_comfy_direct?.directives??[];
test('same-name latest appearance is selected before an older description',()=>{
    const chat=[recent('Alice','older long hair with black eyes'),recent('Alice','recent short hair and green jacket')];
    const ledger=buildRecentAppearanceLedger(chat,{readDirectives});
    assert.equal(ledger.get('alice'),'recent short hair and green jacket');
});
test('different characters and unrelated chats cannot override a named identity',()=>{
    const chat=[recent('Alice','dark hair with brown eyes'),recent('Bob','brown coat and short hair')];
    const people=pinImageCharacterAppearances([{name:'Alice',appear:'random red hair'},{name:'Cara',appear:'unique blonde hair'}],
        buildRecentAppearanceLedger(chat,{readDirectives}),[]);
    assert.equal(people[0].appear,'dark hair with brown eyes');
    assert.equal(people[1].appear,'unique blonde hair');
});
test('user-registered role always has precedence over generated history',()=>{
    const roles=[{name:'Alice',appearanceZh:'银色长发',aliases:['Artist']}];
    const person=pinImageCharacterAppearances([{name:'Alice',appear:''}],new Map([['alice','random red hair']]),roles);
    assert.equal(person[0].appear,'');
});
test('a later unverified appearance cannot replace the first confirmed identity',()=>{
    const items=[
        {prompt:'woman near door, daytime',characters:[{name:'A',type:'female',appear:'dark long hair, natural face'}]},
        {prompt:'woman looking at window, evening',characters:[{name:'A',type:'female',appear:'random blonde hair, blue eyes'}]},
    ];
    const before=JSON.stringify(items);
    const out=buildDirectDrawTasks(items,{maxImages:2},{requireFemaleImage:true,skipInvalidImages:true});
    assert.equal(out.length,2);
    assert.ok(out[0].characterPrompts[0].prompt.includes('dark long hair'));
    assert.ok(out[1].characterPrompts[0].prompt.includes('dark long hair'));
    assert.ok(!out[1].characterPrompts[0].prompt.includes('random blonde'));
    assert.equal(JSON.stringify(items),before);
});
test('unverified new model appearance cannot replace historical identity',()=>{
    const items=[{prompt:'photograph of A, soft natural light',
        characters:[{name:'A',type:'female',appear:'random styled red wig'}]}];
    const prior=new Map([['a','original black hair, brown eyes, oval face']]);
    const tasks=buildDirectDrawTasks(items,{maxImages:1},{
        requireFemaleImage:true,recentAppearances:prior,
    });
    assert.match(tasks[0].characterPrompts[0].prompt,/original black hair/);
    assert.doesNotMatch(tasks[0].characterPrompts[0].prompt,/random styled red wig/);
});
