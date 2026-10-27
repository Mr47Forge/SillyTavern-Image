import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { indexedDB } from 'fake-indexeddb';
import { buildCapsuleFixture } from './fixtures/capsule-lifecycle-fixture.mjs';

const code = await buildCapsuleFixture();
const api = await import('data:text/javascript;base64,' + Buffer.from(code + '\n//# sourceURL=capsule-lifecycle-fixture.mjs').toString('base64'));
const BUSY = ['submitting', 'accepted', 'uncertain', 'queued', 'llm', 'gen', 'cooldown', 'reconnecting', 'cancelling'];
const reportToPanel = (state, data, id) => api.setStateForMessage(id, state, data);

async function settle() { for (let i = 0; i < 30; i++) await setImmediate(); }
function click(node, floating) {
    if (!floating) { node.click(); return; }
    for (const type of ['pointerdown', 'pointerup']) {
        const event = new window.Event(type, { bubbles: true });
        Object.assign(event, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
        node.dispatchEvent(event);
    }
}

async function mount(t, name) {
    const { document, window } = parseHTML('<html><head></head><body><div class="mes" mesid="0"></div></body></html>');
    Object.assign(globalThis, { document, window, indexedDB, BroadcastChannel: undefined,
        requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
    window.innerWidth = 800; window.innerHeight = 600;
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 40 });
    const h = globalThis.__capsule = { api, jobs: new Map(), settings: 0, draws: [], aborts: [], errors: [], server: [],
        ctx: { chatId: name, chat: [{ mes: '[image:lifecycle-slot]', swipe_id: 0 }] } };
    h.draw = async (...args) => { h.draws.push(args); };
    h.abort = (id, options) => {
        const operation = api.cancelFloorDrawWork(id, { ...options,
            jobs: api.getFloorImageJobs(h.jobs, h.ctx, id, options.target),
            imageJobClient: { cancelWork: async targets => { h.server.push(targets); await h.transport?.(targets); } } });
        h.aborts.push(operation);
        return operation;
    };
    globalThis.toastr = { error: e => h.errors.push(e), info() {}, warning() {} };
    api.initFloatingPanel();
    h.panel = api.ensureComfyDrawPanel(document.querySelector('.mes'), 0, { force: true });
    h.floating = document.querySelector('.nd-floating-global');
    t.after(() => api.destroyComfyDrawPanels());
    await settle();
    return h;
}

for (const nativeMessage of [false, true]) test(`unconfirmed pre-submit placement exits confirmation on both controls (native=${nativeMessage})`, async t => {
    const h = await mount(t, `unsubmitted-save-${nativeMessage}`);
    t.after(async () => {
        for (const record of await api.listPendingImageJobs()) if (record.delivery.chatId === h.ctx.chatId) {
            await api.forgetPendingImageJob(record.jobId, record.leaseId);
        }
    });
    const previews = new Map(), selected = new Map();
    let submissions = 0;
    const job = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
        () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
    const report = api.observeFloorImageJob(job, { getCurrentContext: () => h.ctx,
        onStateChange: reportToPanel, classifyError: error => ({ label: '图位保存未确认', desc: error.message }) });
    let saves = 0;
    Object.assign(h.ctx, { groupId: 'fixture-group', getRequestHeaders: () => ({}), saveChat: async () => { saves++; } });
    const saveFailure = () => api.saveChatAndConfirm({ ctx: h.ctx, verify: () => true,
        fetchImpl: async () => { throw new TypeError('Failed to fetch readback'); } });
    const items = [0, 1].map(index => ({ slotId: `confirm-slot-${index}`, imgId: `confirm-img-${index}`,
        chatId: h.ctx.chatId, messageId: 0, tags: `中文画面${index}`,
        positive: `原正向${index}`, negativePrompt: `原负向${index}`,
        delivery: { mode: 'slots', chatId: h.ctx.chatId, messageId: '0', swipeIndex: 0 } }));
    let failure;
    try {
        await api.executePreparedSlots({ items, backend: true, nativeMessage,
            signal: job.controller.signal, onStateChange: report,
            store: async item => previews.set(item.imgId, item), remove: async id => previews.delete(id),
            select: async (slot, id) => selected.set(slot, id), activity() {}, render: async () => {},
            resolveTarget: () => ({ messageId: 0 }), classifyError: job.classifyError,
            commit: async () => {
                h.ctx.chat[0].mes = items.map(item => `[image:${item.slotId}]`).join('正文段落。');
                if (!nativeMessage) await saveFailure();
                return true;
            }, linkJob: saveFailure,
            run: callbacks => api.submitRecoverableImageJob({ provider: 'comfyui', request: {},
                ...callbacks.recoverable, client: { runJob: async () => { submissions++; assert.fail('must not submit'); } } }),
        });
    } catch (error) { failure = error; api.failFloorImageJob(job, error); }
    finally { api.releaseFloorImageJob(h.jobs, job); }
    await settle();
    assert.ok(failure, 'failed persistence must be reported');
    assert.equal(saves, 1, 'exercise the actual chat-save and readback boundary');
    assert.equal(submissions, 0);
    assert.equal((await api.listPendingImageJobs()).length, 0, 'no preparing journal survives a definitively unsubmitted flow');
    assert.equal(h.panel.state, 'error', 'an unsubmitted task must stop spinning without a later page event');
    for (const [index, item] of items.entries()) {
        assert.equal(previews.get(item.imgId).status, 'failed');
        assert.equal(previews.get(item.imgId).positive, `原正向${index}`);
        assert.equal(previews.get(item.imgId).negativePrompt, `原负向${index}`);
        assert.ok(h.ctx.chat[0].mes.includes(`[image:${item.slotId}]`));
    }
    for (const root of [h.panel.root, h.floating]) assert.equal(root.classList.contains('working'), false);
    click(h.floating.querySelector('.nd-btn-draw'), true);
    await settle();
    assert.equal(h.draws.length, 1, 'the user can retry from the floating control');
});

test('lost receipt after backend acceptance reattaches its original job and completes the panel without resubmission', async t => {
    const h = await mount(t, 'accepted-confirm-recovery');
    const previews = new Map();
    let submissions = 0, attachments = 0;
    const job = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
        () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
    const report = api.observeFloorImageJob(job, { getCurrentContext: () => h.ctx, onStateChange: reportToPanel });
    const item = { slotId: 'lifecycle-slot', imgId: 'accepted-confirm-image', chatId: h.ctx.chatId, messageId: 0,
        tags: '保留原提示词', delivery: { mode: 'slots', chatId: h.ctx.chatId, messageId: '0', swipeIndex: 0 } };
    const client = {
        async runJob(_request, callbacks) {
            submissions++;
            await callbacks.onStateChange('created', { job: { id: callbacks.requestId } });
            throw Object.assign(new Error('response lost'), { detached: true });
        },
        async attachJob(_id, callbacks) {
            attachments++;
            await callbacks.onItemReady({ index: 0, base64: 'YWJj' });
            return { preserved: new Set(), deliveryErrors: new Map() };
        },
    };
    try {
        await api.executePreparedSlots({ items: [item], backend: true,
            store: async value => previews.set(value.imgId, value), remove: async id => previews.delete(id),
            select: async () => {}, resolveTarget: () => ({ messageId: 0 }), activity() {}, render: async () => {},
            commit: async () => true, onStateChange: report, classifyError: error => ({ desc: error.message }),
            run: callbacks => api.submitRecoverableImageJob({ provider: 'comfyui', client, request: {}, ...callbacks.recoverable }),
        });
    } catch (error) { api.failFloorImageJob(job, error); }
    finally { api.releaseFloorImageJob(h.jobs, job); }
    await settle();
    const [record] = await api.listPendingImageJobs();
    assert.equal(record.state, 'active');
    assert.equal(previews.get(item.imgId).status, 'pending', 'do not manufacture failure for an accepted job');
    assert.equal(h.panel.state, 'uncertain');
    const { plan } = api.planImageJobReattach({ records: [record], backendJobs: [{ id: record.jobId }] });
    await api.executeImageJobReattachEntry({ entry: plan[0], client, delivery: {
        async deliver(current, entry, payload, guard) {
            await guard();
            previews.set(entry.imgId, { ...item, status: 'success', base64: payload.base64 });
        }, async settle() {},
        afterForget() { api.publishDrawRunActivity({ chatId: h.ctx.chatId, messageId: 0, swipeIndex: 0,
            provider: 'comfyui', phase: 'completed', success: 1, total: 1 }); },
    } });
    await settle();
    assert.equal(submissions, 1);
    assert.equal(attachments, 1);
    assert.equal((await api.listPendingImageJobs()).length, 0);
    assert.equal(previews.get(item.imgId).status, 'success');
    assert.equal(h.panel.state, 'success');
    assert.equal(h.floating.classList.contains('working'), false);
});

test('every orphaned busy state becomes actionable after task reconciliation', async t => {
    for (const state of BUSY) await t.test(state, async t => {
        const h = await mount(t, `orphan-${state}`);
        api.setStateForMessage(0, state, { current: 1, total: 4, cooldownUntil: Date.now() - 1 });
        api.publishDrawRunActivity({ chatId: h.ctx.chatId, messageId: 0, swipeIndex: 0,
            provider: 'comfyui', phase: 'reconciled' });
        await settle();
        assert.equal(h.panel.state, 'idle', `${state} must not survive without a local job or durable task`);
        for (const root of [h.panel.root, h.floating]) {
            assert.equal(root.classList.contains('working') || root.classList.contains('cooldown'), false);
            click(root.querySelector('.nd-btn-draw'), root === h.floating);
        }
        assert.equal(h.draws.length, 2, 'both visible draw controls work again');
    });
});

test('live jobs in every busy phase remain cancellable until their own settlement', async t => {
    for (const state of BUSY) for (const surface of ['floor', 'floating']) await t.test(`${state}: ${surface}`, async t => {
        const h = await mount(t, `live-${state}-${surface}`);
        const job = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
            () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
        const report = api.observeFloorImageJob(job, { getCurrentContext: () => h.ctx,
            onStateChange: reportToPanel });
        report(state, { current: 1, total: 4, cooldownUntil: Date.now() + 30000 });
        const root = surface === 'floor' ? h.panel.root : h.floating;
        click(root.querySelector('.nd-layer-active'), surface === 'floating');
        await Promise.all(h.aborts);
        await settle();
        assert.equal(h.aborts.length, 1, 'the visible cancel control starts cancellation');
        assert.equal(job.controller.signal.aborted, true);
        report('success', { total: 4, success: 0, aborted: true });
        api.releaseFloorImageJob(h.jobs, job);
        await settle();
        assert.equal(h.panel.state, 'idle', 'settled cancellation returns to drawing');
        click(root.querySelector('.nd-btn-draw'), surface === 'floating');
        assert.equal(h.draws.length, 1, 'cancelled jobs do not leave the draw button locked');
    });
});

test('retained local run projection cannot hide completion while another branch still runs', async t => {
    const h = await mount(t, 'retained-branch');
    const message = h.ctx.chat[0];
    const first = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
        () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
    const report = api.observeFloorImageJob(first, { getCurrentContext: () => h.ctx,
        onStateChange: reportToPanel });
    report('accepted', { runId: 'first', total: 4 });
    message.swipe_id = 1;
    const second = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
        () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
    api.observeFloorImageJob(second, { getCurrentContext: () => h.ctx, onStateChange: reportToPanel });
    message.swipe_id = 0;
    api.publishDrawRunActivity({ chatId: h.ctx.chatId, messageId: 0, swipeIndex: 0, provider: 'comfyui',
        runId: 'first', phase: 'completed', success: 4, total: 4 });
    await settle();
    assert.equal(h.panel.state, 'success');
    assert.equal(second.controller.signal.aborted, false, 'another branch stays active');
    api.clearFloorImageJobs(h.jobs);
});

test('returning from a hidden page reconciles every mounted busy control', async t => {
    const h = await mount(t, 'page-resume');
    api.setStateForMessage(0, 'gen', { current: 1, total: 4 });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await settle();
    assert.equal(h.panel.state, 'idle', 'returning to the page must not require switching chats');
    assert.equal(h.floating.classList.contains('working'), false);
});

test('all result states expire and leave both draw controls usable', async t => {
    for (const state of ['success', 'partial', 'error']) await t.test(state, async t => {
        const h = await mount(t, `terminal-${state}`);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        api.setStateForMessage(0, state, { success: state === 'success' ? 4 : 2, total: 4,
            error: { label: '失败', desc: '测试错误' } });
        for (const root of [h.panel.root, h.floating]) {
            click(root.querySelector('.nd-layer-active'), root === h.floating);
            assert.ok(root.classList.contains('show-detail'), 'result details remain clickable');
        }
        t.mock.timers.tick(8001);
        assert.equal(h.panel.state, 'idle');
        for (const root of [h.panel.root, h.floating]) click(root.querySelector('.nd-btn-draw'), root === h.floating);
        assert.equal(h.draws.length, 2);
    });
});

test('a timed-out cancellation releases both controls and preserves the same task for retry', async t => {
    const h = await mount(t, 'storage-timeout-ui');
    t.mock.method(console, 'error', () => {});
    const record = await api.recordPendingImageJob({ jobId: 'storage-timeout-ui', provider: 'comfyui',
        delivery: { mode: 'slots', chatId: h.ctx.chatId, messageId: '0', swipeIndex: 0 },
        items: [{ index: 0, slotId: 'lifecycle-slot', imgId: 'storage-timeout-ui' }] });
    await api.markPendingImageJobActive(record.jobId, record.leaseId);
    t.after(async () => {
        await api.forgetPendingImageJob(record.jobId, record.leaseId);
        for (const intent of await api.drawCancellationJournal.list()) await api.drawCancellationJournal.forget(intent.id);
    });
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('sti_image_backend_jobs', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const blocker = db.transaction('jobs', 'readwrite');
    let holding = true;
    const pump = () => { const request = blocker.objectStore('jobs').get(record.jobId);
        request.onsuccess = () => { if (holding) pump(); }; };
    pump();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    api.setStateForMessage(0, 'gen', { current: 1, total: 4 });
    click(h.floating.querySelector('.nd-layer-active'), true);
    await settle();
    t.mock.timers.tick(15001);
    await settle();
    try {
        assert.equal(h.errors.length, 1, 'the timeout is visible to the user');
        assert.equal(h.server.length, 0, 'no partial cancellation can bypass the unread task set');
    } finally { holding = false; blocker.abort(); db.close(); }
    await settle();
    click(h.panel.root.querySelector('.nd-layer-active'), false);
    await Promise.allSettled(h.aborts);
    await settle();
    assert.equal(h.aborts.length, 2, 'the other visible control can retry the same cancellation');
    assert.equal(h.server.length, 1);
    assert.equal((await api.getPendingImageJob(record.jobId)).state, 'cancelling');
    assert.deepEqual(h.server[0].jobIds, [record.jobId]);
});

test('an in-flight cancellation on an old reply branch cannot lock the current branch', async t => {
    const h = await mount(t, 'branch-cancellation');
    const gate = Promise.withResolvers();
    h.transport = targets => targets.runIds.includes('branch-0') ? gate.promise : Promise.resolve();
    t.after(async () => {
        gate.resolve();
        await Promise.allSettled(h.aborts);
        api.clearFloorImageJobs(h.jobs);
        for (const intent of await api.drawCancellationJournal.list()) await api.drawCancellationJournal.forget(intent.id);
    });
    const start = branch => {
        h.ctx.chat[0].swipe_id = branch;
        const job = api.acquireFloorImageJob(h.jobs, h.ctx, 0,
            () => ({ controller: new AbortController(), backendCancel: new AbortController() }));
        const report = api.observeFloorImageJob(job, { getCurrentContext: () => h.ctx, onStateChange: reportToPanel });
        report('accepted', { runId: `branch-${branch}`, total: 4 });
        return job;
    };
    start(0);
    click(h.floating.querySelector('.nd-layer-active'), true);
    await settle();
    assert.equal(h.server.length, 1);
    click(h.panel.root.querySelector('.nd-layer-active'), false);
    await settle();
    assert.equal(h.aborts.length, 1, 'two controls cannot submit the same in-flight cancellation twice');
    const second = start(1);
    click(h.panel.root.querySelector('.nd-layer-active'), false);
    await settle();
    assert.equal(h.aborts.length, 2, 'the new branch has its own cancellation target');
    assert.equal(second.controller.signal.aborted, true);
    assert.deepEqual(h.server[1].runIds, ['branch-1']);
});

test('page resume keeps a durable task cancellable when the local job registry is empty', async t => {
    const h = await mount(t, 'durable-page-resume');
    const record = await api.recordPendingImageJob({ jobId: 'durable-page-resume', provider: 'comfyui',
        delivery: { mode: 'slots', chatId: h.ctx.chatId, messageId: '0', swipeIndex: 0 },
        items: [{ index: 0, slotId: 'lifecycle-slot', imgId: 'durable-page-resume' }] });
    await api.markPendingImageJobActive(record.jobId, record.leaseId);
    t.after(async () => {
        await api.forgetPendingImageJob(record.jobId, record.leaseId);
        for (const intent of await api.drawCancellationJournal.list()) await api.drawCancellationJournal.forget(intent.id);
    });
    window.dispatchEvent(new window.Event('pageshow'));
    await settle();
    assert.equal(h.panel.state, 'accepted');
    click(h.floating.querySelector('.nd-layer-active'), true);
    await Promise.all(h.aborts);
    await settle();
    assert.deepEqual(h.server[0].jobIds, [record.jobId]);
    assert.equal(h.panel.state, 'cancelling');
});
