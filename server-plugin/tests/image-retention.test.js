'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanupImages, mountImageRetention } = require('../lib/image-retention');
const oldName = 'comfy_auto_img-11111111-1111-4111-8111-111111111111.png';
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-retention-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const images = path.join(root, 'images'), files = path.join(root, 'files');
    await fs.mkdir(path.join(images, 'artist'), { recursive: true }); await fs.mkdir(files);
    const user = { profile: { handle: 'fixture' }, directories: { images, files } };
    const config = { settings: { cacheDays: 3, characterTags: [] } };
    const save = () => fs.writeFile(path.join(files, 'SillyTavernImage_NovelDraw.json'), JSON.stringify(config));
    await save();
    const put = async (name, age = 10) => {
        const p = path.join(images, 'artist', name); await fs.writeFile(p, 'fixture');
        const when = new Date(Date.now() - age * 86400000); await fs.utimes(p, when, when); return p;
    };
    return { root, user, config, save, put };
}
test('expired generated files are deleted; recent, manual and role-reference files survive', async t => {
    const f = await fixture(t);
    const expired = await f.put(oldName); const recent = await f.put(oldName.replace('11111111', '22222222'), 1);
    const manual = await f.put('reference.png'); const role = await f.put(oldName.replace('11111111', '33333333'));
    f.config.settings.characterTags = [{ photoUrl: '/user/images/artist/' + path.basename(role) }]; await f.save();
    const result = await cleanupImages(f.user);
    assert.equal(result.deleted.length, 1); await assert.rejects(fs.stat(expired), { code: 'ENOENT' });
    for (const p of [recent, manual, role]) assert.ok(await fs.stat(p));
    const second = await cleanupImages(f.user);
    assert.equal(second.deleted.length, 0); assert.deepEqual(second.expired, result.deleted);
});
test('missing or invalid settings never authorize deletion; symlinks are not followed', async t => {
    const f = await fixture(t); const image = await f.put(oldName);
    f.config.settings.cacheDays = 0; await f.save(); await assert.rejects(cleanupImages(f.user)); assert.ok(await fs.stat(image));
    f.config.settings.cacheDays = 3; await f.save();
    const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, oldName), 'keep');
    try { await fs.symlink(outside, path.join(f.user.directories.images, 'linked'), 'junction'); } catch (e) { if (e.code !== 'EPERM') throw e; }
    await cleanupImages(f.user); assert.equal(await fs.readFile(path.join(outside, oldName), 'utf8'), 'keep');
});
test('real authenticated HTTP route uses stored days rather than caller supplied paths or cutoff', async t => {
    const f = await fixture(t); await f.put(oldName);
    const express = require('express'), app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { ...f.user, directories: { ...f.user.directories, userImages: f.user.directories.images } }; next(); });
    const close = mountImageRetention(app, { intervalMs: 60000 }); t.after(close);
    const server = app.listen(0, '127.0.0.1'); await new Promise(ok => server.once('listening', ok)); t.after(() => new Promise(ok => server.close(ok)));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/images/cleanup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 0, path: '/' }) });
    assert.equal(res.status, 200); const body = await res.json(); assert.equal(body.days, 3); assert.equal(body.deleted.length, 1);
});
test('the background timer cleans a registered user without another browser request', async t => {
    const f = await fixture(t); const image = await f.put(oldName);
    const express = require('express'), app = express();
    app.use((req, _res, next) => { req.user = { ...f.user, directories: { ...f.user.directories, userImages: f.user.directories.images } }; next(); });
    const close = mountImageRetention(app, { intervalMs: 10 }); t.after(close);
    app.get('/visit', (_req, res) => res.sendStatus(200));
    const server = app.listen(0, '127.0.0.1'); await new Promise(ok => server.once('listening', ok)); t.after(() => new Promise(ok => server.close(ok)));
    await fetch(`http://127.0.0.1:${server.address().port}/visit`);
    let removed = false;
    for (let i = 0; i < 50; i++) {
        try { await fs.stat(image); } catch (e) { if (e.code !== 'ENOENT') throw e; removed = true; break; }
        await new Promise(ok => setTimeout(ok, 10));
    }
    assert.equal(removed, true);
    await close();
});
test('a user with no server image directory can still clean its expired browser records', async t => {
    const f = await fixture(t); await fs.rm(f.user.directories.images, { recursive: true });
    const result = await cleanupImages(f.user); assert.equal(result.ok, true); assert.deepEqual(result.deleted, []);
});
