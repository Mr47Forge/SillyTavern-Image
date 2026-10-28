'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setImmediate: turn } = require('node:timers/promises');
const { createCancellationRegistry, registerCancellationRoutes } = require('../cancellation.js');
const { createAsyncImageJobManager } = require('../image-jobs/job-manager.js');

function fixture(t, registryOptions = {}) {
    const registry = createCancellationRegistry(registryOptions);
    const starts = [], executions = [];
    const jobs = createAsyncImageJobManager({ cancellations: registry, adapters: { fixture: {
        execute({ owner, item, signal }) {
            starts.push({ owner, name: item.request.name });
            return new Promise((resolve, reject) => {
                executions.push({ resolve, signal });
                signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
            });
        },
    } } });
    let route;
    registerCancellationRoutes({ post(_path, handler) { route = handler; } }, {
        registry, jobManager: jobs,
    });
    t.after(() => { jobs.close(); registry.close(); });
    return {
        starts, executions, jobs,
        create(id, owner = 'alice', items = [id]) {
            return jobs.createJob({ owner, provider: 'fixture', requestId: id, context: {}, delay: { min: 0, max: 0 },
                items: items.map(name => ({ kind: 'image', request: { name }, timeout: 60_000 })) });
        },
        cancel(body, owner = 'alice') {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } };
            route({ user: owner ? { profile: { handle: owner } } : undefined, body: { owner, ...body } }, res);
            return res;
        },
    };
}

test('atomic floor cancellation never starts the queued sibling (100 event-loop interleavings)', async t => {
    const f = fixture(t);
    for (let i = 0; i < 100; i++) {
        const a = `a-${i}`, b = `b-${i}`;
        f.create(a); f.create(b); await turn();
        assert.equal(f.cancel({ jobIds: [a, b] }).statusCode, 200);
        await turn();
        assert.equal(f.starts.some(item => item.name === b), false);
        assert.equal(f.jobs.getJob('alice', b).state, 'cancelled');
        f.jobs.deleteJob('alice', a); f.jobs.deleteJob('alice', b);
    }
    assert.equal(f.starts.length, 100);
});

test('duplicate cancellation, absent IDs and foreign IDs are owner-scoped and idempotent', async t => {
    const f = fixture(t);
    f.create('a'); f.create('b'); f.create('private', 'bob'); await turn();
    const command = { jobIds: ['a', 'b', 'b', 'missing', 'private'] };
    assert.equal(f.cancel(command).statusCode, 200);
    assert.equal(f.cancel(command).statusCode, 200);
    await turn();
    assert.equal(f.jobs.getJob('bob', 'private').state, 'running');
    assert.equal(f.executions.find((_, index) => f.starts[index].owner === 'bob').signal.aborted, false);
    assert.throws(() => f.create('missing'), error => error.code === 'request_cancelled');
    assert.doesNotThrow(() => f.create('missing', 'bob'));
});

test('ready image survives cancellation and ACK/deletion cannot reopen its request ID', async t => {
    const f = fixture(t);
    f.create('batch', 'alice', ['ready', 'running']);
    await turn();
    f.executions[0].resolve({ buffer: Buffer.from('image'), mime: 'image/png' });
    await turn();
    f.create('queued');
    f.cancel({ jobIds: ['batch', 'queued'] }); await turn();
    assert.equal(f.jobs.getResult('alice', 'batch', 0).buffer.toString(), 'image');
    assert.equal(f.jobs.consumeResult('alice', 'batch', 0).ok, true);
    assert.equal(f.jobs.deleteJob('alice', 'batch').ok, true);
    assert.throws(() => f.create('batch'), error => error.code === 'request_cancelled');
    f.create('new-reroll'); await turn();
    assert.equal(f.starts.at(-1).name, 'new-reroll');
    assert.equal(f.starts.some(item => item.name === 'queued'), false);
});

test('legacy run cancellation intent and current image jobs remain atomic and owner scoped', async t => {
    const f = fixture(t);
    f.create('running'); await turn(); f.create('queued');
    assert.equal(f.cancel({jobIds:['running','queued'],runIds:['old-plan']}).statusCode,200);
    await turn();
    assert.deepEqual(f.starts.map(item=>item.name),['running']);
    assert.equal(f.jobs.getJob('alice','queued').state,'cancelled');
    assert.equal(f.cancel({runIds:['old-plan']}).statusCode,200);
});

test('invalid or unauthenticated sets cannot partially cancel a valid job', async t => {
    const f = fixture(t);
    f.create('running'); await turn();
    for (const body of [{ jobIds: ['running', '../invalid'] }, { runIds: 'run' }, {}, { jobIds: Array(129).fill('running') }]) {
        assert.equal(f.cancel(body).statusCode, 400);
        assert.equal(f.executions[0].signal.aborted, false);
    }
    assert.equal(f.cancel({ jobIds: ['running'] }, null).statusCode, 403);
    assert.equal(f.executions[0].signal.aborted, false);
});

test('admission reserves cancellation at capacity without starting a queued sibling', async t => {
    let now = 0;
    const f = fixture(t, { now: () => now, retentionMs: 10, maxTargetsPerOwner: 3 });
    f.create('running'); f.create('queued'); await turn();
    assert.equal(f.cancel({ jobIds: ['old'] }).statusCode, 200);
    assert.throws(() => f.create('new'), error => error.code === 'cancellation_limit');
    assert.equal(f.cancel({ jobIds: ['running', 'queued'] }).statusCode, 200);
    await turn();
    assert.equal(f.executions[0].signal.aborted, true);
    assert.deepEqual(f.starts.map(item => item.name), ['running']);
    f.jobs.deleteJob('alice', 'running'); f.jobs.deleteJob('alice', 'queued');
    assert.throws(() => f.create('running'), error => error.code === 'request_cancelled');
    now = 11;
    assert.doesNotThrow(() => f.create('old'));
});

test('a long-running reservation cannot expire and a normally deleted result releases capacity', async t => {
    let now = 0;
    const f = fixture(t, { now: () => now, retentionMs: 10, maxTargetsPerOwner: 1 });
    f.create('running'); await turn(); now = 100;
    assert.equal(f.cancel({ jobIds: ['unseen'] }).statusCode, 429);
    f.executions[0].resolve({ buffer: Buffer.from('image'), mime: 'image/png' }); await turn();
    assert.equal(f.jobs.deleteJob('alice', 'running').ok, true);
    assert.doesNotThrow(() => f.create('next'));
    assert.equal(f.cancel({ jobIds: ['next'] }).statusCode, 200);
});

test('global cancellation capacity rejects new admission but cannot prevent an accepted owner from stopping', async t => {
    const f = fixture(t, { maxTargets: 2 });
    f.create('a', 'alice'); f.create('b', 'bob'); await turn();
    assert.throws(() => f.create('c', 'carol'), error => error.code === 'cancellation_limit');
    assert.equal(f.cancel({ jobIds: ['a'] }, 'alice').statusCode, 200);
    assert.equal(f.cancel({ jobIds: ['b'] }, 'bob').statusCode, 200);
});

test('an account switch cannot acknowledge another profiles cancellation intent', async t => {
    const f = fixture(t);
    f.create('a', 'alice'); await turn();
    const rejected = f.cancel({ owner: 'alice', jobIds: ['a'] }, 'bob');
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.body.code, 'cancellation_owner_mismatch');
    assert.equal(f.executions[0].signal.aborted, false);
    assert.equal(f.cancel({ owner: 'alice', jobIds: ['a'] }, 'alice').statusCode, 200);
    assert.equal(f.executions[0].signal.aborted, true);
});
