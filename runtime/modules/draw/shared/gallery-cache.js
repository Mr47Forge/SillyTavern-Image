// gallery-cache.js
// 画廊和缓存管理模块

import { getContext } from "/scripts/extensions.js";
import { saveBase64AsFile } from "/scripts/utils.js";
import { hasPreviewImage, DRAW_SLOT_COPY, PreviewStatus } from './image-record.js';
import { IMAGE_SAVE_LABEL_HTML } from './image-save-ui.js';
import { writeImageError, openImageDiagnostics } from './image-diagnostics.js';

// ═══════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = 'sti_novel_draw_previews';
const DB_STORE = 'previews';
const DB_SELECTIONS_STORE = 'selections';
const DB_VERSION = 3;
const CACHE_TTL = 5 * 60 * 1000;
const PREVIEW_CACHE_LIMIT = 64;
const PREVIEW_OBJECT_URL_LIMIT = 128;
const PREVIEW_PRELOAD_LIMIT = 128;
const CACHE_SYNC_CHANNEL_NAME = 'sti_novel_draw_preview_changes';
// 图片管理分页：每页默认 24 个图组，单次最多 500 个（数据变化后“重新加载到先前数量”一次请求的上限）。
export const GALLERY_PAGE_DEFAULT_LIMIT = 24;
export const GALLERY_PAGE_MAX_LIMIT = 500;
const SLOT_ORDER_CACHE_TTL = 30 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// 状态
// ═══════════════════════════════════════════════════════════════════════════

let db = null;
let dbOpening = null;
let galleryOverlayCreated = false;
let currentGalleryData = null;

const previewCache = new Map();
const previewObjectUrlCache = new Map();
const previewPreloadCache = new Map();
// 角色 → 图组完整排序（只含元数据，不含 base64）；任何写入 / 删除 / 跨标签页变更都会清空。
const slotOrderCache = new Map();
let slotOrderGeneration = 0;
const cacheChangeListeners = new Set();
let cacheSyncChannel = null;

function storageWriteError(tx) { return tx.error || new Error(DRAW_SLOT_COPY.storageWriteFailed); }

// ═══════════════════════════════════════════════════════════════════════════
// 图片显示 URL
// ═══════════════════════════════════════════════════════════════════════════

function parseBase64Image(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/^data:([^;]+);base64,(.*)$/i);
    return {
        mime: match?.[1] || 'image/png',
        data: match ? match[2] : raw,
    };
}

export function getBase64ImagePayload(value) {
    const parsed = parseBase64Image(value);
    if (!parsed?.data) return { base64: '', format: 'png' };
    const format = parsed.mime === 'image/jpeg'
        ? 'jpg'
        : parsed.mime === 'image/webp'
            ? 'webp'
            : 'png';
    return { base64: parsed.data, format };
}

function base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const chunkSize = 8192;
    const chunks = [];
    for (let offset = 0; offset < binary.length; offset += chunkSize) {
        const slice = binary.slice(offset, offset + chunkSize);
        const bytes = new Uint8Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            bytes[i] = slice.charCodeAt(i);
        }
        chunks.push(bytes);
    }
    return new Blob(chunks, { type: mime });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('blob_read_failed'));
        reader.readAsDataURL(blob);
    });
}

async function savedUrlToDataUrl(savedUrl = '') {
    const url = String(savedUrl || '').trim();
    if (!url) return '';
    if (/^data:[^;]+;base64,/i.test(url)) return url;
    if (/^blob:/i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('image_fetch_failed');
        return blobToDataUrl(await response.blob());
    }
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('image_fetch_failed');
        return blobToDataUrl(await response.blob());
    }
    return '';
}

function getObjectUrlCacheKey(imgId, base64) {
    return String(imgId || '').trim() || `inline-${String(base64 || '').slice(0, 80)}`;
}

function isObjectUrlInUse(url) {
    if (typeof document === 'undefined') return true;
    return Array.from(document.images || []).some(img => img?.src === url);
}

function prunePreviewObjectUrls() {
    if (previewObjectUrlCache.size <= PREVIEW_OBJECT_URL_LIMIT) return;
    for (const [key, url] of previewObjectUrlCache.entries()) {
        if (previewObjectUrlCache.size <= PREVIEW_OBJECT_URL_LIMIT) break;
        if (isObjectUrlInUse(url)) continue;
        try { URL.revokeObjectURL(url); } catch {}
        previewObjectUrlCache.delete(key);
    }
}

function prunePreviewPreloads() {
    while (previewPreloadCache.size > PREVIEW_PRELOAD_LIMIT) {
        const oldestKey = previewPreloadCache.keys().next().value;
        if (oldestKey === undefined) break;
        const cached = previewPreloadCache.get(oldestKey);
        if (cached?.img) {
            try { cached.img.src = ''; } catch {}
        }
        previewPreloadCache.delete(oldestKey);
    }
}

export function revokePreviewObjectUrl(imgId) {
    const key = String(imgId || '').trim();
    if (!key) return;
    const url = previewObjectUrlCache.get(key);
    if (url) {
        try { URL.revokeObjectURL(url); } catch {}
        previewObjectUrlCache.delete(key);
    }
    const preload = previewPreloadCache.get(key);
    if (preload?.img) {
        try { preload.img.src = ''; } catch {}
    }
    previewPreloadCache.delete(key);
}

export function clearPreviewObjectUrls() {
    for (const url of previewObjectUrlCache.values()) {
        try { URL.revokeObjectURL(url); } catch {}
    }
    previewObjectUrlCache.clear();
    for (const cached of previewPreloadCache.values()) {
        if (cached?.img) {
            try { cached.img.src = ''; } catch {}
        }
    }
    previewPreloadCache.clear();
}

export function getPreviewDisplayUrl(preview = {}) {
    // Local-first: previously displayed/generated images never need a network
    // request just because the user has logged in again.
    const parsed = parseBase64Image(preview?.base64);
    const savedUrl = String(preview?.savedUrl || '').trim();
    if (!parsed?.data) return savedUrl;
    if (!parsed?.data) return '';

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof atob !== 'function') {
        return `data:${parsed.mime};base64,${parsed.data}`;
    }

    const key = getObjectUrlCacheKey(preview?.imgId, parsed.data);
    const cached = previewObjectUrlCache.get(key);
    if (cached) return cached;

    try {
        const url = URL.createObjectURL(base64ToBlob(parsed.data, parsed.mime));
        previewObjectUrlCache.set(key, url);
        prunePreviewObjectUrls();
        return url;
    } catch {
        return `data:${parsed.mime};base64,${parsed.data}`;
    }
}

function getPreviewPreloadKey(preview = {}, url = '') {
    return String(preview?.imgId || '').trim() || String(url || '').trim();
}

export async function preloadPreviewDisplayUrl(preview = {}) {
    const url = getPreviewDisplayUrl(preview);
    if (!url || typeof Image === 'undefined') return false;

    const key = getPreviewPreloadKey(preview, url);
    const cached = previewPreloadCache.get(key);
    if (cached) return cached.promise;

    const img = new Image();
    img.decoding = 'async';
    const promise = new Promise((resolve) => {
        const done = (ok) => resolve(ok);
        img.onload = async () => {
            if (typeof img.decode === 'function') {
                try { await img.decode(); } catch {}
            }
            done(true);
        };
        img.onerror = () => {
            previewPreloadCache.delete(key);
            done(false);
        };
        img.src = url;
    });
    previewPreloadCache.set(key, { img, promise, timestamp: Date.now() });
    prunePreviewPreloads();
    return promise;
}

export async function warmSlotPreviewNeighbors(slotId, currentIndex = 0, range = 1) {
    const previews = await getPreviewsBySlot(slotId).catch(() => []);
    const successPreviews = previews.filter(hasPreviewImage);
    if (successPreviews.length <= 1) return;

    const start = Math.max(0, currentIndex - range);
    const end = Math.min(successPreviews.length - 1, currentIndex + range);
    for (let index = start; index <= end; index++) {
        if (index === currentIndex) continue;
        // Do not fetch an unseen history version from H28K in the background.
        if (!parseBase64Image(previews[index]?.base64)?.data) continue;
        const preload = () => {
            void preloadPreviewDisplayUrl(successPreviews[index]).catch(() => {});
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(preload, { timeout: 500 });
        } else {
            setTimeout(preload, 0);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 内存缓存
// ═══════════════════════════════════════════════════════════════════════════

function prunePreviewCache() {
    const now = Date.now();
    for (const [slotId, cached] of previewCache.entries()) {
        if (!cached || now - cached.timestamp >= CACHE_TTL) {
            previewCache.delete(slotId);
        }
    }
    while (previewCache.size > PREVIEW_CACHE_LIMIT) {
        const oldestKey = previewCache.keys().next().value;
        if (oldestKey === undefined) break;
        previewCache.delete(oldestKey);
    }
}

function getCachedPreviews(slotId) {
    prunePreviewCache();
    const cached = previewCache.get(slotId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    return null;
}

function setCachedPreviews(slotId, data) {
    prunePreviewCache();
    previewCache.set(slotId, { data, timestamp: Date.now() });
    prunePreviewCache();
}

function invalidateCache(slotId) {
    slotOrderCache.clear();
    slotOrderGeneration++;
    if (slotId) {
        previewCache.delete(slotId);
    } else {
        previewCache.clear();
    }
}

function normalizeChangedSlotIds(slotIds) {
    if (slotIds === null) return null;
    return [...new Set((Array.isArray(slotIds) ? slotIds : [])
        .map(slotId => String(slotId || '').trim())
        .filter(Boolean))];
}

function notifyCacheChangeListeners(slotIds) {
    for (const listener of cacheChangeListeners) {
        try {
            listener({ slotIds });
        } catch (error) {
            console.error('[GalleryCache] 处理跨标签页缓存变更失败:', error);
        }
    }
}

function ensureCacheSyncChannel() {
    if (cacheSyncChannel || typeof globalThis.BroadcastChannel !== 'function') return cacheSyncChannel;
    try {
        cacheSyncChannel = new globalThis.BroadcastChannel(CACHE_SYNC_CHANNEL_NAME);
        cacheSyncChannel.onmessage = (event) => {
            if (event.data?.type !== 'invalidate') return;
            const slotIds = normalizeChangedSlotIds(event.data.slotIds);
            if (slotIds !== null && slotIds.length === 0) return;
            if (slotIds === null) {
                invalidateCache();
            } else {
                slotIds.forEach(invalidateCache);
            }
            notifyCacheChangeListeners(slotIds);
        };
    } catch {
        cacheSyncChannel = null;
    }
    return cacheSyncChannel;
}

function publishCacheChange(slotIds) {
    const normalized = normalizeChangedSlotIds(slotIds);
    if (normalized !== null && normalized.length === 0) return;
    try {
        ensureCacheSyncChannel()?.postMessage({ type: 'invalidate', slotIds: normalized });
    } catch {}
}

export function subscribeGalleryCacheChanges(listener) {
    if (typeof listener !== 'function') return () => {};
    cacheChangeListeners.add(listener);
    ensureCacheSyncChannel();
    return () => cacheChangeListeners.delete(listener);
}

function normalizePreviewBase64(value = '') {
    const parsed = parseBase64Image(value);
    if (!parsed?.data) return '';
    return `data:${parsed.mime};base64,${parsed.data}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════════

function getChatCharacterName() {
    const ctx = getContext();
    if (ctx.groupId) return String(ctx.groups?.[ctx.groupId]?.id ?? 'group');
    return String(ctx.characters?.[ctx.characterId]?.name || 'character');
}

function showToast(message, type = 'success', duration = 2500) {
    const colors = { success: 'rgba(62,207,142,0.95)', error: 'rgba(248,113,113,0.95)', info: 'rgba(212,165,116,0.95)' };
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:${colors[type] || colors.info};color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;animation:fadeInOut ${duration/1000}s ease-in-out;max-width:80vw;text-align:center;word-break:break-all`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB 操作
// ═══════════════════════════════════════════════════════════════════════════

function isDbValid() {
    if (!db) return false;
    try {
        return db.objectStoreNames.length > 0;
    } catch {
        return false;
    }
}

export async function openDB() {
    if (dbOpening) return dbOpening;

    if (isDbValid() && db.objectStoreNames.contains(DB_SELECTIONS_STORE)) {
        return db;
    }

    if (db) {
        try { db.close(); } catch {}
        db = null;
    }

    dbOpening = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            dbOpening = null;
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            db.onclose = () => { db = null; };
            db.onversionchange = () => { db.close(); db = null; };
            dbOpening = null;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(DB_STORE)) {
                const store = database.createObjectStore(DB_STORE, { keyPath: 'imgId' });
                ['messageId', 'chatId', 'timestamp', 'slotId', 'characterName'].forEach(idx => store.createIndex(idx, idx));
            } else {
                const store = e.target.transaction.objectStore(DB_STORE);
                ['messageId', 'chatId', 'timestamp', 'slotId', 'characterName'].forEach((idx) => {
                    if (!store.indexNames.contains(idx)) {
                        store.createIndex(idx, idx);
                    }
                });
            }
            if (!database.objectStoreNames.contains(DB_SELECTIONS_STORE)) {
                database.createObjectStore(DB_SELECTIONS_STORE, { keyPath: 'slotId' });
            }
        };
    });

    return dbOpening;
}

// ═══════════════════════════════════════════════════════════════════════════
// 选中状态管理
// ═══════════════════════════════════════════════════════════════════════════

export async function setSlotSelection(slotId, imgId) {
    const database = await openDB();
    if (!database.objectStoreNames.contains(DB_SELECTIONS_STORE)) return;
    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_SELECTIONS_STORE, 'readwrite');
            tx.objectStore(DB_SELECTIONS_STORE).put({ slotId, selectedImgId: imgId, timestamp: Date.now() });
            tx.oncomplete = () => {
                publishCacheChange([slotId]);
                resolve();
            };
            tx.onerror = tx.onabort = () => reject(storageWriteError(tx));
        } catch (e) {
            reject(e);
        }
    });
}

export async function getSlotSelection(slotId) {
    const database = await openDB();
    if (!database.objectStoreNames.contains(DB_SELECTIONS_STORE)) return null;
    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_SELECTIONS_STORE, 'readonly');
            const request = tx.objectStore(DB_SELECTIONS_STORE).get(slotId);
            request.onsuccess = () => resolve(request.result?.selectedImgId || null);
            request.onerror = () => reject(request.error);
        } catch (e) {
            reject(e);
        }
    });
}

export async function exportPortablePreviewsForSlots(slotIds = []) {
    const slots = [...new Set((Array.isArray(slotIds) ? slotIds : [])
        .map((slotId) => String(slotId || '').trim())
        .filter(Boolean))];
    const previews = [];
    const selections = [];
    const skipped = [];
    for (const slotId of slots) {
        const display = await getDisplayPreviewForSlot(slotId).catch(() => null);
        const preview = display?.preview || null;
        const imgId = String(preview?.imgId || '').trim();
        if (!imgId) {
            skipped.push({ slotId, imgId: '', reason: 'image_preview_missing' });
            continue;
        }
        let base64 = normalizePreviewBase64(preview.base64);
        if (!base64 && preview.savedUrl) {
            base64 = await savedUrlToDataUrl(preview.savedUrl).catch(() => '');
        }
        if (!base64) {
            skipped.push({ slotId, imgId, reason: 'image_data_missing' });
            continue;
        }
        previews.push({
            imgId,
            slotId,
            messageId: String(preview.messageId || ''),
            chatId: String(preview.chatId || ''),
            characterName: String(preview.characterName || ''),
            source: String(preview.source || ''),
            bookId: String(preview.bookId || ''),
            bookTitle: String(preview.bookTitle || ''),
            chapterPath: String(preview.chapterPath || ''),
            chapterTitle: String(preview.chapterTitle || ''),
            base64,
            tags: String(preview.tags || ''),
            positive: String(preview.positive || ''),
            status: preview.status === 'failed' ? 'failed' : 'success',
            errorType: preview.errorType || null,
            errorMessage: preview.errorMessage || null,
            characterPrompts: preview.characterPrompts || null,
            negativePrompt: preview.negativePrompt || null,
            postPrompt: preview.postPrompt ?? null,
            timestamp: Number(preview.timestamp) || Date.now(),
        });
        selections.push({ slotId, selectedImgId: imgId });
    }
    return { slots, previews, selections, skipped };
}

export async function importPortablePreviews(previews = [], selections = [], options = {}) {
    const database = await openDB();
    const bookId = String(options.bookId || '').trim();
    const bookTitle = String(options.bookTitle || '').trim();
    const records = (Array.isArray(previews) ? previews : [])
        .map((preview) => ({
            ...preview,
            imgId: String(preview?.imgId || '').trim(),
            slotId: String(preview?.slotId || preview?.imgId || '').trim(),
            bookId: bookId || String(preview?.bookId || ''),
            bookTitle: bookTitle || String(preview?.bookTitle || ''),
            base64: normalizePreviewBase64(preview?.base64),
            timestamp: Number(preview?.timestamp) || Date.now(),
            savedUrl: null,
        }))
        .filter((preview) => preview.imgId && preview.slotId && preview.base64);
    const selectionRows = (Array.isArray(selections) ? selections : [])
        .map((selection) => ({
            slotId: String(selection?.slotId || '').trim(),
            selectedImgId: String(selection?.selectedImgId || '').trim(),
            timestamp: Date.now(),
        }))
        .filter((selection) => selection.slotId && selection.selectedImgId);
    if (!records.length && !selectionRows.length) return { importedPreviews: 0, importedSelections: 0 };

    await new Promise((resolve, reject) => {
        try {
            const stores = [DB_STORE];
            if (database.objectStoreNames.contains(DB_SELECTIONS_STORE)) stores.push(DB_SELECTIONS_STORE);
            const tx = database.transaction(stores, 'readwrite');
            const previewStore = tx.objectStore(DB_STORE);
            records.forEach((record) => previewStore.put(record));
            if (stores.includes(DB_SELECTIONS_STORE)) {
                const selectionStore = tx.objectStore(DB_SELECTIONS_STORE);
                selectionRows.forEach((selection) => selectionStore.put(selection));
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        } catch (error) {
            reject(error);
        }
    });
    const changedSlotIds = [...new Set([
        ...records.map(record => record.slotId),
        ...selectionRows.map(selection => selection.slotId),
    ])];
    records.forEach((record) => invalidateCache(record.slotId));
    publishCacheChange(changedSlotIds);
    return {
        importedPreviews: records.length,
        importedSelections: selectionRows.length,
    };
}

export async function clearSlotSelection(slotId) {
    const database = await openDB();
    if (!database.objectStoreNames.contains(DB_SELECTIONS_STORE)) return;
    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_SELECTIONS_STORE, 'readwrite');
            tx.objectStore(DB_SELECTIONS_STORE).delete(slotId);
            tx.oncomplete = () => {
                publishCacheChange([slotId]);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        } catch (e) {
            reject(e);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// 预览存储
// ═══════════════════════════════════════════════════════════════════════════

export async function storePreview(opts) {
    const {
        imgId,
        slotId,
        messageId,
        base64 = null,
        tags,
        positive,
        savedUrl = null,
        status = PreviewStatus.SUCCESS,
        errorType = null,
        errorMessage = null,
        characterPrompts = null,
        negativePrompt = null,
        // 整图正向提示词追加位（ComfyUI 编译器拼在最后），落盘以便画廊编辑重生成时重建
        postPrompt = null,
        promptTrace = null,
        source = '',
        chatId = '',
        characterName = '',
        bookId = '',
        bookTitle = '',
        chapterPath = '',
        chapterTitle = '',
    } = opts;
    const database = await openDB();
    const ctx = getContext();
    const resolvedChatId = String(chatId || ctx.chatId || (ctx.characterId || 'unknown'));
    const resolvedCharacterName = String(characterName || getChatCharacterName());
    const resolvedSlotId = slotId || imgId;

    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put({
                imgId,
                slotId: resolvedSlotId,
                messageId,
                chatId: resolvedChatId,
                characterName: resolvedCharacterName,
                source,
                bookId,
                bookTitle,
                chapterPath,
                chapterTitle,
                base64,
                tags,
                positive,
                savedUrl,
                status,
                errorType,
                errorMessage,
                characterPrompts,
                negativePrompt,
                postPrompt,
                promptTrace,
                timestamp: Date.now()
            });
            tx.oncomplete = () => {
                if (status === 'failed' && errorType !== 'deleted') {
                    void writeImageError({
                        imgId, slotId: resolvedSlotId, messageId, chatId: resolvedChatId,
                        positive, negativePrompt, errorType, errorMessage,
                    }).catch(error => console.warn('[ComfyDraw] Error log write failed:', error));
                }
                invalidateCache(resolvedSlotId);
                publishCacheChange([resolvedSlotId]);
                resolve();
            };
            tx.onerror = tx.onabort = () => reject(storageWriteError(tx));
        } catch (e) {
            reject(e);
        }
    });
}

export async function storeFailedPlaceholder(opts) {
    return storePreview({
        imgId: opts.imgId || `failed-${opts.slotId}-${Date.now()}`,
        slotId: opts.slotId,
        messageId: opts.messageId,
        source: opts.source || '',
        chatId: opts.chatId || '',
        characterName: opts.characterName || '',
        bookId: opts.bookId || '',
        bookTitle: opts.bookTitle || '',
        chapterPath: opts.chapterPath || '',
        chapterTitle: opts.chapterTitle || '',
        base64: null,
        tags: opts.tags,
        positive: opts.positive,
        status: 'failed',
        errorType: opts.errorType,
        errorMessage: opts.errorMessage,
        characterPrompts: opts.characterPrompts ?? null,
        negativePrompt: opts.negativePrompt ?? null,
        postPrompt: opts.postPrompt ?? null,
        promptTrace: opts.promptTrace ?? null,
    });
}

export async function getPreview(imgId) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const request = tx.objectStore(DB_STORE).get(imgId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        } catch (e) {
            reject(e);
        }
    });
}

export async function getPreviewsBySlot(slotId) {
    const cached = getCachedPreviews(slotId);
    if (cached) return cached;

    const database = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);

            const processResults = (results) => {
                results.sort((a, b) => b.timestamp - a.timestamp);
                setCachedPreviews(slotId, results);
                resolve(results);
            };

            if (store.indexNames.contains('slotId')) {
                const request = store.index('slotId').getAll(slotId);
                request.onsuccess = () => {
                    if (request.result?.length) {
                        processResults(request.result);
                    } else {
                        const legacyRequest = store.get(slotId);
                        legacyRequest.onsuccess = () => {
                            const legacy = legacyRequest.result;
                            const results = legacy && (legacy.slotId === slotId || legacy.imgId === slotId || (!legacy.slotId && legacy.imgId === slotId))
                                ? [legacy]
                                : [];
                            processResults(results);
                        };
                        legacyRequest.onerror = () => reject(legacyRequest.error);
                    }
                };
                request.onerror = () => reject(request.error);
            } else {
                const results = [];
                store.openCursor().onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) {
                        processResults(results);
                        return;
                    }
                    const record = cursor.value;
                    if (record?.slotId === slotId || record?.imgId === slotId) {
                        results.push(record);
                    }
                    cursor.continue();
                };
                tx.onerror = () => reject(tx.error);
            }
        } catch (e) {
            reject(e);
        }
    });
}

export async function getDisplayPreviewForSlot(slotId) {
    const previews = await getPreviewsBySlot(slotId);
    const selectedImgId = await getSlotSelection(slotId);
    if (!previews.length) return { preview: null, selectedImgId, historyCount: 0, hasData: false, isFailed: false };

    const successPreviews = previews.filter(hasPreviewImage);
    const failedPreviews = previews.filter(p => !hasPreviewImage(p));
    const asFailure = (preview) => ({
        preview,
        selectedImgId,
        historyCount: successPreviews.length,
        hasData: false,
        isFailed: true,
        isPending: preview?.status === PreviewStatus.PENDING || preview?.status === PreviewStatus.UNKNOWN,
        failedInfo: {
            tags: preview?.tags || '',
            positive: preview?.positive || '',
            errorType: preview?.errorType,
            errorMessage: preview?.errorMessage,
        },
    });

    if (successPreviews.length === 0) {
        return asFailure(failedPreviews[0]);
    }

    if (selectedImgId) {
        const selectedFailure = failedPreviews.find(p => p.imgId === selectedImgId);
        if (selectedFailure) return asFailure(selectedFailure);
        const currentIndex = successPreviews.findIndex(p => p.imgId === selectedImgId);
        if (currentIndex >= 0) {
            return { preview: successPreviews[currentIndex], selectedImgId, currentIndex, historyCount: successPreviews.length, hasData: true, isFailed: false };
        }
    }

    return { preview: successPreviews[0], selectedImgId, currentIndex: 0, historyCount: successPreviews.length, hasData: true, isFailed: false };
}

// All card editors update the selected record, including interrupted attempts.
// This transaction preserves fields unrelated to the edit and never reports a
// successful save after an aborted transaction.
export async function updatePreviewRecord(imgId, changes) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        let updated;
        let failure;
        const request = store.get(imgId);
        request.onsuccess = () => {
            if (!request.result) {
                failure = new Error(DRAW_SLOT_COPY.missingRecord);
                tx.abort();
                return;
            }
            updated = { ...request.result, ...changes, imgId: request.result.imgId, slotId: request.result.slotId };
            store.put(updated);
        };
        tx.oncomplete = () => {
            invalidateCache(updated.slotId);
            publishCacheChange([updated.slotId]);
            resolve(updated);
        };
        tx.onerror = tx.onabort = () => reject(failure || storageWriteError(tx));
    });
}

export async function getCardPreview({ imgId, slotId }) {
    if (!imgId) return null;
    const record = await getPreview(imgId);
    return record?.slotId === slotId ? record : null;
}

export async function getLatestPreviewForSlot(slotId) {
    const result = await getDisplayPreviewForSlot(slotId);
    return result.preview;
}

export async function deletePreview(imgId) {
    const database = await openDB();
    const preview = await getPreview(imgId);
    const slotId = preview?.slotId;

    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction([DB_STORE, DB_SELECTIONS_STORE], 'readwrite');
            tx.objectStore(DB_STORE).delete(imgId);
            if (slotId) {
                const selections = tx.objectStore(DB_SELECTIONS_STORE);
                const selected = selections.get(slotId);
                selected.onsuccess = () => {
                    if (selected.result?.selectedImgId === imgId) selections.delete(slotId);
                };
            }
            tx.oncomplete = () => {
                revokePreviewObjectUrl(imgId);
                if (slotId) invalidateCache(slotId);
                publishCacheChange(slotId ? [slotId] : []);
                resolve();
            };
            tx.onerror = tx.onabort = () => reject(storageWriteError(tx));
        } catch (e) {
            reject(e);
        }
    });
}

export async function deleteFailedRecordsForSlot(slotId) {
    const previews = await getPreviewsBySlot(slotId);
    const failedRecords = previews.filter(p => p.status === 'failed' || (!p.base64 && !p.savedUrl));
    for (const record of failedRecords) {
        await deletePreview(record.imgId);
    }
}

export async function updatePreviewSavedUrl(imgId, savedUrl) {
    const database = await openDB();
    const preview = await getPreview(imgId);
    if (!preview) return;

    preview.savedUrl = savedUrl;
    // Keep the local original for immediate reuse. The H28K URL is fallback
    // on a different device or after the browser itself evicts its storage.

    return new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(preview);
            tx.oncomplete = () => {
                if (!preview.base64) revokePreviewObjectUrl(imgId);
                invalidateCache(preview.slotId);
                publishCacheChange([preview.slotId]);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        } catch (e) {
            reject(e);
        }
    });
}

// Explicit action only: never called by the normal chat renderer.
const remoteImagePulls = new Map();
export async function pullServerImageManually(savedPreview, { signal, maxBytes = 25 * 1024 * 1024 } = {}) {
    const imgId = String(savedPreview?.imgId || '').trim();
    const url = String(savedPreview?.savedUrl || '').trim();
    if (!imgId || !url.startsWith('/user/images/') || url.includes('\\')) {
        throw new Error('图片没有可用的 H28K 保存地址');
    }
    const old = await getPreview(imgId);
    if (old?.base64) return { downloaded: false, image: old };
    if (old?.savedUrl && old.savedUrl !== url) throw new Error('图片版本已经变化');
    if (remoteImagePulls.has(imgId)) return remoteImagePulls.get(imgId);
    const work = (async () => {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal });
        if (!res.ok) throw new Error('从 H28K 拉取失败（HTTP ' + res.status + '）');
        const statedSize = Number(res.headers.get('content-length') || 0);
        if (statedSize > maxBytes) throw new Error('图片超过单张拉取大小限制');
        const blob = await res.blob();
        if (!blob.size || blob.size > maxBytes || !blob.type.startsWith('image/')) {
            throw new Error('服务器返回的图片格式或大小不正确');
        }
        const base64 = await blobToDataUrl(blob);
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        const latest = await getPreview(imgId);
        if (latest?.base64) return { downloaded: false, image: latest };
        if (latest?.savedUrl && latest.savedUrl !== url) throw new Error('图片版本已经变化');
        const image = { ...savedPreview, ...latest, imgId, savedUrl: url, base64 };
        await storePreview(image);
        return { downloaded: true, image };
    })();
    remoteImagePulls.set(imgId, work);
    try { return await work; } finally { remoteImagePulls.delete(imgId); }
}

export async function savePreviewImage(imgId, filePrefix = 'draw') {
    const preview = await getPreview(imgId);
    if (!preview) throw new Error('图片缓存不存在');
    if (preview.savedUrl) return preview.savedUrl;
    if (!preview.base64) throw new Error('图片缓存不存在');
    const charName = preview.characterName || getChatCharacterName();
    const image = getBase64ImagePayload(preview.base64);
    const url = await saveBase64AsFile(image.base64, charName, `${filePrefix}_${imgId}`, image.format);
    await updatePreviewSavedUrl(imgId, url);
    return url;
}

export async function getCacheStats() {
    const database = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const countReq = store.count();
            let totalSize = 0, successCount = 0, failedCount = 0;

            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    totalSize += (cursor.value.base64?.length || 0) * 0.75;
                    if (cursor.value.status === 'failed' || (!cursor.value.base64 && !cursor.value.savedUrl)) {
                        failedCount++;
                    } else {
                        successCount++;
                    }
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve({
                count: countReq.result || 0,
                successCount,
                failedCount,
                sizeBytes: Math.round(totalSize),
                sizeMB: (totalSize / 1024 / 1024).toFixed(2)
            });
        } catch {
            resolve({ count: 0, successCount: 0, failedCount: 0, sizeBytes: 0, sizeMB: '0' });
        }
    });
}

export async function clearExpiredCache(cacheDays = 3) {
    const cutoff = Date.now() - cacheDays * 24 * 60 * 60 * 1000;
    const database = await openDB();
    let cleaned = 0;

    return new Promise((resolve) => {
        try {
            const tx = database.transaction(DB_STORE, 'readwrite');
            const store = tx.objectStore(DB_STORE);
            store.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const record = cursor.value;
                    const isExpiredUnsaved = record.timestamp < cutoff && !record.savedUrl;
                    const isFailed = record.status === 'failed' || (!record.base64 && !record.savedUrl);
                    // A saved H28K URL is NOT grounds to erase the user's
                    // on-device cache. Only unsaved/failed expired records expire.
                    if (isExpiredUnsaved || (isFailed && record.timestamp < cutoff)) {
                        revokePreviewObjectUrl(record.imgId);
                        cursor.delete();
                        cleaned++;
                        cursor.continue();
                        return;
                    }

                    cursor.continue();
                }
            };
            tx.oncomplete = () => {
                invalidateCache();
                if (cleaned > 0) publishCacheChange(null);
                resolve(cleaned);
            };
        } catch {
            resolve(0);
        }
    });
}

export async function clearAllCache() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        try {
            const stores = [DB_STORE];
            if (database.objectStoreNames.contains(DB_SELECTIONS_STORE)) {
                stores.push(DB_SELECTIONS_STORE);
            }
            const tx = database.transaction(stores, 'readwrite');
            tx.objectStore(DB_STORE).clear();
            if (stores.length > 1) {
                tx.objectStore(DB_SELECTIONS_STORE).clear();
            }
            tx.oncomplete = () => {
                clearPreviewObjectUrls();
                invalidateCache();
                publishCacheChange(null);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        } catch (e) {
            reject(e);
        }
    });
}

export async function getGallerySummary() {
    const database = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const summary = {};

            store.openCursor().onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(summary);
                    return;
                }
                const item = cursor.value;
                if (item.status !== 'failed' && (item.base64 || item.savedUrl)) {
                    const charName = item.characterName || 'Unknown';
                    if (!summary[charName]) {
                        summary[charName] = { count: 0, totalSize: 0, slots: {}, latestTimestamp: 0 };
                    }

                    const slotId = item.slotId || item.imgId;
                    if (!summary[charName].slots[slotId]) {
                        summary[charName].slots[slotId] = { count: 0, hasSaved: false, latestTimestamp: 0, latestImgId: null };
                    }

                    const slot = summary[charName].slots[slotId];
                    slot.count++;
                    if (item.savedUrl) slot.hasSaved = true;
                    if (item.timestamp > slot.latestTimestamp) {
                        slot.latestTimestamp = item.timestamp;
                        slot.latestImgId = item.imgId;
                    }

                    summary[charName].count++;
                    summary[charName].totalSize += (item.base64?.length || 0) * 0.75;
                    if (item.timestamp > summary[charName].latestTimestamp) {
                        summary[charName].latestTimestamp = item.timestamp;
                    }
                }
                cursor.continue();
            };
            tx.onerror = () => resolve({});
        } catch {
            resolve({});
        }
    });
}

export async function getCharacterPreviews(charName) {
    const database = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const slots = {};
            const pushItem = (item) => {
                if ((item.characterName || 'Unknown') !== charName) return;
                if (item.status === 'failed' || (!item.base64 && !item.savedUrl)) return;

                const slotId = item.slotId || item.imgId;
                if (!slots[slotId]) slots[slotId] = [];
                slots[slotId].push(item);
            };
            const finish = () => {
                for (const sid in slots) {
                    slots[sid].sort((a, b) => b.timestamp - a.timestamp);
                }
                resolve(slots);
            };

            if (store.indexNames.contains('characterName') && charName !== 'Unknown') {
                const request = store.index('characterName').getAll(charName);
                request.onsuccess = () => {
                    (request.result || []).forEach(pushItem);
                    finish();
                };
                request.onerror = () => resolve({});
                return;
            }

            store.openCursor().onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    finish();
                    return;
                }
                const item = cursor.value;
                pushItem(item);
                cursor.continue();
            };
            tx.onerror = () => resolve({});
        } catch {
            resolve({});
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// 图片管理：按图组分页读取（只把本页图组的“最新一张”带出去，版本按需另取）
// ═══════════════════════════════════════════════════════════════════════════

function isDisplayableRecord(item) {
    return !!item && typeof item === 'object' && item.status !== 'failed' && !!(item.base64 || item.savedUrl);
}

function compareText(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
}

// 页面只需要这几个字段；已保存的记录只带 savedUrl，不带 base64。
function toGalleryImage(item) {
    return {
        imgId: item.imgId,
        slotId: item.slotId || item.imgId,
        timestamp: Number(item.timestamp) || 0,
        savedUrl: item.savedUrl || null,
        base64: item.savedUrl ? null : (item.base64 || null),
    };
}

// 逐条读取该角色的记录，只保留每个图组的元数据，读完一条就丢掉它的 base64，整个角色的图片不会同时驻留内存。
function scanCharacterSlotOrder(charName) {
    return openDB().then((database) => new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const slots = new Map();
            const visit = (item) => {
                try {
                    if (!isDisplayableRecord(item) || (item.characterName || 'Unknown') !== charName) return;
                    const slotId = item.slotId || item.imgId;
                    if (!slotId) return;
                    let slot = slots.get(slotId);
                    if (!slot) {
                        slot = { slotId, count: 0, hasSaved: false, latestTimestamp: -1, latestImgId: null };
                        slots.set(slotId, slot);
                    }
                    slot.count++;
                    if (item.savedUrl) slot.hasSaved = true;
                    const timestamp = Number(item.timestamp) || 0;
                    // 游标按主键升序给出记录：时间相同保留先到的（imgId 较小），与版本排序的平手规则一致。
                    if (timestamp > slot.latestTimestamp) {
                        slot.latestTimestamp = timestamp;
                        slot.latestImgId = item.imgId;
                    }
                } catch {}
            };
            const source = store.indexNames.contains('characterName') && charName !== 'Unknown'
                ? store.index('characterName').openCursor(charName)
                : store.openCursor();
            source.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) return;
                visit(cursor.value);
                cursor.continue();
            };
            source.onerror = () => reject(source.error);
            tx.oncomplete = () => resolve(Array.from(slots.values())
                .sort((a, b) => (b.latestTimestamp - a.latestTimestamp) || compareText(a.slotId, b.slotId)));
            tx.onabort = () => reject(tx.error || new Error('scan aborted'));
        } catch (error) {
            reject(error);
        }
    }));
}

function getCharacterSlotOrder(charName) {
    const cached = slotOrderCache.get(charName);
    if (cached && Date.now() - cached.at < SLOT_ORDER_CACHE_TTL) return cached.promise;
    const generation = slotOrderGeneration;
    const promise = scanCharacterSlotOrder(charName);
    const entry = { at: Date.now(), promise };
    slotOrderCache.set(charName, entry);
    // 失败、或扫描期间发生过写入（结果可能已过期）：不留缓存，本次调用仍可用这份结果作答。
    const drop = () => { if (slotOrderCache.get(charName) === entry) slotOrderCache.delete(charName); };
    promise.then(() => { if (generation !== slotOrderGeneration) drop(); }, drop);
    return promise;
}

function readRecordsByKeys(keys) {
    return openDB().then((database) => new Promise((resolve, reject) => {
        const results = new Array(keys.length).fill(null);
        if (!keys.length) { resolve(results); return; }
        const tx = database.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        tx.oncomplete = () => resolve(results);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error(DRAW_SLOT_COPY.storageReadFailed));
        keys.forEach((key, index) => {
            const request = store.get(key);
            request.onsuccess = () => { results[index] = request.result || null; };
            request.onerror = () => reject(request.error);
        });
    }));
}

/**
 * 某角色的第 offset 起 limit 个图组（按每组最新图时间倒序），每组只带最新一张。
 * 返回 { slots: {slotId: [最新一张]}, order, slotMeta: {slotId: {count, hasSaved}}, offset, limit, total, hasMore, nextOffset }。
 * 记录缺失 / 损坏的图组被跳过（order 里没有它，nextOffset 仍然前进），不让整页失败。
 */
export async function getCharacterSlotsPage(charName, { offset = 0, limit = GALLERY_PAGE_DEFAULT_LIMIT } = {}) {
    const start = Math.max(0, Math.floor(Number(offset)) || 0);
    const size = Math.min(GALLERY_PAGE_MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || GALLERY_PAGE_DEFAULT_LIMIT));
    const all = await getCharacterSlotOrder(charName);
    const pageSlots = all.slice(start, start + size);
    const records = await readRecordsByKeys(pageSlots.map(slot => slot.latestImgId));
    const slots = {};
    const order = [];
    const slotMeta = {};
    pageSlots.forEach((slot, index) => {
        const record = records[index];
        if (!isDisplayableRecord(record)) return;
        slots[slot.slotId] = [toGalleryImage(record)];
        slotMeta[slot.slotId] = { count: slot.count, hasSaved: slot.hasSaved };
        order.push(slot.slotId);
    });
    const nextOffset = start + pageSlots.length;
    return { slots, order, slotMeta, offset: start, limit: size, total: all.length, hasMore: nextOffset < all.length, nextOffset };
}

/** 一个图组的全部版本（按时间倒序，时间相同按 imgId），已保存的只带 savedUrl。 */
export async function getSlotVersions(charName, slotId) {
    if (!slotId) return [];
    const database = await openDB();
    const rows = await new Promise((resolve, reject) => {
        try {
            const tx = database.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const found = [];
            const byIndex = store.indexNames.contains('slotId') ? store.index('slotId').getAll(slotId) : null;
            const byKey = store.get(slotId); // 没有 slotId 字段的记录以自身 imgId 作图组
            if (byIndex) byIndex.onsuccess = () => found.push(...(byIndex.result || []));
            byKey.onsuccess = () => { if (byKey.result && !byKey.result.slotId) found.push(byKey.result); };
            tx.oncomplete = () => resolve(found);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('read aborted'));
        } catch (error) {
            reject(error);
        }
    });
    return rows
        .filter(item => isDisplayableRecord(item) && (item.characterName || 'Unknown') === (charName || 'Unknown'))
        .sort((a, b) => ((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)) || compareText(String(a.imgId), String(b.imgId)))
        .map(toGalleryImage);
}

// ═══════════════════════════════════════════════════════════════════════════
// 小画廊 UI
// ═══════════════════════════════════════════════════════════════════════════

function ensureGalleryStyles() {
    if (document.getElementById('nd-gallery-styles')) return;
    const style = document.createElement('style');
    style.id = 'nd-gallery-styles';
    style.textContent = `#nd-gallery-overlay{position:fixed;top:0;left:0;width:100vw;height:var(--vvh, 100vh);z-index:100008;display:none;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px)}#nd-gallery-overlay.visible{display:flex;flex-direction:column;align-items:center;justify-content:center}.nd-gallery-close{position:absolute;top:16px;right:16px;width:40px;height:40px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:#fff;font-size:20px;cursor:pointer;z-index:10}.nd-gallery-close:hover{background:rgba(255,255,255,0.2)}.nd-gallery-main{display:flex;align-items:center;gap:16px;max-width:90vw;max-height:70vh}.nd-gallery-nav{width:48px;height:48px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:#fff;font-size:24px;cursor:pointer;flex-shrink:0}.nd-gallery-nav:hover{background:rgba(255,255,255,0.2)}.nd-gallery-nav:disabled{opacity:0.3;cursor:not-allowed}.nd-gallery-img-wrap{position:relative;max-width:calc(90vw - 140px);max-height:70vh}.nd-gallery-img{max-width:100%;max-height:70vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5)}.nd-gallery-saved-badge{position:absolute;top:12px;left:12px;background:rgba(62,207,142,0.9);padding:4px 10px;border-radius:6px;font-size:11px;color:#fff;font-weight:600}.nd-gallery-thumbs{display:flex;gap:8px;margin-top:20px;padding:12px;background:rgba(0,0,0,0.3);border-radius:12px;max-width:90vw;overflow-x:auto}.nd-gallery-thumb{width:64px;height:64px;border-radius:8px;object-fit:cover;cursor:pointer;border:2px solid transparent;opacity:0.6;transition:all 0.15s;flex-shrink:0}.nd-gallery-thumb:hover{opacity:0.9}.nd-gallery-thumb.active{border-color:#d4a574;opacity:1}.nd-gallery-thumb.saved{border-color:rgba(62,207,142,0.8)}.nd-gallery-actions{display:flex;gap:12px;margin-top:16px}.nd-gallery-btn{padding:10px 20px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;background:rgba(255,255,255,0.1);color:#fff;font-size:13px;cursor:pointer;transition:all 0.15s}.nd-gallery-btn:hover{background:rgba(255,255,255,0.2)}.nd-gallery-btn.primary{background:rgba(212,165,116,0.3);border-color:rgba(212,165,116,0.5)}.nd-gallery-btn.danger{color:#f87171;border-color:rgba(248,113,113,0.3)}.nd-gallery-btn.danger:hover{background:rgba(248,113,113,0.15)}.nd-gallery-info{text-align:center;margin-top:12px;font-size:12px;color:rgba(255,255,255,0.6)}`;
    style.textContent += '#nd-gallery-overlay .nd-gallery-img-wrap{overflow:hidden;display:flex;align-items:center;justify-content:center;width:min(76vw,1200px);height:min(72vh,900px);max-width:min(76vw,1200px);max-height:72vh;touch-action:none;cursor:grab}#nd-gallery-overlay .nd-gallery-img-wrap:active{cursor:grabbing}#nd-gallery-overlay .nd-gallery-img{max-width:100%;max-height:100%;object-fit:contain;transform-origin:center;transition:transform .08s linear;user-select:none;pointer-events:none}#nd-gallery-overlay .nd-gallery-actions{flex-wrap:wrap;justify-content:center;margin-top:9px}#nd-gallery-overlay .nd-gallery-main{max-width:98vw;gap:9px}#nd-gallery-overlay .nd-gallery-thumbs{max-height:80px;margin-top:8px}#nd-gallery-overlay .nd-gallery-btn{padding:8px 13px}';

    style.textContent += `
#nd-gallery-overlay.visible{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;box-sizing:border-box;padding:8px 10px 5px;overflow:hidden}
#nd-gallery-overlay .nd-gallery-main{display:flex;flex:1 1 0;min-height:0;min-width:0;overflow:hidden;width:100%;max-width:100%;max-height:none;justify-content:center;align-items:center;gap:8px;margin:0 auto;padding:0}
#nd-gallery-overlay .nd-gallery-img-wrap{position:relative;display:flex;flex:1 1 0;min-width:0;min-height:0;width:100%;height:100%;max-height:100%;max-width:calc(100% - 112px);align-items:center;justify-content:center;overflow:hidden;touch-action:none;cursor:grab;user-select:none}
#nd-gallery-overlay .nd-gallery-img-wrap.is-dragging{cursor:grabbing}
#nd-gallery-overlay .nd-gallery-img{display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;transition:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
#nd-gallery-overlay .nd-gallery-thumbs{display:flex;flex:0 0 auto;gap:5px;margin:3px auto 2px;padding:3px 7px;max-width:100%;max-height:57px;min-height:0;overflow-x:auto;overflow-y:hidden}
#nd-gallery-overlay .nd-gallery-thumb{width:48px;height:48px;border-radius:6px;flex:0 0 48px}
#nd-gallery-overlay .nd-gallery-actions{display:flex;flex:0 0 auto;justify-content:center;flex-wrap:nowrap;gap:6px;margin:0 auto;padding:2px 4px;max-width:100%;min-height:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
#nd-gallery-overlay .nd-gallery-btn{padding:6px 9px;font-size:12px;white-space:nowrap;flex:0 0 auto}
#nd-gallery-overlay .nd-gallery-info{flex:0 0 auto;min-height:16px;line-height:16px;font-size:11px;margin:0 auto;padding:0;text-align:center}
#nd-gallery-overlay .nd-gallery-nav{width:42px;height:42px;flex:0 0 42px}
#nd-gallery-overlay .nd-gallery-close{top:10px;right:12px;z-index:12}
@media(max-width:580px){
 #nd-gallery-overlay.visible{padding:5px 5px 3px}
 #nd-gallery-overlay .nd-gallery-main{gap:3px}
 #nd-gallery-overlay .nd-gallery-img-wrap{max-width:calc(100% - 66px)}
 #nd-gallery-overlay .nd-gallery-nav{width:30px;height:40px;flex-basis:30px}
 #nd-gallery-overlay .nd-gallery-thumb{width:40px;height:40px;flex-basis:40px}
 #nd-gallery-overlay .nd-gallery-thumbs{max-height:49px}
 #nd-gallery-overlay .nd-gallery-btn{padding:6px 7px}
}
`;
    document.head.appendChild(style);
}

function createGalleryOverlay() {
    if (galleryOverlayCreated) return;
    galleryOverlayCreated = true;
    ensureGalleryStyles();

    const overlay = document.createElement('div');
    overlay.id = 'nd-gallery-overlay';
    // Template-only UI markup.
    // eslint-disable-next-line no-unsanitized/property
    overlay.innerHTML = `<button class="nd-gallery-close" id="nd-gallery-close">✕</button><div class="nd-gallery-main"><button class="nd-gallery-nav" id="nd-gallery-prev">‹</button><div class="nd-gallery-img-wrap"><img class="nd-gallery-img" id="nd-gallery-img" src="" alt=""><div class="nd-gallery-saved-badge" id="nd-gallery-saved-badge" style="display:none">已保存</div></div><button class="nd-gallery-nav" id="nd-gallery-next">›</button></div><div class="nd-gallery-thumbs" id="nd-gallery-thumbs"></div><div class="nd-gallery-actions" id="nd-gallery-actions"><button class="nd-gallery-btn" id="nd-gallery-prompt-log">提示词日志</button><button class="nd-gallery-btn primary" id="nd-gallery-use">使用此图</button><button class="nd-gallery-btn" id="nd-gallery-save">${IMAGE_SAVE_LABEL_HTML}</button><button class="nd-gallery-btn danger" id="nd-gallery-delete">🗑️ 删除</button></div><div class="nd-gallery-info" id="nd-gallery-info"></div>`;
    document.body.appendChild(overlay);

    document.getElementById('nd-gallery-close').addEventListener('click', closeGallery);
    document.getElementById('nd-gallery-prev').addEventListener('click', () => navigateGallery(1));
    document.getElementById('nd-gallery-next').addEventListener('click', () => navigateGallery(-1));
    document.getElementById('nd-gallery-use').addEventListener('click', useCurrentGalleryImage);
    document.getElementById('nd-gallery-save').addEventListener('click', saveCurrentGalleryImage);
    document.getElementById('nd-gallery-delete').addEventListener('click', deleteCurrentGalleryImage);
    document.getElementById('nd-gallery-prompt-log').addEventListener('click', () => {
        const current=currentGalleryData?.previews?.[currentGalleryData.currentIndex];
        if (current) openImageDiagnostics(current);
    });
    const imageWrap = document.getElementById('nd-gallery-overlay').querySelector('.nd-gallery-img-wrap');
    imageWrap.addEventListener('wheel', event => {
        if (!currentGalleryData) return;
        event.preventDefault();
        zoomGallery(event.deltaY < 0 ? 1.16 : 1 / 1.16);
    }, { passive: false });
    // 单指拖动 + 双指缩放 + 鼠标拖动。
    imageWrap.addEventListener('pointerdown', event => {
        if (!currentGalleryData || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        try { imageWrap.setPointerCapture(event.pointerId); } catch (_) {}
        galleryZoom.pointers.set(event.pointerId, {
            startX: event.clientX, startY: event.clientY,
            curX: event.clientX, curY: event.clientY,
            originX: galleryZoom.x, originY: galleryZoom.y,
        });
        galleryZoom.moved = false;
        imageWrap.classList.add('is-dragging');
        const pts = [...galleryZoom.pointers.values()];
        if (pts.length === 2) {
            galleryZoom.pinch = {
                startDist: Math.hypot(pts[1].startX - pts[0].startX, pts[1].startY - pts[0].startY) || 1,
                startScale: galleryZoom.scale,
                startX: galleryZoom.x, startY: galleryZoom.y,
                startMidX: (pts[0].startX + pts[1].startX) / 2,
                startMidY: (pts[0].startY + pts[1].startY) / 2,
            };
        }
    });
    imageWrap.addEventListener('pointermove', event => {
        if (!galleryZoom.pointers.has(event.pointerId)) return;
        event.preventDefault();
        const rec = galleryZoom.pointers.get(event.pointerId);
        rec.curX = event.clientX;
        rec.curY = event.clientY;
        if (Math.abs(event.clientX - rec.startX) > 2 || Math.abs(event.clientY - rec.startY) > 2) galleryZoom.moved = true;
        const pts = [...galleryZoom.pointers.values()];
        if (galleryZoom.pinch && pts.length >= 2) {
            const p1 = pts[0], p2 = pts[1];
            const dist = Math.hypot(p2.curX - p1.curX, p2.curY - p1.curY);
            const newScale = Math.min(5, Math.max(1, galleryZoom.pinch.startScale * (dist / galleryZoom.pinch.startDist)));
            galleryZoom.scale = newScale;
            if (newScale === 1) { galleryZoom.x = 0; galleryZoom.y = 0; }
            else {
                const midX = (p1.curX + p2.curX) / 2;
                const midY = (p1.curY + p2.curY) / 2;
                galleryZoom.x = galleryZoom.pinch.startX + (midX - galleryZoom.pinch.startMidX);
                galleryZoom.y = galleryZoom.pinch.startY + (midY - galleryZoom.pinch.startMidY);
            }
            applyGalleryZoom();
        } else if (pts.length === 1) {
            const p = pts[0];
            galleryZoom.x = p.originX + p.curX - p.startX;
            galleryZoom.y = p.originY + p.curY - p.startY;
            applyGalleryZoom();
        }
    });
    function endGalleryPointer(event) {
        if (!galleryZoom.pointers.has(event.pointerId)) return;
        galleryZoom.pointers.delete(event.pointerId);
        try { if (imageWrap.hasPointerCapture(event.pointerId)) imageWrap.releasePointerCapture(event.pointerId); } catch (_) {}
        if (galleryZoom.pointers.size < 2) galleryZoom.pinch = null;
        if (galleryZoom.pointers.size === 0) imageWrap.classList.remove('is-dragging');
    }
    imageWrap.addEventListener('pointerup', endGalleryPointer);
    imageWrap.addEventListener('pointercancel', endGalleryPointer);
    imageWrap.addEventListener('lostpointercapture', event => {
        if (galleryZoom.pointers.has(event.pointerId)) {
            galleryZoom.pointers.delete(event.pointerId);
            if (galleryZoom.pointers.size < 2) galleryZoom.pinch = null;
            if (galleryZoom.pointers.size === 0) imageWrap.classList.remove('is-dragging');
        }
    });
    window.addEventListener('blur', () => {
        galleryZoom.pointers.clear();
        galleryZoom.pinch = null;
        galleryZoom.moved = false;
        imageWrap.classList.remove('is-dragging');
    });
    document.addEventListener('keydown',onGalleryKeydown,true);
    overlay.addEventListener('click', (e) => {
        if (galleryZoom.moved) { galleryZoom.moved = false; return; }
        const img = document.getElementById('nd-gallery-img');
        if (!img) return;
        const r = img.getBoundingClientRect();
        const onImg = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (onImg) return;
        if (e.target.closest && (e.target.closest('button') || e.target.closest('.nd-gallery-thumb'))) return;
        closeGallery();
    });
}

const galleryZoom={scale:1,x:0,y:0,pointers:new Map(),pinch:null,moved:false};
function constrainGalleryPan() {
    const img=document.getElementById('nd-gallery-img');
    const wrap=document.getElementById('nd-gallery-overlay')?.querySelector('.nd-gallery-img-wrap');
    if (!img || !wrap) return;
    const imageW=img.offsetWidth || 0;
    const imageH=img.offsetHeight || 0;
    const frameW=wrap.clientWidth || 0;
    const frameH=wrap.clientHeight || 0;
    if (!imageW || !imageH || !frameW || !frameH) {
        galleryZoom.x=0;galleryZoom.y=0;return;
    }
    const scaledW=imageW*galleryZoom.scale;
    const scaledH=imageH*galleryZoom.scale;
    // When fitted, pan within empty margins; when enlarged, stop at the edge.
    const maxX=Math.abs(frameW-scaledW)/2;
    const maxY=Math.abs(frameH-scaledH)/2;
    galleryZoom.x=Math.max(-maxX,Math.min(maxX,galleryZoom.x));
    galleryZoom.y=Math.max(-maxY,Math.min(maxY,galleryZoom.y));
}
function applyGalleryZoom() {
    const img=document.getElementById('nd-gallery-img');
    if (!img) return;
    constrainGalleryPan();
    img.style.transform='translate('+galleryZoom.x+'px,'+galleryZoom.y+'px) scale('+galleryZoom.scale+')';
}
function resetGalleryZoom() {
    galleryZoom.scale=1;galleryZoom.x=0;galleryZoom.y=0;galleryZoom.pointers.clear();galleryZoom.pinch=null;galleryZoom.moved=false;
    document.querySelector('#nd-gallery-overlay .nd-gallery-img-wrap')?.classList.remove('is-dragging');
    applyGalleryZoom();
}
function zoomGallery(factor) {
    galleryZoom.scale=Math.min(5,Math.max(1,galleryZoom.scale*factor));
    if(galleryZoom.scale===1){galleryZoom.x=0;galleryZoom.y=0;}
    applyGalleryZoom();
}
function onGalleryKeydown(event) {
    if(!currentGalleryData||!document.getElementById('nd-gallery-overlay')?.classList.contains('visible'))return;
    if(document.getElementById('sti-draw-diagnostics-overlay'))return;
    if(event.key==='Escape'){event.preventDefault();closeGallery();}
    else if(event.key==='ArrowLeft'){event.preventDefault();void navigateGallery(1);}
    else if(event.key==='ArrowRight'){event.preventDefault();void navigateGallery(-1);}
    else if(event.key==='+'||event.key==='='){event.preventDefault();zoomGallery(1.25);}
    else if(event.key==='-'){event.preventDefault();zoomGallery(0.8);}
    else if(event.key==='0'){event.preventDefault();resetGalleryZoom();}
}
export async function openGallery(slotId, messageId, callbacks = {}) {
    createGalleryOverlay();

    const previews = await getPreviewsBySlot(slotId);
    const validPreviews = previews.filter(hasPreviewImage);

    if (!validPreviews.length) {
        showToast('没有找到图片历史', 'error');
        return;
    }

    const selectedImgId = await getSlotSelection(slotId);
    let startIndex = 0;
    if (selectedImgId) {
        const idx = validPreviews.findIndex(p => p.imgId === selectedImgId);
        if (idx >= 0) startIndex = idx;
    }

    currentGalleryData = { slotId, messageId, previews: validPreviews, currentIndex: startIndex, callbacks };
    resetGalleryZoom();
    renderGalleryThumbs();
    renderGallery();
    document.getElementById('nd-gallery-overlay').classList.add('visible');
}

export function closeGallery() {
    const el = document.getElementById('nd-gallery-overlay');
    if (el) el.classList.remove('visible');
    currentGalleryData = null;
    resetGalleryZoom();
}

function renderGalleryThumbs() {
    if (!currentGalleryData) return;
    const { previews } = currentGalleryData;
    const reversedPreviews = previews.slice().reverse();
    const thumbsContainer = document.getElementById('nd-gallery-thumbs');

    // Generated from local preview data only.
    // eslint-disable-next-line no-unsanitized/property
    thumbsContainer.innerHTML = reversedPreviews.map((p, i) => {
        const src = getPreviewDisplayUrl(p);
        const originalIndex = previews.length - 1 - i;
        const classes = ['nd-gallery-thumb'];
        if (p.savedUrl) classes.push('saved');
        return `<img class="${classes.join(' ')}" src="${src}" data-index="${originalIndex}" alt="" loading="lazy">`;
    }).join('');

    thumbsContainer.querySelectorAll('.nd-gallery-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            currentGalleryData.currentIndex = parseInt(thumb.dataset.index);
            resetGalleryZoom();
            renderGallery();
        });
    });
}

function updateGalleryThumbState() {
    if (!currentGalleryData) return;
    const { currentIndex } = currentGalleryData;
    const thumbsContainer = document.getElementById('nd-gallery-thumbs');
    thumbsContainer.querySelectorAll('.nd-gallery-thumb').forEach((thumb) => {
        const isActive = parseInt(thumb.dataset.index) === currentIndex;
        thumb.classList.toggle('active', isActive);
        if (isActive) {
            thumb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    });
}

function renderGallery() {
    if (!currentGalleryData) return;

    const { previews, currentIndex } = currentGalleryData;
    const current = previews[currentIndex];
    if (!current) return;

    const visibleImage=document.getElementById('nd-gallery-img');
    visibleImage.onload=()=>{if(currentGalleryData?.previews?.[currentGalleryData.currentIndex]?.imgId===current.imgId) applyGalleryZoom();};
    visibleImage.src = getPreviewDisplayUrl(current);
    applyGalleryZoom();
    document.getElementById('nd-gallery-saved-badge').style.display = current.savedUrl ? 'block' : 'none';
    updateGalleryThumbState();

    const groups=currentGalleryData?.callbacks?.managementSlots;
    const groupIndex=Array.isArray(groups)?groups.indexOf(currentGalleryData.slotId):-1;
    document.getElementById('nd-gallery-prev').disabled = currentIndex >= previews.length-1
        && !(groupIndex>=0&&groupIndex<groups.length-1);
    document.getElementById('nd-gallery-next').disabled = currentIndex<=0
        && !(groupIndex>0);

    const saveBtn = document.getElementById('nd-gallery-save');
    if (current.savedUrl) {
        saveBtn.disabled = true;
    } else {
        // Static draw-owned markup, without user input.
        // eslint-disable-next-line no-unsanitized/property
        saveBtn.innerHTML = IMAGE_SAVE_LABEL_HTML;
        saveBtn.disabled = false;
    }

    const displayVersion = previews.length - currentIndex;
    const date = new Date(current.timestamp).toLocaleString();
    document.getElementById('nd-gallery-info').textContent = `版本 ${displayVersion} / ${previews.length} · ${date}`;
}

async function navigateGallery(delta) {
    if (!currentGalleryData) return;
    const newIndex = currentGalleryData.currentIndex - delta;
    if (newIndex >= 0 && newIndex < currentGalleryData.previews.length) {
        currentGalleryData.currentIndex = newIndex;
        resetGalleryZoom();
        renderGallery();
        return;
    }
    const old=currentGalleryData;
    const list=old.callbacks?.managementSlots;
    if(!Array.isArray(list)||list.length<2)return;
    const at=list.indexOf(old.slotId);
    const adjacent=list[at+(delta>0?1:-1)];
    if(!adjacent)return;
    const maker=old.callbacks.createManagementCallbacks;
    const nextCallbacks=typeof maker==='function'?await maker(adjacent):old.callbacks;
    await openGallery(adjacent,Number(nextCallbacks.managementMessageId||0),nextCallbacks);
}

async function useCurrentGalleryImage() {
    if (!currentGalleryData) return;

    const { slotId, messageId, previews, currentIndex, callbacks } = currentGalleryData;
    const selected = previews[currentIndex];
    if (!selected) return;

    await setSlotSelection(slotId, selected.imgId);
    if (callbacks.onUse) callbacks.onUse(slotId, messageId, selected, previews.length);
    closeGallery();
    showToast('已切换显示图片');
}

async function saveCurrentGalleryImage() {
    if (!currentGalleryData) return;

    const { slotId, previews, currentIndex, callbacks } = currentGalleryData;
    const current = previews[currentIndex];
    if (!current || current.savedUrl) return;

    try {
        const charName = current.characterName || getChatCharacterName();
        const image = getBase64ImagePayload(current.base64);
        const url = await saveBase64AsFile(image.base64, charName, `novel_${current.imgId}`, image.format);
        await updatePreviewSavedUrl(current.imgId, url);
        current.savedUrl = url;
        await setSlotSelection(slotId, current.imgId);
        showToast(`已保存: ${url}`, 'success', 4000);
        renderGalleryThumbs();
        renderGallery();
        if (callbacks.onSave) callbacks.onSave(current.imgId, url);
    } catch (e) {
        console.error('[GalleryCache] save failed:', e);
        showToast(`保存失败: ${e.message}`, 'error');
    }
}

async function deleteCurrentGalleryImage() {
    if (!currentGalleryData) return;

    const { slotId, messageId, previews, currentIndex, callbacks } = currentGalleryData;
    const current = previews[currentIndex];
    if (!current) return;

    const msg = current.savedUrl ? '确定删除这条记录吗？服务器上的图片文件不会被删除。' : '确定删除这张图片吗？';
    if (!confirm(msg)) return;

    try {
        await deletePreview(current.imgId);

        const selectedId = await getSlotSelection(slotId);
        if (selectedId === current.imgId) {
            await clearSlotSelection(slotId);
        }

        previews.splice(currentIndex, 1);

        if (previews.length === 0) {
            closeGallery();
            if (callbacks.onBecameEmpty) {
                callbacks.onBecameEmpty(slotId, messageId, { tags: current.tags || '', positive: current.positive || '' });
            }
            showToast('图片已删除，可点击重试重新生成');
        } else {
            if (currentGalleryData.currentIndex >= previews.length) {
                currentGalleryData.currentIndex = previews.length - 1;
            }
            renderGalleryThumbs();
            renderGallery();
            if (callbacks.onDelete) callbacks.onDelete(slotId, current.imgId, previews);
            showToast('图片已删除');
        }
    } catch (e) {
        console.error('[GalleryCache] delete failed:', e);
        showToast(`删除失败: ${e.message}`, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 清理
// ═══════════════════════════════════════════════════════════════════════════

export function destroyGalleryCache() {
    closeGallery();
    invalidateCache();
    clearPreviewObjectUrls();

    document.removeEventListener('keydown',onGalleryKeydown,true);
    document.getElementById('nd-gallery-overlay')?.remove();
    document.getElementById('nd-gallery-styles')?.remove();
    galleryOverlayCreated = false;

    if (db) {
        try { db.close(); } catch {}
        db = null;
    }
    dbOpening = null;
}
