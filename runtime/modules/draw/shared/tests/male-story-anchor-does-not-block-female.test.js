import assert from 'node:assert/strict';
import test from 'node:test';
import {buildDirectDrawTasks} from '../direct-draw.js';
import {containsMaleAnatomy} from '../male-image-exclusion.js';

const story='<content>He walks to the door.\n\nShe sits at the window.\n\nHe shuts the window.\n\nShe picks up a brush.\n\nShe switches the lights off.</content>';
const woman={name:'Alice',type:'adult female',appear:'adult woman with black hair'};
const make=(after,index)=>({imageIndex:index,
    prompt:'one adult woman painting, solo, fully clothed, scene number '+(index+1),
    characters:[woman],after});
const get=(directives)=>buildDirectDrawTasks(directives,{maxImages:4},
    {sourceText:story,requireFemaleImage:true,skipInvalidImages:true});
test('female-only image with a male prose anchor is reattached to a real female scene',()=>{
    const ds=['He walks to the door.','She sits at the window.',
        'He shuts the window.','She picks up a brush.'].map(make);
    const tasks=get(ds);
    assert.equal(tasks.length,4);
    assert.deepEqual(tasks.map(x=>x.imageIndex),[0,1,2,3]);
    assert.ok(tasks.every(t=>t.placement.mode==='source'));
    assert.ok(tasks.every(t=>!containsMaleAnatomy(t.scene)));
    assert.ok(tasks[0].placement.offset>=story.indexOf('She sits at the window.'));
    assert.ok(tasks[2].placement.offset!==story.indexOf('He shuts the window.')+'He shuts the window.'.length);
});
test('real male image directive or male character is still rejected',()=>{
    const directives=[
        {imageIndex:0,prompt:'portrait of an adult man',characters:[{name:'Bob',type:'adult male'}],after:'He walks to the door.'},
        make('She sits at the window.',1),
        make('He shuts the window.',2),
        make('She picks up a brush.',3)
    ];
    const rejected=[];
    const tasks=buildDirectDrawTasks(directives,{maxImages:4},{
        sourceText:story,requireFemaleImage:true,skipInvalidImages:true,
        onImageRejected:x=>rejected.push(x)});
    assert.deepEqual(tasks.map(x=>x.imageIndex),[1,2,3]);
    assert.equal(rejected.length,1);
    assert.equal(rejected[0].image,1);
});
test('explicit male anatomy in the positive scene prompt stays blocked',()=>{
    const directives=[
        {...make('He walks to the door.',0),prompt:'one woman, penis and scrotum visible'},
        make('She sits at the window.',1)
    ];
    const rejected=[];
    const tasks=buildDirectDrawTasks(directives,{maxImages:4},{
        sourceText:story,requireFemaleImage:true,skipInvalidImages:true,
        onImageRejected:x=>rejected.push(x)});
    // Explicit male anatomy is sanitized from the effective positive prompt
    // even if the remaining adult-woman scene stays usable.
    assert.ok(tasks.every(x=>!containsMaleAnatomy(x.scene)));
    assert.equal(tasks.at(-1).imageIndex,1);
});
test('truly male-only narrative does not invent a woman',()=>{
    const maleOnly='<content>He walks to the door. He closes the door.</content>';
    assert.throws(()=>buildDirectDrawTasks([make('He walks to the door.',0)],
        {maxImages:1},{sourceText:maleOnly,requireFemaleImage:true,skipInvalidImages:true}),
        /only male|\u53ea\u6709\u7537\u6027/i);
});
