import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const floating = readFileSync(new URL('../../providers/comfyui/floating-panel.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../providers/comfyui/comfy-draw.js', import.meta.url), 'utf8');
function definition(source, name) {
    const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `missing function ${name}`);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:export )?(?:async )?function /u);
    return (end < 0 ? rest : rest.slice(0, end + 1)).replace(/^export /u, '');
}
function fixture(mode = 'custom') {
    const { document } = parseHTML('<html><body></body></html>');
    const workflows = ['a', 'b'].map(id => ({ id: `workflow-${id}`, name: `工作流${id}`,
        json: JSON.stringify({ [id]: { class_type: 'CLIPTextEncode', inputs: { text: id } } }),
        nodePositive: `${id}-positive`, nodeNegative: `${id}-negative`, nodeWidth: `${id}-width`,
        nodeHeight: `${id}-height`, nodeSeed: `${id}-seed`, nodeSaveImage: `${id}-save` }));
    const initial = { mode: 'auto', workflowMode: mode, selectedWorkflowPresetId: 'workflow-a',
        workflowPresets: workflows, customWorkflow: structuredClone(workflows[0]),
        presets: [{ id: 'parameters', name: '参数预设', width: 768, height: 1152,
            positivePrefix: '用户正向', negativePrefix: '用户负向' }], selectedPresetId: 'parameters',
        promptPresets: [{ id: 'rules', name: '用户规则', topSystem: '保留首段',
            tagGuideContent: '保留指南', sceneRules: '保留场景规则', fieldDescriptions: '' }],
        selectedPromptPresetId: 'rules', overrideSize: 'default' };
    const stored = [], notices = [];
    const ctx = { document, console, structuredClone, settingsLoaded: true, settingsCache: initial,
        cloneSettingsObject: structuredClone, panelMap: new Map(), floatingCache: {}, failSave: false,
        SIZE_OPTIONS: [{ value: 'default', label: '跟随预设' }],
        getSettings: () => ctx.settingsCache,
        showSettingsNotice(message, kind) { notices.push({ message, kind }); }, toastr: { warning() {} },
        SERVER_FILE_KEY: 'config', ComfyDrawStorage: { setAndSave: async (_key, value) => {
            if (ctx.failSave) return false;
            stored.push(structuredClone(value)); return true;
        } },
        normalizePresets: value => value, normalizeWorkflowPresets: value => value,
        BUILTIN_WORKFLOWS: [], DEFAULT_COMFY_DRAW_SETTINGS: { timeout: 120000 },
        normalizeNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        getPromptPresetDefaults: () => ({}), createDefaultWorkflowPreset: () => ({}),
        DEFAULT_PROMPT_CONFIG: {},
    };
    vm.createContext(ctx);
    vm.runInContext(['normalizeSettings', 'persistSettings', 'updateSettingsPersistent']
        .map(name => definition(main, name)).join('\n'), ctx);
    vm.runInContext(['createEl', 'fillPresetSelect', 'fillSizeSelect', 'createMenu',
        'persistQuickSetting', 'setQuickPreset', 'updateAllPresetSelects']
        .map(name => definition(floating, name)).join('\n'), ctx);
    const floorMenu = ctx.createMenu(true), floatingMenu = ctx.createMenu(true);
    const floorSelect = floorMenu.querySelector('.nd-preset-select');
    const floatingSelect = floatingMenu.querySelector('.nd-preset-select');
    ctx.panelMap.set(1, { cache: { presetSelect: floorSelect } });
    ctx.floatingCache = { presetSelect: floatingSelect };
    return { ctx, stored, notices, workflows, initial: structuredClone(initial), floorMenu, floorSelect, floatingSelect };
}

test('fixture executes the real settings normalization and persistence path', async () => {
    const { ctx, stored, notices } = fixture();
    assert.equal(await ctx.updateSettingsPersistent(() => {}), true, JSON.stringify(notices));
    assert.equal(stored.length, 1);
});

test('quick menu exposes saved workflows instead of drawing parameter presets', () => {
    const { floorMenu, floorSelect } = fixture();
    assert.equal(floorMenu.querySelector('.nd-label').textContent, '工作流');
    assert.equal(floorSelect.getAttribute('aria-label'), '工作流');
    assert.deepEqual(Array.from(floorSelect.options, item => item.value), ['workflow-a', 'workflow-b']);
    assert.equal(floorSelect.value, 'workflow-a');
});

test('simple mode does not falsely display a custom workflow as active', () => {
    const { floorSelect } = fixture('simple');
    assert.equal(floorSelect.value, '');
    assert.equal(floorSelect.options[0].textContent, '选择工作流');
    assert.equal(floorSelect.options[0].disabled, true);
    assert.equal(floorSelect.disabled, false);
});

for (const mode of ['custom', 'simple']) test(`quick workflow switch persists complete graph and mappings from ${mode} mode`, async () => {
    const { ctx, stored, workflows, initial, floorSelect, floatingSelect } = fixture(mode);
    assert.equal(await ctx.setQuickPreset('workflow-b'), true);
    assert.equal(stored.length, 1);
    const saved = stored[0];
    assert.equal(saved.workflowMode, 'custom');
    assert.equal(saved.selectedWorkflowPresetId, 'workflow-b');
    for (const key of ['json', 'nodePositive', 'nodeNegative', 'nodeWidth', 'nodeHeight', 'nodeSeed', 'nodeSaveImage']) {
        assert.equal(saved.customWorkflow[key], workflows[1][key], key);
    }
    assert.equal(saved.selectedPresetId, initial.selectedPresetId);
    assert.deepEqual(saved.presets, initial.presets);
    assert.deepEqual(saved.promptPresets, initial.promptPresets);
    assert.equal(floorSelect.value, 'workflow-b');
    assert.equal(floatingSelect.value, 'workflow-b');
});

test('failed workflow persistence restores the visible selection and saved state', async () => {
    const { ctx, stored, initial, floatingSelect } = fixture();
    floatingSelect.options[0].selected = false;
    floatingSelect.options[1].selected = true;
    ctx.failSave = true;
    assert.equal(await ctx.setQuickPreset('workflow-b'), false);
    assert.deepEqual(ctx.settingsCache, initial);
    assert.equal(stored.length, 0);
    assert.equal(floatingSelect.value, 'workflow-a');
});

test('a deleted workflow cannot silently replace the active workflow', async () => {
    const { ctx, stored, initial, floorSelect } = fixture();
    assert.equal(await ctx.setQuickPreset('deleted-workflow'), false);
    assert.equal(stored.length, 0);
    assert.deepEqual(ctx.settingsCache, initial);
    assert.equal(floorSelect.value, 'workflow-a');
});

test('empty workflow list has a disabled Chinese empty state', () => {
    const { ctx, floorSelect } = fixture();
    ctx.settingsCache.workflowPresets = [];
    ctx.fillPresetSelect(floorSelect);
    assert.equal(floorSelect.disabled, true);
    assert.equal(floorSelect.options[0].textContent, '暂无已保存工作流');
});
