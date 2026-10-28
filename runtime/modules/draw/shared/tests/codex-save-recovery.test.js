import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getImageSlotDirective,bindImageSlotDirectives } from '../image-directive-identity.js';
import { buildDirectDrawTasks } from '../direct-draw.js';
import { insertScenePlacementsPreservingSlots } from '../scene-placement.js';

const source=readFileSync(new URL('../../providers/comfyui/comfy-draw.js',import.meta.url),'utf8');
for (const kind of ['single','all']) test('Codex audit: '+kind+' role save does not overwrite edits typed during persistence',async()=>{
    let resolveSaved,entered;
    const waiting=new Promise(resolve=>resolveSaved=resolve);
    const started=new Promise(resolve=>entered=resolve);
    const field={value:'点击保存时的原稿'};
    const card={dataset:{characterId:'audit-person'},querySelector:selector=>selector.includes('appearanceZh')?field:null};
    const read=()=>[{id:'audit-person',name:'成年角色',appearanceZh:field.value,outfits:[],dynamicStates:[]}];
    let persisted=null;
    const env={
        getSharedCharacterTagsFromForm:read,getSharedCharacterGroupsFromForm:()=>[],
        updateSharedDrawSettingsPersistent:async mutator=>{
            const state={characterTags:[]};await mutator(state);persisted=state.characterTags[0];
            entered();await waiting;return true;
        },querySettings:()=>card,querySettingsAll:()=>[card],getChecked:()=>false,collectFilterRules:()=>[],
        getSharedDrawSettings:()=>({worldbooks:{}}),getValue:()=>'',CSS:{escape:x=>x},
    };
    const helper=source.slice(source.indexOf('function characterDraftSignature('),source.indexOf('async function saveSingleComfyCharacterCard('));
    const body=kind==='single'
        ?source.slice(source.indexOf('async function saveSingleComfyCharacterCard('),source.indexOf('function openCharacterTestPreview('))
        :source.slice(source.indexOf('async function saveSharedDrawSettings('),source.indexOf('async function saveAllSettings('));
    const save=new Function(...Object.keys(env),helper+body+';return '+(kind==='single'?'saveSingleComfyCharacterCard':'saveSharedDrawSettings')+';')(...Object.values(env));
    const running=kind==='single'?save('audit-person'):save();
    await started;
    field.value='保存等待期间继续输入的新稿';
    resolveSaved();
    assert.equal(await running,true);
    assert.equal(field.value,'保存等待期间继续输入的新稿','unsaved user draft must survive save response');
    assert.equal(persisted.appearanceZh,'点击保存时的原稿','only acknowledged snapshot may be stored');
});

test('image anchor recovery reuses the actual saved visible anchor with the same punctuation',()=>{
    const after='第二段实际可见剧情里，小雨走到湖边。';
    const first='第一段可见剧情。';
    const sourceText='<content>'+first+'</content>\n\n'+after+'\n\n第三段可见剧情。';
    const [task]=buildDirectDrawTasks([{imageIndex:0,prompt:'landscape by a lake',characters:[],after}],
        {maxImages:1},{sourceText,hostVisibleText:first+' '+after+' 第三段可见剧情。'});
    const message={mes:insertScenePlacementsPreservingSlots(sourceText,[{placement:task.placement,content:'[image:audit-slot]'}],{block:true}),extra:{}};
    bindImageSlotDirectives(message,[task],[{slotId:'audit-slot',imgId:'audit-img'}],[{tags:task.scene}]);
    assert.equal(getImageSlotDirective(message,'audit-slot').after,after);
});
