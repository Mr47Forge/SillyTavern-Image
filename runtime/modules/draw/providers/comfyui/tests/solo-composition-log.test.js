import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComfyPromptForTask, buildComfyImageRequest } from '../compiler.js';
import { workflowPromptTrace, formatImageLog } from '../../../shared/image-diagnostics.js';

const recipe = { positivePrefix: 'realistic photo', negativePrefix: 'bad anatomy', knownCharacters: [] };
const single = { scene: '1girl, solo, adult woman standing in a studio', chars: [{ name: '林安' }], post_prompt:'soft shadows' };
const duo = { scene: '2girls, duo, two women in a studio', chars: [{ name: 'A' }, { name: 'B' }], post_prompt:'soft shadows' };

test('one character does NOT inject any forced single-person or duplicate-person terms', () => {
    const result=compileComfyPromptForTask(single,recipe);
    assert.match(result.positive,/1girl, solo/);
    assert.ok(result.positive.endsWith('soft shadows'));
    assert.doesNotMatch(result.positive,/exactly one person|solitary subject|one human figure|single frame/);
    assert.doesNotMatch(result.negative,/duplicate person|cloned person|mirror duplicate/);
});

test('multi-person task preserves scene character count with no injected solo restriction',()=>{
    const result=compileComfyPromptForTask(duo,recipe);
    assert.match(result.positive,/2girls, duo, two women/);
    assert.doesNotMatch(result.positive,/exactly one person|solitary subject|one human figure/);
    assert.ok(result.positive.endsWith('soft shadows'));
});

test('a user-specified prompt is kept unchanged without automatic number restrictions',()=>{
    const text='two women walking together';
    const result=compileComfyPromptForTask(single,{...recipe,promptOverride:text});
    assert.match(result.positive,/two women walking together/);
    assert.doesNotMatch(result.positive,/exactly one person|solitary subject/);
});

test('the workflow uses the final prompt exactly once; identical node text is hidden from the log',()=>{
    const data=compileComfyPromptForTask(single,recipe);
    const request=buildComfyImageRequest({
        prompt:data.positive,negativePrompt:data.negative,
        params:{model:'fixture.safetensors',width:768,height:1152,cfg:1,steps:8},
        recipe:{workflowMode:'simple'},seed:123,taskCharacters:single.chars,
    });
    assert.equal(request.workflow['3'].inputs.cfg,1);
    assert.equal(request.workflow['6'].inputs.text,data.positive);
    assert.equal(request.workflow['7'].inputs.text,data.negative);
    const trace=workflowPromptTrace(request,data);
    assert.equal(trace.nodes.length,2);
    const shown=formatImageLog({positive:data.positive,negativePrompt:data.negative,promptTrace:trace});
    assert.deepEqual(shown.traceNodes,[]);
    assert.equal(shown.positive,data.positive);
    assert.equal(shown.negative,data.negative);
});

test('900/901 duplicates are hidden while different workflow nodes remain visible',()=>{
    const positive='single woman in a studio';
    const negative='blur';
    const shown=formatImageLog({positive,negativePrompt:negative,promptTrace:{
        nodes:[
            {id:'900',type:'CLIPTextEncode',text:positive},
            {id:'901',type:'CLIPTextEncode',text:negative},
            {id:'84',type:'Krea2EditGroundedEncode',text:'different grounded instruction'},
        ],
    }});
    assert.deepEqual(shown.traceNodes.map(node=>node.id),['84']);
});
