'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const IMAGE = /\/user\/images\/(?:[^/"<>\\\r\n]+\/)?(?:comfy_auto|draw)_img-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpe?g|webp)/gi;
function collectImageUrls(value, urls = new Set()) {
    if (typeof value === 'string') {
        for (const match of value.matchAll(IMAGE)) {
            try { urls.add(decodeURIComponent(match[0])); } catch { /* Invalid URLs never authorize deletion. */ }
        }
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) collectImageUrls(v, urls);
    }
    return urls;
}
async function trackChatImages(user, now = Date.now()) {
    const filename = path.join(user.directories.files, 'SillyTavernImage_ChatImages.json');
    let index = {};
    try {
        const s = await fs.lstat(filename);
        if (!s.isFile() || s.isSymbolicLink()) throw new Error('会话图片索引不能是链接或目录');
        index = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error('会话图片索引无效');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const before = JSON.stringify(index), present = new Set(), names = new Set(), referenced = new Set();
    async function scan(dir, prefix, depth = 0) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch (error) {
            if (error.code === 'ENOENT' && !Object.keys(index).some(k => k.startsWith(prefix + '/'))) return;
            throw error; // An unavailable mounted directory is not proof of chat deletion.
        }
        for (const entry of entries) {
            const file = path.join(dir, entry.name), id = prefix + '/' + entry.name;
            if (entry.isDirectory() && depth < 1) { await scan(file, id, depth + 1); continue; }
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
            const stat = await fs.lstat(file, { bigint: true });
            if (!stat.isFile() || stat.isSymbolicLink()) continue;
            const stamp = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
            const previous = index[id];
            let urls = new Set(previous?.urls || []);
            let contentHash = previous?.contentHash;
            // Fast consecutive saves can share a filesystem timestamp. Re-read
            // recently written chats; old unchanged histories use the cached URL list.
            if (previous?.stamp !== stamp || previous?.deletedAt || now - Number(stat.mtimeMs) < 5000) {
                const text = await fs.readFile(file, 'utf8');
                contentHash = createHash('sha256').update(text).digest('hex');
                for (const line of text.split('\n').filter(l => l.trim())) collectImageUrls(JSON.parse(line.replace(/^\uFEFF/, '')), urls);
            }
            index[id] = { stamp, contentHash, urls: [...urls] }; present.add(id);
            names.add(path.basename(entry.name, '.jsonl'));
            for (const url of urls) referenced.add(url);
        }
    }
    if (typeof user.directories.chats === 'string') await scan(user.directories.chats, 'single');
    if (typeof user.directories.groupChats === 'string') await scan(user.directories.groupChats, 'group');
    const copies = new Map();
    for (const id of present) {
        const entry = index[id];
        if (!copies.has(entry.contentHash)) copies.set(entry.contentHash, []);
        copies.get(entry.contentHash).push(entry);
    }
    const moved = new Set();
    for (const [id, entry] of Object.entries(index)) {
        if (present.has(id) || !entry.contentHash) continue;
        // SillyTavern renames by copy + unlink. Exact-content successors inherit
        // the old redraw history, without equating chats merely sharing one photo.
        for (const successor of copies.get(entry.contentHash) || []) {
            successor.urls = [...new Set([...successor.urls, ...entry.urls])];
            for (const url of entry.urls) referenced.add(url);
            moved.add(id);
        }
    }
    const orphaned = new Set(), deletedChatIds = new Set();
    for (const [id, entry] of Object.entries(index)) {
        if (present.has(id)) continue;
        if (!entry.deletedAt) entry.deletedAt = now;
        if (entry.deletedAt < now - 31 * 86400000) { delete index[id]; continue; }
        for (const url of entry.urls || []) if (!referenced.has(url)) orphaned.add(url);
        const name = path.basename(id, '.jsonl');
        // Chat IDs may be the same under different characters. Only globally absent
        // IDs may remove unsaved browser records; saved files use exact URL ownership.
        if (!names.has(name) && !moved.has(id)) deletedChatIds.add(name);
    }
    if (JSON.stringify(index) !== before) {
        const temp = filename + '.' + randomUUID() + '.tmp';
        try {
            await fs.writeFile(temp, JSON.stringify(index), { flag: 'wx', mode: 0o600 });
            await fs.rename(temp, filename);
        } finally { await fs.rm(temp, { force: true }); }
    }
    return { orphaned, deletedChatIds: [...deletedChatIds] };
}
module.exports = { trackChatImages };
