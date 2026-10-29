import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import showdown from 'showdown';

// Real markup, gallery transactions, chat save/readback, executor and UI. Only
// SillyTavern boundaries and image-provider responses are simulated; no paid API.
const host = { ctx: null, events: new Map(), afterAi: null, errors: [] };
host.emit = async (key, ...args) => { for (const fn of host.events.get(key) || []) await fn(...args); };
globalThis.__chatImageSlotsTest = host;
globalThis.indexedDB = indexedDB;
globalThis.BroadcastChannel = undefined;
const markdown = new showdown.Converter({ simpleLineBreaks: true, tables: true });
host.format = value => markdown.makeHtml(value);
const stubs = {
    'extensions.js': 'export const getContext = () => globalThis.__chatImageSlotsTest.ctx;',
    'user.js': 'export const getCurrentUserHandle = () => "fixture";',
    'script.js': 'export const messageFormatting = text => globalThis.__chatImageSlotsTest.format(text); export const getRequestHeaders = () => ({}); export const syncMesToSwipe = () => {}; export const setExtensionPrompt=()=>{};export const extension_prompt_types={IN_CHAT:1};export const extension_prompt_roles={USER:1};',
    'utils.js': 'export const uuidv4 = () => crypto.randomUUID(); export const saveBase64AsFile = async () => { throw new Error("unexpected upload"); };',
    'event-manager.js': `
        const host = globalThis.__chatImageSlotsTest;
        export const event_types = new Proxy({}, { get: (_, key) => key });
        export const createModuleEvents = () => {
            const owned = [];
            return { on(key, fn) { const listeners = host.events.get(key) || [];
                listeners.push(fn); host.events.set(key, listeners); owned.push([key, fn]); },
                cleanup() { for (const [key, fn] of owned.splice(0)) host.events.set(key, (host.events.get(key) || []).filter(item => item !== fn)); }
            };
        };`,
    'generate-interceptor.js': `export const GENERATE_INTERCEPTOR_ORDER = {};
        export const registerGenerateInterceptor = () => {}; export const unregisterGenerateInterceptor = () => {};`,
    'after-ai-gate.js': `export const initAfterAiGate = () => {};
        export const notifyAfterAiHint = () => globalThis.__chatImageSlotsTest.afterAi?.();
        export const registerAfterAiHandler = (_, fn) => { globalThis.__chatImageSlotsTest.afterAi = fn;
            return () => { globalThis.__chatImageSlotsTest.afterAi = null; }; };`,
    'debug-core.js': 'export const xbLog = { error(...args) { globalThis.__chatImageSlotsTest.errors.push(args.at(-1)?.message); }, warn() {}, info() {} };',
    'draw-run-recovery-runtime.js': 'export const runDrawRunRecoveryPass = async () => {};',
};
const bundle = await build({
    stdin: { contents: [
        'draw-common', 'gallery-cache', 'prepared-chat-images', 'chat-message-images',
        'chat-image-tag-migration', 'card-tag-editor', 'image-card-actions', 'generated-image-runtime',
        'pending-image-jobs', 'image-job-recovery-runtime',
        'image-card-redraw-provider', 'floor-image-job',
        'chat-message-image-markup',
        'draw-run-controls', 'draw-run-activity', 'draw-run-markers', 'confirmable-chat-save', 'slot-activity',
    ].map(name => `export * from './${name}.js';`).join('\n'), resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'host', setup(builder) {
        builder.onResolve({ filter: /\.js$/ }, ({ path }) => {
            const name = path.split('/').at(-1);
            return Object.hasOwn(stubs, name) ? { path: name, namespace: 'host' } : null;
        });
        builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: stubs[path] }));
    } }],
});
// Executes the local production bundle above, not untrusted generated code.
// eslint-disable-next-line no-unsanitized/method
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=draw-slots-test.mjs').toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate) {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await tick(); }
    assert.fail('condition not reached: ' + JSON.stringify(host.errors));
}

let chatNumber = 0;
function setup(t, source, { legacy = false } = {}) {
    host.errors = [];
    const { document, window } = parseHTML('<html><head></head><body><div id="chat"><div class="mes" mesid="0"><div class="mes_text"></div></div></div></body></html>');
    globalThis.document = document;
    globalThis.window = window;
    window.HTMLImageElement.prototype.decode = async () => {};
    globalThis.MutationObserver = window.MutationObserver;
    const observed = new Set();
    globalThis.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; host.observer = this; }
        observe(node) { observed.add(node); }
        unobserve(node) { observed.delete(node); }
        disconnect() { observed.clear(); }
    };
    const message = { name: 'Alice', mes: source, swipe_id: 0, swipes: [source], extra: {} };
    let persisted;
    let saves = 0;
    let responses = 0;
    const deliveries = [];
    let hold = false;
    let saveMode = 'ok';
    let cacheReadsFail = false;
    let onSave;
    let failures = new Set();
    const ctx = host.ctx = { chatId: `chat-${++chatNumber}`, chat: [message], characterId: 0,
        characters: [{ name: 'Alice', avatar: 'alice.png' }],
        chatMetadata: legacy ? {} : { [api.CHAT_IMAGE_TAG_FORMAT_KEY]: api.CHAT_IMAGE_TAG_FORMAT_VERSION },
        getRequestHeaders: () => ({}), saveChat: async () => {
            saves++;
            await onSave?.();
            if (saveMode === 'uncertain') throw new Error('save disconnected');
            persisted = structuredClone([{ chat_metadata: ctx.chatMetadata }, ...ctx.chat]);
        } };
    globalThis.fetch = async (url) => {
        if (String(url || '').includes('/diagnostics/errors')) return Response.json({ ok: true, item: { time: Date.now() } });
        if (saveMode === 'uncertain') throw new Error('readback disconnected');
        return new Response(JSON.stringify(persisted));
    };
    window.stimageDraw = {
        getStatus: () => ({ enabled: true, ready: true }), getProvider: () => 'novelai',
        prepareGeneration(input) {
            if (cacheReadsFail) throw new Error('cache descriptor failed');
            return { fingerprint: { provider: 'novelai', promptData: { positive: input.prompt,
                characterPrompts: [], negativePrompt: '' } }, execute: async () => { throw new Error('legacy generation forbidden'); } };
        },
    };
    const submissions = [];
    const jobs = new Map(), states = [];
    let prepareBarrier = async () => {};
    let stateHook;
    const execute = async input => {
        submissions.push(input);
        await prepareBarrier(input);
        return api.submitPreparedChatImages({ ...input, backend: false,
            metadata: input.tasks.map(task => ({ tags: task.scene, positive: task.scene,
                characterPrompts: task.characterPrompts, negativePrompt: task.negativePrompt ?? '' })),
            run: async callbacks => {
                responses++;
                if (hold) await new Promise(resolve => { deliveries.push(resolve); });
                for (const index of input.tasks.keys()) {
                    if (await callbacks.onItemStarting({ index }) === false) continue;
                    if (failures.has(index)) await callbacks.onItemSettled({ index, state: 'failed',
                        error: Object.assign(new Error('supplier rejected'), { imageRequestOutcome: 'rejected' }) });
                    else await callbacks.onItemReady({ index, base64: 'YWJj' });
                }
            } });
    };
    const dispose = api.registerPreparedImageProvider('novelai', api.createImageCardRedrawProvider({ execute,
        createJob: (messageId, options) => api.acquireFloorImageJob(jobs, host.ctx, messageId, () => ({
            controller: new AbortController(), backendCancel: new AbortController(),
        }), options), releaseJob: job => api.releaseFloorImageJob(jobs, job),
        getCurrentContext: () => host.ctx, setStateForMessage: (_id, state, data) => { states.push({ state, data }); stateHook?.(state, data); },
        classifyError: api.classifyError,
    }));
    const root = document.querySelector('.mes_text');
    function format() {
        // Test-owned message formatted through Markdown, as the host would.
        // eslint-disable-next-line no-unsanitized/property
        root.innerHTML = host.format(message.mes);
    }
    format();
    t.after(() => {
        api.stopImageJobRecovery(); api.configureChatImageTagMigration();
        api.cleanupChatMessageImages(); api.clearPreviewObjectUrls(); dispose();
    });
    return { ctx, message, root, observed, submissions, format, jobs, states,
        set failures(value) { failures = new Set(value); },
        get persisted() { return structuredClone(persisted); },
        async begin({ type = 'normal', streaming = true, dryRun = false } = {}) {
            if (type === 'regenerate') ctx.chat[0] = { ...message };
            else if (!['continue', 'swipe'].includes(type)) ctx.chat.pop();
            await host.emit('GENERATION_STARTED', type, {}, dryRun);
            await host.emit('GENERATION_AFTER_COMMANDS', type, {}, dryRun);
            if (type === 'regenerate') { ctx.chat.pop(); await host.emit('MESSAGE_DELETED'); }
            await host.emit('GENERATE_AFTER_DATA', {}, dryRun);
            if (!ctx.chat.includes(message)) ctx.chat.push(message);
            if (streaming) ctx.streamingProcessor = { messageId: 0, isStopped: false, isFinished: false };
            format();
        },
        async receive(type = 'normal') {
            if (ctx.streamingProcessor) ctx.streamingProcessor.isFinished = true;
            await host.emit('GENERATION_ENDED');
            await host.emit('MESSAGE_RECEIVED', 0, type);
        },
        generateTag() { root.querySelector('[data-sti-draw-tag-action]').click(); },
        get saves() { return saves; }, get requests() { return responses; },
        set hold(value) { hold = value; }, finish() { for (const deliver of deliveries.splice(0)) deliver(); },
        set saveMode(value) { saveMode = value; }, set cacheReadsFail(value) { cacheReadsFail = value; },
        set onSave(value) { onSave = value; },
        set prepareBarrier(value) { prepareBarrier = value; },
        set stateHook(value) { stateHook = value; },
    };
}

async function stageNativeJob(t, h, { active = false } = {}) {
    const tasks = api.parseChatImageTags(h.message.mes).map(tag => ({ scene: tag.tags, placement: { ...tag, mode: 'replace' } }));
    let record;
    await assert.rejects(api.submitPreparedChatImages({ ctx: h.ctx, message: h.message, messageId: 0,
        sourceText: h.message.mes, nativeMessage: true, tasks, backend: true,
        metadata: tasks.map(task => ({ tags: task.scene, positive: task.scene, characterPrompts: [], negativePrompt: '' })),
        run: async ({ recoverable }) => {
            record = await api.recordPendingImageJob({ ...recoverable.plan, jobId: crypto.randomUUID(), provider: 'sd-webui' });
            await recoverable.commitPlacements();
            if (active) await api.markPendingImageJobActive(record.jobId, record.leaseId);
            await api.renewPendingImageJobLease(record.jobId, record.leaseId, { now: 0 });
            throw Object.assign(new Error('page closed'), { detached: true });
        } }), error => error.detached);
    t.after(async () => {
        const current = await api.getPendingImageJob(record.jobId);
        if (current) await api.forgetPendingImageJob(current.jobId, current.leaseId);
    });
    return record;
}


test('streamed direct image code is hidden by an immediate provisional card without creating jobs', async t => {
    const h = setup(t, 'Opening story.\n\n<image>\nprompt: first scene in progress');
    h.ctx.streamingProcessor = { messageId: 0, isStopped: false, isFinished: false };
    api.initChatMessageImages();
    await until(() => h.root.querySelectorAll('[data-sti-direct-draft]').length === 1);
    assert.doesNotMatch(h.root.textContent, /prompt:|scene in progress/);
    assert.match(h.root.textContent, /Opening story/);
    assert.equal(h.requests, 0);
    h.message.mes += '\n</image>\n\nMore story.\n\n<image>\nprompt: second scene';
    h.format();
    await host.emit('MESSAGE_UPDATED', 0);
    await until(() => h.root.querySelectorAll('[data-sti-direct-draft]').length === 2);
    assert.doesNotMatch(h.root.textContent, /prompt:|second scene/);
    assert.match(h.root.textContent, /More story/);
    assert.equal(h.requests, 0);
    h.message.mes = 'Opening story. More story.';
    h.format();
    await host.emit('MESSAGE_UPDATED', 0);
    await until(() => h.root.querySelectorAll('[data-sti-direct-draft]').length === 0);
    assert.equal(h.requests, 0);
});



test('slot deletion finishing after a chat switch never clears the other chat saved image', async t => {
    const h = setup(t, '[image:delete-original]');
    await api.storePreview({ slotId: 'delete-original', imgId: 'delete-original-image', tags: 'tag', messageId: 0, base64: 'YWJj' });
    await api.setDrawSavedEntry(0, 'delete-original', { imgId: 'delete-original-image', savedUrl: '/saved.png' });
    await api.renderPreviewsForMessage(0);
    const nextMessage = structuredClone(h.message);
    const before = structuredClone(nextMessage);
    h.onSave = () => { host.ctx = { ...h.ctx, chatId: 'other-chat', chat: [nextMessage] }; };
    await api.removeChatImageSlot(h.root.querySelector('.sti-nd-img'));
    assert.deepEqual(nextMessage, before);
    assert.equal(h.message.mes, '');
    assert.equal((await api.getPreviewsBySlot('delete-original')).length, 0);
    assert.equal(h.requests, 0);
});



test('a global runtime stop does not accidentally target the first floor recovered jobs', async t => {
    const h = setup(t, '[img: unrelated recovered image]');
    const record = await stageNativeJob(t, h, { active: true });
    const calls = [];
    assert.equal(await api.cancelFloorDrawWork(null, {
        imageJobClient: { cancelWork: async targets => calls.push(targets) },
    }), false);
    assert.deepEqual(calls, []);
    assert.equal((await api.getPendingImageJob(record.jobId)).cancelRequested, false);
});



test('native recovery does not acknowledge an unstored result and reattaches the same request after storage recovers', async t => {
    const warnings = t.mock.method(console, 'warn', () => {});
    const h = setup(t, '[img: storage recovery]');
    const record = await stageNativeJob(t, h, { active: true });
    let failStorage = true, attachments = 0, acknowledgements = 0;
    const put = IDBObjectStore.prototype.put;
    t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
        const result = put.apply(this, args);
        if (failStorage && this.name === 'previews' && args[0].status === 'success') this.transaction.abort();
        return result;
    });
    api.startImageJobRecovery({ client: {
        listJobs: async () => [{ id: record.jobId }],
        attachJob: async (id, callbacks) => {
            assert.equal(id, record.jobId); attachments++;
            try { await callbacks.onItemReady({ index: 0, response: new Response('image') }); }
            catch (error) { return { deliveryErrors: new Map([[0, error]]) }; }
            assert.equal((await api.getPreview(record.items[0].imgId)).status, 'success');
            acknowledgements++; return {};
        },
    }, decoders: { 'sd-webui': async () => 'YWJj' } });
    await api.reconcilePendingImageJobs();
    assert.equal(acknowledgements, 0); assert.ok(await api.getPendingImageJob(record.jobId));
    failStorage = false;
    await api.reconcilePendingImageJobs(); api.stopImageJobRecovery();
    assert.ok(attachments >= 2); assert.equal(acknowledgements, 1);
    assert.ok(warnings.mock.calls.length > 0);
    assert.equal(await api.getPendingImageJob(record.jobId), null);
});



test('legacy read error aborts migration without marker or metadata writes and without generation', async t => {
    const h = setup(t, '[img: old]', { legacy: true }); h.cacheReadsFail = true;
    await assert.rejects(api.ensureChatImageTagFormat(h.ctx));
    assert.equal(h.message.mes, '[img: old]');
    assert.equal(h.ctx.chatMetadata[api.CHAT_IMAGE_TAG_FORMAT_KEY], undefined);
    assert.equal(h.requests, 0); assert.equal(h.saves, 0);
});



test('new chat format registration does not migrate or claim its first new tags', async t => {
    const h = setup(t, '[img: first]', { legacy: true });
    api.markFreshImageTagChat(h.ctx);
    await api.ensureChatImageTagFormat(h.ctx);
    assert.equal(h.message.mes, '[img: first]'); assert.equal(h.requests, 0);
    assert.equal(h.ctx.chatMetadata[api.CHAT_IMAGE_TAG_FORMAT_KEY], api.CHAT_IMAGE_TAG_FORMAT_VERSION);
});



test('deleting the selected image clears only its own selection', async t => {
    setup(t, '[image:delete-selection]');
    await api.storePreview({ slotId: 'delete-selection', imgId: 'selection-image', base64: 'YWJj', tags: 'x', messageId: 0 });
    await api.setSlotSelection('delete-selection', 'selection-image');
    await api.deletePreview('selection-image');
    assert.equal(await api.getSlotSelection('delete-selection'), null);
});



test('aborted TAG edit does not change card text, image or stored metadata', async t => {
    const h = setup(t, '[image:abort-edit]');
    await api.storePreview({ slotId: 'abort-edit', imgId: 'abort-img', base64: 'YWJj', tags: 'old',
        messageId: 0, characterPrompts: [], negativePrompt: 'negative' });
    await api.renderPreviewsForMessage(0);
    const card = h.root.querySelector('.sti-nd-img');
    card.querySelector('textarea').value = 'new';
    const put = IDBObjectStore.prototype.put;
    t.mock.method(IDBObjectStore.prototype, 'put', function (value, ...args) {
        if (value.imgId === 'abort-img') { this.transaction.abort(); return; }
        return put.call(this, value, ...args);
    });
    await assert.rejects(api.persistCardTagEdits(card, tags => ({ positive: tags })));
    assert.equal(card.dataset.tags, 'old');
    const record = await api.getPreview('abort-img');
    assert.equal(record.tags, 'old'); assert.equal(record.base64, 'YWJj'); assert.equal(record.negativePrompt, 'negative');
});




test('four persisted image slots retain unique order and identity across rerender', async t => {
    const ids=['scene-a','scene-b','scene-c','scene-d'];
    const story=ids.map((slotId,i)=>'Visible scene '+(i+1)+'. [image:'+slotId+']').join('\n\n');
    const h=setup(t,story);
    for(let i=0;i<ids.length;i++) {
        await api.storePreview({
            slotId:ids[i],imgId:'image-'+(i+1),messageId:0,
            savedUrl:'/user/images/fixture/image-'+(i+1)+'.png',
            tags:'distinct scene '+(i+1),base64:'YWJj',status:'success'
        });
    }
    await api.renderPreviewsForMessage(0);
    const idsInDom=()=>[...h.root.querySelectorAll('.sti-nd-img[data-slot-id]')].map(node=>node.dataset.slotId);
    assert.deepEqual(idsInDom(),ids);
    assert.equal(h.root.querySelectorAll('.sti-nd-img img').length,4);
    assert.equal(h.requests,0);
    h.format();
    await api.renderPreviewsForMessage(0);
    assert.deepEqual(idsInDom(),ids);
    assert.equal(h.root.querySelectorAll('.sti-nd-img img').length,4);
    assert.equal(h.message.mes,story);
    assert.equal(h.requests,0);
});

test('an unowned marker cannot masquerade as a saved image', async t => {
    const h=setup(t,'Visible text. [image:slot-not-owned] End.');
    await api.renderPreviewsForMessage(0);
    assert.equal(h.requests,0);
    assert.equal((await api.getPreviewsBySlot('slot-not-owned')).length,0);
    assert.equal(h.message.mes,'Visible text. [image:slot-not-owned] End.');
});

test('hidden slots and code blocks cannot create a MESSAGE_UPDATED feedback loop', async t => {
    const h = setup(t, '[image:hidden-loop]\n\n```html\n<div>widget</div>\n```');
    const original = host.format;
    const format = t.mock.method(host, 'format', source => original(source.replace('[image:hidden-loop]', '')));
    h.ctx.eventSource = { emit: host.emit };
    h.format();
    const before = format.mock.calls.length;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    api.startSharedDrawPreviewRuntime();
    t.after(() => api.stopSharedDrawPreviewRuntime());
    await host.emit('MESSAGE_UPDATED', 0);
    for (let i = 0; i < 3; i++) {
        t.mock.timers.tick(300);
        await api.renderPreviewsForMessage(0);
    }
    assert.equal(format.mock.calls.length, before);
    assert.equal(h.requests, 0);
});
