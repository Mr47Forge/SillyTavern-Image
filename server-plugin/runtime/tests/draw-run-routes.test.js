'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MAX_ENVELOPE_BYTES } = require('../draw-runs/envelope.js');
const { registerDrawRunRoutes } = require('../draw-runs/routes.js');

function createRouter() {
    const routes = new Map();
    return {
        routes,
        get(path, handler) { routes.set(`GET ${path}`, handler); },
        post(path, handler) { routes.set(`POST ${path}`, handler); },
        delete(path, handler) { routes.set(`DELETE ${path}`, handler); },
    };
}

async function invoke(router, method, path, { owner = 'alice', body = {}, params = {}, headers = {} } = {}) {
    const handler = router.routes.get(`${method} ${path}`);
    assert.ok(handler, `missing route ${method} ${path}`);
    const responseHeaders = new Map();
    const req = {
        body,
        params,
        headers,
        user: owner === null ? undefined : { profile: { handle: owner } },
    };
    const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        setHeader(name, value) { responseHeaders.set(String(name).toLowerCase(), value); },
        send(value) { this.body = value; return this; },
    };
    await handler(req, res);
    return res;
}

test('Draw Run routes derive ownership only from the authenticated profile', async () => {
    const calls = [];
    const manager = {
        create(owner, body, request) {
            calls.push({ operation: 'create', owner, body, request });
            return { id: body.runId, state: 'queued' };
        },
        list(owner) { calls.push({ operation: 'list', owner }); return []; },
        get(owner, runId) { calls.push({ operation: 'get', owner, runId }); return { id: runId, state: 'queued' }; },
        cancel(owner, runId) { calls.push({ operation: 'cancel', owner, runId }); return { id: runId, state: 'cancelled' }; },
        acknowledge(owner, runId) { calls.push({ operation: 'ack', owner, runId }); return { ok: true }; },
    };
    const router = createRouter();
    registerDrawRunRoutes(router, { manager });

    const created = await invoke(router, 'POST', '/v1/draw-runs', {
        body: { runId: 'run-test-201', owner: 'mallory' },
    });
    assert.equal(created.statusCode, 410);
    assert.equal(created.body.code, 'scene_planning_removed');
    assert.equal(calls.length, 0);
    await invoke(router, 'GET', '/v1/draw-runs');
    assert.equal(calls[0].owner, 'alice');

    for (const [method, path] of [
        ['POST', '/v1/draw-runs'],
        ['GET', '/v1/draw-runs'],
        ['GET', '/v1/draw-runs/:runId'],
        ['POST', '/v1/draw-runs/:runId/cancel'],
        ['DELETE', '/v1/draw-runs/:runId'],
    ]) {
        const response = await invoke(router, method, path, { owner: null, params: { runId: 'run-test-201' } });
        assert.equal(response.statusCode, 403, `${method} ${path}`);
    }
});

test('Retired planner POST never admits oversized inputs to the manager', async () => {
    let createCount = 0;
    const router = createRouter();
    registerDrawRunRoutes(router, {
        manager: {
            create() { createCount += 1; },
            list() { return []; },
            get() { return null; },
            cancel() { return null; },
            acknowledge() { return null; },
        },
    });

    const response = await invoke(router, 'POST', '/v1/draw-runs', {
        headers: { 'content-length': String(MAX_ENVELOPE_BYTES + 1) },
    });
    assert.equal(response.statusCode, 410);
    assert.equal(response.body.code, 'scene_planning_removed');
    assert.equal(createCount, 0);
});

test('Retired planner POST never invokes or logs the planning manager', async () => {
    const calls = [];
    const router = createRouter();
    registerDrawRunRoutes(router, {
        manager: {
            create() {
                throw Object.assign(new Error('The SillyTavern listening socket is unavailable.'), {
                    code: 'loopback_socket_unavailable',
                    status: 503,
                });
            },
        },
        logger: {
            error(...args) { calls.push(args); },
        },
    });

    const response = await invoke(router, 'POST', '/v1/draw-runs', {
        body: { runId: 'run-test-202', apiKey: 'must-not-be-logged' },
    });

    assert.equal(response.statusCode, 410);
    assert.equal(response.body.code, 'scene_planning_removed');
    assert.equal(calls.length, 0);
});
