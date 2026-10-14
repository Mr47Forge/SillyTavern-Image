import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
const base='/home/node/app/data/default-user/extensions/LittleWhiteBox/modules/draw';
const file=base+'/shared/image-diagnostics.js';
const { workflowPromptTrace,formatImageLog }=await import(pathToFileURL(file).href);
test('Image workflow trace stores actual sampled node prompt and params',()=>{
 const workflow={
 '5':{class_type:'TextEncodeKrea2Reference',inputs:{prompt:'character1 reference, standing in a park',image1:['15',0]}},
 '6':{class_type:'CLIPTextEncode',inputs:{text:'CGI, cartoon'}},
 '8':{class_type:'KSampler',inputs:{seed:2345,steps:8,cfg:1,sampler_name:'euler_ancestral',scheduler:'beta'}},
 '15':{class_type:'LoadImage',inputs:{image:'lwb-role-7.jpg'}}
 };
 const trace=workflowPromptTrace({workflow},{positive:'Scene at park',negative:'bad anatomy'});
 assert.equal(trace.nodes.length,2);
 assert.equal(trace.nodes[0].text,'character1 reference, standing in a park');
 assert.equal(trace.seed,2345);
 assert.equal(trace.steps,8);
 assert.equal(trace.referencePhoto,true);
 const info=formatImageLog({imgId:'p1',timestamp:Date.now(),positive:'Scene at park',promptTrace:trace});
 assert.equal(info.traceNodes.length,2);
 assert.equal(info.seed,2345);
});
test('Old gallery records still expose original positive and negative',()=>{
 const info=formatImageLog({imgId:'existing-image',timestamp:Date.now(),positive:'realistic photo',negativePrompt:'anime',status:'success'});
 assert.equal(info.positive,'realistic photo');
 assert.equal(info.negative,'anime');
 assert.equal(info.status,'成功');
});
test('Error details preserved for failed image',()=>{
 const info=formatImageLog({imgId:'fail1',positive:'scene',negativePrompt:'bad',status:'failed',errorType:'ValidationError',errorMessage:'Invalid image file'});
 assert.equal(info.status,'失败');
 assert.equal(info.error,'Invalid image file');
});
test('Viewer and navigation are in parent, above setting overlay',()=>{
 const file=fs.readFileSync(base+'/shared/gallery-cache.js','utf8');
 const settings=fs.readFileSync(base+'/providers/comfyui/comfy-draw.js','utf8');
 const markup=fs.readFileSync(base+'/providers/comfyui/comfy-draw.html','utf8');
 assert.match(file,/z-index:100008/);
 assert.match(file,/id="nd-gallery-zoom-in"/);
 assert.match(file,/id="nd-gallery-prompt-log"/);
 assert.match(file,/async function navigateGallery/);
 assert.match(file,/managementSlots/);
 assert.match(file,/nd-gallery-prev'\)\.addEventListener\('click', \(\) => navigateGallery\(1\)/);
 assert.match(file,/nd-gallery-next'\)\.addEventListener\('click', \(\) => navigateGallery\(-1\)/);
 assert.match(settings,/const sameChat=latest\?\.chatId/);
 assert.match(settings,/createManagementCallbacks/);
 assert.match(settings,/view-prompt-log/);
 assert.match(markup,/data-comfy-view="errors"/);
});
