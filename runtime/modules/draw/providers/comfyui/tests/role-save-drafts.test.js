import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as library from '../../../shared/character-library.js';
import { buildAiPromptCharacters } from '../prompt-import.js';
import { mergeImportedCharacters, parseImportedCharacters } from '../character-import.js';
import { openPromptImportDialog } from '../prompt-import-ui.js';
import { parseHTML } from 'linkedom';
import { setImmediate } from 'node:timers/promises';

const source = fs.readFileSync(new URL('../comfy-draw.js', import.meta.url), 'utf8');
const role = { id: 'saved', name: '林安', appearanceZh: '30岁成年女性，黑色长发，棕色眼睛。',
    appearance: '', appearanceSource: 'chinese', type: 'woman', aliases: [], outfits: [], dynamicStates: [], negativeTags: '' };
const incoming = { name: '张青', type: 'woman', appearanceZh: '32岁成年女性，短发，圆脸。',
    appearance: '', outfits: [{ name: '白色衬衫', tags: '' }], dynamicStates: [], aliases: [], excluded: [] };
const start = source.indexOf('async function savePastedCharacterPrompts(');
const end = source.indexOf('async function importCharactersFromCurrentTavern(', start);
const saveFunction = source.slice(start, end).trim();

function environment(edit = () => {}, initial = [role]) {
    const saved = { characters: structuredClone(initial), groups: [{ id: 'g', name: '人物组' }] };
    let draft = structuredClone(saved), writes = 0, confirmations = 0;
    edit(draft);
    const ui = { getLibrary: () => structuredClone(draft), render: next => { draft = structuredClone(next); } };
    const env = { ...library, buildAiPromptCharacters, mergeImportedCharacters,
        ensureCharacterLibraryUi: () => ui,
        getSharedDrawSettings: () => ({ characterTags: saved.characters, characterGroups: saved.groups }),
        askConfirmDialog: async () => { confirmations++; return true; },
        saveSharedDrawSettings: async () => { writes++; return true; }, refreshSettingsSummary() {} };
    const save = (...args) => new Function(...Object.keys(env), 'return (' + saveFunction + ')(...arguments[arguments.length-1]);')
        (...Object.values(env), args);
    return { save, saved, get draft() { return draft; }, get writes() { return writes; }, get confirmations() { return confirmations; } };
}

test('an unchanged saved Chinese-only library imports without a false unsaved warning or second confirmation', async () => {
    const h = environment();
    await h.save([incoming]);
    assert.equal(h.writes, 1);
    assert.equal(h.confirmations, 0, 'the review save button is already the user confirmation');
    assert.equal(h.draft.characters[0].appearanceZh, role.appearanceZh);
    assert.equal(h.draft.characters[1].appearanceZh, incoming.appearanceZh);
});

test('unchanged defaults and an empty English field are not edits', async () => {
    const h = environment(draft => {
        draft.characters[0].enabled = true;
        draft.characters[0].danbooruTag = '';
    });
    await h.save([incoming]);
    assert.equal(h.writes, 1);
    assert.equal(h.confirmations, 0);
});

for (const [name, edit] of [
    ['Chinese appearance', d => { d.characters[0].appearanceZh = '改成短发'; }],
    ['role name', d => { d.characters[0].name = '新姓名'; }],
    ['role negative tags', d => { d.characters[0].negativeTags = '额外人物'; }],
    ['wardrobe', d => { d.characters[0].outfits.push({ name: '蓝色长裙', tags: '' }); }],
    ['dynamic state', d => { d.characters[0].dynamicStates.push({ name: '右手拿画笔', tags: '' }); }],
    ['enabled state', d => { d.characters[0].enabled = false; }],
    ['group switch', d => { d.groups[0].enabled = false; }],
    ['group name', d => { d.groups[0].name = '新分组名'; }],
]) test(`actual unsaved ${name} cannot be silently committed by importing another role`, async () => {
    const h = environment(edit, [{ ...role, appearance: 'legacy face' }]);
    const before = structuredClone(h.draft);
    await assert.rejects(h.save([incoming]), /未保存/);
    assert.equal(h.writes, 0);
    assert.equal(h.confirmations, 0);
    assert.deepEqual(h.draft, before);
});

test('a Chinese-only extraction result keeps wardrobe and state without needing an English pair', () => {
    const result = parseImportedCharacters(JSON.stringify({ characters: [{ ...incoming,
        dynamicStates: [{ name: '面带微笑', tags: '' }] }] }));
    assert.equal(result[0].appearanceZh, incoming.appearanceZh);
    assert.equal(result[0].appearanceSource, 'chinese');
    assert.deepEqual(result[0].outfits, [{ name: '白色衬衫', tags: '' }]);
    assert.deepEqual(result[0].dynamicStates, [{ name: '面带微笑', tags: '' }]);
});

for (const changed of [false, true]) test(`review click uses actual saved-library comparison, with changes: ${changed}`, async t => {
    const h = environment(draft => { if (changed) draft.characters[0].name = '尚未保存的新名字'; });
    const { document, window } = parseHTML('<html><body></body></html>');
    Object.assign(globalThis, { document, window });
    t.mock.method(globalThis, 'setInterval', () => 0);
    const overlay = openPromptImportDialog({ save: h.save, initialResults: [structuredClone(incoming)] });
    t.after(() => overlay.remove());
    [...overlay.querySelectorAll('button')].find(node => node.textContent === '确认并保存角色').click();
    for (let i = 0; i < 30; i++) await setImmediate();
    assert.equal(h.confirmations, 0, 'the explicit review button never opens a second confirmation');
    assert.equal(h.writes, changed ? 0 : 1);
    assert.equal(document.querySelectorAll('#lwb-comfy-ai-prompt-dialog').length, 1);
    const status = overlay.querySelector('[role="status"]').textContent;
    if (changed) assert.match(status, /确实有未保存修改/);
    else assert.match(status, /保存成功/);
});
