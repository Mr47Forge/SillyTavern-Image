import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getSingleSlotReplanContext,
    normalizeSingleSlotReplanTask,
    executeSingleSlotReplan,
} from '../single-slot-replan.js';

const story = '第一幕。一个成年人在花园里散步。\n[image:slot-first]\n第二幕。她坐到长椅上，观察身边的树木。\n[image:slot-second]\n第三幕。她站起身离开。';

test('focuses the clicked slot, not the end of story or another image', () => {
    const first = getSingleSlotReplanContext(story, 'slot-first');
    const second = getSingleSlotReplanContext(story, 'slot-second');
    assert.match(first, /散步/);
    assert.doesNotMatch(first, /长椅/);
    assert.match(second, /长椅/);
    assert.doesNotMatch(second, /第三幕/);
    assert.doesNotMatch(second, /\[image:/);
});

test('does not include the original stored image TAGs', () => {
    const source = '描述公园。\n[image:slot-old]\n另一段。';
    const result = getSingleSlotReplanContext(source, 'slot-old');
    assert.equal(result, '描述公园。');
});

test('keeps one new planned task on exactly the old slot', () => {
    const planned = [{ scene: 'fresh description', chars: [{ name: 'A' }], placement: { mode:'source', offset:20 } }];
    const task = normalizeSingleSlotReplanTask(planned, 'slot-second', 'old prompt');
    assert.equal(task.scene, 'fresh description');
    assert.deepEqual(task.placement, { mode:'existing', slotId:'slot-second' });
    assert.deepEqual(task.chars, [{ name: 'A' }]);
    assert.deepEqual(planned[0].placement, { mode:'source', offset:20 });
});

test('rejects identical or empty prompts and multiple images', () => {
    assert.throws(() => normalizeSingleSlotReplanTask([{scene:'same'}],'slot','same'), /完全相同/);
    assert.throws(() => normalizeSingleSlotReplanTask([], 'slot'), /单张/);
    assert.throws(() => normalizeSingleSlotReplanTask([{scene:'one'},{scene:'two'}],'slot'), /单张/);
    assert.throws(() => getSingleSlotReplanContext(story,'missing'), /已经不存在/);
});

test('replans from the correct story segment and submits one new prompt once', async () => {
    const events=[];
    const output=await executeSingleSlotReplan({
        sourceText: story, slotId:'slot-second', oldScene:'old scene',
        assertCurrent:()=>events.push('guard'),
        plan:async focusedText=>{
            events.push('planner');
            assert.match(focusedText, /长椅/);
            assert.doesNotMatch(focusedText, /第三幕/);
            return [{scene:'new scene', chars:[], placement:{mode:'source',offset:999}}];
        },
        submit: async task=>{
            events.push('comfy');
            assert.equal(task.scene,'new scene');
            assert.deepEqual(task.placement,{mode:'existing',slotId:'slot-second'});
            return 'submitted';
        },
    });
    assert.equal(output,'submitted');
    assert.deepEqual(events,['guard','planner','guard','comfy']);
});

test('planner failure and changed target never submit a generation', async()=>{
    let submissions=0;
    await assert.rejects(executeSingleSlotReplan({
        sourceText:story,slotId:'slot-first',
        plan:async()=>{throw new Error('planner down');},
        submit:async()=>{submissions++;},
    }),/planner down/);
    let guards=0;
    await assert.rejects(executeSingleSlotReplan({
        sourceText:story,slotId:'slot-first',
        plan:async()=>[{scene:'new scene'}],
        assertCurrent:()=>{if(++guards===2)throw new Error('chat changed');},
        submit:async()=>{submissions++;},
    }),/chat changed/);
    assert.equal(submissions,0);
});
