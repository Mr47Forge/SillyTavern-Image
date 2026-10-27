import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { openPromptImportDialog } from '../prompt-import-ui.js';

const profile = { name: '林安', type: 'woman', basis: '剧情明确', appearanceZh: '30岁成年女性，黑色长发，棕色眼睛。',
    appearance: 'old English face', outfits: [{ name: '白色衬衫', tags: 'old English wardrobe' }],
    dynamicStates: [{ name: '面带微笑', tags: 'old English state' }], excluded: ['画室背景'] };
function setup(t, save) {
    const { document, window } = parseHTML('<html><body></body></html>');
    window.innerHeight = 800;
    Object.assign(globalThis, { document, window });
    t.mock.method(globalThis, 'setInterval', () => 0);
    const overlay = openPromptImportDialog({ save, initialResults: [structuredClone(profile)] });
    t.after(() => overlay.remove());
    const button = [...overlay.querySelectorAll('button')].find(node => node.textContent === '确认并保存角色');
    return { overlay, button, status: overlay.querySelector('[role="status"]') };
}
async function settle() { for (let i = 0; i < 30; i++) await setImmediate(); }

test('story review only exposes editable Chinese facts, without English previews or retired import modes', t => {
    const { overlay } = setup(t, async () => '已保存');
    assert.match(overlay.textContent, /从当前剧情生成角色/);
    assert.doesNotMatch(overlay.textContent, /旧版英文|英文绘图词|AI 识别并分类|从图片生成/);
    const values = [...overlay.querySelectorAll('textarea')].map(node => node.value);
    assert.ok(values.includes(profile.appearanceZh));
    assert.ok(values.includes('白色衬衫'));
    assert.ok(values.includes('面带微笑'));
    assert.ok(values.every(value => !value.includes('old English')));
});

test('one confirmation click saves only reviewed Chinese facts and does not submit twice while busy', async t => {
    const gate = Promise.withResolvers();
    const calls = [];
    const { button, status } = setup(t, async (...args) => { calls.push(args); await gate.promise; return '保存成功'; });
    button.click(); button.click();
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(button.disabled, true);
    assert.equal(calls[0][0][0].appearance, '');
    assert.deepEqual(calls[0][0][0].outfits, [{ name: '白色衬衫', tags: '' }]);
    gate.resolve(); await settle();
    assert.equal(status.textContent, '保存成功');
    assert.equal(button.hidden, true);
});

test('a real save failure stays inline and keeps the editable review for retry', async t => {
    const { overlay, button, status } = setup(t, async () => { throw new Error('当前资料尚未保存'); });
    button.click(); await settle();
    assert.match(status.textContent, /没有写入角色库.*未保存/);
    assert.equal(button.disabled, false);
    assert.equal(button.hidden, false);
    assert.ok([...overlay.querySelectorAll('textarea')].some(node => node.value === profile.appearanceZh));
});

test('empty extraction results cannot create a stray review popup', t => {
    const { document, window } = parseHTML('<html><body></body></html>');
    Object.assign(globalThis, { document, window });
    assert.throws(() => openPromptImportDialog({ save() {}, initialResults: [] }), /没有可核对/);
    assert.equal(document.querySelector('#lwb-comfy-ai-prompt-dialog'), null);
});
