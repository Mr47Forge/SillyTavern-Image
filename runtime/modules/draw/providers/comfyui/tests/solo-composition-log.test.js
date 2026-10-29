import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComfyPromptForTask, buildComfyImageRequest } from '../compiler.js';
import { workflowPromptTrace, formatImageLog } from '../../../shared/image-diagnostics.js';

const onePerson = {
    scene: '1girl, solo, one adult woman standing in a studio',
    chars: [{ name: '林安', type: 'woman', appear: 'black long hair, brown eyes' }],
    post_prompt: 'natural lighting',
    extraNegativePrompt: 'blurry',
};
const recipe = {
    positivePrefix: 'realistic photo',
    negativePrefix: 'bad anatomy',
    knownCharacters: [],
};

test('a single character keeps one positive conditioning and explicit subject count even at CFG 1', () => {
    const data = compileComfyPromptForTask(onePerson, recipe);
    assert.match(data.positive, /exactly one person, solitary subject, one human figure, single frame/);
    assert.match(data.positive, /1girl, solo/);
    assert.match(data.negative, /duplicate person/);
    assert.match(data.negative, /multiple people/);
    assert.match(data.negative, /bad anatomy/);
    assert.equal(data.characterPrompts.length, 1);
});

test('solo compositional constraint never changes explicit group or manual override', () => {
    const group = compileComfyPromptForTask({
        ...onePerson, scene: '2girls, duo, two people talking',
    }, recipe);
    assert.doesNotMatch(group.positive, /exactly one person/);
    const namedGroup = compileComfyPromptForTask({
        ...onePerson, chars: [{name:'A'}, {name:'B'}], scene: 'duo in a studio',
    }, recipe);
    assert.doesNotMatch(namedGroup.positive, /exactly one person/);
    const manual = compileComfyPromptForTask(onePerson, {...recipe, promptOverride:'manual exact prompt'});
    assert.doesNotMatch(manual.positive, /exactly one person/);
});

test('structured one-person prompt and workflow node receive identical final text', () => {
    const data = compileComfyPromptForTask(onePerson, recipe);
    const request = buildComfyImageRequest({
        prompt: data.positive, negativePrompt: data.negative,
        params: {model:'fixture.safetensors',width:768,height:1152,cfg:1,steps:8},
        recipe: {workflowMode:'simple'}, seed:123, taskCharacters:onePerson.chars,
    });
    assert.equal(request.workflow['3'].inputs.cfg,1);
    assert.equal(request.workflow['6'].inputs.text,data.positive);
    assert.equal(request.workflow['7'].inputs.text,data.negative);
    const trace=workflowPromptTrace(request,data);
    assert.equal(trace.nodes.length,2);
    const shown=formatImageLog({positive:data.positive, negativePrompt:data.negative,promptTrace:trace});
    assert.equal(shown.traceNodes.length,0,'exact duplicates should not repeat in prompt log');
    assert.equal(shown.positive,data.positive);
    assert.equal(shown.negative,data.negative);
});

test('image log retains genuinely different node prompts but hides identical 900/901 entries',()=>{
    const positive='single woman in a studio';
    const negative='blur, multiple people';
    const record={positive,negativePrompt:negative,promptTrace:{
        nodes:[
            {id:'900',type:'CLIPTextEncode',text:positive},
            {id:'901',type:'CLIPTextEncode',text:negative},
            {id:'84',type:'Krea2EditGroundedEncode',text:'different grounded instruction'},
        ],
    }};
    const shown=formatImageLog(record);
    assert.deepEqual(shown.traceNodes.map(n=>n.id),['84']);
    assert.equal(shown.positive,positive);
    assert.equal(shown.negative,negative);
});
