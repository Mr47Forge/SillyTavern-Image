import { hashStableValue, stableSerialize } from './generation-fingerprint.js';
import { DRAW_SLOT_COPY } from './image-record.js';
import { getImageCacheOwner, imageCacheDatabaseName, assertImageCacheOwner } from './image-cache-owner.js';

const DB_NAME = 'sti_draw_generated_images';
const DB_STORE = 'images';
const DB_VERSION = 1;
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const inflightRequests = new Map();
const databasePromises = new Map();

function createAbortError() {
    try {
        return new DOMException('图片生成已取消', 'AbortError');
    } catch {
        const error = new Error('图片生成已取消');
        error.name = 'AbortError';
        return error;
    }
}

function getDrawFacade() {
    const facade = window.stimageDraw;
    if (!facade || (
        typeof facade.prepareGeneration !== 'function'
        && typeof facade.generateImage !== 'function'
    )) {
        throw new Error('画图模块未启用');
    }
    return facade;
}

function buildDescriptor(input = {}) {
    const facade = getDrawFacade();
    const payload = typeof input === 'string' ? { prompt: input } : (input || {});
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) throw new Error('无效的图片标签');
    const cacheEnabled = payload.cache !== false;
    const owner = getImageCacheOwner();
    const provider = String(facade.getProvider?.() || 'disabled');
    const generationPlan = typeof facade.prepareGeneration === 'function'
        ? facade.prepareGeneration(payload)
        : null;
    const generationFingerprint = generationPlan?.fingerprint || {
            provider,
            promptData: typeof facade.buildPromptData === 'function'
                ? facade.buildPromptData(payload)
                : { prompt },
        };
    const fingerprint = stableSerialize({
        owner,
        namespace: String(payload.cacheNamespace || 'shared'),
        cacheEnabled,
        generation: generationFingerprint,
    });
    return {
        owner,
        cacheEnabled,
        cacheKey: hashStableValue(fingerprint, 'draw'),
        facade,
        fingerprint,
        generationPlan,
        payload,
        prompt,
        provider,
    };
}

function openDatabase(owner) {
    assertImageCacheOwner(owner);
    if (databasePromises.has(owner)) return databasePromises.get(owner);
    const opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(imageCacheDatabaseName(DB_NAME, owner), DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(DB_STORE)) {
                database.createObjectStore(DB_STORE, { keyPath: 'cacheKey' });
            }
        };
    }).catch((error) => {
        databasePromises.delete(owner);
        throw error;
    });
    databasePromises.set(owner, opening);
    return opening;
}

async function readCache(descriptor, strict = false) {
    if (!descriptor.cacheEnabled || typeof indexedDB === 'undefined') return null;
    try {
        assertImageCacheOwner(descriptor.owner);
        const database = await openDatabase(descriptor.owner);
        assertImageCacheOwner(descriptor.owner);
        const base64 = await new Promise((resolve, reject) => {
            const transaction = database.transaction(DB_STORE, 'readonly');
            const request = transaction.objectStore(DB_STORE).get(descriptor.cacheKey);
            let cached = null;
            request.onsuccess = () => {
                const record = request.result;
                const valid = record
                    && record.owner === descriptor.owner
                    && record.provider === descriptor.provider
                    && record.prompt === descriptor.prompt
                    && Date.now() - Number(record.timestamp || 0) < CACHE_TTL;
                cached = valid ? record.base64 : null;
            };
            transaction.oncomplete = () => resolve(cached);
            request.onerror = () => strict ? reject(request.error) : resolve(null);
            transaction.onabort = () => strict ? reject(transaction.error || new Error(DRAW_SLOT_COPY.cacheReadFailed)) : resolve(null);
        });
        assertImageCacheOwner(descriptor.owner);
        return base64;
    } catch (error) {
        if (strict) throw error;
        return null;
    }
}

async function writeCache(descriptor, base64) {
    if (!descriptor.cacheEnabled || !base64 || typeof indexedDB === 'undefined') return;
    try {
        assertImageCacheOwner(descriptor.owner);
        const database = await openDatabase(descriptor.owner);
        assertImageCacheOwner(descriptor.owner);
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(DB_STORE, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            transaction.objectStore(DB_STORE).put({
                owner: descriptor.owner,
                cacheKey: descriptor.cacheKey,
                provider: descriptor.provider,
                prompt: descriptor.prompt,
                base64,
                timestamp: Date.now(),
            });
        });
        assertImageCacheOwner(descriptor.owner);
    } catch { }
}

function notifyEntry(entry, status, ahead, delay) {
    entry.progress = { status, ahead, delay };
    entry.consumers.forEach((consumer) => {
        if (!consumer.active) return;
        try { consumer.onProgress?.(status, ahead, delay); } catch (error) {
            console.error('[GeneratedImageRuntime] 进度回调失败:', error);
        }
    });
}

function normalizeProviderProgress(entry, state, data = {}) {
    if (state === 'start') {
        notifyEntry(entry, 'generating', 0);
        return;
    }
    if (state === 'cooldown') {
        return;
    }
    const rawAhead = Number(data.ahead);
    const rawPosition = Number(data.position);
    const ahead = Number.isFinite(rawAhead)
        ? Math.max(0, rawAhead)
        : Math.max(0, Number.isFinite(rawPosition) ? rawPosition - 1 : 0);
    notifyEntry(entry, state || 'queued', ahead);
}

function subscribe(entry, signal, onProgress) {
    return new Promise((resolve, reject) => {
        const consumer = {
            active: true,
            abortHandler: null,
            onProgress: typeof onProgress === 'function' ? onProgress : null,
        };
        const cleanup = () => {
            if (!consumer.active) return;
            consumer.active = false;
            entry.consumers.delete(consumer);
            if (signal && consumer.abortHandler) signal.removeEventListener('abort', consumer.abortHandler);
        };
        consumer.abortHandler = () => {
            if (!consumer.active) return;
            cleanup();
            reject(createAbortError());
            if (entry.consumers.size === 0) entry.controller.abort();
        };
        entry.consumers.add(consumer);
        if (entry.progress && consumer.onProgress) {
            const { status, ahead, delay } = entry.progress;
            try { consumer.onProgress(status, ahead, delay); } catch (error) {
                console.error('[GeneratedImageRuntime] 进度回调失败:', error);
            }
        }
        signal?.addEventListener('abort', consumer.abortHandler, { once: true });
        entry.promise.then((base64) => {
            if (!consumer.active) return;
            cleanup();
            resolve(base64);
        }, (error) => {
            if (!consumer.active) return;
            cleanup();
            reject(error);
        });
    });
}

function createRequest(descriptor) {
    const entry = {
        controller: new AbortController(),
        consumers: new Set(),
        progress: null,
        promise: null,
    };
    entry.promise = (async () => {
        const cached = await readCache(descriptor);
        assertImageCacheOwner(descriptor.owner);
        if (entry.controller.signal.aborted) throw createAbortError();
        if (cached) return cached;
        const runtimeOptions = {
            signal: entry.controller.signal,
            onQueueStateChange: (state, data) => normalizeProviderProgress(entry, state, data),
        };
        const base64 = typeof descriptor.generationPlan?.execute === 'function'
            ? await descriptor.generationPlan.execute(runtimeOptions)
            : await descriptor.facade.generateImage({
                ...descriptor.payload,
                prompt: descriptor.prompt,
                ...runtimeOptions,
            });
        if (entry.controller.signal.aborted) throw createAbortError();
        assertImageCacheOwner(descriptor.owner);
        await writeCache(descriptor, base64);
        assertImageCacheOwner(descriptor.owner);
        return base64;
    })().finally(() => {
        if (inflightRequests.get(descriptor.fingerprint) === entry) {
            inflightRequests.delete(descriptor.fingerprint);
        }
    });
    return entry;
}

export function generateSharedImage(input = {}) {
    const descriptor = buildDescriptor(input);
    const signal = descriptor.payload.signal;
    if (signal?.aborted) return Promise.reject(createAbortError());
    let entry = inflightRequests.get(descriptor.fingerprint);
    if (!entry || entry.controller.signal.aborted) {
        entry = createRequest(descriptor);
        inflightRequests.set(descriptor.fingerprint, entry);
    }
    return subscribe(entry, signal, descriptor.payload.onProgress);
}

export async function checkGeneratedImageCache(input = {}) {
    return await readCache(buildDescriptor(input));
}

// Upgrade-only reader. It must never conflate a failed read with a cache miss,
// and must never call the generation branch of this runtime.
export async function readGeneratedImageForAdoption(input) {
    const descriptor = buildDescriptor(input);
    if (typeof indexedDB === 'undefined') throw new Error(DRAW_SLOT_COPY.cacheReadFailed);
    const base64 = await readCache(descriptor, true);
    return { base64, promptData: descriptor.generationPlan?.fingerprint?.promptData || {} };
}

export function clearSharedImageRequests() {
    inflightRequests.forEach(entry => entry.controller.abort());
    inflightRequests.clear();
}

export async function clearExpiredGeneratedImageCache() {
    if (typeof indexedDB === 'undefined') return;
    try {
        const owner = getImageCacheOwner();
        const database = await openDatabase(owner);
        assertImageCacheOwner(owner);
        const cutoff = Date.now() - CACHE_TTL;
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(DB_STORE, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            const request = transaction.objectStore(DB_STORE).openCursor();
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) return;
                if (Number(cursor.value?.timestamp || 0) < cutoff) cursor.delete();
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    } catch { }
}
