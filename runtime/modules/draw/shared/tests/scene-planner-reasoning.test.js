import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenePlannerReasoning } from '../scene-planner.js';

const chosen={provider:'openai-compatible',model:'cn:deepseek-v4-flash',
    maxTokens:8192,reasoning:{mode:'inherit',effort:'high',output:'hide'}};

test('DeepSeek V4 Flash draw planner uses low effort without changing global preset',()=>{
    const result=normalizeScenePlannerReasoning(chosen);
    assert.equal(result.reasoning.mode,'on');
    assert.equal(result.reasoning.effort,'low');
    assert.equal(result.maxTokens,8192);
    assert.equal(chosen.reasoning.mode,'inherit');
    assert.equal(chosen.reasoning.effort,'high');
    assert.equal(result.reasoning.output,'hide');
});
test('other models and providers retain original reasoning config',()=>{
    for(const value of [
      {...chosen,model:'cn:deepseek-v4.1-flash'},
      {...chosen,model:'cn:glm-5.2'},
      {...chosen,provider:'sillytavern-openai-compatible'},
    ]) {
      assert.equal(normalizeScenePlannerReasoning(value),value);
    }
});
test('explicit reasoning-off setting is respected',()=>{
    const off={...chosen,reasoning:{mode:'off',effort:'high'}};
    assert.equal(normalizeScenePlannerReasoning(off),off);
});
