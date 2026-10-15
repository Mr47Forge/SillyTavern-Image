import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDrawAgentProviderConfig } from '../draw-agent.js';

function makeSettings(name, model, toolMode) {
    return {
        currentPresetName: name,
        presets: {
            [name]: {
                provider: 'openai-compatible',
                modelConfigs: {
                    'openai-compatible': {
                        model, toolMode, baseUrl: 'http://127.0.0.1:7863/v1',
                        apiKey: '', maxTokens: 1024
                    }
                }
            }
        }
    };
}
async function read(name, model, mode) {
    return (await resolveDrawAgentProviderConfig({
        dependencies: { getAgentSettings: () => makeSettings(name, model, mode) }
    })).providerConfig;
}
test('仅场景规划的 WorkBuddy V4.1 使用原生工具', async () => {
    assert.equal((await read('workbuddy','cn:deepseek-v4.1-flash','tagged-json')).toolMode,'native');
});
test('其他共享预设仍保留原工具模式', async () => {
    assert.equal((await read('other','cn:deepseek-v4.1-flash','tagged-json')).toolMode,'tagged-json');
});
test('WorkBuddy 使用其他模型时不覆盖原模式', async () => {
    assert.equal((await read('workbuddy','other-model','tagged-json')).toolMode,'tagged-json');
});

test('当前实际保存的 WorkBuddy 预设在绘图时转换为原生工具，且原配置不被修改', async () => {
    const stored = JSON.parse(readFileSync('/home/node/app/data/default-user/user/files/LittleWhiteBox_Assistant.json', 'utf8')).settings;
    assert.equal(stored.currentPresetName, 'workbuddy');
    const original = stored.presets.workbuddy.modelConfigs['openai-compatible'].toolMode;
    assert.equal(original, 'tagged-json');
    const result = await resolveDrawAgentProviderConfig({ dependencies: { getAgentSettings: () => stored } });
    assert.equal(result.providerConfig.toolMode, 'native');
    assert.equal(stored.presets.workbuddy.modelConfigs['openai-compatible'].toolMode, 'tagged-json');
});
