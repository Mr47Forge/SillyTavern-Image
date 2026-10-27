import { runWithAbortDeadline } from './abort-utils.js';

const options = { timeoutMs: 15000, timeoutMessage: '本地图片数据读写超时，请稍后重试；原记录仍会保留' };

export function openImageDatabase(name, version, upgrade) {
    return runWithAbortDeadline(signal => new Promise((resolve, reject) => {
        const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = event => {
            if (signal.aborted) { request.transaction.abort(); return; }
            upgrade?.(request.result, event);
        };
        request.onsuccess = () => {
            if (signal.aborted) { request.result.close(); return; }
            resolve(request.result);
        };
    }), options);
}

// Reuse the existing deadline utility and abort real transactions on expiry;
// rejecting a promise alone would let queued writes commit after retry.
export function runImageDatabaseOperation(work) {
    return runWithAbortDeadline(signal => new Promise((resolve, reject) => {
        const transactions = new Set();
        const abort = () => { for (const tx of transactions) { try { tx.abort(); } catch {} } };
        signal.addEventListener('abort', abort, { once: true });
        const transaction = (database, stores, mode) => {
            signal.throwIfAborted();
            const tx = database.transaction(stores, mode);
            transactions.add(tx);
            const release = () => {
                transactions.delete(tx);
                if (!transactions.size) signal.removeEventListener('abort', abort);
            };
            tx.addEventListener('complete', release, { once: true });
            tx.addEventListener('abort', release, { once: true });
            return tx;
        };
        try { work(resolve, error => { abort(); reject(error); }, transaction); }
        catch (error) { abort(); reject(error); }
    }), options);
}
