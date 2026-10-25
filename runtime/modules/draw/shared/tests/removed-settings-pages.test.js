import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const main=readFileSync(new URL('../../providers/comfyui/comfy-draw.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../providers/comfyui/comfy-draw.html',import.meta.url),'utf8');
test('quick testing, model API and jailbreak pages and dedicated handlers are removed',()=>{
    for(const value of ['test','llm','jailbreak']){
        assert.ok(!html.includes(`data-comfy-view="${value}"`));
        assert.ok(!html.includes(`data-comfy-view-panel="${value}"`));
    }
    for(const value of ['testGenerateFromSettingsPanel','attachDrawAgentSettingsSurface','ensureAgentSettingsSurface','renderLastLlmRequestPreview','selectedJailbreakId','jailbreaks','comfy-prompt-jailbreak'])assert.ok(!main.includes(value),value);
    assert.ok(!existsSync(new URL('../agent-settings-surface.js',import.meta.url)));
});
test('image connection, workflow, fixed prompts and normal generation remain',()=>{
    for(const view of ['api','workflow','params','prompts','characters','worldbook','gallery'])assert.ok(html.includes(`data-comfy-view-panel="${view}"`));
    for(const id of ['comfy-draw-host','comfy-draw-positive-prefix','comfy-draw-negative-prefix','comfy-draw-test'])assert.ok(html.includes(`id="${id}"`));
    for(const name of ['testConnection','generateAndInsertImages','getDirectDrawInstruction'])assert.ok(main.includes(`function ${name}(`));
});
test('settings now open on drawing parameters and invalid old tabs fall back safely',()=>{
    const start=main.indexOf('function switchSettingsView('),end=main.indexOf('\n}',start)+2;
    const states=[];
    const ctx={COMFY_DRAW_VIEWS:['api','workflow','params','prompts','worldbook','characters','gallery','errors'],
        querySettingsAll: selector=>selector.includes('panel')?[{dataset:{comfyViewPanel:'params'},classList:{toggle:(_key,value)=>states.push(value)}}]:[],
        inlineErrorLogRender:null};
    vm.runInNewContext(main.slice(start,end),ctx);
    ctx.switchSettingsView();assert.equal(states.pop(),true);
    ctx.switchSettingsView('llm');assert.equal(states.pop(),true);
    assert.match(main,/switchSettingsView\('params'\)/);
});

test('removed AI import, automatic learning and destructive role-clear controls stay absent',()=>{
    for(const id of ['comfy-import-prompts','comfy-import-image','comfy-auto-learn',
        'comfy-auto-learn-update','comfy-shared-char-clear']) {
        assert.ok(!html.includes('id="' + id + '"'),id);
    }
    for(const name of ['openComfyPromptImport','openComfyImageCharacterImport','recognizeImageCharacter',
        'maybeComfyAutoLearn','applyComfyDrawRunAutoLearn','clearCharacterTagsDraft']) {
        assert.ok(!main.includes(name),name);
    }
    for(const id of ['comfy-import-from-chat','comfy-shared-char-add',
        'comfy-shared-char-export','comfy-shared-char-import','comfy-gallery-refresh']) {
        assert.ok(html.includes('id="' + id + '"'),id);
    }
});
