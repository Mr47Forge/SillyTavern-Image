import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectDrawInstruction,buildDirectDrawTasks} from '../direct-draw.js';
import {buildMaleImageOnlyRule,storyMentionsFemale} from '../male-image-exclusion.js';
import {compile} from '../../providers/comfyui/compiler.js';

const known=[
    {name:'Alice',type:'1girl',appearance:'adult woman with black hair',enabled:true},
    {name:'Bob',type:'male',appearance:'adult man',enabled:true},
];
const preset={maxImages:2,positivePrefix:'photo',negativePrefix:'male, man, men, beard'};
const story='Bob steps into the hall.\nAlice opens the wooden door.\nBob answers his phone.\nAlice walks toward the window.';
const female=(prompt,after)=>({prompt,after,characters:[{name:'Alice',type:'1girl'}]});
const male=(prompt,after)=>({prompt,after,characters:[{name:'Bob',type:'male'}]});
function build(images,sourceText=story,options={}){
    return buildDirectDrawTasks(images,preset,{
        sourceText,knownCharacters:known,requireFemaleImage:true,...options
    });
}
test('single-call Gemini instruction chooses existing female story moments, not scenery fallback',()=>{
    const rule=buildMaleImageOnlyRule();
    assert.match(rule,/\u6700\u8fd1/);
    assert.match(rule,/\u5973\u6027\u51fa\u955c\u7684\u4e0d\u540c\u5267\u60c5\u8282\u70b9/);
    assert.match(rule,/\u4e0d\u5f97\u7528\u98ce\u666f/);
    assert.doesNotMatch(rule,/\u53ef\u7ed8\u5236\u539f\u5267\u60c5\u573a\u666f/);
    const model=buildDirectDrawInstruction({preset,characters:known});
    assert.ok(model.includes(rule));
    assert.match(model,/EXACTLY 2/);
});
test('model-selected two separate real female moments compile to two independent outputs',()=>{
    const scenes=[
        female('Alice opens the wooden door, wide cinematic shot','Alice opens the wooden door.'),
        female('Alice walks toward the window, medium shot','Alice walks toward the window.')
    ];
    const tasks=build(scenes);
    assert.equal(tasks.length,2);
    assert.equal(new Set(tasks.map(t=>t.scene)).size,2);
    assert.equal(tasks[0].chars[0].name,'Alice');
    assert.equal(tasks[1].chars[0].name,'Alice');
    const compiled=compile(tasks,{knownCharacters:known,positivePrefix:preset.positivePrefix,
        negativePrefix:preset.negativePrefix,workflowMode:'simple',
        params:{model:'fixture',width:512,height:768,steps:8,cfg:4},
        timeout:1000,delayMs:0,seeds:[100,101]});
    assert.equal(compiled.artifacts.length,2);
    assert.equal(new Set(compiled.artifacts.map(p=>p.promptData.positive)).size,2);
    assert.ok(compiled.artifacts.every(p=>p.promptData.negative.includes('male')));
});
test('male-only node cannot be silently converted to empty scenery even if women exist elsewhere',()=>{
    assert.throws(()=>build([
        male('Bob enters the hall, close-up of man','Bob steps into the hall.'),
        female('Alice walks toward the window','Alice walks toward the window.')
    ]),/\u6ca1\u6709\u53ef\u7528\u4eba\u7269/);
});
test('model cannot turn no-person image into landscape when image is required to show a woman',()=>{
    assert.throws(()=>build([
        {prompt:'empty hall, furniture only',characters:[],after:'Bob steps into the hall.'},
        female('Alice near a window','Alice walks toward the window.')
    ]),/\u6ca1\u6709\u53ef\u7528\u4eba\u7269/);
});
test('no female anywhere in the original story is an error even if image claims a female',()=>{
    const onlyMen='Bob reads a letter.\nBob looks at the door.';
    const directives=[
        female('Alice reading a letter','Bob reads a letter.'),
        female('Alice near the door','Bob looks at the door.')
    ];
    assert.equal(storyMentionsFemale(onlyMen,known),false);
    assert.throws(()=>build(directives,onlyMen),/\u53ea\u6709\u7537\u6027/);
});
test('female role in Chinese narrative can be grounded without adding another AI request',()=>{
    assert.equal(storyMentionsFemale('\u5979\u5728\u7a97\u8fb9\u5750\u4e0b\u3002',known),true);
    assert.equal(storyMentionsFemale('Alice opens the door.',known),true);
    assert.equal(storyMentionsFemale('Bob goes outside.',known),false);
});
test('same-response male dialogue is left untouched and image after references female source',()=>{
    const raw=story;
    const scenes=[
        female('Alice standing at the door, 1girl','Alice opens the wooden door.'),
        female('Alice looking from the window, 1girl','Alice walks toward the window.')
    ];
    build(scenes,raw);
    assert.equal(raw,story);
    assert.equal(scenes[0].after,'Alice opens the wooden door.');
});

test('male-only after anchor is reattached to an actual female story beat, not faked',()=>{
    const tasks=build([
        female('Alice opens the wooden door, wide angle','Alice opens the wooden door.'),
        female('Alice holding a cellphone, front angle','Bob answers his phone.')
    ]);
    assert.equal(tasks.length,2);
    assert.equal(tasks[1].placement.mode,'source');
    const bobEnd=story.indexOf('Bob answers his phone.')+'Bob answers his phone.'.length;
    assert.notEqual(tasks[1].placement.offset,bobEnd);
    assert.ok(tasks[1].placement.offset>=tasks[0].placement.offset);
});
test('the grounded female anchor is not rejected just because the story also has men',()=>{
    const image=build([
        female('Alice standing by the door, full shot','Alice opens the wooden door.'),
        female('Alice near the window, soft daylight','Alice walks toward the window.')
    ]);
    assert.equal(image.length,2);
});

test('blacklist-only mode accepts unknown role titles when image has people',()=>{
    const unusual=[
        {name:'A',type:'custom-mysterious-social-status',appear:'adult subject with dark hair'},
        {name:'B',type:'\u4e0d\u5728\u4efb\u4f55\u8bcd\u5e93\u7684\u5947\u5e7b\u8eab\u4efd',appear:'person by doorway'},
    ];
    const batch=unusual.map((person,i)=>({prompt:'1girl, unique lens '+i,after:'',characters:[person]}));
    const res=buildDirectDrawTasks(batch,{maxImages:2},{requireFemaleImage:true,skipInvalidImages:true});
    assert.equal(res.length,2);
    assert.equal(res[0].chars[0].name,'A');
    assert.equal(res[1].chars[0].name,'B');
});
test('one rejected image never blocks other three or duplicates them',()=>{
    const feedback=[];
    const scenes=[
        {prompt:'Alice sitting by doorway, 1girl',characters:[{name:'Alice',type:'female'}],after:'Alice opens the wooden door.'},
        {prompt:'Bob alone in the hall, 1boy',characters:[{name:'Bob',type:'male'}],after:'Bob steps into the hall.'},
        {prompt:'Alice by window looking away, 1girl',characters:[{name:'Alice',type:'female'}],after:'Alice walks toward the window.'},
        {prompt:'Alice in room, full body, 1girl',characters:[{name:'Alice',type:'unknown-custom-title'}],after:''}
    ];
    const untouched=JSON.stringify(scenes);
    const tasks=buildDirectDrawTasks(scenes,{maxImages:4},{
        knownCharacters:known,sourceText:story,requireFemaleImage:true,
        skipInvalidImages:true,onImageRejected:data=>feedback.push(data)
    });
    assert.equal(tasks.length,3);
    assert.deepEqual(feedback.map(x=>x.image),[2]);
    assert.equal(new Set(tasks.map(x=>x.scene)).size,3);
    assert.equal(JSON.stringify(scenes),untouched);
    assert.ok(tasks.every(task=>task.chars.length>0));
});
test('image without characters is skipped while another image still succeeds',()=>{
    const issues=[];
    const tasks=buildDirectDrawTasks([
        {prompt:'empty landscape',characters:[]},
        {prompt:'Alice by the window, 1girl',characters:[{name:'Alice',type:'female'}]}
    ],{maxImages:2},{skipInvalidImages:true,requireFemaleImage:true,
        onImageRejected:x=>issues.push(x)});
    assert.equal(tasks.length,1);
    assert.equal(tasks[0].chars.length,1);
    assert.deepEqual(issues.map(x=>x.image),[1]);
});
test('duplicate effective positive prompt is skipped per image without cloning',()=>{
    const issues=[];
    const directives=[
        {prompt:'A near the door',characters:[{name:'Alice',type:'female'}]},
        {prompt:'A near the door',characters:[{name:'Alice',type:'female'}]},
        {prompt:'A near the window',characters:[{name:'Alice',type:'female'}]},
    ];
    const tasks=buildDirectDrawTasks(directives,{maxImages:3},{
        requireFemaleImage:true,skipInvalidImages:true,onImageRejected:x=>issues.push(x)
    });
    assert.equal(tasks.length,2);
    assert.deepEqual(issues.map(x=>x.image),[2]);
    assert.equal(new Set(tasks.map(x=>x.scene)).size,2);
});
test('all-invalid images report one batch failure without an empty ComfyUI request',()=>{
    const issues=[];
    assert.throws(()=>buildDirectDrawTasks([
        {prompt:'portrait of Bob',characters:[{name:'Bob',type:'1boy'}]},
        {prompt:'empty scene',characters:[]}
    ],{maxImages:2},{requireFemaleImage:true,skipInvalidImages:true,onImageRejected:x=>issues.push(x)}),
    /\u6240\u6709\u7ed8\u56fe|\u6ca1\u6709\u53ef\u63d0\u4ea4/);
    assert.deepEqual(issues.map(x=>x.image),[1,2]);
});

test('unmatched anchor cannot put the fourth saved image into Status_block',()=>{
    const storyText=[
        '<hidden>Long preamble about the world.</hidden>',
        '<maintext><hidden>',
        'Alice stands near the door.',
        'Alice crosses the living room.',
        'Alice sits on the sofa.',
        'Alice looks toward the window.',
        '</hidden></maintext>',
        '<Status_block>',
        'Energy: 95',
        'Relationship: close.',
        'Inventory: keys.',
        'Internal scene state: active.',
        '</Status_block>'
    ].join('\n');
    const pieces=[
        female('Alice near door, wide angle','Alice stands near the door.'),
        female('Alice crossing room, profile','Alice crosses the living room.'),
        female('Alice sits on sofa, medium view','Alice sits on the sofa.'),
        female('Alice looks out window, rear view','This intentionally does not match any original paragraph.'),
    ];
    const fallback=[];
    const tasks=buildDirectDrawTasks(pieces,{maxImages:4},{
        sourceText:storyText,knownCharacters:known,requireFemaleImage:true,
        skipInvalidImages:true,onPlacementFallback:e=>fallback.push(e),
    });
    const boundary=storyText.indexOf('</maintext>');
    assert.equal(tasks.length,4);
    // The nested hidden wrapper contains the real narrative. It must not
    // suppress valid story anchors or scatter the fourth into state metadata.
    assert.deepEqual(fallback.map(v=>v.image),[4]);
    assert.ok(tasks.every(t=>t.placement.mode==='source'));
    assert.ok(tasks.every(t=>t.placement.offset < boundary));
    assert.equal(tasks[3].placement.offset,tasks[2].placement.offset);
});
test('unmatched anchor stays with preceding picture, never within status block',()=>{
    const raw='Alice enters the room.\nAlice smiles.\n<Status_block>\nEnergy:100.\nNPC: Bob.\n</Status_block>';
    const problems=[];
    const tasks=buildDirectDrawTasks([
        female('Alice entering room','Alice enters the room.'),
        female('Alice smiling in room','invalid anchor goes to fallback'),
    ],{maxImages:2},{sourceText:raw,knownCharacters:known,requireFemaleImage:true,
        skipInvalidImages:true,onImageRejected:e=>problems.push(e)});
    assert.equal(tasks.length,2);
    assert.equal(problems.length,0);
    assert.equal(tasks[1].placement.mode,'source');
    assert.equal(tasks[1].placement.offset,tasks[0].placement.offset);
    assert.ok(tasks[1].placement.offset<raw.indexOf('<Status_block>'));
});
test('existing status markup and hidden tags are untouched by source placement',()=>{
    const raw='<maintext><hidden>Alice opens the door.\nAlice looks outside.</hidden></maintext>\n<Status_block>Stats.</Status_block>';
    const original=raw;
    const directives=[
        female('Alice by the door, clear framing','Alice opens the door.'),
        female('Alice looking outside, side view','Alice looks outside.'),
    ];
    buildDirectDrawTasks(directives,{maxImages:2},{sourceText:raw,knownCharacters:known,requireFemaleImage:true});
    assert.equal(raw,original);
    assert.equal(raw.match(/<Status_block>/g).length,1);
});
