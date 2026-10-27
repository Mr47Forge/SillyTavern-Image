import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describeCharacterSaveError } from '../character-save-errors.js';
import { setImmediate } from 'node:timers/promises';

const source = readFileSync(new URL('../comfy-draw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../comfy-draw.html', import.meta.url), 'utf8');
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing section ${start}`);
    return source.slice(from, to);
}
function bind(code, env) {
    return new Function(...Object.keys(env), `return (${code.trim()});`)(...Object.values(env));
}
function harness() {
    const { document } = parseHTML(html);
    const notices = [], statuses = [], saveBtnStates = new WeakMap();
    const env = {
        saveBtnStates, describeCharacterSaveError,
        setSavingState(button) { if (button) { button.disabled = true; saveBtnStates.set(button, true); } },
        handleSaveResult(ok, button) { if (button) { button.disabled = false; saveBtnStates.delete(button); } },
        updateStatusText: (...args) => statuses.push(args),
        showSettingsNotice: (...args) => notices.push(args),
        toastr: { success: (...args) => notices.push(['old-toast', ...args]), error: (...args) => notices.push(['old-toast', ...args]) },
        refreshSettingsSummary() {}, console: { warn() {} },
    };
    return { document, notices, statuses, env,
        run: bind(section('async function runSaveButtonTask(', 'function setSavingState('), env) };
}

test('manual saves show one popup on completion and clear inline save notices', async () => {
    const h = harness();
    const button = h.document.querySelector('[data-comfy-save-shared]');
    const gate = Promise.withResolvers();
    const work = h.run(button, () => gate.promise, { statusElementId: 'status', successText: '角色已保存' });
    await setImmediate();
    assert.equal(button.disabled, true);
    assert.equal(h.notices.length, 0, 'no success before storage confirms the write');
    gate.resolve(true);
    assert.equal(await work, true);
    assert.equal(button.disabled, false);
    assert.deepEqual(h.notices, [['角色已保存', 'success']]);
    assert.deepEqual(h.statuses.at(-1), ['status', '', '']);
});

test('save failure shows one actionable popup and preserves retry', async () => {
    const h = harness();
    const button = h.document.querySelector('[data-comfy-save-shared]');
    const ok = await h.run(button, () => { throw Object.assign(new Error('conflict'), { code: 'STORAGE_VERSION_CONFLICT' }); }, {
        statusElementId: 'status', errorText: '当前角色保存失败', showErrorDetails: true,
    });
    assert.equal(ok, false);
    assert.equal(button.disabled, false);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0][0], /未覆盖.*刷新/);
    assert.equal(h.notices[0][1], 'error');
});

test('a duplicate click cannot queue a second write or popup', async () => {
    const h = harness(), gate = Promise.withResolvers();
    const button = h.document.querySelector('[data-comfy-save-shared]');
    let writes = 0;
    const task = () => { writes++; return gate.promise; };
    const first = h.run(button, task);
    const second = h.run(button, task);
    gate.resolve(true); await Promise.all([first, second]);
    assert.equal(writes, 1);
    assert.equal(h.notices.length, 1);
});

test('silent internal saves do not open a success popup', async () => {
    const h = harness();
    assert.equal(await h.run(null, () => true, { notify: false }), true);
    assert.equal(h.notices.length, 0);
});

test('a partial configuration save reports the actual stage once', async () => {
    const h = harness();
    const save = bind(section('async function saveAllSettings(', 'function addCharacterTagDraft('), {
        ...h.env, runSaveButtonTask: h.run,
        saveSharedDrawSettings: async () => true,
        readForm: () => ({}), persistSettings: async () => false,
    });
    const button = h.document.querySelector('[data-comfy-save-shared]');
    assert.equal(await save({ triggerButton: button, notify: true }), false);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0][0], /角色设置已保存.*配置.*失败/);
});

test('save notice disappears automatically, has no confirmation and escapes its text', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const calls = [];
    const toastr = { options: { timeOut: 9000 }, error: (...args) => calls.push(args) };
    const show = bind(section('function showSettingsNotice(', '// 自定义输入对话框'), {
        document, toastr, console,
    });
    show('<img src=x onerror=alert(1)>', 'error');
    assert.equal(calls.length, 1);
    const [message, title, options] = calls[0];
    assert.equal(message, '<img src=x onerror=alert(1)>');
    assert.equal(title, undefined);
    assert.equal(options.closeButton, false);
    assert.equal(options.escapeHtml, true);
    assert.ok(options.timeOut > 0 && options.timeOut <= 5000);
    assert.notEqual(options.containerId, 'toast-container');
    assert.equal(document.querySelector('dialog,button,img'), null);
    assert.deepEqual(toastr.options, { timeOut: 9000 }, 'other plugins keep their notification options');
});

test('character actions share one area and the header contains the live total', () => {
    const h = harness(), doc = h.document;
    const actions = doc.querySelector('.char-management-actions');
    assert.ok(actions, 'one shared actions area above the list');
    for (const id of ['comfy-shared-char-add', 'comfy-shared-char-export', 'comfy-shared-char-import',
        'comfy-role-collapse-all', 'comfy-role-expand-all']) {
        assert.ok(actions.contains(doc.getElementById(id)), id);
    }
    assert.ok(actions.querySelector('[data-comfy-save-shared]'));
    assert.equal(doc.querySelector('#comfy-draw-summary-preset'), null);
    assert.equal(doc.querySelector('#comfy-group-preset-root'), null);
    assert.equal(doc.querySelector('#comfy-import-from-chat'), null);
    assert.equal(doc.querySelector('#comfy-shared-character-toolbar'), null);
    assert.equal(doc.querySelector('.char-summary-grid'), null);
    assert.equal(doc.querySelector('#comfy-role-save-status'), null);
    const counter = doc.querySelector('.char-list-card-header #comfy-draw-character-result-count');
    assert.ok(counter);
    let count = 4;
    const refresh = bind(section('function refreshSettingsSummary(', 'function setValue('), {
        getSettings: () => ({}), getActivePreset: () => ({}),
        getSharedDrawSettings: () => ({ characterTags: [] }),
        characterLibraryUi: { isRendered: () => true, getCardCount: () => count },
        querySettings: selector => doc.querySelector(selector),
    });
    refresh(); assert.match(counter.textContent, /共\s*4\s*名角色/);
    count = 3; refresh(); assert.match(counter.textContent, /共\s*3\s*名角色/);
});
