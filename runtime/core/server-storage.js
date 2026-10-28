import { getRequestHeaders } from '/script.js';
import { debounce } from '/scripts/utils.js';
import { StorageFile } from './storage-file.js';

const createStorage = (filename, opts = {}) => new StorageFile(filename, {
    ...opts,
    versioned: true,
    readTimeoutMs: 5000,
    getRequestHeaders,
    debounce,
});

export const NovelDrawStorage = createStorage('SillyTavernImage_NovelDraw.json', { debounceMs: 800 });
export const ComfyDrawStorage = createStorage('SillyTavernImage_ComfyDraw.json', { debounceMs: 800 });
