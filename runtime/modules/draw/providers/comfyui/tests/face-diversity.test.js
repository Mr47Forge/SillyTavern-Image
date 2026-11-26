import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectDrawTasks, readDirectDrawDirectives } from '../../../shared/direct-draw.js';
import { buildComfyImageRequest, compileComfyPromptForTask } from '../compiler.js';

const people = [
    {name:'画师',type:'adult woman',position:'left',appear:'square jaw, wide-set eyes',costume:'blue work coat',action:'holding a sketchbook'},
    {name:'策展人',type:'adult woman',position:'right',appear:'oval face, hooded eyes',costume:'grey blazer',action:'gesturing toward a painting'},
];

test('old unpositioned prompts retain face traits even when clothes and actions are already in the scene', () => {
    const scene = 'Two women in an art gallery, left woman in a blue work coat holding a sketchbook, right woman in a grey blazer gesturing toward a painting';
    const {positive} = compileComfyPromptForTask({scene,chars:people});
    assert.match(positive,/square jaw/);
    assert.match(positive,/hooded eyes/);
    assert.equal(positive.split('blue work coat').length,2);
    assert.equal(positive.split('gesturing toward a painting').length,2);
    assert.doesNotMatch(positive,/authentic Han Chinese facial appearance/);
});

test('direct draw binds each face and outfit to its own position in the actual workflow text', () => {
    const reply = ['<image>','prompt: two women in a studio','characters: '+JSON.stringify(people),'</image>'].join('\n');
    const [task] = buildDirectDrawTasks(readDirectDrawDirectives({mes:reply}),{maxImages:1});
    const {positive, negative} = compileComfyPromptForTask(task);
    const request = buildComfyImageRequest({prompt:positive,negativePrompt:negative,
        params:{model:'test-model.safetensors'},seed:42});
    const workflowText = request.workflow['6'].inputs.text;
    assert.equal(workflowText,positive);
    assert.match(workflowText,/^On the left, an adult woman with a square jaw and wide-set eyes wears a blue work coat and is holding a sketchbook\. On the right/);
    assert.match(workflowText,/On the right, an adult woman with an oval face and hooded eyes wears a grey blazer and is gesturing toward a painting\.\n\ntwo women in a studio\.$/);
    const reopened = JSON.parse(JSON.stringify(compileComfyPromptForTask(task).characterPrompts));
    reopened[0].prompt = 'On the left, the painter wears a red jacket.';
    const edited = compileComfyPromptForTask({scene:'A gallery.',characterPrompts:reopened,post_prompt:'filmic contrast'},
        {positivePrefix:'soft grain',negativePrefix:'blurry'});
    assert.match(edited.positive,/^On the left, the painter wears a red jacket\./);
    assert.doesNotMatch(edited.positive,/blue work coat/);
    assert.ok(edited.positive.endsWith('filmic contrast'));
    assert.equal(edited.negative,'blurry');
});

test('missing face traits fill sparse history without overwriting established traits', () => {
    const [task] = buildDirectDrawTasks([{prompt:'portrait in a studio',characters:[{
        ...people[0],appear:'blonde hair, round face, wide-set eyes, blue eyes, straight nose bridge',
    }]}],{maxImages:1},{
        recentAppearances:new Map([['画师','black hair, square jaw, brown eyes, natural East Asian facial features']]),
    });
    assert.match(task.chars[0].appear,/black hair, square jaw, brown eyes/);
    assert.match(task.chars[0].appear,/wide-set eyes, straight nose bridge/);
    assert.doesNotMatch(task.chars[0].appear,/blonde|round face|blue eyes/);
});
