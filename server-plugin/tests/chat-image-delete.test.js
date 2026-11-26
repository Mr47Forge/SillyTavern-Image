'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cleanupImages } = require('../lib/image-retention');
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-chat-delete-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const directories = Object.fromEntries(['files', 'images', 'chats', 'groupChats'].map(k => [k, path.join(root, k)]));
    for (const dir of Object.values(directories)) await fs.mkdir(dir);
    await fs.mkdir(path.join(directories.chats, 'artist')); await fs.mkdir(path.join(directories.chats, 'other'));
    await fs.writeFile(path.join(directories.files, 'SillyTavernImage_NovelDraw.json'), JSON.stringify({ settings: { cacheDays: 3, characterTags: [] } }));
    const user = { profile: { handle: 'fixture' }, directories };
    const image = async n => { const name = `comfy_auto_img-${String(n).padStart(8, '0')}-1111-4111-8111-111111111111.png`; await fs.writeFile(path.join(directories.images, name), 'fixture'); return '/user/images/' + name; };
    const chat = async (name, urls, group = false) => {
        const p = path.join(group ? directories.groupChats : directories.chats, name + '.jsonl');
        await fs.writeFile(p, JSON.stringify({ mes: '测试剧情不应被修改', extra: { stimageDrawSaved: Object.fromEntries(urls.map((url, i) => ['slot-' + i, { savedUrl: url }])) } }) + '\n'); return p;
    };
    return { root, user, image, chat, exists: url => fs.stat(path.join(directories.images, path.basename(url))).then(() => true, () => false) };
}
test('deleting one chat deletes its images and old redraw versions, preserving other chats and shared references', async t => {
    const f = await fixture(t), one = await f.image(1), two = await f.image(2), shared = await f.image(3), other = await f.image(4);
    const p = await f.chat('artist/a', [one, shared]); await f.chat('other/b', [shared, other]);
    await cleanupImages(f.user);
    await f.chat('artist/a', [two, shared]); await cleanupImages(f.user);
    await fs.unlink(p); const result = await cleanupImages(f.user);
    assert.deepEqual(new Set(result.deleted), new Set([one, two]));
    assert.equal(await f.exists(shared), true); assert.equal(await f.exists(other), true);
    assert.ok(result.deletedChatIds.includes('a'));
});
test('group chat deletion works; same-name live chats and renamed branches are preserved', async t => {
    const f = await fixture(t), a = await f.image(10), b = await f.image(11), c = await f.image(12);
    const p = await f.chat('artist/same', [a]); await f.chat('other/same', [b]); const group = await f.chat('group-a', [c], true);
    await cleanupImages(f.user); await fs.unlink(p); await fs.unlink(group);
    const result = await cleanupImages(f.user); assert.equal(await f.exists(a), false); assert.equal(await f.exists(c), false); assert.equal(await f.exists(b), true);
    assert.equal(result.deletedChatIds.includes('same'), false);
    await fs.rename(path.join(f.user.directories.chats, 'other/same.jsonl'), path.join(f.user.directories.chats, 'other/renamed.jsonl'));
    await cleanupImages(f.user); assert.equal(await f.exists(b), true);
});
test('failed chat deletion, reference photos and unknown image ownership never authorize deleting a recent image', async t => {
    const f = await fixture(t), a = await f.image(20), reference = await f.image(21), unknown = await f.image(22);
    const p = await f.chat('artist/a', [a, reference]);
    await fs.writeFile(path.join(f.user.directories.files, 'SillyTavernImage_NovelDraw.json'), JSON.stringify({ settings: { cacheDays: 3, characterTags: [{ photoUrl: reference }] } }));
    await cleanupImages(f.user); await cleanupImages(f.user); assert.equal(await f.exists(a), true);
    await fs.unlink(p); await cleanupImages(f.user);
    assert.equal(await f.exists(a), false); assert.equal(await f.exists(reference), true); assert.equal(await f.exists(unknown), true);
});
test('native copy-and-unlink rename preserves every redraw version, then deletion of the renamed chat cleans all', async t => {
    const f = await fixture(t), a = await f.image(30), b = await f.image(31);
    const original = await f.chat('artist/before', [a]); await cleanupImages(f.user);
    await f.chat('artist/before', [b]); await cleanupImages(f.user);
    const renamed = path.join(f.user.directories.chats, 'artist/after.jsonl');
    await fs.copyFile(original, renamed); await fs.unlink(original);
    const result = await cleanupImages(f.user);
    assert.equal(await f.exists(a), true); assert.equal(await f.exists(b), true);
    assert.equal(result.deletedChatIds.includes('before'), false);
    await fs.unlink(renamed); await cleanupImages(f.user);
    assert.equal(await f.exists(a), false); assert.equal(await f.exists(b), false);
});
