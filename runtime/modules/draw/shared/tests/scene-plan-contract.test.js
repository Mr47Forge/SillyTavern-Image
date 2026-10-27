import test from 'node:test';
import assert from 'node:assert/strict';
import {ScenePlannerError,ScenePlannerErrorCategory,getScenePlannerErrorCategory,toSceneCharacterPromptTag} from '../scene-plan-contract.js';

test('scene planner errors expose stable failure categories', () => {
    const cases = [
        ['EMPTY_MESSAGE', ScenePlannerErrorCategory.INPUT],
        ['NO_INSERT_POINTS', ScenePlannerErrorCategory.INPUT],
        ['IMAGE_LIMIT_EXCEEDED', ScenePlannerErrorCategory.INPUT],
        ['MODEL_MISSING', ScenePlannerErrorCategory.AGENT_CONFIG],
        ['HOST_REQUEST_HEADERS_LOAD_FAILED', ScenePlannerErrorCategory.AGENT_CONFIG],
        ['TOOL_CALL_MISSING', ScenePlannerErrorCategory.TOOL_PROTOCOL],
        ['TAGGED_TOOL_CALL_INVALID', ScenePlannerErrorCategory.TOOL_PROTOCOL],
        ['TOOL_ARGUMENTS_SCHEMA_INVALID', ScenePlannerErrorCategory.SCHEMA],
        ['REQUEST_TIMEOUT', ScenePlannerErrorCategory.TIMEOUT],
        ['REQUEST_ABORTED', ScenePlannerErrorCategory.ABORTED],
        ['PROVIDER_REQUEST_FAILED', ScenePlannerErrorCategory.PROVIDER],
    ];
    for (const [code, expected] of cases) {
        assert.equal(getScenePlannerErrorCategory(new ScenePlannerError('test', code)), expected);
    }
    assert.equal(getScenePlannerErrorCategory(new Error('test')), null);
});

test('scene planner reports prompt expansion failures as their own category', () => {
    assert.equal(
        getScenePlannerErrorCategory(new ScenePlannerError('test', 'PROMPT_EXPANSION_FAILED')),
        ScenePlannerErrorCategory.PROMPT,
    );
});

test('current character prompt conversion preserves multilingual types and canonical no-humans tag',()=>{
 assert.equal(toSceneCharacterPromptTag('no_humans'),'no humans');
 assert.equal(toSceneCharacterPromptTag('  成年女画家  '),'成年女画家');
 assert.equal(toSceneCharacterPromptTag('adult woman'),'adult woman');
 assert.equal(toSceneCharacterPromptTag(null),'');
});
