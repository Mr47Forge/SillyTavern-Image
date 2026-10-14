import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenePlannerToolProtocol } from '../scene-planner.js';
import { SillyTavernOpenAICompatibleAdapter } from '../../../agent-core/adapters/sillytavern-openai-compatible.js';

test('DeepSeek 4.1 Flash draw scene planner switches its copied tool protocol to tagged JSON',()=>{
 const original={provider:'sillytavern-openai-compatible',model:'cn:deepseek-v4.1-flash',toolMode:'native',temperature:1,maxTokens:32000};
 const fixed=normalizeScenePlannerToolProtocol(original);
 assert.notStrictEqual(fixed,original);
 assert.equal(fixed.toolMode,'tagged-json');
 assert.equal(fixed.model,original.model);
 assert.equal(original.toolMode,'native');
});
test('other providers and tool modes do not get changed',()=>{
 for(const profile of [
  {provider:'sillytavern-openai-compatible',model:'gpt-4o',toolMode:'native'},
  {provider:'sillytavern-openai-compatible',model:'cn:deepseek-v4.1-flash',toolMode:'tagged-json'},
  {provider:'openai-compatible',model:'cn:deepseek-v4.1-flash',toolMode:'native'},
  {provider:'sillytavern-openai-compatible',model:'cn:deepseek-v4.0',toolMode:'native'},
 ]){
  assert.strictEqual(normalizeScenePlannerToolProtocol(profile),profile);
 }
});
test('Draw Planner tagged protocol sends tool instructions as text rather than native tools',()=>{
 const config=normalizeScenePlannerToolProtocol({provider:'sillytavern-openai-compatible',model:'cn:deepseek-v4.1-flash',toolMode:'native'});
 const adapter=new SillyTavernOpenAICompatibleAdapter(config,{
  buildHostChatCompletionGenerateRequest(){throw new Error('no actual network should be used')},
  async createHostChatCompletion(){throw new Error('no actual network should be used')},
  async streamHostChatCompletion(){throw new Error('no actual network should be used')},
 });
 const task={
  systemPrompt:'Generate a scene plan for an adult character.',
  messages:[{role:'user',content:'A person standing in a park'}],
  tools:[{type:'function',function:{name:'submit_scene_plan',description:'Submit one scene plan',parameters:{type:'object',properties:{images:{type:'array'}},required:['images']}}}],
  toolChoice:'required',
  maxTokens:4000,
 };
 const actual=adapter.buildMessages(task);
 assert.ok(actual.some(m=>JSON.stringify(m).includes('submit_scene_plan')));
 const nativeFlag=JSON.stringify(actual).includes('tool_calls');
 assert.equal(nativeFlag,false);
});
