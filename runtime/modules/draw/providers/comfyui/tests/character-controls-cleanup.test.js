import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { createCharacterLibraryUi } from '../../../shared/character-library-ui.js';
import { normalizeSharedDrawSettings } from '../../../shared/draw-settings.js';
import { openCharacterImportDialog, openCharacterExportDialog } from '../../../shared/character-library-dialog.js';
import { parseCharacterImport } from '../../../shared/character-library.js';

test('retired preset implementation and startup watcher are removed', () => {
    for (const name of ['character-group-presets.js', 'character-group-presets-ui.js',
        'character-group-presets-ui.css', 'character-group-presets-runtime.js', 'character-group-presets-draft-binding.js']) {
        assert.equal(existsSync(new URL('../../../shared/' + name, import.meta.url)), false, name);
    }
    for (const path of ['../../../../../../extension/entry.js', '../comfy-draw.js']) {
        const text = readFileSync(new URL(path, import.meta.url), 'utf8');
        assert.doesNotMatch(text, /GroupPreset|groupPreset|group-presets/);
    }
});

test('roles retain their old groups without creation or multi-selection controls', () => {
    const { document } = parseHTML('<html><body><div id="roles"></div></body></html>');
    const library = { groups: [{ id: 'g', name: '已存分组', enabled: false }],
        characters: [{ id: 'c', name: '林安', groupId: 'g', appearanceZh: '黑色长发', enabled: true }] };
    const ui = createCharacterLibraryUi({ document, listElement: document.getElementById('roles'),
        readCharacters: () => structuredClone(library.characters), renderEmpty: () => document.createElement('p'),
        renderCard({ character }) {
            const card = document.createElement('div'); card.className = 'sd-char-card';
            card.dataset.characterId = character.id;
            card.innerHTML = '<div class="sd-char-card-header"><div class="sd-char-card-title"></div><div class="btn-group"></div></div>';
            return card;
        },
    });
    ui.render(library);
    assert.equal(document.querySelector('[data-role="group-add"],[data-role="select-toggle"],[data-batch],.lwb-cl-select,.lwb-cl-group-select'), null);
    assert.equal(ui.getCardCount(), 1);
    assert.deepEqual(ui.getLibrary(), library);
    assert.equal(ui.getSelectedIds, undefined);
    assert.equal(ui.isSelectMode, undefined);
    ui.destroy();
});

test('retired preset configuration is not reintroduced while role data survives', () => {
    const result = normalizeSharedDrawSettings({ characterGroups: [{ id: 'g', name: '旧分组', enabled: false }],
        characterTags: [{ id: 'c', name: '林安', groupId: 'g', appearanceZh: '黑色长发' }],
        characterGroupPresets: [{ id: 'p', groupStates: { g: true } }], characterGroupPresetApplied: { presetId: 'p' } });
    assert.equal('characterGroupPresets' in result, false);
    assert.equal('characterGroupPresetApplied' in result, false);
    assert.equal(result.characterGroups[0].enabled, false);
    assert.equal(result.characterTags[0].appearanceZh, '黑色长发');
});

test('import and export dialogs do not retain removed creation or selection controls', t => {
    const { document } = parseHTML('<html><body></body></html>');
    const library = { groups: [], characters: [{ id: 'c', name: '林安' }] };
    const input = openCharacterImportDialog({ document, library, parsed: parseCharacterImport({ type: 'novel-draw-characters', version: 4, characters: [{ name: '新角色' }] }) });
    t.after(() => input.close());
    assert.equal(input.element.querySelector('[data-role="new-group-name"]'), null);
    input.close();
    const output = openCharacterExportDialog({ document, library });
    t.after(() => output.close());
    assert.equal(output.element.querySelector('[data-role="scope-selection"]'), null);
    output.close();
});
