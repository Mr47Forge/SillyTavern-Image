import assert from 'node:assert/strict';
import test from 'node:test';
import {createSceneSource} from '../scene-source.js';
import {buildDirectDrawTasks} from '../direct-draw.js';
import {insertScenePlacements} from '../scene-placement.js';

const labels=['Alice stands by the door.','Alice looks toward the window.','Alice sits on a chair.','Alice walks to the table.'];
const directives=labels.map((after,i)=>({
    prompt:'portrait of adult Alice in scene '+(i+1),
    characters:[{name:'Alice',type:'adult woman'}],after
}));
const makeText=(wrapper)=>wrapper.replace('STORY',labels.join('\n\n'));
test('full-body hidden wrapper inside content is treated as narrative, not empty',()=>{
    const original=makeText('<hidden>metadata</hidden><content><hidden>STORY</hidden></content><Status_block>stats</Status_block>');
    const source=createSceneSource(original,{restrictToNarrativeBody:true});
    assert.equal(source.points.length>=4,true);
    assert.ok(source.content.includes(labels[0]));
    assert.ok(source.content.includes(labels[3]));
    assert.ok(!source.content.includes('metadata'));
    assert.ok(!source.content.includes('stats'));
    const tasks=buildDirectDrawTasks(directives,{maxImages:4},{sourceText:original,skipInvalidImages:true,requireFemaleImage:true});
    assert.equal(tasks.length,4);
    assert.ok(tasks.every(t=>t.placement.mode==='source'));
    assert.deepEqual(tasks.map(t=>t.placement.offset),[...tasks.map(t=>t.placement.offset)].sort((a,b)=>a-b));
    const combined=insertScenePlacements(original,tasks.map((t,i)=>({placement:t.placement,content:'[image:slot-'+i+']'})));
    assert.equal((combined.match(/\[image:slot-/g)||[]).length,4);
    assert.ok(combined.indexOf('[image:slot-1]')<combined.indexOf('</content>'));
});
test('outer hidden preamble does not suppress actual content section',()=>{
    const original=makeText('<hidden>private draft<br></hidden><content>STORY</content>');
    const source=createSceneSource(original,{restrictToNarrativeBody:true});
    assert.ok(source.content.includes(labels[3]));
    assert.ok(!source.content.includes('private draft'));
});
test('nested separate hidden notes are excluded but visible scenes stay',()=>{
    const original=makeText('<content>'+labels[0]+'<hidden>private notes, not a scene</hidden>'+labels[1]+'</content>');
    const source=createSceneSource(original,{restrictToNarrativeBody:true});
    assert.ok(source.content.includes(labels[0]));
    assert.ok(source.content.includes(labels[1]));
    assert.ok(!source.content.includes('private notes'));
});
test('no source mapping mutates source text or hidden tags',()=>{
    const original=makeText('<content><hidden>STORY</hidden></content>');
    const frozen=original;
    createSceneSource(original,{restrictToNarrativeBody:true});
    buildDirectDrawTasks(directives,{maxImages:4},{sourceText:original,skipInvalidImages:true,requireFemaleImage:true});
    assert.equal(original,frozen);
});
