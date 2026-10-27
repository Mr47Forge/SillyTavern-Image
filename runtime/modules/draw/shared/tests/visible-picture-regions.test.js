import assert from 'node:assert/strict';
import test from 'node:test';
import {findNonVisibleImageSlotIds} from '../scene-slot-dom.js';
import {createSceneSource} from '../scene-source.js';
import {buildDirectDrawTasks} from '../direct-draw.js';
import {insertScenePlacements} from '../scene-placement.js';
import {normalizeImagePerspective,buildMaleImageOnlyRule} from '../male-image-exclusion.js';

test('hidden and status source slots are not ordinary visible slots',()=>{
    const src='<maintext><hidden>Note [image:slot-a]</hidden> Visible plot [image:slot-b]</maintext><Status_block>[image:slot-c]</Status_block>';
    assert.deepEqual([...findNonVisibleImageSlotIds(src)].sort(),['slot-a','slot-c']);
});
test('unclosed nested hidden container cannot pass image placement',()=>{
    const src='<hidden>Header<maintext><hidden>Story [image:slot-d]</hidden></maintext><Status_block>State</Status_block>';
    assert.deepEqual([...findNonVisibleImageSlotIds(src)],['slot-d']);
    assert.ok(createSceneSource(src,{restrictToNarrativeBody:true}).points.length>0);
});
test('unhidden narrative remains available, hidden passages are excluded',()=>{
    const src='<maintext>Alice enters. <hidden>Private notes.</hidden> Alice smiles.</maintext><Status_block>Stats.</Status_block>';
    const scene=createSceneSource(src,{restrictToNarrativeBody:true});
    assert.ok(scene.content.includes('Alice enters.'));
    assert.ok(scene.content.includes('Alice smiles.'));
    assert.ok(!scene.content.includes('Private notes.'));
    assert.ok(!scene.content.includes('Stats.'));
    assert.ok(scene.points.every(p=>p.offset<=src.indexOf('</maintext>')));
});
test('hidden-only reply retains both distinct images as tail cards',()=>{
    const src='<maintext><hidden>Alice arrives. Alice smiles.</hidden></maintext><Status_block>State.</Status_block>';
    const roles=[{name:'Alice',type:'female'}];
    const items=[{prompt:'woman in doorway',characters:roles,after:'Alice arrives.'},
        {prompt:'woman smiling',characters:roles,after:'Alice smiles.'}];
    const tasks=buildDirectDrawTasks(items,{maxImages:2},{sourceText:src,requireFemaleImage:true,skipInvalidImages:true});
    assert.equal(tasks.length,2);
    assert.ok(tasks.every(t=>t.placement.mode==='source'));
});

test('image prompt camera framing avoids first-person viewpoints',()=>{
    const s=normalizeImagePerspective('POV, first person view, viewer arms, daylight portrait');
    assert.ok(!/pov|first person|viewer arms/i.test(s));
    assert.match(s,/third-person camera/);
    assert.match(s,/daylight portrait/);
    assert.match(buildMaleImageOnlyRule(),/third-person external camera/i);
});

test('four existing images stay in original 1-2-3-4 order despite missed anchors',()=>{
    const story='Alice opens the door.\nAlice smiles at the window.\nAlice sits beside the table.\nAlice stands up.';
    const characters=[{name:'Alice',type:'woman',appear:'adult woman with long dark hair'}];
    const directives=[
        {prompt:'portrait at doorway',characters,after:'Alice opens the door.'},
        {prompt:'portrait at window',characters,after:'No matching sentence exists for second view'},
        {prompt:'portrait beside table',characters,after:'Alice sits beside the table.'},
        {prompt:'portrait standing up',characters,after:'Fourth after is not in source'}
    ];
    const saved=JSON.stringify(directives);
    const tasks=buildDirectDrawTasks(directives,{maxImages:4},{
        sourceText:story,requireFemaleImage:true,skipInvalidImages:true
    });
    assert.equal(tasks.length,4);
    assert.deepEqual(tasks.map(x=>x.placement.mode),['source','source','source','source']);
    assert.equal(tasks[0].placement.offset,tasks[1].placement.offset);
    assert.equal(tasks[2].placement.offset,tasks[3].placement.offset);
    assert.ok(tasks[2].placement.offset>=tasks[1].placement.offset);
    const slots=tasks.map((task,index)=>({placement:task.placement,content:'[image:slot-'+(index+1)+']'}));
    const result=insertScenePlacements(story,slots);
    const positions=slots.map(x=>result.indexOf(x.content));
    assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
    assert.equal(JSON.stringify(directives),saved);
});
test('unmatched first anchor keeps later images after it in same generated order',()=>{
    const story='Alice waves. Alice walks away. Alice returns to the door.';
    const characters=[{name:'Alice',type:'woman'}];
    const result=buildDirectDrawTasks([
        {prompt:'view one',characters,after:'Not found in any story paragraph'},
        {prompt:'view two',characters,after:'Alice walks away.'},
        {prompt:'view three',characters,after:'Not found anywhere'}
    ],{maxImages:3},{sourceText:story,skipInvalidImages:true,requireFemaleImage:true});
    assert.equal(result.length,3);
    assert.ok(result.every(x=>x.placement.mode==='source'));
    assert.ok(result[0].placement.offset<result[1].placement.offset);
    assert.equal(result[2].placement.offset,result[1].placement.offset);
    const placed=insertScenePlacements(story,result.map((x,i)=>({placement:x.placement,content:'[image:slot-'+(i+1)+']'})));
    assert.ok(placed.indexOf('[image:slot-1]')<placed.indexOf('[image:slot-2]'));
    assert.ok(placed.indexOf('[image:slot-2]')<placed.indexOf('[image:slot-3]'));
});
