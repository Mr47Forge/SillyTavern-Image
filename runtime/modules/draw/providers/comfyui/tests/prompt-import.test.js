import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPromptCharacters, resolveAiOutputBudgets } from '../prompt-import.js';

test('reviewed story profiles save Chinese facts without stale English copies', () => {
    const input = [{ name: '林安', type: 'woman', appearanceZh: '30岁成年女性，黑色长发。',
        appearance: 'stale red hair', negativeTags: 'old exclusions',
        outfits: [{ name: '白色衬衫', tags: 'old black dress' }], dynamicStates: [{ name: '面带微笑', tags: 'old crying' }] }];
    const before = structuredClone(input);
    const [role] = buildAiPromptCharacters(input);
    assert.equal(role.appearanceZh, input[0].appearanceZh);
    assert.equal(role.appearanceSource, 'chinese');
    assert.equal(role.appearance, '');
    assert.equal(role.negativeTags, '');
    assert.deepEqual(role.outfits, [{ name: '白色衬衫', tags: '' }]);
    assert.deepEqual(role.dynamicStates, [{ name: '面带微笑', tags: '' }]);
    assert.deepEqual(input, before);
});

test('review requires the selected person name and a Chinese profile', () => {
    assert.throws(() => buildAiPromptCharacters([{ name: '', appearanceZh: '黑色长发' }]), /名称/);
    assert.throws(() => buildAiPromptCharacters([{ name: '林安', appearanceZh: '' }]), /中文/);
    assert.throws(() => buildAiPromptCharacters([{ name: '林安', appearanceZh: 'long hair' }]), /中文/);
});

test('story extraction stays within the current host model output budget', () => {
    assert.deepEqual(resolveAiOutputBudgets({ maxTokens: 2048 }), { initial: 2048, retry: 2048 });
    assert.deepEqual(resolveAiOutputBudgets({ maxTokens: 32768 }), { initial: 8192, retry: 16384 });
    assert.deepEqual(resolveAiOutputBudgets(), { initial: 8192, retry: 8192 });
});
