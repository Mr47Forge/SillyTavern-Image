import { runWithAbortDeadline } from '../../../shared/common/abort-utils.js';

// The exact set selected by one user cancellation must survive a lost response
// or reload. No credentials, prompts, leases or second job state machine.
// Each entry dies only after backend ACK and its projection into delivery journals.
const DB_NAME = 'sti_draw_cancellations';
const STORE = 'intents';
let opening;
const STORAGE_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MESSAGE = '本地取消记录读写超时，请重试；原任务记录仍会保留';

function open() {
    opening ??= runWithAbortDeadline(signal => new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (signal.aborted) { request.transaction.abort(); return; }
            request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            if (signal.aborted) { db.close(); return; }
            db.onversionchange = () => { db.close(); opening = null; };
            db.onclose = () => { opening = null; };
            resolve(db);
        };
    }), { timeoutMs: STORAGE_TIMEOUT_MS, timeoutMessage: STORAGE_TIMEOUT_MESSAGE })
        .catch(error => { opening = null; throw error; });
    return opening;
}

async function transaction(mode, work) {
    const db = await open();
    return runWithAbortDeadline(signal => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const abort = () => { try { tx.abort(); } catch {} };
        signal.addEventListener('abort', abort, { once: true });
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => { signal.removeEventListener('abort', abort); resolve(request.result); };
        tx.onabort = tx.onerror = () => { signal.removeEventListener('abort', abort); reject(tx.error); };
    }), { timeoutMs: STORAGE_TIMEOUT_MS, timeoutMessage: STORAGE_TIMEOUT_MESSAGE });
}

export const drawCancellationJournal = Object.freeze({
    async record(targets) {
        if (typeof targets.owner !== 'string' || !targets.owner) throw new TypeError('CANCELLATION_OWNER_REQUIRED');
        const entry = { owner: targets.owner, jobIds: [...new Set(targets.jobIds)], runIds: [...new Set(targets.runIds)] };
        const id = await transaction('readwrite', store => store.add(entry));
        return { ...entry, id };
    },
    list: () => transaction('readonly', store => store.getAll()),
    forget: id => transaction('readwrite', store => store.delete(id)),
});
