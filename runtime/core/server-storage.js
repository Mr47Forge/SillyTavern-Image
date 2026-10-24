import { getRequestHeaders } from '/script.js';
import { debounce } from '/scripts/utils.js';
import { StorageFile } from './storage-file.js';

const createStorage = (filename, opts = {}) => new StorageFile(filename, {
    ...opts,
    getRequestHeaders,
    debounce,
});

export const TasksStorage = createStorage('SillyTavernImage_Tasks.json');
export const StoryOutlineStorage = createStorage('SillyTavernImage_StoryOutline.json');
export const NovelDrawStorage = createStorage('SillyTavernImage_NovelDraw.json', { debounceMs: 800 });
export const SdDrawStorage = createStorage('SillyTavernImage_SdDraw.json', { debounceMs: 800 });
export const ComfyDrawStorage = createStorage('SillyTavernImage_ComfyDraw.json', { debounceMs: 800 });
export const AssistantStorage = createStorage('SillyTavernImage_Assistant.json', { debounceMs: 800 });
export const TtsStorage = createStorage('SillyTavernImage_TTS.json', { debounceMs: 800 });
export const EnaPlannerStorage = createStorage('SillyTavernImage_EnaPlanner.json', { debounceMs: 800 });
export const CommonSettingStorage = createStorage('SillyTavernImage_CommonSettings.json', { debounceMs: 1000, readTimeoutMs: 5000 });
export const VectorStorage = createStorage('SillyTavernImage_Vectors.json', { debounceMs: 3000 });
