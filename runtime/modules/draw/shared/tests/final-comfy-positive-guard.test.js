import assert from 'node:assert/strict';
import test from 'node:test';
import {compileComfyPromptForTask} from '../../providers/comfyui/compiler.js';
import {sanitizeFinalImagePositive} from '../male-image-exclusion.js';

test('final ComfyUI request excludes POV and male organs even from preset prefix',()=>{
 const recipe={
   positivePrefix:'realistic woman portrait, POV, a penile closeup, natural light',
   negativePrefix:'penis, male body',
 };
 const task={
   scene:'third-person photo, pov, woman looking up at viewer, traditional apartment',
   characterPrompts:[{name:'A',prompt:'mature female, detailed brown eyes, viewer legs, from the viewer perspective'}],
   post_prompt:'high quality, 1girl',
 };
 const out=compileComfyPromptForTask(task,recipe);
 assert.doesNotMatch(out.positive,/\bpov\b|penile|viewer\b|\bmale body\b/i);
 assert.match(out.positive,/mature female/);
 assert.match(out.positive,/detailed brown eyes/);
 assert.match(out.positive,/camera lens/);
 assert.match(out.negative,/penis/);
 assert.equal(recipe.positivePrefix,'realistic woman portrait, POV, a penile closeup, natural light');
 assert.match(task.scene,/pov/);
});
test('manual prompt override cannot bypass final positive filter',()=>{
 const recipe={promptOverride:'POV, male genitalia, mature female, cowboy shot, looking at viewer',
     positivePrefix:'photo portrait',negativePrefix:'testicles, male anatomy'};
 const out=compileComfyPromptForTask({},recipe);
 assert.doesNotMatch(out.positive,/\bpov\b|male genitalia|looking at viewer/i);
 assert.match(out.positive,/mature female/);
 assert.match(out.positive,/cowboy shot/);
 assert.match(out.positive,/camera lens/);
 assert.match(out.negative,/testicles/);
});
test('women-only normal tags are not mistaken for male anatomy',()=>{
 const original='mature female, cowboy shot, natural window light, erect nipples, 1girl';
 const final=sanitizeFinalImagePositive(original);
 assert.equal(final,original);
});
test('male anatomy in compiled character field and post prompt is removed',()=>{
 const task={
   scene:'1girl in sunlit room, alone',
   characterPrompts:[{name:'A',prompt:'woman, long dark hair, semen on body, elegant blouse'}],
   post_prompt:'shallow depth of field, scrotum, photo',
 };
 const out=compileComfyPromptForTask(task,{negativePrefix:'male genitalia'});
 assert.doesNotMatch(out.positive,/semen|scrotum/i);
 assert.match(out.positive,/long dark hair/);
 assert.match(out.positive,/shallow depth of field/);
 assert.match(out.negative,/male genitalia/);
});
