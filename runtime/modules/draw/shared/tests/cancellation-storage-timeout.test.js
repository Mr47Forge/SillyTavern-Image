import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';

async function settle() { for (let i = 0; i < 30; i++) await setImmediate(); }
function open(factory, name, version, store) {
    return new Promise((resolve, reject) => {
        const req = factory.open(name, version);
        req.onupgradeneeded = () => req.result.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

test('a blocked task database releases the caller and can reopen after the blocker closes', async t => {
    const factory = globalThis.indexedDB = new IDBFactory();
    const blocker = await open(factory, 'sti_image_backend_jobs', 2, 'jobs');
    const api = await import('../pending-image-jobs.js?blocked-open');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let rejected;
    const operation = api.listPendingImageJobs().catch(error => { rejected = error; });
    await settle();
    t.mock.timers.tick(15001);
    await settle();
    try { assert.ok(rejected, 'storage must reject instead of leaving the capsule locked indefinitely'); }
    finally { blocker.close(); await operation; }
    assert.deepEqual(await api.listPendingImageJobs(), []);
});

for (const kind of ['tasks', 'intents']) test(`${kind}: a stalled transaction times out without late writes`, async t => {
    const factory = globalThis.indexedDB = new IDBFactory();
    const api = kind === 'tasks' ? await import('../pending-image-jobs.js?stalled-transaction')
        : (await import('../draw-cancellation-journal.js?stalled-transaction')).drawCancellationJournal;
    if (kind === 'tasks') await api.listPendingImageJobs(); else await api.list();
    const db = await open(factory, kind === 'tasks' ? 'sti_image_backend_jobs' : 'sti_draw_cancellations',
        kind === 'tasks' ? 3 : 1, kind === 'tasks' ? 'jobs' : 'intents');
    const storeName = kind === 'tasks' ? 'jobs' : 'intents';
    const blocker = db.transaction(storeName, 'readwrite');
    let holding = true;
    const keepAlive = () => {
        const req = blocker.objectStore(storeName).get('absent');
        req.onsuccess = () => { if (holding) keepAlive(); };
    };
    keepAlive();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let rejected;
    const operation = (kind === 'tasks' ? api.listPendingImageJobs()
        : api.record({ owner: 'fixture', jobIds: ['must-not-be-written'], runIds: [] }))
        .catch(error => { rejected = error; });
    await settle();
    t.mock.timers.tick(15001);
    await settle();
    try { assert.ok(rejected, 'queued database work must release the caller within its deadline'); }
    finally {
        holding = false;
        blocker.abort();
        db.close();
        await operation;
    }
    const records = kind === 'tasks' ? await api.listPendingImageJobs() : await api.list();
    assert.deepEqual(records, [], 'a timed-out write cannot commit after the user retries');
});
