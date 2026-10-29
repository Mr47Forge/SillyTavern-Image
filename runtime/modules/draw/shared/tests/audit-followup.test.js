import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectDrawTasks, buildDirectDrawInstruction } from '../direct-draw.js';
import { compileComfyPromptForTask } from '../../providers/comfyui/compiler.js';

// Both wardrobe actors are women: male actors are filtered before wardrobe merging.
const known = [{name:'Alice',aliases:['小艾'],type:'woman',appearance:'brown hair'},
    {name:'Beth',type:'woman',appearance:'black hair'}];
const wardrobe = [{name:'Alice',costume:'blue blouse',state:'bandaged arm'},
    {name:'Beth',costume:'gray coat',state:'holding book'}];
function build(story, characters, entries=wardrobe) {
    return buildDirectDrawTasks([{prompt:'adults in a studio',characters,after:story}],{},
        {sourceText:story,knownCharacters:known,wardrobeLedger:entries})[0];
}
test('pronoun change accepts the one explicitly updated outfit without changing other people or injury',()=>{
    const task=build('她换上红色裙子，Beth仍在原地等待。',
        [{name:'小艾',costume:'red dress'},{name:'Beth',costume:'gray coat'}]);
    assert.equal(task.chars[0].costume,'red dress');
    assert.equal(task.chars[0].state,'bandaged arm');
    assert.equal(task.chars[1].costume,'gray coat');
    assert.match(compileComfyPromptForTask(task,{knownCharacters:known}).positive,/red dress/);
});
test('pronoun event with missing scene outfit keeps existing clothes',()=>{
    const task=build('她换上红色裙子，Beth仍在原地等待。',[{name:'Alice'},{name:'Beth'}]);
    assert.equal(task.chars[0].costume,'blue blouse');
    assert.equal(task.chars[1].costume,'gray coat');
});
test('ambiguous event cannot authorize two conflicting outfit updates',()=>{
    const task=build('她换上红色裙子。',[{name:'Alice',costume:'red dress'},{name:'Beth',costume:'green suit'}]);
    assert.equal(task.chars[0].costume,'blue blouse');
    assert.equal(task.chars[1].costume,'gray coat');
});
test('named change cannot authorize an unrelated person outfit update',()=>{
    const task=build('Beth换上绿色外套。',[{name:'Alice',costume:'red dress'},{name:'Beth',costume:'green coat'}]);
    assert.equal(task.chars[0].costume,'blue blouse');
    assert.equal(task.chars[1].costume,'green coat');
});
test('pronoun state event updates only the one declared lasting state',()=>{
    const task=build('她放下雨伞。',[{name:'Alice',state:'bandaged arm'},{name:'Beth',state:'holding book'}],
        [{name:'Alice',costume:'blue blouse',state:'bandaged arm, holding umbrella'},wardrobe[1]]);
    assert.equal(task.chars[0].state,'bandaged arm');
    assert.equal(task.chars[0].costume,'blue blouse');
    assert.equal(task.chars[1].state,'holding book');
});
for (const rules of [
    '通过 submit_scene_plan 提交；画面必须水彩，使用蓝色调。',
    '画面必须水彩，最后通过 submit_scene_plan 提交，使用蓝色调。',
    '通过工具调用提交。画面必须水彩；使用蓝色调。',
    '画面必须水彩；通过 tool_call 提交；使用蓝色调。',
]) test('retired protocol removal preserves rules on both sides: '+rules,()=>{
    const instruction=buildDirectDrawInstruction({prompts:{sceneRules:rules}});
    assert.match(instruction,/画面必须水彩/);assert.match(instruction,/使用蓝色调/);
    assert.ok(!/submit_scene_plan|tool_call|工具调用/.test(instruction));
});
test('scene translation is used without reading old English library identity',()=>{
    const task=build('Alice在画室里等待。',[{name:'Alice',danbooru:'audit_canonical_tag',appear:'brown hair'}],[]);
    const positive=compileComfyPromptForTask(task,{knownCharacters:known}).positive;
    assert.match(positive,/audit_canonical_tag/);assert.match(positive,/brown hair/);
    assert.ok(!positive.includes('outdated library English identity'));
});
test('nonempty saved canonical tag stays authoritative',()=>{
    const people=[{...known[0],danbooruTag:'saved_identity_tag'}];
    const task=buildDirectDrawTasks([{prompt:'studio',characters:[{name:'Alice',danbooru:'conflicting_tag'}]}],{},
        {knownCharacters:people})[0];
    const positive=compileComfyPromptForTask(task,{knownCharacters:people}).positive;
    assert.match(positive,/saved_identity_tag/);assert.ok(!positive.includes('conflicting_tag'));
});
