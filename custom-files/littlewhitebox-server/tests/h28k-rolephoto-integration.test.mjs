import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const base='/home/node/app';
const dir=base+'/data/default-user/extensions/LittleWhiteBox/modules/draw/providers/comfyui';
const { buildComfyImageRequest }=await import(pathToFileURL(dir+'/compiler.js').href);
const {selectPhotoCharacter}=await import(pathToFileURL(dir+'/role-photo-reference.js').href);
const cfg=JSON.parse(fs.readFileSync(base+'/data/default-user/user/files/LittleWhiteBox_ComfyDraw.json','utf8')).config;
const preset=cfg.workflowPresets.find(p=>p.id==='workflow-20261014-krea2-rolephoto-v1');
assert.ok(preset && preset.json);
const original=JSON.parse(preset.json);
const roles=JSON.parse(fs.readFileSync(base+'/data/default-user/user/files/LittleWhiteBox_NovelDraw.json','utf8')).settings.characterTags;
const photoRole=roles.find(r=>r.photoUrl);
assert.ok(photoRole);
const name=photoRole.name;
const params={width:768,height:1152};
const recipe={workflowMode:'custom',customWorkflow:preset,knownCharacters:roles};
function render(characters, library=roles){
 return buildComfyImageRequest({
  prompt:'A natural documentary photograph of '+name+' in a bright modern library, wearing a blue sweater and reading a book, one person, realistic daylight.',
  negativePrompt:'anime, CGI, extra hands', params,
  recipe:{...recipe,knownCharacters:library},seed:584888,taskCharacters:characters
 });
}
const selected=render([name]);
assert.equal(selected.preferredSaveImageNodeId,'11');
assert.equal(selected.workflow['15'].inputs.image,'lwb-role-photo:'+photoRole.photoUrl);
assert.equal(selected.workflow['5'].inputs.image1[0],'15');
assert.match(selected.workflow['5'].inputs.prompt,/character1 from image1/);
assert.ok(selected.workflow['9']);
console.log('PASS PHOTO MATCH',name,'marker_written=1');
const without=render(['Nonexistent Character'],[]);
assert.equal(without.workflow['15'],undefined);
assert.equal(without.workflow['5'],undefined);
assert.deepEqual(without.workflow['8'].inputs.positive,['18',0]);
assert.match(without.workflow['18'].inputs.text,/modern library/);
console.log('PASS NO-PHOTO FALLBACK','reference_nodes_removed=1');
const noOtherPhoto=render(['Nonexistent Character']);
assert.equal(noOtherPhoto.workflow['15'],undefined);
console.log('PASS WRONG-CHARACTER GUARD');
const unchanged=buildComfyImageRequest({prompt:'person in courtyard',negativePrompt:'bad',
 params,seed:584888,recipe:{workflowMode:'custom',customWorkflow:cfg.workflowPresets[0],knownCharacters:roles}});
assert.equal(unchanged.workflow['15'],undefined);
console.log('PASS OLD PRESET PRESERVED');
const chosen=selectPhotoCharacter({taskCharacters:[name],knownCharacters:roles});
assert.equal(chosen.id,photoRole.id);
console.log('ALL FRONTEND WORKFLOW TESTS PASSED');
if(process.argv.includes('--full-run')){
 const adapter=require(base+'/plugins/littlewhitebox-server/providers/comfyui/adapter.js');
 const result=await adapter.execute({context:{url:cfg.host,auth:cfg.auth || ''},
  item:{request:{workflow:selected.workflow,preferredSaveImageNodeId:'11'}},
  signal:new AbortController().signal});
 assert.ok(result.buffer.length>50000,'Generation returned too little data');
 assert.equal(result.mime,'image/png');
 console.log('LIVE BACKEND DRAW SUCCESS','bytes='+result.buffer.length,'mime='+result.mime);
}
if(process.argv.includes('--no-photo-live')){
 const adapter=require(base+'/plugins/littlewhitebox-server/providers/comfyui/adapter.js');
 const result=await adapter.execute({context:{url:cfg.host,auth:cfg.auth||''},
  item:{request:{workflow:noOtherPhoto.workflow,preferredSaveImageNodeId:'11'}},
  signal:new AbortController().signal});
 assert.ok(result.buffer.length>50000,'Fallback image output too small');
 assert.equal(result.mime,'image/png');
 console.log('LIVE NO-PHOTO DRAW SUCCESS','bytes='+result.buffer.length,'mime='+result.mime);
}
