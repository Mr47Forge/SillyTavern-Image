import test from 'node:test';
import assert from 'node:assert/strict';
import {isClearScenePlannerRefusal, parseSubmittedScenePlan, getScenePlannerErrorCategory, ScenePlannerErrorCategory} from '../scene-plan-contract.js';
import {isRetryablePlannerError} from '../planner-retry.js';
test('explicit refusal is distinguished from missing tool and does not get retried', () => {
    for (const text of [
        '这组插图我无法按现状生成。',
        '我仍然不能提交这份图片计划，这不是协议问题，而是内容边界问题。',
        'Sorry, I cannot generate this image.',
    ]) {
        assert.equal(isClearScenePlannerRefusal(text), true);
        assert.throws(() => parseSubmittedScenePlan({toolCalls:[],text}), error => {
            assert.equal(error.code, 'MODEL_OUTPUT_REFUSED');
            assert.equal(getScenePlannerErrorCategory(error), ScenePlannerErrorCategory.PROMPT);
            assert.equal(isRetryablePlannerError(error),false);
            assert.match(error.message,/不是工具调用故障/);
            return true;
        });
    }
});
test('normal missing tool does not get incorrectly labeled as refusal', () => {
    for (const text of ['正在构思画面。', '准备提交计划。', '', 'The images array must be valid.']) {
        assert.equal(isClearScenePlannerRefusal(text), false);
        assert.throws(() => parseSubmittedScenePlan({toolCalls:[],text}), e=>e.code==='TOOL_CALL_MISSING');
    }
});
