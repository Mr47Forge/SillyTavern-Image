import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectDrawTasks, buildDirectDrawInstruction } from '../direct-draw.js';
import { parseDrawImageDirectives } from '../image-marker-syntax.js';
import { applyWardrobeContinuity } from '../wardrobe-continuity.js';
import { createSceneSource } from '../scene-source.js';
import { selectPhotoCharacter } from '../../providers/comfyui/role-photo-reference.js';

test('ambiguous pronoun clothing event preserves unrelated actor', () => {
    const entries=[{name:'Alice',costume:'blue blouse'}, {name:'Bob',costume:'gray coat'}];
    const source='\u5979\u6362\u4e0a\u7ea2\u8272\u88d9\u5b50\uff0cBob\u4ecd\u5728\u539f\u5730\u7b49\u5f85\u3002';
    const tasks=[{scene:'two people, outdoors',chars:[{name:'Alice',costume:''},{name:'Bob',costume:''}],placement:{offset:source.length}}];
    const result=applyWardrobeContinuity(tasks,entries,{narrative:source});
    assert.equal(result[0].chars[1].costume,'gray coat');
    assert.equal(result[0].chars[0].costume,'blue blouse');
});
test('half-sentence anchor cannot scatter a generated image to unrelated paragraph',()=>{
    const story='An adult painter pushes open the studio door and arranges brushes.';
    const tasks=buildDirectDrawTasks([{prompt:'artist portrait, studio',
        characters:[{name:'Alice',type:'woman'}],after:'studio'}],
        {maxImages:1},{sourceText:story,requireFemaleImage:true});
    assert.equal(tasks.length,1);
    assert.equal(tasks[0].placement.mode,'tail');
});
test('multiline JSON character arrays parse with following after field',()=>{
    const input='<image>\nprompt: studio\ncharacters: [\n'+
        '  {"name":"Alice","costume":"blue blouse"},\n'+
        '  {"name":"Bob","costume":"gray coat"}\n'+
        ']\nafter: Alice opens the door.\n</image>';
    const rows=parseDrawImageDirectives(input);
    assert.equal(rows.length,1);assert.equal(rows[0].characters.length,2);
    assert.equal(rows[0].after,'Alice opens the door.');
});
test('empty declared character list does not inject a photo',()=>{
    const known=[{name:'Alice',enabled:true,photoUrl:'user/images/SillyTavernImage-role-photos/alice.jpg'}];
    assert.equal(selectPhotoCharacter({prompt:'Empty Alice studio',taskCharacters:[],knownCharacters:known}),null);
    assert.equal(selectPhotoCharacter({prompt:'Empty Alice studio',knownCharacters:known}),known[0]);
});
test('incomplete saved character keeps this scene appearance',()=>{
    const known=[{name:'Alice',enabled:true,type:'',appearance:'',danbooruTag:''}];
    const story='Alice appears in the studio.';
    const tasks=buildDirectDrawTasks([{prompt:'1girl, studio',characters:[{name:'Alice',type:'adult artist',appear:'silver hair'}],after:story}],
        {maxImages:1},{sourceText:story,knownCharacters:known});
    assert.match(tasks[0].characterPrompts[0].prompt,/silver hair/);
    assert.match(tasks[0].characterPrompts[0].prompt,/artist/);
});
test('same line keeps style while removing retired planner instruction',()=>{
    const input='\u6c34\u5f69\u98ce\u3001\u84dd\u8272\u8c03\uff0c\u6700\u540e\u901a\u8fc7 submit_scene_plan \u63d0\u4ea4';
    const result=buildDirectDrawInstruction({prompts:{sceneRules:input}});
    assert.match(result,/\u6c34\u5f69\u98ce/);
    assert.match(result,/\u84dd\u8272\u8c03/);
    assert.ok(!result.includes('submit_scene_plan'));
});
