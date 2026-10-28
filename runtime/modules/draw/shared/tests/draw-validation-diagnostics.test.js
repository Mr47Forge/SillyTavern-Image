import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../providers/comfyui/comfy-draw.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function buildTasksFromMessage('),
    source.indexOf('\nfunction buildTextSourceGalleryMeta('));

function setup({ rejectAll = false, loggerFails = false, emitMismatch = true, emitRejection = true, visibleText = null } = {}) {
    const message = { mes: 'Adult painter enters studio.', is_user: false };
    const ctx = { chatId: 'fixture-chat', chat: [message] };
    const logged = [], warnings = [], attempted = [];
    const env = {
        console: { error: () => {}, warn: () => {} },
        getSettings: () => ({}),
        getSharedDrawSettings: () => ({}),
        characterLibraryFromSettings: () => [],
        selectEnabledCharacters: () => [],
        getContext: () => ctx,
        readHostVisibleNarrative: () => visibleText,
        getActiveDrawingWorldbook: async () => '',
        readDirectDrawDirectives: () => Array.from({ length: 4 }, (_, i) => ({ prompt: 'scene ' + i })),
        getActivePreset: () => ({ maxImages: 4 }),
        buildWardrobeLedger: () => [],
        buildRecentAppearanceLedger: () => [],
        DEFAULT_MESSAGE_FILTER_RULES: [],
        globalThis: { toastr: { warning: (body, title) => warnings.push({ body, title }) } },
        writeImageError: async info => {
            attempted.push(info);
            if (loggerFails) throw new Error('diagnostic persistence unavailable');
            logged.push(info);
        },
        buildDirectDrawTasks: (_, __, options) => {
            assert.equal(options.skipInvalidImages, true);
            assert.equal(options.requireFemaleImage, true);
            assert.equal(options.hostVisibleText,visibleText);
            if (emitRejection) options.onImageRejected({ image: 3, message: 'scene anchor not found' });
            if (emitMismatch) options.onCountMismatch({ expected: 4, received: 3 });
            if (rejectAll) throw new Error('no valid image instructions');
            return [{ scene: 'working image', imageIndex: 0 }];
        },
    };
    vm.runInNewContext(code + '\nthis.buildTasksFromMessage = buildTasksFromMessage;', env);
    const run = () => env.buildTasksFromMessage({ message, signal: new AbortController().signal });
    return { run, logged, attempted, warnings };
}

test('provider passes SillyTavern rendered visible text to image task placement', async () => {
    const fixture=setup({visibleText:'reader-visible paragraph',emitMismatch:false,emitRejection:false});
    const result=await fixture.run();
    assert.equal(result.tasks.length,1);
    assert.equal(fixture.logged.length,0);
});

test('partial image rejection logs the exact popup reason with image index and chat target', async () => {
    const f = setup();
    const outcome = await f.run();
    assert.equal(outcome.tasks.length, 1, 'the remaining valid image is submitted');
    assert.equal(f.warnings.length, 2);
    assert.equal(f.logged.length, 2);
    assert.equal(f.logged[0].errorType, 'DRAW_IMAGE_REJECTED');
    assert.match(f.logged[0].errorMessage, /第 3 张.*scene anchor not found/);
    assert.equal(f.logged[0].errorMessage, f.warnings[0].body);
    assert.equal(f.logged[1].errorType, 'DRAW_IMAGE_COUNT_MISMATCH');
    assert.equal(f.logged[1].errorMessage, f.warnings[1].body);
    for (const row of f.logged) {
        assert.equal(row.chatId, 'fixture-chat');
        assert.equal(row.messageId, '0');
        assert.equal(row.provider, 'ComfyUI');
        assert.equal(row.source, 'draw-validation');
    }
});
test('individual error is saved even if every image is rejected', async () => {
    const f = setup({ rejectAll: true, emitMismatch: false });
    await assert.rejects(f.run(), /no valid image instructions/);
    assert.equal(f.logged.length, 1);
    assert.equal(f.logged[0].errorType, 'DRAW_IMAGE_REJECTED');
});
test('diagnostic transport failure never cancels remaining valid images', async () => {
    const f = setup({ loggerFails: true });
    const outcome = await f.run();
    assert.equal(outcome.tasks.length, 1);
    assert.equal(f.attempted.length, 2);
    assert.equal(f.warnings.length, 2);
});
test('successful validation adds no false error log', async () => {
    const f = setup({ emitMismatch: false, emitRejection: false });
    assert.equal((await f.run()).tasks.length, 1);
    assert.equal(f.logged.length, 0);
    assert.equal(f.warnings.length, 0);
});
