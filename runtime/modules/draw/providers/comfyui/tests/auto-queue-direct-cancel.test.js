import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { indexedDB, IDBDatabase } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { buildProviderFixture, fixtureProviderSettings, fixturePng } from '../../../shared/tests/fixtures/provider-runtime-fixture.mjs';

// Expose private entry points only in the in-memory test bundle. The automatic
// parser, floor jobs, preparation, persistence and direct transport stay real.
const source = await buildProviderFixture('comfyui');
const api = await import('data:text/javascript;base64,' + Buffer.from(source + `
    export { autoGenerateForLastAI, fetchComfyDirectImageFromWorkflow };
    export function activateAutomaticFixture() { moduleInitialized = true; }
    export function setInjectedFactsFixture(value) { injectedDrawingFacts = value; }
`).toString('base64'));

let sequence = 0;
function setup(t) {
    const { document, window } = parseHTML('<html><head></head><body><div id="chat"></div></body></html>');
    Object.assign(globalThis, { document, window, indexedDB, BroadcastChannel: undefined,
        MutationObserver: window.MutationObserver, toastr: { error() {}, warning() {} },
        FileReader: class {
            readAsDataURL(blob) {
                blob.arrayBuffer().then(bytes => {
                    this.result = `data:${blob.type};base64,` + Buffer.from(bytes).toString('base64');
                    this.onload?.();
                }).catch(error => { this.error = error; this.onerror?.(); });
            }
        } });
    const h = globalThis.__review = { ctx: null, events: new Map(), states: [], requests: [], held: null, errors: [] };
    const makeContext = (messages = []) => {
        const ctx = { chatId: 'automatic-' + (++sequence), groupId: 'fixture', chat: messages,
            getRequestHeaders: () => ({}), async saveChat() { ctx.persisted = structuredClone(ctx.chat); } };
        ctx.persisted = structuredClone(messages);
        return ctx;
    };
    h.ctx = makeContext();
    h.makeContext = makeContext;
    h.emit = () => api.autoGenerateForLastAI();
    h.add = (label, ctx = h.ctx) => {
        const story = `成年画家在画室里画出${label}。`;
        const message = { name: '画家', mes: story, swipe_id: 0, swipes: [story], extra: {
            sti_comfy_direct: { source: story, directives: [{ prompt: 'adult woman artist, ' + label,
                after: story, characters: [{ name: '画家', type: 'woman', appear: 'black hair, brown eyes' }] }] },
        } };
        ctx.chat.push(message);
        ctx.persisted = structuredClone(ctx.chat);
        return message;
    };
    const settings = { ...fixtureProviderSettings('comfyui'), mode: 'auto', workflowMode: 'simple', timeout: 5000 };
    api.configureFixtureSettings(settings);
    api.setInjectedFactsFixture(null);
    api.activateAutomaticFixture();
    h.settings = settings;
    t.mock.method(console, 'error', (...args) => h.errors.push(args.map(x => x?.message || String(x)).join(' ')));
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    t.mock.method(console, 'log', () => {});
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        const value = String(url), path = value.startsWith('http') ? new URL(value).pathname : value;
        h.requests.push({ path, body: options.body ? JSON.parse(options.body) : null, signal: options.signal });
        if (path.endsWith('/diagnostics/errors')) { h.errors.push(JSON.parse(options.body)); return Response.json({ ok: true }); }
        if (path === '/api/chats/group/get') return Response.json(h.ctx.persisted);
        if (path === '/prompt') {
            if (!h.held) await new Promise(resolve => { h.held = resolve; });
            return new Response('fixture rejection', { status: 400 });
        }
        throw new Error('Unexpected transport: ' + value);
    });
    t.after(() => { h.held?.(); api.cleanupComfyDraw(); });
    return h;
}

async function until(predicate, description) {
    const deadline = Date.now() + 4500;
    while (!predicate() && Date.now() < deadline) await delay(5);
    assert.ok(predicate(), description + ': ' + JSON.stringify({ errors: globalThis.__review?.errors, paths: globalThis.__review?.requests.map(x => x.path) }));
}

const prompts = h => h.requests.filter(item => item.path === '/prompt');
function positive(request) {
    return Object.values(request.body.prompt).find(node => node.class_type === 'CLIPTextEncode')?.inputs?.text || '';
}

function holdOwnershipRead(t) {
    const transaction = IDBDatabase.prototype.transaction;
    const gate = { release: null };
    let taken = false;
    t.mock.method(IDBDatabase.prototype, 'transaction', function (stores, ...args) {
        const tx = transaction.call(this, stores, ...args);
        if (!taken && (Array.isArray(stores) ? stores.includes('jobs') : stores === 'jobs')) {
            taken = true;
            tx.addEventListener('complete', event => {
                event.stopImmediatePropagation();
                gate.release = () => tx.oncomplete?.(event);
            }, { once: true });
        }
        return tx;
    });
    t.after(() => gate.release?.());
    return gate;
}

test('automatic completion events retain all three consecutive replies and coalesce duplicate events', async t => {
    const h = setup(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => prompts(h).length === 1, 'first automatic batch reaches the simulated supplier');
    h.add('second-scene');
    await h.emit();
    await h.emit();
    h.add('third-scene');
    await h.emit();
    await h.emit();
    h.held();
    await first;
    assert.equal(prompts(h).length, 3, 'neither intermediate reply may be discarded while the first batch waits');
    assert.deepEqual(prompts(h).map(positive).map(text => /first-scene|second-scene|third-scene/.exec(text)?.[0]),
        ['first-scene', 'second-scene', 'third-scene']);
    await h.emit();
    assert.equal(prompts(h).length, 3, 'accepted slots prevent later events resubmitting a whole batch');
});

test('duplicate events during ownership lookup cannot lose either later reply', async t => {
    const h = setup(t), gate = holdOwnershipRead(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => gate.release, 'ownership lookup reaches its asynchronous boundary');
    await h.emit();
    h.add('second-scene');
    await h.emit();
    await h.emit();
    h.add('third-scene');
    await h.emit();
    gate.release();
    await until(() => h.held, 'first queued batch reaches the supplier');
    h.held();
    await first;
    assert.equal(prompts(h).length, 3);
    assert.deepEqual(prompts(h).map(positive).map(text => /first-scene|second-scene|third-scene/.exec(text)?.[0]),
        ['first-scene', 'second-scene', 'third-scene']);
});

test('queued replies retain each turn worldbook snapshot after later injections overwrite the shared facts', async t => {
    const h = setup(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => h.held, 'first batch waits for the simulated supplier');
    const silver = '画家有银色长发和绿色眼睛。';
    const second = h.add('second-scene');
    Object.assign(second.extra.sti_comfy_direct.directives[0].characters[0],
        { appear: 'generated silver hair, green eyes', appear_evidence: silver });
    const facts = { chatId: h.ctx.chatId, messageId: 1, worldbook: silver };
    api.setInjectedFactsFixture(facts);
    await h.emit();
    const red = '画家有红色短发和蓝色眼睛。';
    const third = h.add('third-scene');
    Object.assign(third.extra.sti_comfy_direct.directives[0].characters[0],
        { appear: 'generated red hair, blue eyes', appear_evidence: red });
    facts.messageId = 2;
    facts.worldbook = red;
    await h.emit();
    h.held();
    await first;
    assert.equal(prompts(h).length, 3);
    assert.ok(positive(prompts(h)[1]).includes(silver), 'second reply uses its own source fact, not current worldbook lookup');
    assert.ok(positive(prompts(h)[2]).includes(red), 'third reply keeps its separate injected source fact');
});

test('queued replies follow the captured message object when earlier messages are deleted', async t => {
    const h = setup(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => h.held, 'first batch reaches the supplier');
    const pending = h.add('second-scene');
    await h.emit();
    h.ctx.chat.shift();
    h.ctx.persisted = structuredClone(h.ctx.chat);
    h.held();
    await first;
    assert.equal(prompts(h).length, 2);
    assert.match(positive(prompts(h)[1]), /second-scene/);
    assert.equal(h.ctx.chat[0], pending);
    assert.equal(Object.keys(pending.extra.sti_comfy_slots || {}).length, 1);
});

for (const deletion of ['earlier', 'target', 'other-message']) {
    test(`swipe deletion ${deletion} rebases only the surviving automatic target`, async t => {
        const h = setup(t);
        api.cleanupComfyDraw();
        assert.equal(await api.initComfyDraw(), true);
        h.add('first-scene');
        const first = h.emit();
        await until(() => h.held, 'first batch holds the automatic worker');
        const pending = h.add('second-scene');
        pending.swipe_id = deletion === 'target' ? 1 : 2;
        // Identical replacement text matters: deleting the target branch must
        // invalidate its identity even if its successor has the same body.
        pending.swipes = ['old first swipe', pending.mes, pending.mes];
        await h.emit();
        const other = h.add('third-scene');
        other.swipe_id = 2;
        other.swipes = ['other old first swipe', 'other old second swipe', other.mes];
        await h.emit();
        const changed = deletion === 'other-message' ? other : pending;
        const swipeId = deletion === 'target' ? 1 : 0;
        changed.swipes.splice(swipeId, 1);
        if (changed.swipe_id > swipeId) changed.swipe_id--;
        changed.mes = changed.swipes[changed.swipe_id];
        h.ctx.persisted = structuredClone(h.ctx.chat);
        const listeners = h.events.get('MESSAGE_SWIPE_DELETED') || [];
        assert.equal(listeners.length, 1, 'exercise the handler installed by the production initializer');
        for (const listener of listeners) await listener({ messageId: h.ctx.chat.indexOf(changed), swipeId });
        h.held();
        await first;
        const scenes = prompts(h).map(positive).map(text => /first-scene|second-scene|third-scene/.exec(text)?.[0]);
        assert.deepEqual(scenes, deletion === 'target'
            ? ['first-scene', 'third-scene'] : ['first-scene', 'second-scene', 'third-scene']);
        if (deletion === 'target') assert.equal(pending.mes.includes('[image:'), false);
    });
}

for (const change of ['swipe', 'text', 'delete', 'replace', 'placed', 'missing']) {
    test(`queued automatic reply revalidates ${change} before submitting`, async t => {
        const h = setup(t);
        h.add('first-scene');
        const first = h.emit();
        await until(() => prompts(h).length === 1, 'first batch blocks the automatic worker');
        const pending = h.add('second-scene');
        if (change === 'placed') pending.mes += '\n[image:already-owned]';
        await h.emit();
        if (change === 'swipe') pending.swipe_id = 1;
        if (change === 'text') pending.mes += '剧情已修改。';
        if (change === 'delete') h.ctx.chat.pop();
        if (change === 'replace') h.ctx.chat[1] = structuredClone(pending);
        if (change === 'placed') {
            pending.extra.sti_comfy_slots = { 'already-owned': { status: 'success' } };
        }
        if (change === 'missing') pending.extra.sti_comfy_direct.directives = [];
        h.add('third-scene');
        await h.emit();
        h.held();
        await first;
        assert.equal(prompts(h).length, 2, 'invalid pending reply is skipped while the later valid reply is retained');
        assert.match(positive(prompts(h)[1]), /third-scene/);
    });
}

test('switching chats never retargets queued replies into the newly opened chat', async t => {
    const h = setup(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => prompts(h).length === 1, 'first batch reaches the supplier');
    const old = h.ctx;
    h.add('old-pending');
    await h.emit();
    h.ctx = h.makeContext();
    h.add('new-chat-scene');
    await h.emit();
    h.held();
    await first;
    assert.equal(prompts(h).length, 2);
    assert.match(positive(prompts(h)[1]), /new-chat-scene/);
    assert.equal(old.chat[1].mes.includes('[image:'), false);
    assert.equal(Object.keys(h.ctx.chat[0].extra.sti_comfy_slots || {}).length, 1);
});

test('cleanup during an active transport invalidates every waiting automatic target', async t => {
    const h = setup(t);
    h.add('first-scene');
    const first = h.emit();
    await until(() => prompts(h).length === 1, 'first batch reaches the supplier');
    const pending = h.add('second-scene');
    await h.emit();
    api.cleanupComfyDraw();
    api.activateAutomaticFixture();
    h.ctx = h.makeContext();
    h.add('new-lifecycle');
    const restarted = h.emit();
    h.held();
    await Promise.all([first, restarted]);
    assert.equal(prompts(h).length, 2);
    assert.match(positive(prompts(h)[1]), /new-lifecycle/);
    assert.equal(pending.mes.includes('[image:'), false);
});

test('cleanup during ownership lookup fences the old worker from a newly activated lifecycle', async t => {
    const h = setup(t), gate = holdOwnershipRead(t);
    const stale = h.add('old-lifecycle');
    const first = h.emit();
    await until(() => gate.release, 'old worker is waiting on its ownership read');
    api.cleanupComfyDraw();
    api.activateAutomaticFixture();
    h.ctx = h.makeContext();
    h.add('new-first');
    const restarted = h.emit();
    await until(() => h.held, 'new lifecycle may start while old preflight is still returning');
    gate.release();
    await first;
    h.add('new-second');
    await h.emit();
    h.held();
    await restarted;
    assert.equal(prompts(h).length, 2);
    assert.match(positive(prompts(h)[0]), /new-first/);
    assert.match(positive(prompts(h)[1]), /new-second/);
    assert.equal(stale.mes.includes('[image:'), false);
});

for (const phase of ['poll', 'submit-response', 'submit-body']) for (const cause of ['cancel', 'timeout']) {
    test(`direct ${cause} deletes only its own accepted prompt during ${phase}`, async t => {
        const h = setup(t), controller = new AbortController(), calls = [];
        let release, reached;
        const arrived = new Promise(resolve => { reached = resolve; });
        const hold = new Promise(resolve => { release = resolve; });
        t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
            const path = new URL(url).pathname;
            calls.push({ path, url: String(url), headers: options.headers,
                body: options.body && JSON.parse(options.body), signal: options.signal });
            if (path.endsWith('/queue')) return Response.json({});
            if (path.endsWith('/prompt')) {
                if (phase === 'submit-response') { reached(); await hold; }
                if (phase === 'submit-body') return { ok: true, async json() { reached(); await hold; return { prompt_id: 'owned-prompt' }; } };
                return Response.json({ prompt_id: 'owned-prompt' });
            }
            if (path.endsWith('/history')) {
                reached();
                await hold;
                return Response.json({});
            }
            throw new Error('Unexpected direct request: ' + path);
        });
        const operation = api.fetchComfyDirectImageFromWorkflow({}, { signal: controller.signal,
            generationConfig: { ...h.settings, host: 'https://comfy.invalid/base?key=preserved', auth: 'fixture:password' },
            timeoutMs: cause === 'timeout' ? 50 : 5000 });
        await arrived;
        if (cause === 'cancel') controller.abort();
        else await delay(80);
        release();
        await assert.rejects(operation);
        await delay(0);
        const removals = calls.filter(call => call.path.endsWith('/queue'));
        assert.equal(removals.length, 1);
        assert.deepEqual(removals[0].body, { delete: ['owned-prompt'] });
        assert.equal(removals[0].url, 'https://comfy.invalid/base/queue?key=preserved');
        assert.equal(removals[0].headers.Authorization, 'Basic ' + btoa('fixture:password'));
        assert.equal(removals[0].signal.aborted, false, 'cancellation must use its own short-lived request signal');
        assert.equal(calls.some(call => call.path.endsWith('/interrupt')), false);
    });
}

test('a transport abort during polling still issues one scoped removal and keeps the abort outcome', async t => {
    const h = setup(t), controller = new AbortController(), paths = [];
    let reached;
    const polling = new Promise(resolve => { reached = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === '/prompt') return Response.json({ prompt_id: 'only-mine' });
        if (path === '/queue') return Response.json({});
        if (path === '/history') {
            reached();
            return new Promise((_, reject) => options.signal.addEventListener('abort',
                () => reject(new DOMException('fixture abort', 'AbortError')), { once: true }));
        }
        throw new Error('Unexpected transport: ' + path);
    });
    const operation = api.fetchComfyDirectImageFromWorkflow({}, { signal: controller.signal,
        generationConfig: h.settings, timeoutMs: 5000 });
    await polling;
    controller.abort();
    await assert.rejects(operation, error => error.name === 'AbortError' && error.uncertain === true);
    assert.deepEqual(paths, ['/prompt', '/history', '/queue']);
});

test('an aborted submission without a returned ID cannot delete unrelated queue entries', async t => {
    const h = setup(t), controller = new AbortController(), paths = [];
    let reached;
    const submitting = new Promise(resolve => { reached = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        paths.push(new URL(url).pathname);
        reached();
        return new Promise((_, reject) => options.signal.addEventListener('abort',
            () => reject(new DOMException('fixture abort', 'AbortError')), { once: true }));
    });
    const operation = api.fetchComfyDirectImageFromWorkflow({}, { signal: controller.signal,
        generationConfig: h.settings, timeoutMs: 5000 });
    await submitting;
    controller.abort();
    await assert.rejects(operation, error => error.uncertain === true);
    assert.deepEqual(paths, ['/prompt']);
});

test('a completed direct image releases cancellation listeners without deleting its prompt later', async t => {
    const h = setup(t), controller = new AbortController(), paths = [];
    t.mock.method(globalThis, 'fetch', async url => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === '/prompt') return Response.json({ prompt_id: 'completed' });
        if (path === '/history') return Response.json({ completed: { status: { status_str: 'success' },
            outputs: { '9': { images: [{ filename: 'completed.png', subfolder: '', type: 'output' }] } } } });
        if (path === '/view') return new Response(Buffer.from(fixturePng, 'base64'), { headers: { 'Content-Type': 'image/png' } });
        throw new Error('Unexpected transport: ' + path);
    });
    const result = await api.fetchComfyDirectImageFromWorkflow({ '9': { class_type: 'SaveImage', inputs: {} } },
        { signal: controller.signal, generationConfig: h.settings, timeoutMs: 5000 });
    assert.equal(result, fixturePng);
    controller.abort();
    await delay(0);
    assert.deepEqual(paths, ['/prompt', '/history', '/view']);
});
