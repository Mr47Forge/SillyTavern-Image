'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getCurrentUser } = require('./user-context');
const { trackChatImages } = require('./chat-image-ownership');

// Only names emitted by this plugin, never uploaded pictures or character cards.
const GENERATED = /^(?:comfy_auto|draw)_img-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpe?g|webp)$/i;
const DAY = 86400000;
const running = new Map();
async function cleanupImages(user, now = Date.now()) {
    const { images, files } = user.directories;
    const saved = JSON.parse(await fs.readFile(path.join(files, 'SillyTavernImage_NovelDraw.json'), 'utf8'));
    const days = saved.settings?.cacheDays;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('图片保留天数无效，未执行删除');
    const chatImages = await trackChatImages(user, now);
    const cutoff = now - days * DAY;
    const journalPath = path.join(files, 'SillyTavernImage_ExpiredImages.json');
    let journal = {};
    try {
        const stat = await fs.lstat(journalPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('图片清理记录不能是链接或目录');
        journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
        if (!journal || typeof journal !== 'object' || Array.isArray(journal)) throw new Error('图片清理记录无效');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const originalJournal = JSON.stringify(journal);
    for (const [url, at] of Object.entries(journal)) {
        if (!Number.isFinite(at) || at < now - 31 * DAY) delete journal[url];
    }
    let root;
    try { root = await fs.realpath(images); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const protectedUrls = new Set();
    for (const person of saved.settings.characterTags || []) {
        if (typeof person?.photoUrl === 'string') {
            try { protectedUrls.add(decodeURIComponent(new URL(person.photoUrl, 'http://local').pathname)); }
            catch { protectedUrls.add(person.photoUrl); }
        }
    }
    const deleted = [], errors = [];
    async function scan(dir, depth = 0) {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
            const p = path.join(dir, item.name);
            if (item.isDirectory() && depth < 1) { await scan(p, depth + 1); continue; }
            if (!item.isFile() || !GENERATED.test(item.name)) continue;
            const relative = path.relative(root, p).split(path.sep).join('/');
            const url = '/user/images/' + relative;
            if (protectedUrls.has(url)) continue;
            try {
                const stat = await fs.lstat(p);
                if (!stat.isFile() || stat.isSymbolicLink()
                    || (stat.mtimeMs >= cutoff && !chatImages.orphaned.has(url))) continue;
                // Recheck the resolved parent: a replaced folder must never redirect deletion.
                if (await fs.realpath(path.dirname(p)) !== path.dirname(p)) continue;
                await fs.unlink(p); deleted.push(url); journal[url] = now;
            } catch (error) { if (error.code !== 'ENOENT') errors.push({ path: url, code: error.code || 'DELETE_FAILED' }); }
        }
    }
    if (root) await scan(root);
    // Other devices may reconnect after the timer already deleted a file. Keep a
    // bounded deletion journal so missing files never imply deleting a recent local original.
    if (JSON.stringify(journal) !== originalJournal) {
        const temp = journalPath + '.' + randomUUID() + '.tmp';
        try {
            await fs.writeFile(temp, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
            await fs.rename(temp, journalPath);
        } finally { await fs.rm(temp, { force: true }); }
    }
    return { ok: errors.length === 0, days, cutoff, deleted, expired: Object.keys(journal), deletedChatIds: chatImages.deletedChatIds, errors };
}
function mountImageRetention(router, { intervalMs = 10 * 60000 } = {}) {
    const users = new Map();
    const run = (user, operation = cleanupImages) => {
        const owner = user.profile.handle;
        const task = (running.get(owner) || Promise.resolve()).catch(() => {}).then(() => operation(user));
        running.set(owner, task);
        void task.finally(() => { if (running.get(owner) === task) running.delete(owner); }).catch(() => {});
        return task;
    };
    // Remember authenticated roots, not caller supplied paths. The timer continues
    // after a browser closes; a server restart registers users on their next visit.
    router.use((req, _res, next) => {
        const user = getCurrentUser(req);
        if (user?.directories.files) users.set(user.profile.handle, user);
        next();
    });
    router.post('/v1/images/cleanup', async (req, res) => {
        const user = getCurrentUser(req);
        res.set('Cache-Control', 'private, no-store');
        if (!user?.directories.files) return res.status(403).json({ ok: false, error: '请先登录酒馆' });
        try { return res.json(await run(user)); }
        catch (error) {
            console.error('[SillyTavern-Image] 图片清理失败:', error.code || error.message);
            return res.status(503).json({ ok: false, error: 'H28K 图片清理失败，请检查后台日志' });
        }
    });
    router.post('/v1/images/track-chats', async (req, res) => {
        const user = getCurrentUser(req);
        if (!user?.directories.files) return res.status(403).json({ ok: false, error: '请先登录酒馆' });
        try { await run(user, trackChatImages); return res.json({ ok: true }); }
        catch (error) {
            console.error('[SillyTavern-Image] 会话图片登记失败:', error.code || error.message);
            return res.status(503).json({ ok: false, error: '会话图片登记失败，将在下次同步重试' });
        }
    });
    const timer = setInterval(() => {
        for (const user of users.values()) void run(user).then(result => {
            if (!result.ok) console.error('[SillyTavern-Image] 部分过期图片删除失败:', result.errors.length);
        }).catch(error => console.error('[SillyTavern-Image] 自动清理失败:', error.code || error.message));
    }, intervalMs);
    timer.unref?.();
    return async () => {
        clearInterval(timer); users.clear();
        await Promise.allSettled([...running.values()]);
    };
}
module.exports = { cleanupImages, mountImageRetention };
