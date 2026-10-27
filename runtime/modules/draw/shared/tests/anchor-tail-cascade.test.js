import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectDrawTasks} from '../direct-draw.js';

const story='<content>First female scene: Alice opens a window.\n\n'
    +'Second female scene: Alice mixes blue paint.\n\n'
    +'Third female scene: Alice paints a mountain.\n\n'
    +'Fourth female scene: Alice puts away her brushes.</content>';
const anchors=['Alice opens a window.','Alice mixes blue paint.',
    'Alice paints a mountain.','Alice puts away her brushes.'];
const directives=anchors.map((after,i)=>({
    imageIndex:i,prompt:'adult woman artist '+(i+1),
    characters:[{name:'Alice',type:'adult woman'}],after
}));
const tasks=ds=>buildDirectDrawTasks(ds,{maxImages:4},{
    sourceText:story,skipInvalidImages:true,requireFemaleImage:true});

test('missing first anchor never forces later correct pictures to tail',()=>{
    const current=directives.map((item,i)=>i===0
        ?{...item,after:'A paragraph absent from the actual story.'}:item);
    const result=tasks(current);
    assert.equal(result.length,4);
    assert.deepEqual(result.map(x=>x.placement.mode),['source','source','source','source']);
    const offsets=result.map(x=>x.placement.offset);
    assert.ok(offsets[0]<offsets[1]);
    assert.ok(offsets[1]<offsets[2] && offsets[2]<offsets[3]);
    assert.equal(result[1].directiveIdentity.after.includes('mixes blue paint'),true);
    assert.equal(result[0].directiveIdentity.requestedAfter,current[0].after);
});

test('missing middle image stays beside predecessor without destroying later anchors',()=>{
    const current=directives.map((item,i)=>i===1
        ?{...item,after:'An unrelated hallucinated after quote.'}:item);
    const result=tasks(current);
    const offsets=result.map(x=>x.placement.offset);
    assert.equal(offsets[1],offsets[0]);
    assert.ok(offsets[2]>offsets[1]);
    assert.ok(offsets[3]>offsets[2]);
});

test('all-unmatched images remain tail instead of being randomly scattered',()=>{
    const current=directives.map((item,i)=>({...item,after:'Missing scene number '+i}));
    const result=tasks(current);
    assert.deepEqual(result.map(x=>x.placement.mode),['tail','tail','tail','tail']);
});

test('missing final quote follows third matched picture',()=>{
    const current=directives.map((item,i)=>i===3?{...item,after:'Unknown ending scene'}:item);
    const result=tasks(current);
    assert.equal(result[3].placement.mode,'source');
    assert.equal(result[3].placement.offset,result[2].placement.offset);
});

test('incorrectly reversed quote never creates a backwards picture ordering',()=>{
    const current=directives.map((item,i)=>i===2?{...item,after:anchors[0]}:item);
    const result=tasks(current);
    assert.ok(result.every((x,i)=>i===0||x.placement.offset>=result[i-1].placement.offset));
    assert.equal(result[3].placement.offset,story.indexOf(anchors[3])+anchors[3].length);
});
