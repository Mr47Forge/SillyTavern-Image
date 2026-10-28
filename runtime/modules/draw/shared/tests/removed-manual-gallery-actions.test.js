import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const read = name => readFileSync(new URL('../'+name, import.meta.url), 'utf8');
const gallery = read('gallery-cache.js');
const cards = read('draw-common.js');
const provider = readFileSync(new URL('../../providers/comfyui/comfy-draw.js', import.meta.url), 'utf8');
const saveUi = read('image-save-ui.js');
const autoSave = read('server-image-autosave.js');
const prepared = read('prepared-chat-images.js');
const recovery = read('image-job-recovery-runtime.js');

test('gallery bottom only offers prompt log and delete, not manual use/save', () => {
    const match = gallery.match(/overlay\.innerHTML = (\x60[^\x60]+\x60);/);
    assert.ok(match, 'gallery HTML template exists');
    const {document} = parseHTML('<div id="root"></div>');
    // The retained gallery markup is a fixed template without interpolated actions.
    const markup = match[1].slice(1,-1);
    const actions = document.createElement('div');
    actions.innerHTML = markup;
    const buttons = [...actions.querySelectorAll('#nd-gallery-actions button')];
    assert.deepEqual(buttons.map(b=>b.id), ['nd-gallery-prompt-log', 'nd-gallery-delete']);
    assert.equal(actions.querySelector('#nd-gallery-use'), null);
    assert.equal(actions.querySelector('#nd-gallery-save'), null);
    assert.ok(actions.querySelector('#nd-gallery-img'));
    assert.ok(actions.querySelector('#nd-gallery-thumbs'));
    assert.ok(actions.querySelector('#nd-gallery-saved-badge'));
});

test('manual use/save event handlers, callbacks and state branches are gone', () => {
    const source = gallery+'\n'+provider+'\n'+cards+'\n'+saveUi;
    for(const term of ['useCurrentGalleryImage','saveCurrentGalleryImage','saveCurrentImage(',
        'IMAGE_SAVE_BUTTON_HTML','IMAGE_SAVE_LABEL_HTML','id="nd-gallery-use"','id="nd-gallery-save"',
        'data-action="save-image"','onUse:', 'onSave:']) {
        assert.equal(source.includes(term),false,'obsolete manual UI symbol '+term);
    }
    assert.doesNotMatch(provider, /getElementById\('nd-gallery-save'\)/);
    assert.doesNotMatch(provider, /querySelector\('\[data-action="save-image"\]'\)/);
});

test('automatic saving, automatic selection, history and recovery remain intact', () => {
    assert.match(provider,/saveComfyImageToServer\(imgId,\s*\{\s*slotId/);
    assert.match(provider,/setSlotSelection\(slotId,\s*imgId\)/);
    assert.match(prepared,/saveComfyImageToServer\(imgId/);
    assert.match(recovery,/saveComfyImageToServer\(/);
    assert.match(gallery,/export async function savePreviewImage\(/);
    assert.match(gallery,/export async function setSlotSelection\(/);
    assert.match(gallery,/function renderGalleryThumbs\(/);
    assert.match(gallery,/async function navigateGallery\(/);
    assert.match(gallery,/async function deleteCurrentGalleryImage\(/);
    assert.match(cards,/IMAGE_SAVING_INDICATOR_HTML/);
    assert.match(saveUi,/export const IMAGE_SAVING_INDICATOR_HTML/);
});
