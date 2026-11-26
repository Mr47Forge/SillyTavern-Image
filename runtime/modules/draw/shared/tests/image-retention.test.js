import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { isExpiredSavedImage } from '../image-retention.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const host = globalThis.__retentionFixture = { pending: new Map(), activity: new Map() };
const stubs = {
    'extensions.js': 'export const getContext=()=>({chat:[],chatId:"retention"});',
    'user.js': 'export const getCurrentUserHandle=()=>globalThis.__retentionFixture.owner;',
    'utils.js': 'export const saveBase64AsFile=()=>{};',
    'script.js': 'export const getRequestHeaders=()=>({});',
    'pending-image-jobs.js': 'export const getPendingImageJobSlots=async()=>{globalThis.__retentionFixture.beforePending?.();return globalThis.__retentionFixture.pending;};',
    'slot-activity.js': 'export const getSlotActivity=id=>globalThis.__retentionFixture.activity.get(id);',
};
const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: "export * from './gallery-cache.js';" }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'host', setup(b) {
    b.onResolve({ filter: /\.js$/ }, ({ path }) => stubs[path.split('/').at(-1)] ? { path: path.split('/').at(-1), namespace: 'host' } : null);
    b.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: stubs[path] }));
} }] });
let seq = 0;
const savedUrl = '/user/images/artist/comfy_auto_img-11111111-1111-4111-8111-111111111111.png';
async function setup() {
    host.owner = 'retention'; host.beforePending = null;
    globalThis.indexedDB = new IDBFactory(); globalThis.BroadcastChannel = undefined;
    globalThis.document = { getElementById: () => null }; host.pending.clear(); host.activity.clear();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, days: 3, cutoff: Date.now() - 3 * 86400000, deleted: [savedUrl], expired: [savedUrl] }) });
    const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n// fixture ' + seq++).toString('base64'));
    const db = await api.openDB();
    await new Promise((ok, no) => { const tx = db.transaction(['previews', 'selections'], 'readwrite'); const s = tx.objectStore('previews');
        for (const [imgId, status, age, url] of [['old-saved', 'success', 10, savedUrl], ['old-local', 'success', 10, null], ['recent', 'success', 0, null], ['pending', 'pending', 10, null], ['active', 'success', 10, null], ['recovered', 'success', 0, savedUrl]])
            s.put({ imgId, slotId: imgId, timestamp: Date.now() - age * 86400000, base64: 'YWJj', savedUrl: url, status });
        tx.objectStore('selections').put({ slotId: 'old-saved', selectedImgId: 'old-saved' });
        tx.oncomplete = ok; tx.onerror = () => no(tx.error);
    }); host.activity.set('active', {}); return { api, db };
}
test('expiry deletes saved/local records and stale selections; active tasks and recent images survive', async () => {
    const { api, db } = await setup(); const result = await api.clearExpiredCache(3);
    assert.equal(result.local, 3); assert.equal(result.server, 1);
    for (const id of ['old-saved', 'old-local', 'recovered']) assert.equal(await api.getPreview(id), undefined);
    for (const id of ['recent', 'pending', 'active']) assert.ok(await api.getPreview(id));
    const selection = await new Promise(ok => { const q = db.transaction('selections').objectStore('selections').get('old-saved'); q.onsuccess = () => ok(q.result); }); assert.equal(selection, undefined);
});
test('a failed server cleanup rejects without deleting the local original', async () => {
    const { api } = await setup(); globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(api.clearExpiredCache(3), /503/); assert.ok(await api.getPreview('old-saved'));
});
test('a recent local original is kept when its server file is missing for reasons other than expiry', async () => {
    const { api } = await setup();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, cutoff: Date.now() - 3 * 86400000, deleted: [], expired: [] }) });
    await api.clearExpiredCache(3); assert.ok(await api.getPreview('recovered'));
});
test('account switching during cleanup cannot apply one users expiry policy to another database', async () => {
    const { api } = await setup(); host.beforePending = () => { host.owner = 'other'; };
    await assert.rejects(api.clearExpiredCache(), /账号已切换/);
    host.owner = 'retention'; host.beforePending = null;
    assert.ok(await api.getPreview('old-saved'));
});
test('native chat deletion event runs cleanup immediately, including fresh records of that chat', async () => {
    const { api, db } = await setup();
    await new Promise(ok => { const tx = db.transaction('previews', 'readwrite');
        tx.objectStore('previews').put({ imgId: 'chat-only', slotId: 'chat-only', chatId: 'deleted-chat', base64: 'YWJj', status: 'success', timestamp: Date.now() }); tx.oncomplete = ok;
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, cutoff: Date.now() - 3 * 86400000, deleted: [], expired: [], deletedChatIds: ['deleted-chat'] }) });
    const src = await fs.readFile(new URL('../../providers/comfyui/comfy-draw.js', import.meta.url), 'utf8');
    const start = src.indexOf('    const cleanDeletedChatImages = async () =>');
    const code = src.slice(start, src.indexOf('\n    events.on(event_types.CHARACTER_MESSAGE_RENDERED', start));
    const callbacks = new Map();
    new Function('events', 'event_types', 'cleanExpiredImages', 'trackServerChatImages', 'imageRetentionRunning', code)(
        { on: (key, fn) => callbacks.set(key, fn) }, { CHAT_DELETED: 'chat_deleted', GROUP_CHAT_DELETED: 'group_chat_deleted', CHAT_CHANGED: 'chat_changed' }, api.clearExpiredCache, api.trackServerChatImages, null);
    assert.equal(typeof callbacks.get('group_chat_deleted'), 'function');
    await callbacks.get('chat_deleted')();
    assert.equal(await api.getPreview('chat-only'), undefined); assert.ok(await api.getPreview('recent'));
});
test('an expired portable reference cannot restore an old image after browser cache eviction', () => {
    assert.equal(isExpiredSavedImage({ savedUrl, updatedAt: Date.now() - 10 * 86400000 }, 3), true);
    assert.equal(isExpiredSavedImage({ savedUrl: '/user/images/reference.png', updatedAt: 1 }, 3), false);
    assert.equal(isExpiredSavedImage({ savedUrl, updatedAt: Date.now() }, 3), false);
});
test('real cleanup HTTP removes the H28K fixture and browser original together', async t => {
    const { api } = await setup(); const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-cleanup-e2e-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const images = path.join(root, 'images'), files = path.join(root, 'files');
    await fs.mkdir(path.join(images, 'artist'), { recursive: true }); await fs.mkdir(files);
    await fs.writeFile(path.join(files, 'SillyTavernImage_NovelDraw.json'), JSON.stringify({ settings: { cacheDays: 3 } }));
    const image = path.join(images, 'artist', savedUrl.split('/').at(-1));
    await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
    const old = new Date(Date.now() - 10 * 86400000); await fs.utimes(image, old, old);
    const express = require('express'), app = express();
    app.use((req, _res, next) => { req.user = { profile: { handle: 'retention' }, directories: { userImages: images, files } }; next(); });
    const { mountImageRetention } = require('../../../../../server-plugin/lib/image-retention.js');
    const stop = mountImageRetention(app); t.after(stop);
    const server = app.listen(0, '127.0.0.1'); await new Promise(ok => server.once('listening', ok)); t.after(() => new Promise(ok => server.close(ok)));
    const nativeFetch = (await import('node:http')).request;
    globalThis.fetch = (_url, options) => new Promise((ok, no) => {
        const q = nativeFetch(`http://127.0.0.1:${server.address().port}/v1/images/cleanup`, options, res => {
            let body = ''; res.on('data', x => body += x); res.on('end', () => ok({ ok: res.statusCode === 200, status: res.statusCode, json: async () => JSON.parse(body) }));
        }); q.on('error', no); q.end();
    });
    const result = await api.clearExpiredCache(3); assert.equal(result.server, 1);
    await assert.rejects(fs.stat(image), { code: 'ENOENT' }); assert.equal(await api.getPreview('old-saved'), undefined);
    assert.ok(await api.getPreview('recent')); assert.ok(await api.getPreview('pending'));
});
