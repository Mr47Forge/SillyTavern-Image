import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComfyPromptForTask } from '../compiler.js';
import { applyRolePhotoReference } from '../role-photo-reference.js';

const recipe = { positivePrefix: 'photorealistic', negativePrefix: 'blurry, bad anatomy' };
const baseScene = '1girl, solo, Chinese adult woman, long black hair, brown eyes, white knit sweater, smiling softly, sitting on a sofa';
const samePerson = {
    name: '角色甲', type: 'woman',
    prompt: 'Chinese adult woman, long black hair, brown eyes, white knit sweater, smiling softly, sitting on a sofa',
    uc: 'red hair',
};

test('a complete scene never receives a SECOND copy of its person description', () => {
    const task = {scene:baseScene, chars:[{name:'角色甲'}],characterPrompts:[samePerson],post_prompt:'warm window light'};
    const actual=compileComfyPromptForTask(task,recipe);
    assert.equal(actual.positive.split('long black hair').length-1,1);
    assert.equal(actual.positive.split('white knit sweater').length-1,1);
    assert.equal(actual.positive.split('sitting on a sofa').length-1,1);
    assert.equal(actual.characterPrompts.length,1,'retain structured metadata without injecting it twice');
    assert.equal(actual.negative.includes('red hair'),true);
    assert.ok(actual.positive.endsWith('warm window light'));
});

test('short environment-only prompts still receive their missing character information once',()=>{
    const actual=compileComfyPromptForTask({scene:'studio, warm light',characterPrompts:[samePerson]},recipe);
    assert.match(actual.positive,/studio, warm light/);
    assert.equal(actual.positive.split('long black hair').length-1,1);
});

test('each member of a multi-person scene is deduplicated independently without locking count',()=>{
    const scene='2girls, two women talking, long black hair, brown eyes, white knit sweater, blonde wavy hair, blue shirt, standing by window';
    const personB={name:'角色乙',prompt:'blonde wavy hair, blue shirt, standing by window',uc:''};
    const complete=compileComfyPromptForTask({scene,characterPrompts:[samePerson,personB]},recipe);
    assert.equal(complete.positive.split('long black hair').length-1,1);
    assert.equal(complete.positive.split('blonde wavy hair').length-1,1);
    assert.match(complete.positive,/2girls, two women/);
    const partial=compileComfyPromptForTask({scene:'long black hair, brown eyes, female in a studio',characterPrompts:[samePerson,personB]},recipe);
    assert.equal(partial.positive.split('long black hair').length-1,1);
    assert.match(partial.positive,/blonde wavy hair/,'still add another character when scene has not described her');
});

test('fully manual prompt is not augmented with either structured character copy',()=>{
    const actual=compileComfyPromptForTask(
        {scene:baseScene,characterPrompts:[samePerson]},
        {...recipe,promptOverride:'two people at the beach'},
    );
    assert.match(actual.positive,/two people at the beach/);
    assert.doesNotMatch(actual.positive,/long black hair/);
});

test('Krea2 missing-photo fallback creates ONE positive encoder (900) and ONE negative encoder (901)',()=>{
    const workflow={
        '53':{class_type:'KSampler',inputs:{model:['90',0],positive:['84',0],negative:['84',0],latent_image:['82',0]}},
        '55':{class_type:'UNETLoader',inputs:{unet_name:'fixture'}},
        '56':{class_type:'CLIPLoader',inputs:{clip_name:'fixture'}},
        '79':{class_type:'Krea2EditModelPatch',inputs:{model:['55',0]}},
        '82':{class_type:'EmptySD3LatentImage',inputs:{width:768,height:1152,batch_size:1}},
        '84':{class_type:'Krea2EditGroundedEncode',inputs:{clip:['56',0],image:['72',0]}},
        '90':{class_type:'PathchSageAttentionKJ',inputs:{model:['79',0]}},
        '72':{class_type:'LoadImage',inputs:{image:'__ST_IMAGE_ROLE__'}},
    };
    const compiled=compileComfyPromptForTask({scene:baseScene,characterPrompts:[samePerson]},recipe);
    const after=applyRolePhotoReference(workflow,{prompt:compiled.positive,negativePrompt:compiled.negative,
        knownCharacters:[],taskCharacters:[{name:'角色甲'}]});
    assert.deepEqual(after['53'].inputs.positive,['900',0]);
    assert.deepEqual(after['53'].inputs.negative,['901',0]);
    assert.equal(after['900'].inputs.text,compiled.positive);
    assert.equal(after['901'].inputs.text,compiled.negative);
    assert.equal(Object.values(after).filter(x=>x.class_type==='CLIPTextEncode').length,2);
    assert.equal(after['900'].inputs.text.split('long black hair').length-1,1);
});
