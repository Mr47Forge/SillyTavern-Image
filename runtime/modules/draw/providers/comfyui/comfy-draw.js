import {
    storePreview,
    storeFailedPlaceholder,
    setSlotSelection,
    openDB,
    openGallery,
    getPreviewsBySlot,
    getPreview,
    getGallerySummary,
    clearExpiredCache,
    clearAllCache,
    deletePreview,
    getPreviewDisplayUrl,
    preloadPreviewDisplayUrl,
    warmSlotPreviewNeighbors,
} from "../../shared/gallery-cache.js";
import { getContext } from "/scripts/extensions.js";
import { getRequestHeaders, syncMesToSwipe, saveChatConditional, substituteParams } from "/script.js";
import { extensionFolderPath } from "../../../../core/constants.js";
import { mountServerPluginGuide } from '../../../../shared/server-plugin/installation-guide.js';
import { createModuleEvents, event_types } from "../../../../core/event-manager.js";
import { ComfyDrawStorage } from "../../../../core/server-storage.js";
import { expandScenePromptText, loadScenePromptRuntime } from "../../shared/scene-prompt-expansion.js";
import { createSceneSource, normalizeMessageSceneSourceText } from "../../shared/scene-source.js";
import { resolveSettingsViewport } from './settings-viewport.js';
import { readDirectDrawDirectives, rememberDirectDrawDirectives, buildDirectDrawTasks, buildDirectDrawInstruction, stripDirectDrawSource, getDirectDrawWorldbook, getDirectDrawReplyState } from '../../shared/direct-draw.js';
import { readHostVisibleNarrative } from '../../shared/host-visible-scene.js';
import { buildWardrobeLedger, formatWardrobeLedger } from '../../shared/wardrobe-continuity.js';
import { renderDirectDrawFields } from '../../shared/direct-draw-preview.js';
import { isSceneSlotAlive } from "../../shared/scene-placement.js";
import { getSlotActivity, setSlotActivity, clearSlotActivity } from "../../shared/slot-activity.js";
import { getPendingImageJobSlots } from "../../shared/pending-image-jobs.js";
import { stripDrawImageSlots, stripUnownedDrawImageSlots, parseDrawImageDirectives, stripDrawImageDirectives } from "../../shared/image-marker-syntax.js";
import { assertSceneSourceUnchanged } from "../../shared/scene-placement.js";
import {
    loadSharedDrawSettings,
    getSharedDrawSettings,
    updateSharedDrawSettingsPersistent,
    normalizeSharedCacheDays,
} from "../../shared/draw-settings.js";
import { saveComfyImageToServer } from "../../shared/server-image-autosave.js";
import { characterLibraryFromSettings, selectEnabledCharacters } from "../../shared/character-library.js";
import { createSerialImageRequestQueue } from "../../shared/serial-image-request-queue.js";
import { applyRolePhotoReference } from './role-photo-reference.js';
import { workflowPromptTrace, openImageDiagnostics, readImageErrors, clearImageErrors, writeImageError } from '../../shared/image-diagnostics.js';
import {
    buildComfyImageRequest,
    buildSimpleWorkflow,
    compile as compileComfyScenePlan,
    COMFY_REQUEST_DELAY_MS,
    parseComfyApiWorkflowJson,
    resolveComfyDirectOutputImage,
    validateComfyWorkflowNodeMap,
} from "./compiler.js";
import {
    createBackendItemError,
    createImageBackendJobMonitorRegistry,
    createImageBackendJobsClient,
    fetchImageBackendJobsStatus,
    hasImageBackendJobsCapability,
    IMAGE_JOBS_UNAVAILABLE_MESSAGE,
    readImageBackendResultBase64,
    readImageBlobBase64,
    reportImageBackendJobState,
} from "../../shared/backend-image-jobs.js";
import { submitRecoverableImageJob } from "../../shared/recoverable-image-jobs.js";
import { cancelFloorDrawWork, captureDrawCancellationTarget } from "../../shared/draw-run-controls.js";
import { createCharacterEnabledControl, getCharacterEnabledFromCard } from "../../shared/character-enabled-control.js";
import { createCharacterLibraryUi } from "../../shared/character-library-ui.js";
import { buildCharacterTestPrompt } from "./character-test-prompt.js";
import { namedTagsChineseText, reconcileChineseNamedLines } from "./chinese-named-tags.js";
import { describeCharacterSaveError } from "./character-save-errors.js";
import { hashStableValue } from "../../shared/generation-fingerprint.js";
import {
    createScenePlannerDefaultPresets,
    isPovPromptPreset,
    SCENE_PLANNER_PRESET_INSTALL_NOTICE,
} from "../../shared/scene-planner-presets.js";
import {
    findLastAIMessageId,
    getOwnedImageSlotIds,
    isMessageBeingEdited,
    detectPresentCharacters,
    DEFAULT_MESSAGE_FILTER_RULES,
    joinTags,
    ensureDrawImageStyles,
    classifyError,
    ErrorType,
    syncDrawSavedFromPreview,
    syncDrawSavedAfterDeletion,
    getDrawSavedPreview,
    clearDrawSavedEntry,
    startSharedDrawPreviewRuntime,
    stopSharedDrawPreviewRuntime,
    toScenePlannerProgress,
    buildFailedPlaceholderHtml,
    renderPreviewsForMessage,
    buildRemotePullPlaceholderHtml,
    pullOneRemoteImage,
    pullCurrentChatImages,
} from "../../shared/draw-common.js";
import { IMAGE_SAVING_INDICATOR_HTML } from '../../shared/image-save-ui.js';
import { parseFieldDescriptions } from '../../shared/scene-plan-descriptions.js';
import {
    DEFAULT_PROMPT_CONFIG,
    PROMPT_TEMPLATE_VERSION,
    getLoadedTagGuide,
    loadPromptTemplates,
    loadTagGuide,
} from "./comfy-prompts.js";
import { submitPreparedChatImages, generatePreparedChatImages, registerPreparedImageProvider } from "../../shared/prepared-chat-images.js";
import { buildRecentAppearanceLedger } from '../../shared/character-appearance-ledger.js';
import { prepareImageInput } from '../../shared/prepared-image-input.js';
import { acquireFloorImageJob, getFloorImageJob, getFloorImageJobs, getFloorImagePhase, getFloorImageState, releaseFloorImageJob, observeFloorImageJob, failFloorImageJob, clearFloorImageJobs, resolveFloorImageJobTarget, rebaseFloorImageJobsAfterSwipeDeletion } from '../../shared/floor-image-job.js';
import { createImageRequestAttempt, imageHttpFailure, withImageRequestOutcome, ImageRequestOutcome } from '../../shared/image-request-outcome.js';
import { createImageCardRedrawProvider } from "../../shared/image-card-redraw-provider.js";
import { redrawImageCard, removeChatImageSlot, restoreImageCard, retryFloorFailedImageCards, redrawFloorFailedImageCards } from "../../shared/image-card-actions.js";
import { setActiveMessageText } from '../../shared/scene-placement.js';
import { syncRenderedMessageFromState } from '../../shared/draw-common.js';
import { persistCardTagEdits, readCardTagEditor } from "../../shared/card-tag-editor.js";
import { getCurrentUserHandle } from "/scripts/user.js";
import { hasPreviewImage, DRAW_SLOT_COPY } from "../../shared/image-record.js";
// comfy-draw.js


const MODULE_KEY = 'comfyDraw';
const DRAW_RUN_PROVIDER = 'comfyui';
const HTML_PATH = `${extensionFolderPath}/modules/draw/providers/comfyui/comfy-draw.html`;
const SERVER_FILE_KEY = 'config';

const DEFAULT_COMFY_DRAW_SETTINGS = {
    host: '',
    connectionMode: 'proxy',
    auth: '',
    timeout: 120000,
    useImageBackendJobs: false,
    mode: 'manual',
    overrideSize: 'default',
    showFloorButton: true,
    showFloatingButton: true,
    selectedPresetId: 'default',
    builtinWorkflowId: 'official-core-checkpoint',
    presets: [],

    // 简单模式参数
    selectedModel: '',
    sampler: 'euler',
    scheduler: 'normal',
    steps: 20,
    cfg: 7,

    // 工作流模式：'simple' | 'custom'
    workflowMode: 'simple',
    selectedWorkflowPresetId: 'workflow-default',
    workflowPresets: [],

    // 自定义工作流（保留）
    customWorkflow: {
        json: '',
        nodePositive: '',
        nodeNegative: '',
        nodeWidth: '',
        nodeHeight: '',
        nodeSeed: '',
        nodeSaveImage: '',
    },

    // 缓存
    modelCache: [],
    samplerCache: [],
    schedulerCache: [],
    advancedMode: true,
    drawSource: 'direct',
    customPrompts: { topSystem: null, tagGuideContent: null, sceneRules: null },
    promptPresets: [],
    selectedPromptPresetId: null,
    _promptTemplateVersion: 0,
};

let moduleInitialized = false;
let moduleLifecycleGeneration = 0;
let settingsCache = null;
let settingsLoaded = false;
let overlayElement = null;
let overlayFrame = null;
let frameReadyPromise = null;
let pendingController = null;
let resizeHandler = null;
let settingsViewportState = null;
let viewportSyncFrame = 0;
let eventsBound = false;
let characterLibraryUi = null;
// UI-only disclosure state; no role data, prompts, or groups are changed.
const expandedComfyCharacterIds = new Set();
function setComfyCharacterCardExpanded(card, expanded) {
    if (!card) return;
    const id = String(card.dataset.characterId || '');
    if (id) {
        if (expanded) expandedComfyCharacterIds.add(id);
        else expandedComfyCharacterIds.delete(id);
    }
    const body = card.querySelector('.comfy-role-card-body');
    if (body) body.hidden = !expanded;
    card.classList.toggle('comfy-role-collapsed', !expanded);
    const button = card.querySelector('[data-comfy-role-toggle]');
    if (button) {
        button.setAttribute('aria-expanded', String(expanded));
        button.title = expanded ? '收起角色详情' : '展开编辑角色';
        const label = button.querySelector('span');
        if (label) label.textContent = expanded ? '收起' : '展开';
        const icon = button.querySelector('i');
        if (icon) icon.className = expanded ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
    }
}
function setAllComfyCharacterCardsExpanded(expanded) {
    querySettingsAll('#comfy-shared-character-list .sd-char-card')
        .forEach(card => setComfyCharacterCardExpanded(card, expanded));
}
function updateComfyCharacterCardTitle(card) {
    if (!card) return;
    const name = String(card.querySelector('[data-sd-char-field="name"]')?.value || '').trim();
    const type = String(card.querySelector('[data-sd-char-field="type"]')?.value || '').trim();
    const types = { girl: '女孩', boy: '男孩', woman: '成年女性', man: '成年男性', other: '其他' };
    const primary = card.querySelector('[data-comfy-role-primary]');
    if (primary) primary.textContent = name || '未命名角色';
    const secondary = card.querySelector('[data-comfy-role-meta]');
    if (secondary) secondary.textContent = types[type] || type || '未分类';
}

let promptChainPreviewFrame = 0;
let ensureComfyDrawPanelRef = null;
let destroyComfyDrawPanelsRef = null;
let reportComfyDrawPanelStateRef = null;
let imageDelegationBound = false;
let autoBusy = false;
let autoPendingTargets = [];
let injectedDrawingFacts=null;
const autoDrawDiagnostics = new WeakMap();
const events = createModuleEvents(MODULE_KEY);
let generationJobs = new Map();
const backendJobMonitors = createImageBackendJobMonitorRegistry({ active: false });
const COMFY_DRAW_VIEWS = ['api', 'workflow', 'params', 'prompts', 'worldbook', 'characters', 'gallery', 'errors'];
const ImageState = { PREVIEW: 'preview', SAVING: 'saving', SAVED: 'saved', REFRESHING: 'refreshing', FAILED: 'failed' };
const comfyImageRequestQueue = createSerialImageRequestQueue({
    getCooldownMs: () => COMFY_REQUEST_DELAY_MS,
});
const comfyBackendJobsClient = createImageBackendJobsClient({ getHeaders: getRequestHeaders, getOwner: getCurrentUserHandle });
const COMFY_SIZE_PRESETS = [
    { value: '832x1216', width: 832, height: 1216 },
    { value: '1216x832', width: 1216, height: 832 },
    { value: '1024x1024', width: 1024, height: 1024 },
    { value: '768x1280', width: 768, height: 1280 },
    { value: '1280x768', width: 1280, height: 768 },
];
const BUILTIN_WORKFLOWS = [
    {
        id: 'official-core-checkpoint',
        name: '基础出图',
        family: 'simple',
        summary: '最稳的入门方案：选一个模型文件，直接文生图。',
        description: '适合第一次跑通 ComfyUI。独立绘图 会把提示词、尺寸、采样参数填进内置工作流，并只返回预览图。',
        recommended: {
            width: 512,
            height: 512,
            steps: 20,
            cfg: 8,
            sampler: 'euler',
            scheduler: 'normal',
        },
        notes: '如果你不确定选什么，就先用这个。',
    },
    {
        id: 'checkpoint-sdxl',
        name: '高清出图',
        family: 'simple',
        summary: '同一套稳定流程，但默认使用 1024 尺寸。',
        description: '适合已经确认模型能正常出图后再使用。画面更大，也更吃显存。',
        recommended: {
            width: 1024,
            height: 1024,
            steps: 20,
            cfg: 7,
            sampler: 'euler',
            scheduler: 'normal',
        },
        notes: '如果报显存不足，切回基础出图或降低尺寸。',
    },
];
const saveBtnStates = new WeakMap();

function createDefaultPreset() {
    return {
        id: 'default',
        name: '默认',
        width: 1024,
        height: 1024,
        positivePrefix: '',
        negativePrefix: '',
        // 新增
        model: '',
        sampler: 'euler',
        scheduler: 'normal',
        steps: 20,
        cfg: 7,
        maxImages: 2,
        maxCharactersPerImage: 0,
    };
}

function createDefaultWorkflowPreset() {
    return {
        id: 'workflow-default',
        name: '默认工作流',
        json: '',
        nodePositive: '',
        nodeNegative: '',
        nodeWidth: '',
        nodeHeight: '',
        nodeSeed: '',
        nodeSaveImage: '',
    };
}

function normalizeWorkflowPresets(rawPresets, rawCustomWorkflow = {}) {
    const fallbackPreset = {
        ...createDefaultWorkflowPreset(),
        json: String(rawCustomWorkflow?.json || ''),
        nodePositive: String(rawCustomWorkflow?.nodePositive || ''),
        nodeNegative: String(rawCustomWorkflow?.nodeNegative || ''),
        nodeWidth: String(rawCustomWorkflow?.nodeWidth || ''),
        nodeHeight: String(rawCustomWorkflow?.nodeHeight || ''),
        nodeSeed: String(rawCustomWorkflow?.nodeSeed || ''),
        nodeSaveImage: String(rawCustomWorkflow?.nodeSaveImage || ''),
    };
    const source = Array.isArray(rawPresets) && rawPresets.length ? rawPresets : [fallbackPreset];
    return source.map((preset, index) => ({
        ...createDefaultWorkflowPreset(),
        ...preset,
        id: String(preset?.id || `workflow-${Date.now()}-${index}`),
        name: String(preset?.name || `工作流 ${index + 1}`),
        json: String(preset?.json || ''),
        nodePositive: String(preset?.nodePositive || ''),
        nodeNegative: String(preset?.nodeNegative || ''),
        nodeWidth: String(preset?.nodeWidth || ''),
        nodeHeight: String(preset?.nodeHeight || ''),
        nodeSeed: String(preset?.nodeSeed || ''),
        nodeSaveImage: String(preset?.nodeSaveImage || ''),
    }));
}

function getPromptPresetDefaults(name) {
    const guide = getLoadedTagGuide() || '';
    if (isPovPromptPreset(name)) {
        return {
            topSystem: DEFAULT_PROMPT_CONFIG.topSystemPov || DEFAULT_PROMPT_CONFIG.topSystem,
            tagGuideContent: guide,
            sceneRules: DEFAULT_PROMPT_CONFIG.sceneRules,
            fieldDescriptions: '',
        };
    }
    return {
        topSystem: DEFAULT_PROMPT_CONFIG.topSystem,
        tagGuideContent: guide,
        sceneRules: DEFAULT_PROMPT_CONFIG.sceneRules,
        fieldDescriptions: '',
    };
}

function createPromptPreset(name, id = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
    return { id, name, ...getPromptPresetDefaults(name) };
}

function cloneSettingsObject(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

function normalizeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizePresets(rawPresets, rawSettings = {}) {
    const source = Array.isArray(rawPresets) && rawPresets.length ? rawPresets : [{
        ...createDefaultPreset(),
        width: rawSettings.defaultParams?.width ?? 1024,
        height: rawSettings.defaultParams?.height ?? 1024,
        positivePrefix: rawSettings.positivePrefix || '',
        negativePrefix: rawSettings.negativePrefix || '',
    }];

    return source.map((preset, index) => ({
        ...createDefaultPreset(),
        ...preset,
        id: String(preset.id || `preset-${Date.now()}-${index}`),
        name: String(preset.name || `预设 ${index + 1}`),
        width: normalizeNumber(preset.width, 1024, 64, 2048),
        height: normalizeNumber(preset.height, 1024, 64, 2048),
        positivePrefix: String(preset.positivePrefix ?? ''),
        negativePrefix: String(preset.negativePrefix ?? ''),
        model: String(preset.model ?? ''),
        sampler: String(preset.sampler || 'euler'),
        scheduler: String(preset.scheduler || 'normal'),
        steps: normalizeNumber(preset.steps, 20, 1, 150),
        cfg: normalizeNumber(preset.cfg, 7, 1, 30),
        maxImages: normalizeNumber(preset.maxImages, 2, 0, 999),
        maxCharactersPerImage: normalizeNumber(preset.maxCharactersPerImage, 0, 0, 999),
    }));
}

function normalizeSettings(raw = {}) {
    const presets = normalizePresets(raw.presets, raw);
    const workflowPresets = normalizeWorkflowPresets(raw.workflowPresets, raw.customWorkflow);
    const selectedPresetId = presets.some(p => p.id === raw.selectedPresetId)
        ? raw.selectedPresetId
        : presets[0]?.id || 'default';
    const selectedWorkflowPresetId = workflowPresets.some((p) => p.id === raw.selectedWorkflowPresetId)
        ? raw.selectedWorkflowPresetId
        : workflowPresets[0]?.id || 'workflow-default';
    const builtinWorkflowId = BUILTIN_WORKFLOWS.some((item) => item.id === raw.builtinWorkflowId)
        ? raw.builtinWorkflowId
        : DEFAULT_COMFY_DRAW_SETTINGS.builtinWorkflowId;
    const activeWorkflowPreset = workflowPresets.find((item) => item.id === selectedWorkflowPresetId) || workflowPresets[0] || createDefaultWorkflowPreset();
    const merged = {
        host: String(raw.host || ''),
        mode: raw.mode === 'auto' ? 'auto' : 'manual',
        drawSource: 'direct',
        overrideSize: String(raw.overrideSize || 'default'),
        showFloorButton: raw.showFloorButton !== false,
        showFloatingButton: raw.showFloatingButton !== false,
        connectionMode: raw.connectionMode === 'direct' ? 'direct' : 'proxy',
        auth: String(raw.auth ?? ''),
        timeout: normalizeNumber(raw.timeout, DEFAULT_COMFY_DRAW_SETTINGS.timeout, 10000, 600000),
        useImageBackendJobs: raw.useImageBackendJobs === true,
        selectedPresetId,
        selectedWorkflowPresetId,
        builtinWorkflowId,
        presets,
        workflowPresets,
        selectedPromptPresetId: raw.selectedPromptPresetId == null ? null : String(raw.selectedPromptPresetId),
        _promptTemplateVersion: Number(raw._promptTemplateVersion) || 0,
        // 简单模式参数
        selectedModel: String(raw.selectedModel ?? ''),
        sampler: String(raw.sampler || 'euler'),
        scheduler: String(raw.scheduler || 'normal'),
        steps: normalizeNumber(raw.steps, 20, 1, 150),
        cfg: normalizeNumber(raw.cfg, 7, 1, 30),
        // 工作流模式：兼容旧的 'builtin' 转为 'simple'
        workflowMode: raw.workflowMode === 'custom' ? 'custom' : 'simple',
        customWorkflow: {
            json: String(activeWorkflowPreset?.json || ''),
            nodePositive: String(activeWorkflowPreset?.nodePositive || ''),
            nodeNegative: String(activeWorkflowPreset?.nodeNegative || ''),
            nodeWidth: String(activeWorkflowPreset?.nodeWidth || ''),
            nodeHeight: String(activeWorkflowPreset?.nodeHeight || ''),
            nodeSeed: String(activeWorkflowPreset?.nodeSeed || ''),
            nodeSaveImage: String(activeWorkflowPreset?.nodeSaveImage || ''),
        },
        // 缓存
        modelCache: Array.isArray(raw.modelCache) ? raw.modelCache : [],
        samplerCache: Array.isArray(raw.samplerCache) ? raw.samplerCache : [],
        schedulerCache: Array.isArray(raw.schedulerCache) ? raw.schedulerCache : [],

    };

    merged.advancedMode = true;
    let promptPresets = Array.isArray(raw.promptPresets)
        ? raw.promptPresets.filter((preset) => preset && typeof preset.sceneRules === 'string')
        : [];
    if (!promptPresets.length) promptPresets = createScenePlannerDefaultPresets(DEFAULT_PROMPT_CONFIG);

    merged.promptPresets = promptPresets.map((preset, index) => {
        const defaults = getPromptPresetDefaults(preset.name);
        return {
            id: String(preset.id || `prompt-${Date.now()}-${index}`),
            name: String(preset.name || `提示词预设 ${index + 1}`),
            topSystem: typeof preset.topSystem === 'string' ? preset.topSystem : defaults.topSystem,
            tagGuideContent: typeof preset.tagGuideContent === 'string'
                ? preset.tagGuideContent
                : defaults.tagGuideContent,
            sceneRules: typeof preset.sceneRules === 'string' ? preset.sceneRules : defaults.sceneRules,
            // submit_scene_plan 字段描述覆写（JSON 字符串）；空串 = 全部用内置文案
            fieldDescriptions: typeof preset.fieldDescriptions === 'string'
                ? preset.fieldDescriptions
                : defaults.fieldDescriptions,
        };
    });

    if (!merged.selectedPromptPresetId || !merged.promptPresets.some((preset) => preset.id === merged.selectedPromptPresetId)) {
        merged.selectedPromptPresetId = merged.promptPresets[0]?.id || null;
    }
    const activePromptPreset = merged.promptPresets.find((preset) => preset.id === merged.selectedPromptPresetId)
        || merged.promptPresets[0]
        || createPromptPreset('默认-完整规则');
    merged.customPrompts = {
        topSystem: activePromptPreset.topSystem,
        tagGuideContent: activePromptPreset.tagGuideContent,
        sceneRules: activePromptPreset.sceneRules,
        fieldDescriptions: activePromptPreset.fieldDescriptions,
    };

    return merged;
}

export async function loadSettings() {
    if (settingsLoaded && settingsCache) return settingsCache;

    try {
        const saved = await ComfyDrawStorage.getStrict(SERVER_FILE_KEY, null);
        const upgrade = { settings: saved, installed: false, changed: false };
        settingsCache = normalizeSettings(upgrade.settings);
        if (!saved || upgrade.changed) {
            const savedDefaults = await ComfyDrawStorage.setAndSave(SERVER_FILE_KEY, settingsCache, { silent: true });
            if (!savedDefaults) throw new Error('新版提示词预设保存失败');
        }
        if (saved && upgrade.installed) {
            toastr.info(SCENE_PLANNER_PRESET_INSTALL_NOTICE, 'ComfyUI', { timeOut: 8000 });
        }
        settingsLoaded = true;
        return settingsCache;
    } catch (error) {
        console.error('[ComfyDraw] 加载设置失败:', error);
        settingsCache = null;
        settingsLoaded = false;
        toastr.error('无法读取 ComfyUI 配置，已禁止保存，请稍后重试', 'ComfyUI');
        throw error;
    }
}

export function getSettings() {
    if (!settingsCache) {
        console.warn('[ComfyDraw] 设置未加载，使用默认值');
        settingsCache = normalizeSettings({});
    }
    if (!settingsCache.promptPresets?.length) {
        settingsCache = normalizeSettings(settingsCache);
    }
    return settingsCache;
}

export function getGenerationSnapshot() {
    const settings = getSettings();
    const customWorkflow = settings.customWorkflow || {};
    const workflowMode = String(settings.workflowMode || 'simple');
    const executionCustomWorkflow = Object.freeze({
        json: String(customWorkflow.json || ''),
        nodePositive: String(customWorkflow.nodePositive || ''),
        nodeNegative: String(customWorkflow.nodeNegative || ''),
        nodeWidth: String(customWorkflow.nodeWidth || ''),
        nodeHeight: String(customWorkflow.nodeHeight || ''),
        nodeSeed: String(customWorkflow.nodeSeed || ''),
        nodeSaveImage: String(customWorkflow.nodeSaveImage || ''),
    });
    const execution = Object.freeze({
        host: String(settings.host || '').trim(),
        auth: String(settings.auth || ''),
        connectionMode: String(settings.connectionMode || 'proxy'),
        timeout: Number(settings.timeout) || 120000,
        workflowMode,
        customWorkflow: executionCustomWorkflow,
        prepared: true,
    });
    return {
        fingerprint: {
            version: 1,
            endpointHash: hashStableValue(execution.host, 'endpoint'),
            connectionMode: execution.connectionMode,
            workflowMode,
            customWorkflow: workflowMode === 'custom' ? {
                workflowHash: hashStableValue(executionCustomWorkflow.json, 'workflow'),
                nodePositive: executionCustomWorkflow.nodePositive,
                nodeNegative: executionCustomWorkflow.nodeNegative,
                nodeWidth: executionCustomWorkflow.nodeWidth,
                nodeHeight: executionCustomWorkflow.nodeHeight,
                nodeSeed: executionCustomWorkflow.nodeSeed,
                nodeSaveImage: executionCustomWorkflow.nodeSaveImage,
            } : null,
        },
        execution,
    };
}

async function persistSettings(nextSettings, okText = '已保存', { notify = true, silent = false } = {}) {
    if (!settingsLoaded) {
        console.error('[ComfyDraw] 设置尚未成功加载，拒绝保存');
        if (notify) showSettingsNotice('配置尚未成功加载，已禁止保存', 'error');
        return false;
    }
    const next = normalizeSettings(nextSettings);
    const previous = settingsCache ? cloneSettingsObject(settingsCache) : null;
    try {
        settingsCache = next;
        const ok = await ComfyDrawStorage.setAndSave(SERVER_FILE_KEY, next, { silent });
        if (ok !== false) {
            if (notify) {
                showSettingsNotice(okText, 'success');
            }
            return true;
        }
        if (notify) {
            showSettingsNotice('保存失败，请重试', 'error');
        }
        settingsCache = previous;
        return false;
    } catch (error) {
        settingsCache = previous;
        if (notify) {
            showSettingsNotice(error?.message || '保存失败，请重试', 'error');
        }
        return false;
    }
}

export async function updateSettingsPersistent(mutator, okText = '已保存', options = {}) {
    const draft = cloneSettingsObject(getSettings());
    if (typeof mutator === 'function') {
        await mutator(draft);
    }
    return await persistSettings(draft, okText, options);
}

function getActivePreset(settings = getSettings()) {
    return settings.presets.find(p => p.id === settings.selectedPresetId) || settings.presets[0] || createDefaultPreset();
}

function getQuickSizeOptions() {
    return [
        { value: 'default', label: '跟随预设' },
        ...COMFY_SIZE_PRESETS.map((item) => ({
            value: item.value,
            label: item.value.replace('x', ' x '),
        })),
    ];
}

export function getQuickSettings() {
    const settings = getSettings();
    const presets = (settings.presets || []).map((preset) => ({
        value: String(preset.id || ''),
        label: String(preset.name || '未命名'),
    })).filter((preset) => preset.value);
    return {
        provider: 'comfyui',
        providerLabel: 'ComfyUI',
        available: moduleInitialized,
        auto: settings.mode === 'auto',
        presets,
        selectedPresetId: String(settings.selectedPresetId || presets[0]?.value || ''),
        sizeOptions: getQuickSizeOptions(),
        selectedSize: String(settings.overrideSize || 'default'),
    };
}

export async function updateQuickSettings(patch = {}) {
    const ok = await updateSettingsPersistent((settings) => {
        if (Object.prototype.hasOwnProperty.call(patch, 'selectedPresetId')) {
            settings.selectedPresetId = String(patch.selectedPresetId || '');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'selectedSize')) {
            settings.overrideSize = String(patch.selectedSize || 'default');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'auto')) {
            settings.mode = patch.auto === true ? 'auto' : 'manual';
        }
    }, '快捷设置已保存', { notify: false, silent: false });
    if (!ok) {
        throw new Error('quick_settings_save_failed');
    }
    try {
        const fp = await import('./floating-panel.js');
        fp.updateAllPresetSelects?.();
        fp.updateAllSizeSelects?.();
        fp.updateAutoModeUI?.();
    } catch {}
    return getQuickSettings();
}

function getActiveWorkflowPreset(settings = getSettings()) {
    return settings.workflowPresets?.find((p) => p.id === settings.selectedWorkflowPresetId)
        || settings.workflowPresets?.[0]
        || createDefaultWorkflowPreset();
}

function buildWorkflowNodeMapFromForm() {
    return {
        positive: getValue('comfy-node-positive').trim(),
        negative: getValue('comfy-node-negative').trim(),
        width: getValue('comfy-node-width').trim(),
        height: getValue('comfy-node-height').trim(),
        seed: getValue('comfy-node-seed').trim(),
        saveImage: getValue('comfy-node-save-image').trim(),
    };
}

function validateWorkflowPresetDraftOrThrow({ json, nodeMap }) {
    if (!nodeMap.positive || !nodeMap.saveImage) {
        throw new Error('请至少填写正向提示词节点和 SaveImage 节点。');
    }
    const workflow = parseComfyApiWorkflowJson(json);
    validateComfyWorkflowNodeMap(workflow, nodeMap);
}

function getActivePromptPreset(settings = getSettings()) {
    return settings.promptPresets.find((preset) => preset.id === settings.selectedPromptPresetId)
        || settings.promptPresets[0]
        || createPromptPreset('默认-完整规则');
}

function getEffectiveParams(settings = getSettings(), overrides = {}) {
    const preset = getActivePreset(settings);
    const overrideSize = String(overrides.overrideSize ?? settings.overrideSize ?? 'default');
    let sizeOverride = null;
    if (overrideSize && overrideSize !== 'default') {
        const match = overrideSize.match(/^(\d+)x(\d+)$/i);
        if (match) {
            sizeOverride = {
                width: normalizeNumber(match[1], preset.width ?? 1024, 64, 2048),
                height: normalizeNumber(match[2], preset.height ?? 1024, 64, 2048),
            };
        }
    }
    return {
        width: overrides.width ?? sizeOverride?.width ?? preset.width,
        height: overrides.height ?? sizeOverride?.height ?? preset.height,
        positivePrefix: overrides.positivePrefix ?? preset.positivePrefix ?? '',
        negativePrefix: overrides.negativePrefix ?? preset.negativePrefix ?? '',
        model: overrides.model ?? preset.model ?? settings.selectedModel ?? '',
        sampler: overrides.sampler ?? preset.sampler ?? settings.sampler ?? 'euler',
        scheduler: overrides.scheduler ?? preset.scheduler ?? settings.scheduler ?? 'normal',
        steps: overrides.steps ?? preset.steps ?? settings.steps ?? 20,
        cfg: overrides.cfg ?? preset.cfg ?? settings.cfg ?? 7,
    };
}

export function createComfyGenerationRecipe({
    settings = getSettings(),
    characterLibrary = characterLibraryFromSettings(getSharedDrawSettings()),
    paramsOverride = {},
    promptOverride = '',
    negativePromptOverride = '',
    itemCount = 0,
} = {}) {
    const params = getEffectiveParams(settings, paramsOverride);
    const customWorkflow = settings.customWorkflow || {};
    return {
        host: String(settings.host || '').trim(),
        auth: String(settings.auth || ''),
        timeout: Number(settings.timeout) || 120000,
        delayMs: COMFY_REQUEST_DELAY_MS,
        workflowMode: settings.workflowMode === 'custom' ? 'custom' : 'simple',
        customWorkflow: {
            json: String(customWorkflow.json || ''),
            nodePositive: String(customWorkflow.nodePositive || ''),
            nodeNegative: String(customWorkflow.nodeNegative || ''),
            nodeWidth: String(customWorkflow.nodeWidth || ''),
            nodeHeight: String(customWorkflow.nodeHeight || ''),
            nodeSeed: String(customWorkflow.nodeSeed || ''),
            nodeSaveImage: String(customWorkflow.nodeSaveImage || ''),
        },
        params: cloneSettingsObject(params),
        positivePrefix: params.positivePrefix,
        negativePrefix: params.negativePrefix,
        // 只携带有效启用的角色（分组开着且角色自己开着），后台 500 条上限也按这个数计。
        knownCharacters: cloneSettingsObject(selectEnabledCharacters(characterLibrary)),
        promptOverride: String(promptOverride || ''),
        negativePromptOverride: String(negativePromptOverride || ''),
        seeds: Array.from({ length: Math.max(0, Math.floor(Number(itemCount) || 0)) }, createComfySeed),
    };
}

function getBuiltinWorkflowDefinition(id) {
    return BUILTIN_WORKFLOWS.find((item) => item.id === id) || BUILTIN_WORKFLOWS[0];
}

function createBuiltinWorkflowPreview({ model, width, height, steps, cfg, sampler, scheduler }) {
    const workflow = buildSimpleWorkflow({
        model: String(model || '<selected-model>'),
        sampler,
        scheduler,
        steps,
        cfg,
        width,
        height,
        positive: '<positive-prompt>',
        negative: '<negative-prompt>',
        seed: '<random-seed>',
    });
    return JSON.stringify(workflow, null, 2);
}

function getBuiltinWorkflowPreviewParams(settings = getSettings()) {
    const activePreset = getActivePreset(settings);
    const selectedBuiltinId = getValue('comfy-builtin-workflow') || settings.builtinWorkflowId || DEFAULT_COMFY_DRAW_SETTINGS.builtinWorkflowId;
    const workflow = getBuiltinWorkflowDefinition(selectedBuiltinId);
    const fallback = workflow.recommended || {};
    const sizePreset = getValue('comfy-draw-size-preset');

    let width = normalizeNumber(getValue('comfy-draw-width'), activePreset?.width ?? fallback.width ?? 1024, 64, 2048);
    let height = normalizeNumber(getValue('comfy-draw-height'), activePreset?.height ?? fallback.height ?? 1024, 64, 2048);
    if (sizePreset && sizePreset !== 'custom') {
        const matched = COMFY_SIZE_PRESETS.find((item) => item.value === sizePreset);
        if (matched) {
            width = matched.width;
            height = matched.height;
        }
    }

    return {
        model: getValue('comfy-draw-model') || activePreset?.model || settings.selectedModel || '<selected-model>',
        sampler: getValue('comfy-draw-sampler') || activePreset?.sampler || settings.sampler || fallback.sampler || 'euler',
        scheduler: getValue('comfy-draw-scheduler') || activePreset?.scheduler || settings.scheduler || fallback.scheduler || 'normal',
        steps: normalizeNumber(getValue('comfy-draw-steps'), activePreset?.steps ?? settings.steps ?? fallback.steps ?? 20, 1, 150),
        cfg: normalizeNumber(getValue('comfy-draw-cfg'), activePreset?.cfg ?? settings.cfg ?? fallback.cfg ?? 7, 1, 30),
        width,
        height,
    };
}

function createComfyRequestSignal(signal, timeoutMs) {
    const controller = new AbortController();
    let timeoutId = null;
    const abort = () => controller.abort();

    if (signal?.aborted) {
        controller.abort();
    } else if (signal) {
        signal.addEventListener('abort', abort, { once: true });
    }

    if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
        timeoutId = setTimeout(() => controller.abort(), Number(timeoutMs));
    }

    return {
        signal: controller.signal,
        cleanup() {
            if (timeoutId) clearTimeout(timeoutId);
            if (signal) signal.removeEventListener('abort', abort);
        },
    };
}

function createComfyDeadlineSignal(signal, timeoutMs) {
    return createComfyRequestSignal(signal, timeoutMs);
}

function getComfyAuthHeaders(settings = getSettings()) {
    const auth = String(settings.auth || '').trim();
    if (!auth) return {};
    return { Authorization: `Basic ${btoa(auth)}` };
}

function isDirectConnection(settings = getSettings()) {
    return settings.connectionMode === 'direct';
}

function createComfyUrl(path, query = {}, settings = getSettings()) {
    const base = String(settings.host || '').trim();
    if (!base) throw new Error('请先填写 ComfyUI 地址');
    // 直接用 new URL(path, base) 会在 base 同时带路径和 query 时把补的 '/' 拼进 query，
    // 导致反代基础路径丢失；改为显式拼 pathname，同时保留 base 上的 query 参数。
    const url = new URL(base);
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${basePath}/${String(path || '').replace(/^\/+/, '')}`;
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    return url;
}

async function requestComfyTransport(path, body = {}, { signal, timeoutMs, generationConfig, attempt } = {}) {
    const settings = generationConfig || getSettings();
    if (!settings.host) throw new Error('请先填写 ComfyUI 地址');
    if (isDirectConnection(settings) && path === 'ping') {
        await testComfyDirectConnection({ signal, timeoutMs, generationConfig: settings });
        return { ok: true, json: async () => ({}) };
    }
    if (isDirectConnection(settings) && path === 'generate') {
        const workflow = JSON.parse(body?.prompt || '{}')?.prompt;
        const data = await fetchComfyDirectImageFromWorkflow(workflow, {
            signal,
            timeoutMs,
            generationConfig: settings,
            preferredSaveImageNodeId: body?.preferredSaveImageNodeId,
            attempt,
        });
        return { ok: true, json: async () => ({ data }) };
    }
    const proxySignal = createComfyRequestSignal(signal, timeoutMs ?? settings.timeout ?? 120000);
    try {
        const payload = JSON.stringify({ url: settings.host, ...body });
        attempt?.submit();
        const response = await fetch(`/api/sd/comfy/${path}`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: payload,
            signal: proxySignal.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (path === 'generate') {
                throw imageHttpFailure(new Error(buildComfyProxyGenerateError(text || `HTTP ${response.status}`, response.status)), response.status);
            }
            throw Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
        }
        return response;
    } catch (error) {
        if (path === 'generate' && isComfyProxyGenerateFailure(error)) {
            throw withImageRequestOutcome(new Error(buildComfyProxyGenerateError(error?.message || 'ComfyUI 生成失败', error?.status)),
                error.imageRequestOutcome ?? ImageRequestOutcome.UNKNOWN);
        }
        if (error?.name === 'AbortError') error.uncertain = true;
        throw error;
    } finally {
        proxySignal.cleanup();
    }
}

async function fetchComfyDirectJson(path, { signal, timeoutMs, method = 'GET', body, generationConfig, attempt } = {}) {
    const settings = generationConfig || getSettings();
    const directSignal = createComfyRequestSignal(signal, timeoutMs ?? settings.timeout ?? 120000);
    try {
        const url = createComfyUrl(path, {}, settings);
        attempt?.submit();
        const response = await fetch(url, {
            method,
            headers: {
                ...getComfyAuthHeaders(settings),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body,
            signal: directSignal.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const error = Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
            throw attempt ? imageHttpFailure(error, response.status) : error;
        }
        return await response.json();
    } catch (error) {
        if (error?.name === 'AbortError') error.uncertain = true;
        throw error;
    } finally {
        directSignal.cleanup();
    }
}

async function fetchComfyDirectBlob(path, query = {}, { signal, timeoutMs, generationConfig } = {}) {
    const settings = generationConfig || getSettings();
    const directSignal = createComfyRequestSignal(signal, timeoutMs ?? settings.timeout ?? 120000);
    try {
        const response = await fetch(createComfyUrl(path, query, settings), {
            headers: getComfyAuthHeaders(settings),
            signal: directSignal.signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
        }
        return await response.blob();
    } catch (error) {
        if (error?.name === 'AbortError') error.uncertain = true;
        throw error;
    } finally {
        directSignal.cleanup();
    }
}

function normalizeComfyModelList(data = {}) {
    return (data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []).filter(Boolean);
}

async function fetchComfyDirectModels({ signal, timeoutMs } = {}) {
    const data = await fetchComfyDirectJson('/object_info', { signal, timeoutMs });
    return normalizeComfyModelList(data);
}

async function fetchComfyDirectSamplers({ signal, timeoutMs } = {}) {
    const data = await fetchComfyDirectJson('/object_info', { signal, timeoutMs });
    return {
        samplers: data.KSampler?.input?.required?.sampler_name?.[0] || [],
        schedulers: data.KSampler?.input?.required?.scheduler?.[0] || [],
    };
}

async function testComfyDirectConnection({ signal, timeoutMs, generationConfig } = {}) {
    await fetchComfyDirectJson('/system_stats', { signal, timeoutMs, generationConfig });
}

function isComfyProxyGenerateFailure(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('did not return any recognizable outputs')
        || msg.includes('未返回图片数据')
        || msg.includes('execution_cached')
        || msg.includes('cached-empty');
}

function buildComfyProxyGenerateError(message, status = null) {
    const raw = String(message || '').trim();
    const prefix = status ? `ComfyUI 取图失败（HTTP ${status}）` : 'ComfyUI 取图失败';
    if (/did not return any recognizable outputs|未返回图片数据|execution_cached|cached-empty/i.test(raw)) {
        return `${prefix}：ComfyUI 可能已经出图，但这次没有把图片返回到酒馆。请先检查 ComfyUI 输出目录；如果反复出现，可以换另一种连接方式对照。`;
    }
    return `${prefix}：${raw || '后端返回失败'}`;
}

async function fetchComfyDirectImageFromWorkflow(workflow, {
    signal,
    timeoutMs,
    generationConfig,
    preferredSaveImageNodeId,
    attempt,
} = {}) {
    const settings = generationConfig || getSettings();
    const deadline = createComfyDeadlineSignal(signal, timeoutMs ?? settings.timeout ?? 120000);
    let promptId = null;
    let queueDropStarted = false;
    const dropQueuedPrompt = () => {
        if (!promptId || queueDropStarted) return;
        queueDropStarted = true;
        // Delete only this request's waiting entry. A global interrupt would
        // also stop work belonging to other tabs or ComfyUI users.
        void fetchComfyDirectJson('/queue', {
            method: 'POST',
            body: JSON.stringify({ delete: [promptId] }),
            timeoutMs: 5000,
            generationConfig: settings,
        }).catch(() => {});
    };
    deadline.signal.addEventListener('abort', dropQueuedPrompt, { once: true });
    try {
        deadline.signal.throwIfAborted();
        const data = await fetchComfyDirectJson('/prompt', {
            attempt,
            method: 'POST',
            body: JSON.stringify({ prompt: workflow }),
            signal: deadline.signal,
            timeoutMs,
            generationConfig: settings,
        });
        promptId = data?.prompt_id;
        if (!promptId) throw new Error('ComfyUI 未返回任务 ID');
        // The response/body may finish after cancellation. Once its ID is
        // known, remove that accepted entry even if the abort listener ran first.
        if (deadline.signal.aborted) dropQueuedPrompt();

        let item = null;
        let cachedEmptySince = 0;
        while (!deadline.signal.aborted) {
            const history = await fetchComfyDirectJson('/history', {
                signal: deadline.signal,
                timeoutMs,
                generationConfig: settings,
            });
            item = history?.[promptId];
            if (!item) {
                await waitWithAbort(deadline.signal, 100);
                continue;
            }

            if (item.status?.status_str === 'error') break;

            const imgInfo = resolveComfyDirectOutputImage(item, workflow, preferredSaveImageNodeId);
            if (imgInfo) break;

            if (item.status?.status_str === 'success') {
                cachedEmptySince ||= Date.now();
                if (Date.now() - cachedEmptySince > 15000) {
                    throw new Error('ComfyUI 可能已经出图，但这次没有把图片返回到酒馆。请先检查 ComfyUI 输出目录；如果反复出现，可以换另一种连接方式对照。');
                }
            }

            await waitWithAbort(deadline.signal, 100);
        }
        if (deadline.signal.aborted) {
            const errorType = signal?.aborted ? ErrorType.ABORTED : ErrorType.TIMEOUT;
            throw Object.assign(new Error(errorType.desc), { errorType });
        }
        if (!item) throw new Error('ComfyUI 未返回生成结果');

        if (item.status?.status_str === 'error') {
            const errorMessages = item.status?.messages
                ?.filter(it => it[0] === 'execution_error')
                .map(it => it[1])
                .map(it => `${it.node_type} [${it.node_id}] ${it.exception_type}: ${it.exception_message}`)
                .join('\r\n') || '';
            throw withImageRequestOutcome(new Error(`ComfyUI 生成失败${errorMessages ? `\r\n\r\n${errorMessages}` : ''}`), ImageRequestOutcome.REJECTED);
        }

        const imgInfo = resolveComfyDirectOutputImage(item, workflow, preferredSaveImageNodeId);
        if (!imgInfo) {
            const suffix = item?.status?.status_str === 'success'
                ? '请先检查 ComfyUI 输出目录；如果反复出现，可以换另一种连接方式对照。'
                : '请稍后重试，或检查 ComfyUI 是否正常出图。';
            throw new Error(`ComfyUI 未返回图片数据。${suffix}`);
        }

        const blob = await fetchComfyDirectBlob('/view', {
            filename: imgInfo.filename,
            subfolder: imgInfo.subfolder,
            type: imgInfo.type,
        }, { signal: deadline.signal, timeoutMs, generationConfig: settings });
        return await readImageBlobBase64(blob);
    } finally {
        deadline.signal.removeEventListener('abort', dropQueuedPrompt);
        deadline.cleanup();
    }
}

async function fetchComfyModels({ signal, timeoutMs } = {}) {
    if (isDirectConnection()) {
        return await fetchComfyDirectModels({ signal, timeoutMs });
    }
    const res = await requestComfyTransport('models', {}, { signal, timeoutMs });
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
        .filter(item => {
            const label = String(item?.text ?? item?.value ?? item ?? '');
            const value = String(item?.value ?? item ?? '');
            return !/^(UNet|GGUF):/i.test(label) && !/^(UNet|GGUF):/i.test(value);
        })
        .map(item => typeof item === 'string' ? item : item?.value)
        .filter(Boolean);
}

async function fetchComfySamplers({ signal, timeoutMs } = {}) {
    if (isDirectConnection()) {
        return await fetchComfyDirectSamplers({ signal, timeoutMs });
    }
    const [samplersRes, schedulersRes] = await Promise.all([
        requestComfyTransport('samplers', {}, { signal, timeoutMs }),
        requestComfyTransport('schedulers', {}, { signal, timeoutMs }),
    ]);
    const samplers = await samplersRes.json();
    const schedulers = await schedulersRes.json();
    return {
        samplers: Array.isArray(samplers) ? samplers : [],
        schedulers: Array.isArray(schedulers) ? schedulers : [],
    };
}

function createComfySeed() {
    return Math.floor(Math.random() * 2 ** 32);
}

async function requestComfyImage({ prompt, negativePrompt = '', params = {}, prepared, seed, generationConfig, signal } = {}) {
    const attempt = createImageRequestAttempt();
    try {
        signal?.throwIfAborted();
        const settings = generationConfig || getSettings();
        const effective = generationConfig?.prepared === true ? params : getEffectiveParams(settings, params);
        const request = prepared || buildComfyImageRequest({
            prompt,
            negativePrompt,
            params: effective,
            recipe: { ...settings, knownCharacters: selectEnabledCharacters(characterLibraryFromSettings(getSharedDrawSettings())) },
            seed: seed ?? createComfySeed(),
        });
        // Uploaded role photographs live on H28K, not in the Windows ComfyUI input folder.
        // Resolve them only for the new Krea2 role-photo preset; old presets keep their path.
        let submittedWorkflow = request.workflow;
        // Some manual/test/recovery paths pass a saved API template instead of
        // a freshly compiled request. Resolve it here too, before ComfyUI sees it.
        if (submittedWorkflow?.['15']?.inputs?.image === '__LWB_ROLE_PHOTO__') {
            submittedWorkflow = applyRolePhotoReference(
                structuredClone(submittedWorkflow), {
                    prompt,
                    knownCharacters: selectEnabledCharacters(
                        characterLibraryFromSettings(getSharedDrawSettings())),
                });
        }
        const needsPhotoTransfer = Object.values(submittedWorkflow || {}).some(node =>
            node?.class_type === 'LoadImage'
            && String(node?.inputs?.image || '').startsWith('lwb-role-photo:'));
        if (needsPhotoTransfer) {
            const transfer = await fetch('/api/plugins/sillytavern-image-server/runtime/v1/comfy/resolve-role-photo', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ url: settings.host, auth: settings.auth || '', workflow: submittedWorkflow }),
                signal,
            });
            if (!transfer.ok) {
                const detail = await transfer.text().catch(() => '');
                throw new Error('角色照片传给 ComfyUI 失败：' + detail.slice(0, 230));
            }
            submittedWorkflow = (await transfer.json()).workflow;
            if (!submittedWorkflow) throw new Error('角色照片传输未返回工作流');
        }
        const requestBody = { prompt: JSON.stringify({ prompt: submittedWorkflow }) };
        if (isDirectConnection(settings) && request.preferredSaveImageNodeId) requestBody.preferredSaveImageNodeId = request.preferredSaveImageNodeId;

        const response = await requestComfyTransport('generate', requestBody, {
            attempt,
            signal,
            timeoutMs: settings.timeout || 120000,
            generationConfig: settings,
        });
        const data = await response.json();
        if (!data?.data) throw new Error('ComfyUI 未返回图片数据');
        return String(data.data || '');
    } catch (error) { throw attempt.failure(error); }
}

async function runComfyImageBatch({
    requests,
    compiledBatch,
    generationConfig,
    signal,
    backendCancelSignal,
    recoverable,
    monitorGeneration,
    queueBatch,
    onStateChange,
    onItemReady,
    onItemSettled,
    onItemStarting,
}) {
    if (!requests.length) return { mode: 'empty' };
    const settings = generationConfig || getSettings();
    const prepared = compiledBatch
        ? compiledBatch.items.map(item => item.request)
        : requests.map((request) => {
            const effective = settings.prepared === true
                ? request.params
                : getEffectiveParams(settings, request.params);
            return request.prepared || buildComfyImageRequest({
                ...request,
                params: effective,
                recipe: { ...settings, knownCharacters: selectEnabledCharacters(characterLibraryFromSettings(getSharedDrawSettings())) },
                seed: request.seed ?? createComfySeed(),
            });
        });
    if (settings.useImageBackendJobs && recoverable) {
        let status;
        const detachScope = backendJobMonitors.createScope(
            backendCancelSignal ? signal : null,
            monitorGeneration ?? backendJobMonitors.captureGeneration(),
        );
        try {
            status = await fetchImageBackendJobsStatus({ getHeaders: getRequestHeaders, signal });
        } catch (error) {
            detachScope.dispose();
            if (signal?.aborted) throw new Error('已取消');
            throw error;
        }
        if (!hasImageBackendJobsCapability(status)) {
            detachScope.dispose();
            throw new Error(IMAGE_JOBS_UNAVAILABLE_MESSAGE);
        }
        try {
            const backendRequest = compiledBatch
                ? {
                    provider: compiledBatch.provider,
                    context: compiledBatch.context,
                    delay: compiledBatch.delay,
                    items: compiledBatch.items,
                }
                : {
                    provider: 'comfyui',
                    context: { url: settings.host, auth: settings.auth || '' },
                    delay: { min: COMFY_REQUEST_DELAY_MS, max: COMFY_REQUEST_DELAY_MS },
                    items: prepared.map(request => ({ request, timeout: settings.timeout || 120000 })),
                };
            const backendHandlers = {
                cancelSignal: backendCancelSignal || signal,
                detachSignal: detachScope.signal,
                onStateChange: (state, data) => reportImageBackendJobState(onStateChange, state, data),
                onItemReady: async ({ response, ...details }) => onItemReady?.({ ...details, base64: await readImageBackendResultBase64(response) }),
                onItemSettled: async (item) => {
                    // 早先已交付并 ACK 过的项是成功事实，绝不能触发失败 UI；
                    // 它由恢复流程按记录的 imgId 从画廊还原。
                    if (item.alreadyDelivered === true) return;
                    await onItemSettled?.({
                        ...item,
                        error: item.source === 'frontend' ? item.error : createBackendItemError(item),
                    });
                },
            };
            const result = await submitRecoverableImageJob({
                client: comfyBackendJobsClient,
                provider: 'comfyui',
                request: backendRequest,
                plan: recoverable.plan,
                commitPlacements: recoverable.commitPlacements,
                settlePlacements: recoverable.settlePlacements,
                resolveSettlement: recoverable.resolveSettlement,
                afterForget: recoverable.afterForget,
                ...backendHandlers,
            });
            return { mode: 'backend-job', ...result };
        } catch (error) {
            if (error?.detached === true || error?.code === 'PENDING_JOB_LEASE_LOST') throw error;
            if (signal?.aborted) throw new Error('已取消');
            throw error;
        } finally {
            detachScope.dispose();
        }
    }
    for (let index = 0; index < requests.length; index++) {
        if (signal?.aborted) {
            for (let pending = index; pending < requests.length; pending++) {
                await onItemSettled?.({ index: pending, state: 'cancelled', error: new Error('已取消'), source: 'frontend' });
            }
            break;
        }
        try {
            const base64 = await generateComfyImage({
                ...requests[index],
                prepared: prepared[index],
                beforeRequest: () => onItemStarting?.({ index }),
                generationConfig: settings,
                signal,
                queueBatch,
                onQueueStateChange: (state, data) => {
                if (state === 'start') return onStateChange?.('progress', { current: index + 1, total: requests.length });
                if (state === 'cooldown') {
                    if (index + 1 >= requests.length) return;
                    return onStateChange?.('cooldown', { ...data, nextIndex: index + 2, total: requests.length });
                }
                onStateChange?.(state, { current: index + 1, total: requests.length, ...data });
                },
            });
            if (base64 === null) continue;
            await onItemReady?.({ index, base64 });
        } catch (error) {
            await onItemSettled?.({ index, state: signal?.aborted ? 'cancelled' : 'failed', error, source: 'frontend' });
            if (signal?.aborted) break;
        }
    }
    return { mode: 'frontend' };
}

function waitWithAbort(signal, durationMs) {
    return new Promise((resolve) => {
        if (!durationMs || durationMs <= 0) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, durationMs);
        if (!signal) return;
        signal.addEventListener('abort', async () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

export async function generateComfyImage({
    prompt,
    negativePrompt = '',
    params = {},
    prepared,
    seed,
    generationConfig,
    signal,
    queueBatch,
    onQueueStateChange,
    beforeRequest,
} = {}) {
    return comfyImageRequestQueue.enqueue(
        async () => {
            if (await beforeRequest?.() === false) return null;
            return requestComfyImage({ prompt, negativePrompt, params, prepared, seed, generationConfig, signal });
        },
        {
            signal,
            batchKey: queueBatch,
            onQueued: (data) => onQueueStateChange?.('queued', data),
            onStart: () => onQueueStateChange?.('start'),
            onCooldown: (data) => onQueueStateChange?.('cooldown', data),
        },
    );
}

async function generateSingleComfyImage(request, {
    signal,
    generationConfig,
    onQueueStateChange,
} = {}) {
    const settings = generationConfig || getSettings();
    return generateComfyImage({ ...request, generationConfig: settings, signal, onQueueStateChange });
}

function ensureStyles() {
    if (document.getElementById('stimage-comfy-draw-style')) return;
    const style = document.createElement('style');
    style.id = 'stimage-comfy-draw-style';
    style.textContent = `
#stimage-comfy-draw-overlay .comfy-draw-backdrop{position:absolute;top:0;left:0;width:100%;height:100%;background:#0d1117}
#stimage-comfy-draw-overlay .comfy-draw-frame-wrap{position:absolute;z-index:1}
#stimage-comfy-draw-iframe{width:100%;height:100%;border:none;background:#0d1117}
@media(min-width:769px){#stimage-comfy-draw-overlay .comfy-draw-frame-wrap{top:12px;left:12px;right:12px;bottom:12px}#stimage-comfy-draw-iframe{border-radius:12px}}
@media(max-width:768px){#stimage-comfy-draw-overlay .comfy-draw-frame-wrap{top:0;left:0;right:0;bottom:0}#stimage-comfy-draw-iframe{border-radius:0}}
`;
    document.head.appendChild(style);
}

async function createOverlay() {
    if (overlayElement && frameReadyPromise) {
        await frameReadyPromise;
        return overlayElement;
    }
    ensureStyles();

    overlayElement = document.createElement('div');
    overlayElement.id = 'stimage-comfy-draw-overlay';
    overlayElement.style.cssText = 'position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;height:' + window.innerHeight + 'px!important;z-index:100002!important;display:none;overflow:hidden!important;';
    const backdrop = document.createElement('div');
    backdrop.className = 'comfy-draw-backdrop';
    backdrop.addEventListener('click', hideSettings);
    const frameWrap = document.createElement('div');
    frameWrap.className = 'comfy-draw-frame-wrap';
    overlayFrame = document.createElement('iframe');
    overlayFrame.id = 'stimage-comfy-draw-iframe';
    overlayFrame.src = `${HTML_PATH}?v=${Date.now()}`;
    frameWrap.appendChild(overlayFrame);
    overlayElement.append(backdrop, frameWrap);
    document.body.appendChild(overlayElement);

    resizeHandler = () => {
        if (overlayElement && overlayElement.style.display !== 'none' && !viewportSyncFrame) {
            viewportSyncFrame = requestAnimationFrame(() => {
                viewportSyncFrame = 0;
                syncOverlayHeight();
            });
        }
    };
    window.addEventListener('resize', resizeHandler);
    window.visualViewport?.addEventListener('resize', resizeHandler);
    window.visualViewport?.addEventListener('scroll', resizeHandler);

    frameReadyPromise = new Promise((resolve, reject) => {
        overlayFrame?.addEventListener('load', async () => {
            eventsBound = false;
            bindOverlayEvents();
            fillForm(getSettings());
            overlayFrame.contentDocument?.addEventListener('focusin', resizeHandler);
            overlayFrame.contentDocument?.addEventListener('focusout', resizeHandler);
            syncOverlayHeight();
            resolve(overlayElement);
        }, { once: true });
        overlayFrame?.addEventListener('error', async () => {
            reject(new Error('ComfyUI 设置页加载失败'));
        }, { once: true });
    });

    await frameReadyPromise;
    return overlayElement;
}

function readVisibleViewport() {
    const vv = window.visualViewport;
    return {
        height: Math.round((vv && vv.height) || window.innerHeight || 0),
        offsetTop: Math.round((vv && vv.offsetTop) || 0),
    };
}

function trackVisibleViewport(element) {
    const apply = () => {
        if (!element || !element.isConnected) return;
        const view = readVisibleViewport();
        element.style.setProperty('top', view.offsetTop + 'px', 'important');
        element.style.setProperty('height', view.height + 'px', 'important');
        element.style.setProperty('bottom', 'auto', 'important');
    };
    apply();
    const vv = window.visualViewport;
    if (!vv) return function () {};
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return function () {
        vv.removeEventListener('resize', apply);
        vv.removeEventListener('scroll', apply);
    };
}

function trackVisibleViewportAuto(element) {
    const stop = trackVisibleViewport(element);
    const timer = setInterval(() => {
        if (!element.isConnected) { clearInterval(timer); stop(); }
    }, 500);
}

function syncOverlayHeight() {
    if (!overlayElement) return;
    const view = readVisibleViewport();
    const fd = overlayFrame?.contentDocument;
    const active = fd?.activeElement;
    settingsViewportState = resolveSettingsViewport(settingsViewportState, {
        width: window.innerWidth,
        layoutHeight: window.innerHeight,
        visibleHeight: view.height,
        offsetTop: view.offsetTop,
        mobile: window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches,
        editable: Boolean(active && (active.matches('input, textarea, select') || active.isContentEditable)),
    });
    // Offset compensates browser panning, while height stays independent of
    // keyboard animation. Only the central scroller receives the occlusion.
    overlayElement.style.setProperty('top', settingsViewportState.offsetTop + 'px', 'important');
    overlayElement.style.setProperty('height', settingsViewportState.height + 'px', 'important');
    document.documentElement.style.setProperty('--vvh', view.height + 'px');
    document.documentElement.style.setProperty('--vv-top', view.offsetTop + 'px');
    try {
        if (fd && fd.documentElement) {
            const height = overlayFrame.clientHeight || settingsViewportState.height;
            const safeHeight = Math.max(0, Math.min(height,
                view.offsetTop + settingsViewportState.visibleHeight - overlayFrame.getBoundingClientRect().top));
            fd.documentElement.style.setProperty('--app-h', height + 'px');
            fd.documentElement.style.setProperty('--kbd-safe-h', safeHeight + 'px');
            fd.documentElement.style.setProperty('--kbd-inset', Math.max(0, height - safeHeight) + 'px');
            fd.documentElement.style.setProperty('--vvh', safeHeight + 'px');
            fd.dispatchEvent(new fd.defaultView.Event('sti-comfy-viewport'));
        }
    } catch (_) {}
}

function getSettingsDocument() {
    return overlayFrame?.contentDocument || document.getElementById('stimage-comfy-draw-iframe')?.contentDocument || null;
}

function getSettingsElement(id) {
    return getSettingsDocument()?.getElementById(id) || null;
}

function querySettings(selector) {
    return getSettingsDocument()?.querySelector(selector) || null;
}

function querySettingsAll(selector) {
    return Array.from(getSettingsDocument()?.querySelectorAll(selector) || []);
}

function showSettingsNotice(message, level = 'success') {
    if (!document.getElementById('sti-save-notice-style')) {
        const style = document.createElement('style');
        style.id = 'sti-save-notice-style';
        style.textContent = `
            #sti-save-notices { position:fixed; z-index:2147483007; top:calc(env(safe-area-inset-top, 0px) + 64px); left:50%; transform:translateX(-50%); width:min(420px, calc(100% - 32px)); pointer-events:none; }
            #sti-save-notices > .toast { width:100%; box-sizing:border-box; padding:12px 16px; margin:0 0 8px; border:1px solid #46515f; border-radius:10px; background:#202832; background-image:none !important; box-shadow:0 6px 20px #0004; color:#e6edf3; font-size:14px; line-height:1.5; opacity:1; pointer-events:auto; overflow-wrap:anywhere; }
            #sti-save-notices > .toast-success { border-color:#557564; }
            #sti-save-notices > .toast-error { border-color:#a55d5d; }
        `;
        document.head.appendChild(style);
    }
    const show = toastr[level] || toastr.info;
    show.call(toastr, String(message || ''), undefined, {
        containerId: 'sti-save-notices', positionClass: '',
        timeOut: level === 'error' ? 4500 : 2000, extendedTimeOut: 0,
        closeButton: false, tapToDismiss: true, escapeHtml: true,
        preventDuplicates: true, progressBar: false, showDuration: 120, hideDuration: 180,
    });
}

// 自定义输入对话框：替代原生 await askInputDialog()。移动端原生 prompt 会强制页面缩放/重排，导致整个 UI 上移。
function askInputDialog(title, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;height:100%;z-index:2147483006;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
        const box = document.createElement('div');
        box.style.cssText = 'width:min(420px,100%);max-height:calc(var(--vvh, 100vh) - 24px);overflow-y:auto;overscroll-behavior:contain;background:#1b2029;color:#e6edf3;border:1px solid #3c4552;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;';
        const label = document.createElement('div');
        label.textContent = title || '';
        label.style.cssText = 'font-size:14px;font-weight:600;line-height:1.5;';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue || '';
        input.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid #4a5563;background:#0f141b;color:#e6edf3;font-size:15px;box-sizing:border-box;';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = '取消';
        cancel.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #4a5563;background:#2a323d;color:#e6edf3;font-size:14px;';
        const ok = document.createElement('button');
        ok.type = 'button'; ok.textContent = '确定';
        ok.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #8e6239;background:#8e6239;color:#fff;font-size:14px;';
        actions.append(cancel, ok);
        box.append(label, input, actions);
        overlay.append(box);
        document.body.append(overlay);
        const stopTracking = trackVisibleViewport(overlay);
        const done = (value) => { stopTracking(); overlay.remove(); resolve(value); };
        cancel.addEventListener('click', () => done(null));
        ok.addEventListener('click', () => done(input.value.trim() || null));
        overlay.addEventListener('click', async (e) => { if (e.target === overlay) done(null); });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
            else if (e.key === 'Escape') { e.preventDefault(); done(null); }
        });
        try { input.focus({ preventScroll: true }); input.select(); } catch (_) {}
    });
}

// 自定义确认对话框：替代原生 await askConfirmDialog()（同样避免移动端页面缩放/上移）
function askConfirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;height:100%;z-index:2147483006;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
        const box = document.createElement('div');
        box.style.cssText = 'width:min(420px,100%);max-height:calc(var(--vvh, 100vh) - 24px);overflow-y:auto;overscroll-behavior:contain;background:#1b2029;color:#e6edf3;border:1px solid #3c4552;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;';
        const text = document.createElement('div');
        text.textContent = message || '';
        text.style.cssText = 'font-size:14px;line-height:1.6;word-break:break-word;';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = '取消';
        cancel.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #4a5563;background:#2a323d;color:#e6edf3;font-size:14px;';
        const ok = document.createElement('button');
        ok.type = 'button'; ok.textContent = '确定';
        ok.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #8e6239;background:#8e6239;color:#fff;font-size:14px;';
        actions.append(cancel, ok);
        box.append(text, actions);
        overlay.append(box);
        document.body.append(overlay);
        const stopTracking = trackVisibleViewport(overlay);
        const done = (value) => { stopTracking(); overlay.remove(); resolve(value); };
        cancel.addEventListener('click', () => done(false));
        ok.addEventListener('click', () => done(true));
        overlay.addEventListener('click', async (e) => { if (e.target === overlay) done(false); });
    });
}

// 把错误原文翻译成大白话，便于快速判断问题
function explainImageError(message) {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (/did not complete normally|prohibited|blockreason|block_reason|safety|finish_reason.?stop/.test(lower)) {
        return '模型未返回可用内容。请查看上游实际错误，并检查场景是否符合服务的生成规则。';
    }
    if (/too many requests|429|freeusage|free usage|rate.?limit|quota|额度|insufficient/.test(lower)) {
        return '模型额度用尽了（或请求太频繁被限流）。等额度重置，或换一个有额度的模型。';
    }
    if (/not found|404|no such|does not exist|unknown model|invalid model/.test(lower)) {
        return '这个模型名在服务里不存在（可能写错了，或该模型已下线）。去模型列表核对正确的模型名。';
    }
    if (/etimedout|timeout|timed out|502|503|504|fetch failed|econnreset|enotfound|econnrefused|connect|aborted/.test(lower)) {
        return '连不上上游模型（网络超时或上游挂了）。检查代理/网络是否正常，或等一会儿再试。';
    }
    if (/no credentials|no active credentials|401|unauthorized|access token|invalid.*key|api key|forbidden.*key/.test(lower)) {
        return 'API 密钥没配或失效了。去模型服务里检查 / 重新填一下密钥。';
    }
    if (/images.{0,4}必须是 array|未知角色必须填写外貌|必须是 array|必须填写外貌/.test(text)) {
        return '场景规划输出的格式不对（插件的兼容问题）。刷新页面重试一次，一般能自动修复。';
    }
    return '';
}

function bindOverlayEvents() {
    if (!overlayElement || eventsBound || !getSettingsDocument()) return;
    eventsBound = true;
    mountServerPluginGuide(getSettingsElement('comfy-backend-guide'), 'comfy-backend');
    querySettings('#comfy-draw-close')?.addEventListener('click', hideSettings);
    getSettingsDocument()?.addEventListener('click', async (event) => {
        const button = event.target?.closest?.('[data-comfy-view]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        switchSettingsView(button.dataset.comfyView || 'params');
    });
    const renderInlineErrorLog = async () => {
        const doc = getSettingsDocument();
        const host = getSettingsElement('comfy-error-log-list');
        if (!doc || !host) return;
        updateStatusText('comfy-error-log-status','','正在读取 H28K 日志...');
        try {
            const items = await readImageErrors(300);
            updateStatusText('comfy-error-log-status','success','已读取 ' + items.length + ' 条日志（H28K 与浏览器旧记录）');
            host.textContent = '';
            if (!items.length) {
                const empty = doc.createElement('p');
                empty.className = 'status-text';
                empty.textContent = '暂无错误记录。';
                host.append(empty);
                return;
            }
            for (const entry of items) {
                const card = doc.createElement('section');
                card.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:1px solid #4b3440;border-radius:8px;background:#191d26';
                const head = doc.createElement('div');
                head.style.cssText = 'font-size:12px;color:#55e6b0;margin:0 0 6px;word-break:break-all';
                head.textContent = new Date(entry.time).toLocaleString('zh-CN') + ' · ' + (entry.stage || '') + ' · ' + (entry.errorType || '');
                const plain = explainImageError(entry.message || '');
                if (plain) {
                    const tip = doc.createElement('div');
                    tip.style.cssText = 'font-size:13px;color:#ffd166;margin:0 0 6px;word-break:break-all;background:#2a2118;border:1px solid #5a4a1a;border-radius:6px;padding:6px 8px;';
                    tip.textContent = '💡 ' + plain;
                    card.append(tip);
                }
                const msg = doc.createElement('pre');
                msg.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 Consolas,monospace;margin:0;color:#f4f4f5';
                msg.textContent = entry.message || '';
                card.append(head, msg);
                for (const [title, value] of [['当时正向提示词', entry.positive], ['当时负向提示词', entry.negative]]) {
                    if (!value) continue;
                    const detail = doc.createElement('details');
                    detail.style.cssText = 'margin-top:8px';
                    const summary = doc.createElement('summary');
                    summary.style.cssText = 'cursor:pointer;font-size:12px;color:#9aa4b2';
                    summary.textContent = title;
                    const body = doc.createElement('pre');
                    body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 Consolas,monospace;margin:6px 0 0;background:#252a35;border-radius:6px;padding:8px;color:#f4f4f5';
                    body.textContent = String(value);
                    detail.append(summary, body);
                    card.append(detail);
                }
                host.append(card);
            }
            host.dataset.loaded = '1';
        } catch (error) {
            const message = '日志读取失败：' + (error?.message || '未知原因');
            updateStatusText('comfy-error-log-status','error',message);
        }
    };
    inlineErrorLogRender = renderInlineErrorLog;
    querySettings('#comfy-error-log-refresh')?.addEventListener('click', async () => { void renderInlineErrorLog(); });
    querySettings('#comfy-error-log-clear')?.addEventListener('click', async () => {
        if (!await askConfirmDialog('确定清空绘图错误日志？这不会删除任何图片。')) return;
        try {
            await clearImageErrors();
            updateStatusText('comfy-error-log-status','success','H28K 与浏览器错误日志已清空');
            if (inlineErrorLogRender) void inlineErrorLogRender();
        } catch (error) {
            updateStatusText('comfy-error-log-status','error','清空失败：'+(error?.message || '未知错误'));
            toastr.error('错误日志清空失败');
        }
    });
    querySettings('#comfy-gallery-refresh')?.addEventListener('click', async () => {
        await renderGalleryManagement();
    });
    querySettings('#comfy-gallery-save-cache-days')?.addEventListener('click', async (event) => {
        const nextDays = normalizeSharedCacheDays(getValue('comfy-gallery-cache-days'), getSharedDrawSettings().cacheDays);
        const ok = await runSaveButtonTask(event.currentTarget, () => updateSharedDrawSettingsPersistent((settings) => {
            settings.cacheDays = nextDays;
        }, '自动清理设置已保存', { notify: false, silent: false }), {
            statusElementId: 'comfy-gallery-status',
            pendingText: '正在保存...',
            successText: `自动清理已设为 ${nextDays} 天`,
            errorText: '保存失败，请重试',
        });
        if (ok) {
            setValue('comfy-gallery-cache-days', nextDays);
        }
    });
    querySettings('#comfy-gallery-clear-expired')?.addEventListener('click', async () => {
        updateStatusText('comfy-gallery-status', '', '正在清理...');
        try {
            const cleaned = await clearExpiredCache(getSharedDrawSettings().cacheDays);
            updateStatusText('comfy-gallery-status', 'success', `已清理/瘦身 ${cleaned} 条`);
            await renderGalleryManagement();
        } catch (error) {
            console.warn('[ComfyDraw] clearExpiredCache failed:', error);
            updateStatusText('comfy-gallery-status', 'error', '清理失败，请重试');
        }
    });
    querySettings('#comfy-gallery-clear-all')?.addEventListener('click', async () => {
        if (!await askConfirmDialog('确定清空全部图片记录？已保存到服务器的文件不会被删除。')) return;
        updateStatusText('comfy-gallery-status', '', '正在清空...');
        try {
            await clearAllCache();
            updateStatusText('comfy-gallery-status', 'success', '已清空');
            await renderGalleryManagement();
        } catch (error) {
            console.warn('[ComfyDraw] clearAllCache failed:', error);
            updateStatusText('comfy-gallery-status', 'error', '清空失败，请重试');
        }
    });
    querySettingsAll('[data-comfy-mode]').forEach((button) => {
        button.addEventListener('click', async () => {
            const nextMode = button.dataset.comfyMode === 'auto' ? 'auto' : 'manual';
            const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
                settings.mode = nextMode;
            }, '模式已保存', { silent: false }));
            if (!ok) return;
            fillForm(getSettings());
            try {
                const fp = await import('./floating-panel.js');
                fp.updateAutoModeUI?.();
            } catch {}
        });
    });
    querySettings('#comfy-show-floor')?.addEventListener('change', async (event) => {
        const checked = event.target.checked === true;
        const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
            settings.showFloorButton = checked;
        }, '楼层按钮设置已保存', { silent: false }));
        if (!ok) return;
        const settings = getSettings();
        // 只同步这一个开关，绝不重填整张表单
        const floorToggle = querySettings('#comfy-show-floor');
        if (floorToggle) floorToggle.checked = settings.showFloorButton !== false;
        try {
            const fp = await import('./floating-panel.js');
            fp.updateButtonVisibility?.(settings.showFloorButton !== false, settings.showFloatingButton !== false);
        } catch {}
    });
    querySettings('#comfy-show-floating')?.addEventListener('change', async (event) => {
        const checked = event.target.checked === true;
        const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
            settings.showFloatingButton = checked;
        }, '悬浮按钮设置已保存', { silent: false }));
        if (!ok) return;
        const settings = getSettings();
        // 只同步这一个开关，绝不重填整张表单
        const floatingToggle = querySettings('#comfy-show-floating');
        if (floatingToggle) floatingToggle.checked = settings.showFloatingButton !== false;
        try {
            const fp = await import('./floating-panel.js');
            fp.updateButtonVisibility?.(settings.showFloorButton !== false, settings.showFloatingButton !== false);
        } catch {}
    });
    querySettings('#comfy-draw-save')?.addEventListener('click', async (event) => {
        const ok = await saveAllSettings({ notify: true, triggerButton: event.currentTarget, statusElementId: 'comfy-draw-api-status' });
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-connection-mode')?.addEventListener('change', async () => {
        updateConnectionModeUI(getValue('comfy-connection-mode'));
    });
    querySettings('#comfy-use-image-backend-jobs')?.addEventListener('change', async () => {
        updateConnectionModeUI(getValue('comfy-connection-mode'));
    });
    querySettings('#comfy-draw-test')?.addEventListener('click', async () => {
        const saved = await saveAllSettings({ notify: false });
        if (!saved) { showSettingsNotice('配置没有保存成功，已停止连接测试；请先处理保存报错', 'error'); return; }
        await testConnection();
    });
    querySettings('#comfy-draw-size-preset')?.addEventListener('change', async () => {
        applySizePresetSelection();
    });
    [
        'comfy-draw-model',
        'comfy-draw-sampler',
        'comfy-draw-scheduler',
        'comfy-draw-steps',
        'comfy-draw-cfg',
        'comfy-draw-width',
        'comfy-draw-height',
    ].forEach((id) => {
        const eventName = id === 'comfy-draw-width' || id === 'comfy-draw-height' || id === 'comfy-draw-steps' || id === 'comfy-draw-cfg'
            ? 'input'
            : 'change';
        querySettings(`#${id}`)?.addEventListener(eventName, () => {
            refreshBuiltinWorkflowPanel(getSettings());
        });
    });
    querySettings('#comfy-draw-preset-select')?.addEventListener('change', async () => {
        const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
            settings.selectedPresetId = getValue('comfy-draw-preset-select');
        }, '预设已切换', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-draw-preset-add')?.addEventListener('click', async () => {
        const preset = {
            ...readPresetFromForm(),
            id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: await askInputDialog('输入预设名称：', '新预设') || '新预设',
        };
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.presets = [...draft.presets, preset];
            draft.selectedPresetId = preset.id;
        }, '已创建预设', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-draw-preset-rename')?.addEventListener('click', async () => {
        const settings = getSettings();
        const preset = getActivePreset(settings);
        const name = await askInputDialog('输入新名称：', preset.name || '预设');
        if (!name) return;
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.presets = draft.presets.map((item) => item.id === preset.id ? { ...item, name } : item);
        }, '预设已重命名', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-draw-preset-delete')?.addEventListener('click', async () => {
        const settings = getSettings();
        if (settings.presets.length <= 1) {
            toastr.warning('至少保留一个预设');
            return;
        }
        const preset = getActivePreset(settings);
        if (!await askConfirmDialog(`删除预设「${preset.name}」？`)) return;
        const presets = settings.presets.filter(item => item.id !== preset.id);
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.presets = presets;
            draft.selectedPresetId = presets[0]?.id || 'default';
        }, '预设已删除', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-draw-preset-save')?.addEventListener('click', async (event) => {
        const settings = getSettings();
        const preset = getActivePreset(settings);
        const nextPreset = { ...readPresetFromForm(), id: preset.id, name: preset.name };
        const ok = await runSaveButtonTask(event.currentTarget, () => updateSettingsPersistent((draft) => {
            const form = readForm();
            Object.assign(draft, form);
            draft.presets = draft.presets.map((item) => item.id === preset.id ? nextPreset : item);
            draft.selectedPresetId = preset.id;
        }, '预设已保存', { notify: false, silent: false }), {
            statusElementId: 'comfy-draw-params-status',
            pendingText: '正在保存预设...',
            successText: '预设已保存到独立绘图配置文件',
            errorText: '预设保存失败，请重试',
        });
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-workflow-preset-select')?.addEventListener('change', async () => {
        const selectedWorkflowPresetId = getValue('comfy-workflow-preset-select');
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.selectedWorkflowPresetId = selectedWorkflowPresetId;
            const preset = draft.workflowPresets.find((item) => item.id === selectedWorkflowPresetId) || draft.workflowPresets[0] || createDefaultWorkflowPreset();
            draft.customWorkflow = {
                json: preset.json,
                nodePositive: preset.nodePositive,
                nodeNegative: preset.nodeNegative,
                nodeWidth: preset.nodeWidth,
                nodeHeight: preset.nodeHeight,
                nodeSeed: preset.nodeSeed,
                nodeSaveImage: preset.nodeSaveImage,
            };
        }, '工作流预设已切换', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-workflow-preset-add')?.addEventListener('click', async () => {
        const preset = {
            ...createDefaultWorkflowPreset(),
            id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: await askInputDialog('输入工作流预设名称：', '新工作流') || '新工作流',
        };
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.workflowPresets = [...(draft.workflowPresets || []), preset];
            draft.selectedWorkflowPresetId = preset.id;
            draft.customWorkflow = {
                json: preset.json,
                nodePositive: preset.nodePositive,
                nodeNegative: preset.nodeNegative,
                nodeWidth: preset.nodeWidth,
                nodeHeight: preset.nodeHeight,
                nodeSeed: preset.nodeSeed,
                nodeSaveImage: preset.nodeSaveImage,
            };
        }, '已创建工作流预设', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-workflow-preset-rename')?.addEventListener('click', async () => {
        const settings = getSettings();
        const preset = getActiveWorkflowPreset(settings);
        const name = await askInputDialog('输入新名称：', preset.name || '工作流');
        if (!name) return;
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.workflowPresets = draft.workflowPresets.map((item) => item.id === preset.id ? { ...item, name } : item);
        }, '工作流预设已重命名', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-workflow-preset-delete')?.addEventListener('click', async () => {
        const settings = getSettings();
        if ((settings.workflowPresets || []).length <= 1) {
            toastr.warning('至少保留一个工作流预设');
            return;
        }
        const preset = getActiveWorkflowPreset(settings);
        if (!await askConfirmDialog(`删除工作流预设「${preset.name}」？`)) return;
        const workflowPresets = settings.workflowPresets.filter((item) => item.id !== preset.id);
        const nextPreset = workflowPresets[0] || createDefaultWorkflowPreset();
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.workflowPresets = workflowPresets;
            draft.selectedWorkflowPresetId = nextPreset.id;
            draft.customWorkflow = {
                json: nextPreset.json,
                nodePositive: nextPreset.nodePositive,
                nodeNegative: nextPreset.nodeNegative,
                nodeWidth: nextPreset.nodeWidth,
                nodeHeight: nextPreset.nodeHeight,
                nodeSeed: nextPreset.nodeSeed,
                nodeSaveImage: nextPreset.nodeSaveImage,
            };
        }, '工作流预设已删除', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    // 拉取模型按钮
    querySettings('#comfy-draw-refresh-models')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        if (button) {
            button.disabled = true;
            const doc = getSettingsDocument() || document;
            const icon = doc.createElement('i');
            if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
            button.replaceChildren(icon, doc.createTextNode(' 拉取中...'));
        }
        try {
            const saved = await saveAllSettings({ notify: false });
            if (!saved) {
                updateStatusText('comfy-draw-workflow-status', 'error', '保存当前连接配置失败，请重试');
                return;
            }
            await refreshComfyOptions({ notify: true });
        } finally {
            if (button) {
                button.disabled = false;
                const doc = getSettingsDocument() || document;
                const icon = doc.createElement('i');
                if (icon) icon.className = 'fa-solid fa-rotate';
                button.replaceChildren(icon, doc.createTextNode(' 拉取模型'));
            }
        }
    });
    querySettings('#comfy-builtin-workflow')?.addEventListener('change', async () => {
        const builtinWorkflowId = getValue('comfy-builtin-workflow') || DEFAULT_COMFY_DRAW_SETTINGS.builtinWorkflowId;
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.builtinWorkflowId = builtinWorkflowId;
        }, '内置工作流已保存', { notify: false, silent: false }));
        if (ok) refreshBuiltinWorkflowPanel(getSettings());
    });
    querySettings('#comfy-builtin-workflow-apply')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const workflow = getBuiltinWorkflowDefinition(getValue('comfy-builtin-workflow') || getSettings().builtinWorkflowId);
        const recommended = workflow.recommended || {};
        setSavingState(button);
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.builtinWorkflowId = workflow.id;
            draft.sampler = recommended.sampler || draft.sampler;
            draft.scheduler = recommended.scheduler || draft.scheduler;
            draft.steps = normalizeNumber(recommended.steps, draft.steps, 1, 150);
            draft.cfg = normalizeNumber(recommended.cfg, draft.cfg, 1, 30);
            const preset = draft.presets.find((item) => item.id === draft.selectedPresetId);
            if (preset) {
                preset.width = normalizeNumber(recommended.width, preset.width, 64, 2048);
                preset.height = normalizeNumber(recommended.height, preset.height, 64, 2048);
                preset.sampler = recommended.sampler || preset.sampler;
                preset.scheduler = recommended.scheduler || preset.scheduler;
                preset.steps = normalizeNumber(recommended.steps, preset.steps, 1, 150);
                preset.cfg = normalizeNumber(recommended.cfg, preset.cfg, 1, 30);
            }
        }, '已应用内置工作流推荐参数', { notify: false, silent: false }));
        handleSaveResult(ok, button, 'fa-solid fa-wand-magic-sparkles');
        if (!ok) toastr.error('应用失败，请重试', 'ComfyUI');
        if (ok) fillForm(getSettings());
    });
    // 高级参数面板展开/折叠（简单模式内）
    querySettings('#comfy-toggle-advanced-params')?.addEventListener('click', async () => {
        const section = getSettingsElement('comfy-advanced-params-section');
        const btn = getSettingsElement('comfy-toggle-advanced-params');
        if (!section || !btn) return;
        const isHidden = section.classList.contains('hidden');
        section.classList.toggle('hidden', !isHidden);
        const icon = document.createElement('i');
        icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
        btn.replaceChildren(icon, document.createTextNode(isHidden ? ' 收起' : ' 展开'));
    });
    // 工作流模式切换（顶部二选一）
    querySettings('#comfy-workflow-mode-simple')?.addEventListener('click', async () => {
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.workflowMode = 'simple';
        }, '已切换到简单模式', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-workflow-mode-custom')?.addEventListener('click', async () => {
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.workflowMode = 'custom';
        }, '已切换到自定义模式', { silent: false }));
        if (ok) fillForm(getSettings());
    });
    // 自定义工作流：JSON 文件导入
    querySettings('#comfy-workflow-import')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            parseComfyApiWorkflowJson(text);
            setValue('comfy-workflow-json', text);
            toastr.success('工作流已导入，请配置节点映射后保存', 'ComfyUI');
        } catch (e) {
            toastr.error(e.message || '工作流格式错误：需要 API Format workflow JSON', 'ComfyUI');
        }
        event.target.value = ''; // 重置以允许重复导入同一文件
    });
    // 自定义工作流：清空
    querySettings('#comfy-workflow-clear')?.addEventListener('click', async () => {
        setValue('comfy-workflow-json', '');
        toastr.info('已清空工作流内容', 'ComfyUI');
    });
    const saveComfyWorkflowField = async (label, mutator, statusElementId = 'comfy-draw-workflow-status') => {
        updateStatusText(statusElementId, '', `${label}保存中...`);
        const ok = await withSaveTimeout(updateSettingsPersistent(mutator, `${label}已保存`, { notify: false, silent: false }));
        const successText = `${label}已保存`;
        updateStatusText(statusElementId, '', '');
        showSettingsNotice(ok ? successText : `${label}保存失败，请重试`, ok ? 'success' : 'error');
        if (ok) fillForm(getSettings());
        return ok;
    };

    // 模型/采样器/调度器/steps/cfg 变更后即时保存
    querySettings('#comfy-draw-model')?.addEventListener('change', async () => {
        const model = getValue('comfy-draw-model');
        await saveComfyWorkflowField('模型', (draft) => {
            draft.selectedModel = model;
            const preset = draft.presets.find(p => p.id === draft.selectedPresetId);
            if (preset) preset.model = model;
        }, 'comfy-draw-model-status');
    });
    querySettings('#comfy-draw-sampler')?.addEventListener('change', async () => {
        const sampler = getValue('comfy-draw-sampler');
        await saveComfyWorkflowField('采样器', (draft) => {
            draft.sampler = sampler;
            const preset = draft.presets.find(p => p.id === draft.selectedPresetId);
            if (preset) preset.sampler = sampler;
        });
    });
    querySettings('#comfy-draw-scheduler')?.addEventListener('change', async () => {
        const scheduler = getValue('comfy-draw-scheduler');
        await saveComfyWorkflowField('调度器', (draft) => {
            draft.scheduler = scheduler;
            const preset = draft.presets.find(p => p.id === draft.selectedPresetId);
            if (preset) preset.scheduler = scheduler;
        });
    });
    querySettings('#comfy-draw-steps')?.addEventListener('change', async () => {
        const steps = normalizeNumber(getValue('comfy-draw-steps'), 20, 1, 150);
        await saveComfyWorkflowField('Steps', (draft) => {
            draft.steps = steps;
            const preset = draft.presets.find(p => p.id === draft.selectedPresetId);
            if (preset) preset.steps = steps;
        });
    });
    querySettings('#comfy-draw-cfg')?.addEventListener('change', async () => {
        const cfg = normalizeNumber(getValue('comfy-draw-cfg'), 7, 1, 30);
        await saveComfyWorkflowField('CFG', (draft) => {
            draft.cfg = cfg;
            const preset = draft.presets.find(p => p.id === draft.selectedPresetId);
            if (preset) preset.cfg = cfg;
        });
    });
    querySettings('#comfy-workflow-preset-save')?.addEventListener('click', async (event) => {
        const settings = getSettings();
        const activePreset = getActiveWorkflowPreset(settings);
        const nodeMap = buildWorkflowNodeMapFromForm();
        const ok = await runSaveButtonTask(event.currentTarget, () => updateSettingsPersistent((draft) => {
            const json = getValue('comfy-workflow-json');
            validateWorkflowPresetDraftOrThrow({ json, nodeMap });
            const nextPreset = {
                ...activePreset,
                json,
                nodePositive: nodeMap.positive,
                nodeNegative: nodeMap.negative,
                nodeWidth: nodeMap.width,
                nodeHeight: nodeMap.height,
                nodeSeed: nodeMap.seed,
                nodeSaveImage: nodeMap.saveImage,
            };
            draft.workflowPresets = draft.workflowPresets.map((item) => item.id === activePreset.id ? nextPreset : item);
            draft.selectedWorkflowPresetId = activePreset.id;
            draft.workflowMode = 'custom';
            draft.customWorkflow = {
                json: nextPreset.json,
                nodePositive: nextPreset.nodePositive,
                nodeNegative: nextPreset.nodeNegative,
                nodeWidth: nextPreset.nodeWidth,
                nodeHeight: nextPreset.nodeHeight,
                nodeSeed: nextPreset.nodeSeed,
                nodeSaveImage: nextPreset.nodeSaveImage,
            };
        }, '工作流预设已保存', { notify: false, silent: false }), {
            statusElementId: 'comfy-workflow-preset-status',
            pendingText: '正在保存工作流预设...',
            successText: '工作流预设已保存',
            errorText: '保存失败，请重试',
        });
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-shared-char-add')?.addEventListener('click', async () => {
        addCharacterTagDraft();
    });
    querySettings('#comfy-shared-char-export')?.addEventListener('click', async () => {
        exportSharedCharacterTags();
    });
    querySettings('#comfy-shared-char-import')?.addEventListener('change', async (event) => {
        await importSharedCharacterTags(event.target);
    });
    querySettings('#comfy-prompt-preset-select')?.addEventListener('change', async () => {
        const selectedId = getValue('comfy-prompt-preset-select');
        const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
            settings.selectedPromptPresetId = selectedId;
            const active = settings.promptPresets.find((preset) => preset.id === selectedId) || settings.promptPresets[0];
            if (active) {
                settings.customPrompts = {
                    topSystem: active.topSystem,
                    tagGuideContent: active.tagGuideContent,
                    sceneRules: active.sceneRules,
                    fieldDescriptions: active.fieldDescriptions,
                };
            }
        }, '提示词预设已切换', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompt-preset-add')?.addEventListener('click', async () => {
        const current = readPromptPresetFromForm();
        const preset = {
            ...current,
            id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: await askInputDialog('输入提示词预设名称：', `提示词-${(getSettings().promptPresets || []).length + 1}`) || `提示词-${(getSettings().promptPresets || []).length + 1}`,
        };
        const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
            settings.promptPresets = [...settings.promptPresets, preset];
            settings.selectedPromptPresetId = preset.id;
            settings.customPrompts = {
                topSystem: preset.topSystem,
                tagGuideContent: preset.tagGuideContent,
                sceneRules: preset.sceneRules,
                fieldDescriptions: preset.fieldDescriptions,
            };
        }, '已创建提示词预设', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompt-preset-rename')?.addEventListener('click', async () => {
        const settings = getSettings();
        const preset = getActivePromptPreset(settings);
        const name = await askInputDialog('输入新名称：', preset.name || '提示词预设');
        if (!name) return;
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.promptPresets = draft.promptPresets.map((item) => item.id === preset.id ? { ...item, name } : item);
        }, '提示词预设已重命名', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompt-preset-delete')?.addEventListener('click', async () => {
        const settings = getSettings();
        if ((settings.promptPresets || []).length <= 1) {
            toastr.warning('至少保留一个提示词预设');
            return;
        }
        const preset = getActivePromptPreset(settings);
        if (!await askConfirmDialog(`删除提示词预设「${preset.name}」？`)) return;
        const nextPresets = settings.promptPresets.filter((item) => item.id !== preset.id);
        const ok = await withSaveTimeout(updateSettingsPersistent((draft) => {
            draft.promptPresets = nextPresets;
            draft.selectedPromptPresetId = nextPresets[0]?.id || null;
            const active = nextPresets[0];
            if (active) {
                draft.customPrompts = {
                    topSystem: active.topSystem,
                    tagGuideContent: active.tagGuideContent,
                    sceneRules: active.sceneRules,
                    fieldDescriptions: active.fieldDescriptions,
                };
            }
        }, '提示词预设已删除', { notify: false, silent: false }));
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompt-preset-save')?.addEventListener('click', async (event) => {
        const settings = getSettings();
        const preset = getActivePromptPreset(settings);
        const nextPreset = { ...readPromptPresetFromForm(preset), id: preset.id, name: preset.name };
        const ok = await runSaveButtonTask(event.currentTarget, () => updateSettingsPersistent((draft) => {
            draft.promptPresets = draft.promptPresets.map((item) => item.id === preset.id ? nextPreset : item);
            draft.selectedPromptPresetId = preset.id;
            draft.customPrompts = {
                topSystem: nextPreset.topSystem,
                tagGuideContent: nextPreset.tagGuideContent,
                sceneRules: nextPreset.sceneRules,
                fieldDescriptions: nextPreset.fieldDescriptions,
            };
        }, '提示词预设已保存', { notify: false, silent: false }), {
            statusElementId: 'comfy-prompt-preset-status',
            pendingText: '正在保存提示词预设...',
            successText: '提示词预设已保存',
            errorText: '提示词预设保存失败，请重试',
        });
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompts-save')?.addEventListener('click', async (event) => {
        const settings = getSettings();
        const preset = getActivePromptPreset(settings);
        const nextPreset = { ...readPromptPresetFromForm(preset), id: preset.id, name: preset.name };
        const ok = await runSaveButtonTask(event.currentTarget, () => updateSettingsPersistent((draft) => {
            draft.promptPresets = draft.promptPresets.map((item) => item.id === preset.id ? nextPreset : item);
            draft.selectedPromptPresetId = preset.id;
            draft.customPrompts = {
                topSystem: nextPreset.topSystem,
                tagGuideContent: nextPreset.tagGuideContent,
                sceneRules: nextPreset.sceneRules,
                fieldDescriptions: nextPreset.fieldDescriptions,
            };
        }, '提示词预设已保存', { notify: false, silent: false }), {
            statusElementId: 'comfy-prompts-status',
            pendingText: '正在保存提示词模板...',
            successText: '提示词模板已保存到当前预设',
            errorText: '提示词模板保存失败，请重试',
        });
        if (ok) fillForm(getSettings());
    });
    querySettings('#comfy-prompt-reset-system')?.addEventListener('click', async () => {
        const defaults = getPromptPresetDefaults(getActivePromptPreset(getSettings()).name);
        setValue('comfy-prompt-system', defaults.topSystem);
        renderPromptChainPreview();
    });
    querySettings('#comfy-prompt-reset-guide')?.addEventListener('click', async () => {
        const defaults = getPromptPresetDefaults(getActivePromptPreset(getSettings()).name);
        setValue('comfy-prompt-guide', defaults.tagGuideContent);
        renderPromptChainPreview();
    });
    querySettings('#comfy-prompt-reset-format')?.addEventListener('click', async () => {
        const defaults = getPromptPresetDefaults(getActivePromptPreset(getSettings()).name);
        setValue('comfy-prompt-format', defaults.sceneRules);
        renderPromptChainPreview();
    });
    querySettings('#comfy-prompts-reset-all')?.addEventListener('click', async () => {
        if (!await askConfirmDialog('确认恢复当前提示词模板为默认值？')) return;
        const defaults = getPromptPresetDefaults(getActivePromptPreset(getSettings()).name);
        setValue('comfy-prompt-system', defaults.topSystem);
        setValue('comfy-prompt-guide', defaults.tagGuideContent);
        setValue('comfy-prompt-format', defaults.sceneRules);
        // 字段描述没有独立的表单控件：已存覆写与当前草稿全部打成空串墓碑，保存时一并剔除
        const savedFieldDescriptions = parseFieldDescriptions(getActivePromptPreset(getSettings())?.fieldDescriptions);
        [...Object.keys(savedFieldDescriptions), ...promptFieldDraft.keys()].forEach((path) => promptFieldDraft.set(path, ''));
        renderPromptChainPreview();
    });
    querySettings('#comfy-prompt-preset-export')?.addEventListener('click', async () => {
        const preset = getActivePromptPreset(getSettings());
        const payload = {
            _type: 'comfy-draw-prompt-template',
            _version: 1,
            name: preset.name,
            topSystem: getValue('comfy-prompt-system'),
            tagGuideContent: getValue('comfy-prompt-guide'),
            sceneRules: getValue('comfy-prompt-format'),
            fieldDescriptions: serializeFieldDescriptions(preset),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${preset.name || '提示词预设'}.json`;
        link.click();
        URL.revokeObjectURL(url);
    });
    querySettings('#comfy-prompt-preset-import')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            if (payload?._type !== 'comfy-draw-prompt-template' || payload?._version !== 1) {
                throw new Error('不是有效的 ComfyUI 提示词预设文件');
            }
            if (typeof payload.topSystem !== 'string' || typeof payload.tagGuideContent !== 'string' || typeof payload.sceneRules !== 'string') {
                throw new Error('不是有效的提示词模板文件');
            }
            parseFieldDescriptions(payload.fieldDescriptions);
            const name = (typeof payload.name === 'string' && payload.name.trim())
                ? payload.name.trim()
                : (file.name.replace(/\.json$/i, '').trim() || `导入的预设-${(getSettings().promptPresets || []).length + 1}`);
            const preset = {
                id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name,
                topSystem: payload.topSystem,
                tagGuideContent: payload.tagGuideContent,
                sceneRules: payload.sceneRules,
                // 老导出文件没有这一项，落到空覆写（全部用内置文案）
                fieldDescriptions: payload.fieldDescriptions ?? '',
            };
            const ok = await withSaveTimeout(updateSettingsPersistent((settings) => {
                settings.promptPresets = [...settings.promptPresets, preset];
                settings.selectedPromptPresetId = preset.id;
            }, `已导入为新预设「${name}」`, { notify: true, silent: false }));
            if (ok) fillForm(getSettings());
        } catch (error) {
            toastr.error(error?.message || '导入失败', 'ComfyUI');
        } finally {
            event.target.value = '';
        }
    });
    getSettingsElement('comfy-prompt-chain')?.closest('details')?.addEventListener('toggle', async (event) => {
        if (event.currentTarget.open) schedulePromptChainPreview();
    });
    ['comfy-prompt-system', 'comfy-prompt-guide', 'comfy-prompt-format'].forEach((id) => {
        querySettings(`#${id}`)?.addEventListener('input', async () => {
            schedulePromptChainPreview();
        });
    });
    querySettings('#comfy-filter-add')?.addEventListener('click', async () => {
        renderFilterRuleRow({ start: '', end: '' });
    });
    querySettings('#comfy-filter-reset')?.addEventListener('click', async () => {
        renderFilterRules(DEFAULT_MESSAGE_FILTER_RULES);
    });
    querySettings('#comfy-filter-save')?.addEventListener('click', async (event) => {
        await runSaveButtonTask(event.currentTarget, () => saveSharedDrawSettings({ notify: false }), {
            statusElementId: 'comfy-filter-status',
            pendingText: '正在保存过滤规则...',
            successText: '过滤规则已保存',
            errorText: '过滤规则保存失败，请重试',
        });
    });
    bindWorldbookUploadEvents();
    querySettingsAll('[data-comfy-save-shared]').forEach((button) => {
        button.addEventListener('click', async (event) => {
            const statusElementId = event.currentTarget.dataset.comfyStatus || '';
            await saveAllSettings({ notify: true, triggerButton: event.currentTarget, statusElementId });
        });
    });
    querySettings('#comfy-role-collapse-all')?.addEventListener('click', () => setAllComfyCharacterCardsExpanded(false));
    querySettings('#comfy-role-expand-all')?.addEventListener('click', () => setAllComfyCharacterCardsExpanded(true));
    querySettings('#comfy-shared-character-list')?.addEventListener('input', async (event) => {
        if (!event.target?.matches?.('[data-sd-char-field="name"], [data-sd-char-field="type"]')) return;
        updateComfyCharacterCardTitle(event.target.closest('.sd-char-card'));
    });
    querySettings('#comfy-shared-character-list')?.addEventListener('click', async (event) => {
        const toggle = event.target.closest('[data-comfy-role-toggle]');
        if (toggle) {
            const card = toggle.closest('.sd-char-card');
            setComfyCharacterCardExpanded(card, card?.classList.contains('comfy-role-collapsed'));
            return;
        }
        const header = event.target.closest('.sd-char-card-header');
        if (header && !event.target.closest('button, input, select, a, [data-drag-char], [role="button"]')) {
            const card = header.closest('.sd-char-card');
            setComfyCharacterCardExpanded(card, card?.classList.contains('comfy-role-collapsed'));
            return;
        }
        const deleteButton = event.target.closest('[data-sd-char-delete]');
        if (deleteButton) {
            if (!await askConfirmDialog('确定删除该角色？删除后点击「保存角色」才真正生效。')) return;
            deleteCharacterTagDraft(deleteButton.dataset.sdCharDelete);
            return;
        }

    });
}

function fillForm(settings) {
    const preset = getActivePreset(settings);
    fillPresetSelect(settings);
    fillWorkflowPresetSelect(settings);
    fillPromptPresetSelect(settings);
    const showFloor = getSettingsElement('comfy-show-floor');
    const showFloating = getSettingsElement('comfy-show-floating');
    if (showFloor) showFloor.checked = settings.showFloorButton !== false;
    if (showFloating) showFloating.checked = settings.showFloatingButton !== false;
    getSettingsDocument()?.body?.classList.add('advanced-mode');
    querySettingsAll('[data-comfy-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.comfyMode === (settings.mode === 'auto' ? 'auto' : 'manual'));
    });

    setValue('comfy-connection-mode', settings.connectionMode || 'proxy');
    setValue('comfy-draw-auth', settings.auth || '');
    setChecked('comfy-use-image-backend-jobs', settings.useImageBackendJobs === true);
    updateConnectionModeUI(settings.connectionMode || 'proxy', settings.useImageBackendJobs === true);
    setValue('comfy-draw-host', settings.host);
    setValue('comfy-draw-timeout', settings.timeout);
    setValue('comfy-draw-width', preset.width);
    setValue('comfy-draw-height', preset.height);
    updateSizePresetSelection();
    setValue('comfy-draw-positive-prefix', preset.positivePrefix);
    setValue('comfy-draw-negative-prefix', preset.negativePrefix);
    setValue('comfy-draw-max-images', preset.maxImages || 0);
    setValue('comfy-draw-max-chars', preset.maxCharactersPerImage || 0);
    setValue('comfy-gallery-cache-days', getSharedDrawSettings().cacheDays);

    // 模型配置页面
    populateModelSelect(settings.modelCache || []);
    if (Array.isArray(settings.samplerCache) && settings.samplerCache.length) {
        populateSelect(
            'comfy-draw-sampler',
            settings.samplerCache.map((item) => ({ value: item, label: item })),
            { value: preset.sampler || settings.sampler || 'euler' },
        );
    }
    if (Array.isArray(settings.schedulerCache) && settings.schedulerCache.length) {
        populateSelect(
            'comfy-draw-scheduler',
            settings.schedulerCache.map((item) => ({ value: item, label: item })),
            { value: preset.scheduler || settings.scheduler || 'normal' },
        );
    }
    setSelectValue('comfy-draw-model', preset.model || settings.selectedModel || '');
    setSelectValue('comfy-draw-sampler', preset.sampler || settings.sampler || 'euler');
    setSelectValue('comfy-draw-scheduler', preset.scheduler || settings.scheduler || 'normal');
    setValue('comfy-draw-steps', preset.steps ?? settings.steps ?? 20);
    setValue('comfy-draw-cfg', preset.cfg ?? settings.cfg ?? 7);

    // 工作流模式
    const isSimple = settings.workflowMode !== 'custom';
    const simpleBtn = getSettingsElement('comfy-workflow-mode-simple');
    const customBtn = getSettingsElement('comfy-workflow-mode-custom');
    const simpleSection = getSettingsElement('comfy-simple-mode-section');
    const customSection = getSettingsElement('comfy-custom-mode-section');
    if (simpleBtn) simpleBtn.classList.toggle('active', isSimple);
    if (customBtn) customBtn.classList.toggle('active', !isSimple);
    if (simpleSection) simpleSection.classList.toggle('hidden', !isSimple);
    if (customSection) customSection.classList.toggle('hidden', isSimple);

    // 自定义工作流字段（保留原逻辑）
    setValue('comfy-workflow-json', settings.customWorkflow?.json || '');
    setValue('comfy-node-positive', settings.customWorkflow?.nodePositive || '');
    setValue('comfy-node-negative', settings.customWorkflow?.nodeNegative || '');
    setValue('comfy-node-width', settings.customWorkflow?.nodeWidth || '');
    setValue('comfy-node-height', settings.customWorkflow?.nodeHeight || '');
    setValue('comfy-node-seed', settings.customWorkflow?.nodeSeed || '');
    setValue('comfy-node-save-image', settings.customWorkflow?.nodeSaveImage || '');

    refreshBuiltinWorkflowPanel(settings);
    applyPromptPresetToForm(settings);
    fillSharedDrawForm();
    refreshSettingsSummary();
}

function readForm() {
    const current = getSettings();
    const preset = readPresetFromForm();
    return {
        ...current,
        host: getValue('comfy-draw-host').trim(),
        connectionMode: getValue('comfy-connection-mode') === 'direct' ? 'direct' : 'proxy',
        auth: getValue('comfy-draw-auth').trim(),
        timeout: normalizeNumber(getValue('comfy-draw-timeout'), current.timeout, 10000, 600000),
        useImageBackendJobs: getChecked('comfy-use-image-backend-jobs'),
        builtinWorkflowId: getValue('comfy-builtin-workflow') || current.builtinWorkflowId || DEFAULT_COMFY_DRAW_SETTINGS.builtinWorkflowId,
        presets: current.presets.map(item => item.id === current.selectedPresetId ? { ...preset, id: item.id, name: item.name } : item),
    };
}

function readPresetFromForm() {
    const settings = getSettings();
    const current = getActivePreset(settings);
    const sizePreset = getValue('comfy-draw-size-preset');
    let width = normalizeNumber(getValue('comfy-draw-width'), 1024, 64, 2048);
    let height = normalizeNumber(getValue('comfy-draw-height'), 1024, 64, 2048);
    if (sizePreset && sizePreset !== 'custom') {
        const matched = COMFY_SIZE_PRESETS.find((item) => item.value === sizePreset);
        if (matched) {
            width = matched.width;
            height = matched.height;
        }
    }
    return {
        ...current,
        width,
        height,
        positivePrefix: getValue('comfy-draw-positive-prefix'),
        negativePrefix: getValue('comfy-draw-negative-prefix'),
        // 新增
        model: getValue('comfy-draw-model'),
        sampler: getValue('comfy-draw-sampler'),
        scheduler: getValue('comfy-draw-scheduler'),
        steps: normalizeNumber(getValue('comfy-draw-steps'), 20, 1, 150),
        cfg: normalizeNumber(getValue('comfy-draw-cfg'), 7, 1, 30),
        maxImages: normalizeNumber(getValue('comfy-draw-max-images'), 0, 0, 999),
        maxCharactersPerImage: normalizeNumber(getValue('comfy-draw-max-chars'), 0, 0, 999),
    };
}

function updateSizePresetSelection() {
    const width = getValue('comfy-draw-width');
    const height = getValue('comfy-draw-height');
    const value = `${width}x${height}`;
    const select = getSettingsElement('comfy-draw-size-preset');
    const customRow = getSettingsElement('comfy-draw-custom-size');
    if (!select || !customRow) return;
    const matched = COMFY_SIZE_PRESETS.find((item) => item.value === value);
    select.value = matched ? matched.value : 'custom';
    customRow.classList.toggle('hidden', select.value !== 'custom');
}

function applySizePresetSelection() {
    const value = getValue('comfy-draw-size-preset');
    const customRow = getSettingsElement('comfy-draw-custom-size');
    if (!customRow) return;
    if (value === 'custom') {
        customRow.classList.remove('hidden');
        refreshBuiltinWorkflowPanel(getSettings());
        return;
    }
    const matched = COMFY_SIZE_PRESETS.find((item) => item.value === value);
    if (matched) {
        setValue('comfy-draw-width', matched.width);
        setValue('comfy-draw-height', matched.height);
    }
    customRow.classList.add('hidden');
    refreshBuiltinWorkflowPanel(getSettings());
}

function fillPresetSelect(settings = getSettings()) {
    const select = getSettingsElement('comfy-draw-preset-select');
    if (!select) return;
    select.textContent = '';
    settings.presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || preset.id;
        select.appendChild(option);
    });
    select.value = settings.selectedPresetId;
}

function fillWorkflowPresetSelect(settings = getSettings()) {
    const select = getSettingsElement('comfy-workflow-preset-select');
    if (!select) return;
    select.textContent = '';
    (settings.workflowPresets || []).forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || preset.id;
        select.appendChild(option);
    });
    select.value = settings.selectedWorkflowPresetId || settings.workflowPresets?.[0]?.id || '';
}

function fillPromptPresetSelect(settings = getSettings()) {
    const select = getSettingsElement('comfy-prompt-preset-select');
    if (!select) return;
    select.textContent = '';
    (settings.promptPresets || []).forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || preset.id;
        select.appendChild(option);
    });
    select.value = settings.selectedPromptPresetId || settings.promptPresets?.[0]?.id || '';
}





function applyPromptPresetToForm(settings = getSettings()) {
    const promptPreset = getActivePromptPreset(settings);
    setValue('comfy-prompt-system', promptPreset.topSystem || '');
    setValue('comfy-prompt-guide', promptPreset.tagGuideContent || '');
    setValue('comfy-prompt-format', promptPreset.sceneRules || '');
    if (promptFieldPresetId !== promptPreset.id) {
        promptFieldDraft.clear();
        promptFieldPresetId = promptPreset.id;
    } else {
        // A form refresh only acknowledges the saved values, not edits made while saving.
        const saved = parseFieldDescriptions(promptPreset.fieldDescriptions);
        for (const [path, text] of promptFieldDraft) {
            if ((saved[path] || '') === (text.trim() ? text : '')) promptFieldDraft.delete(path);
        }
    }
    renderPromptChainPreview(settings);
}

function readPromptPresetFromForm(basePreset = getActivePromptPreset(getSettings())) {
    return {
        ...basePreset,
        topSystem: getValue('comfy-prompt-system'),
        tagGuideContent: getValue('comfy-prompt-guide'),
        sceneRules: getValue('comfy-prompt-format'),
        fieldDescriptions: serializeFieldDescriptions(basePreset),
    };
}

/** 已存覆写与当前草稿合并成 JSON 字符串；空串/空白项剔除（= 恢复内置文案）。 */
function serializeFieldDescriptions(basePreset = getActivePromptPreset(getSettings())) {
    const merged = { ...parseFieldDescriptions(basePreset?.fieldDescriptions), ...Object.fromEntries(promptFieldDraft) };
    const out = {};
    for (const [key, text] of Object.entries(merged)) {
        if (typeof text === 'string' && text.trim()) out[key] = text;
    }
    return Object.keys(out).length ? JSON.stringify(out) : '';
}

function updateConnectionModeUI(
    mode = getSettings().connectionMode,
    useImageBackendJobs = getChecked('comfy-use-image-backend-jobs'),
) {
    const isDirect = mode === 'direct';
    const usesServerJobs = useImageBackendJobs === true;
    getSettingsElement('comfy-backend-guide').classList.toggle('hidden', !usesServerJobs);
    const authRow = getSettingsElement('comfy-auth-row');
    const connectionHint = getSettingsElement('comfy-connection-hint');
    const connectionModeNote = getSettingsElement('comfy-connection-mode-note');
    const hostHint = getSettingsElement('comfy-host-hint');
    const status = getSettingsElement('comfy-draw-api-status');
    const workflowStatus = getSettingsElement('comfy-draw-workflow-status');
    const statusText = usesServerJobs
        ? '批量出图将由独立绘图后台任务连接 ComfyUI。'
        : isDirect
            ? '当前使用浏览器直连 ComfyUI。'
            : '当前使用酒馆后端代理连接 ComfyUI。';
    authRow?.classList.toggle('hidden', !isDirect && !usesServerJobs);
    if (connectionHint) {
        connectionHint.textContent = usesServerJobs
            ? '后台批量任务会从酒馆服务器访问 ComfyUI；需要登录时可在这里填写认证信息。'
            : isDirect
                ? '浏览器直连会从当前浏览器访问 ComfyUI；需要登录时可在这里填写认证信息。'
                : '酒馆代理会通过 SillyTavern 转发请求；这里不填写 ComfyUI 认证信息。';
    }
    if (connectionModeNote) {
        connectionModeNote.textContent = usesServerJobs
            ? '后台任务由酒馆服务器直接访问上方地址，地址里的反代基础路径和 query 都会保留，与连接模式无关。'
            : isDirect
                ? '如果直连偶发连接失败，可以先换酒馆代理对照。'
                : '如果代理偶发拿不到图，可以先检查 ComfyUI 输出目录，或换浏览器直连对照。';
    }
    if (hostHint) {
        hostHint.textContent = usesServerJobs || !isDirect
            ? '填写酒馆服务器能访问到的 ComfyUI 地址。'
            : '填写当前浏览器能访问到的 ComfyUI 地址。';
    }
    if (status) {
        status.textContent = statusText;
        status.className = 'status-text';
    }
    if (workflowStatus) {
        workflowStatus.textContent = statusText;
        workflowStatus.className = 'status-text';
    }
}

// 填充模型下拉框
function populateModelSelect(models = []) {
    const select = getSettingsElement('comfy-draw-model');
    if (!select) return;
    const currentValue = select.value;
    const modelList = Array.isArray(models) ? models.filter(Boolean) : [];
    select.textContent = '';
    if (!modelList.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '未找到可直接出图的模型';
        select.appendChild(opt);
    } else {
        modelList.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model;
            opt.textContent = model;
            select.appendChild(opt);
        });
    }
    if (currentValue && modelList.includes(currentValue)) {
        select.value = currentValue;
    }
}

function populateBuiltinWorkflowSelect(selectedId) {
    const select = getSettingsElement('comfy-builtin-workflow');
    if (!select) return;
    select.textContent = '';
    BUILTIN_WORKFLOWS.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        select.appendChild(option);
    });
    select.value = BUILTIN_WORKFLOWS.some((item) => item.id === selectedId)
        ? selectedId
        : BUILTIN_WORKFLOWS[0].id;
}

function refreshBuiltinWorkflowPanel(settings = getSettings()) {
    const workflow = getBuiltinWorkflowDefinition(settings.builtinWorkflowId);
    populateBuiltinWorkflowSelect(workflow.id);
    const summaryEl = getSettingsElement('comfy-builtin-workflow-summary');
    const descEl = getSettingsElement('comfy-builtin-workflow-desc');
    const notesEl = getSettingsElement('comfy-builtin-workflow-notes');
    if (summaryEl) summaryEl.textContent = workflow.summary;
    if (descEl) descEl.textContent = workflow.description;
    if (notesEl) notesEl.textContent = workflow.notes || '';
    setValue('comfy-builtin-workflow-preview', createBuiltinWorkflowPreview(getBuiltinWorkflowPreviewParams(settings)));
}

// 刷新 ComfyUI 模型和采样器列表
async function refreshComfyOptions({ notify = true, timeoutMs = getSettings().timeout || 120000 } = {}) {
    if (notify) updateStatusText('comfy-draw-workflow-status', '', '正在获取模型列表...');
    try {
        const models = await fetchComfyModels({ timeoutMs });

        await updateSettingsPersistent((draft) => {
            draft.modelCache = models || [];
        }, '模型列表已更新', { notify, silent: !notify });

        populateModelSelect(models || []);

        const count = models?.length || 0;
        if (notify) {
            updateComfyOptionStatus(
                count ? 'success' : 'error',
                count
                    ? `已获取 ${count} 个可直接出图的模型；采样器/调度器后台刷新中`
                    : '没有找到“只选一个模型文件就能画”的模型；如果你的模型需要多个文件，请导入自定义工作流',
            );
        }
        void refreshComfySamplerOptions({ notify: false, timeoutMs: Math.max(timeoutMs, 30000) });
        return true;
    } catch (error) {
        console.error('[ComfyDraw] refreshComfyOptions failed:', error);
        await writeImageError({
            stage:'ComfyUI 模型拉取',errorType:'COMFY_MODEL_FETCH_FAILED',
            errorMessage:error?.message || '获取失败',provider:'ComfyUI',
        }).catch(logError=>console.error('[ComfyDraw] failed to log model fetch error',logError));
        if (notify) updateComfyOptionStatus('error', error?.message || '获取失败');
        return false;
    }
}

async function refreshComfySamplerOptions({ notify = true, timeoutMs = Math.max(getSettings().timeout || 120000, 30000) } = {}) {
    try {
        const samplerInfo = await fetchComfySamplers({ timeoutMs });
        await updateSettingsPersistent((draft) => {
            draft.samplerCache = samplerInfo?.samplers || [];
            draft.schedulerCache = samplerInfo?.schedulers || [];
        }, '采样器列表已更新', { notify: false, silent: true });

        populateSelect(
            'comfy-draw-sampler',
            (samplerInfo?.samplers || []).map((item) => ({ value: item, label: item })),
            { value: getValue('comfy-draw-sampler') || getActivePreset(getSettings()).sampler || getSettings().sampler || 'euler' },
        );
        populateSelect(
            'comfy-draw-scheduler',
            (samplerInfo?.schedulers || []).map((item) => ({ value: item, label: item })),
            { value: getValue('comfy-draw-scheduler') || getActivePreset(getSettings()).scheduler || getSettings().scheduler || 'normal' },
        );
        if (notify) updateComfyOptionStatus('success', '采样器/调度器已刷新');
    } catch (error) {
        console.warn('[ComfyDraw] refreshComfySamplerOptions failed:', error);
        if (notify) updateComfyOptionStatus('error', `模型已更新，采样器/调度器刷新失败：${error?.message || '请检查配置'}`);
    }
}

let inlineErrorLogRender = null;

function switchSettingsView(viewName = 'params') {
    const requested = COMFY_DRAW_VIEWS.includes(viewName) ? viewName : 'params';
    const normalized = requested;
    querySettingsAll('[data-comfy-view]').forEach((button) => {
        button.classList.toggle('active', button.dataset.comfyView === normalized);
    });
    querySettingsAll('[data-comfy-view-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.comfyViewPanel === normalized);
    });
    if (normalized === 'gallery') {
        void renderGalleryManagement();
    }
    if (normalized === 'errors' && inlineErrorLogRender) {
        void inlineErrorLogRender();
    }
    if (normalized === 'prompts') {
        schedulePromptChainPreview();
    }
}

function formatBytes(bytes = 0) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function renderGalleryManagement() {
    const container = getSettingsElement('comfy-gallery-container');
    const empty = getSettingsElement('comfy-gallery-empty');
    const countEl = getSettingsElement('comfy-gallery-count');
    const sizeEl = getSettingsElement('comfy-gallery-size');
    const cacheDaysEl = getSettingsElement('comfy-gallery-cache-days');
    if (!container || !empty || !countEl || !sizeEl) return;
    if (cacheDaysEl) {
        cacheDaysEl.value = String(getSharedDrawSettings().cacheDays);
    }

    container.textContent = '加载中...';
    empty.style.display = 'none';

    let summary = {};
    try {
        summary = await getGallerySummary();
    } catch (error) {
        console.warn('[ComfyDraw] getGallerySummary failed:', error);
    }

    const chars = Object.keys(summary);
    const totalCount = chars.reduce((sum, charName) => sum + (summary[charName]?.count || 0), 0);
    const totalSize = chars.reduce((sum, charName) => sum + (summary[charName]?.totalSize || 0), 0);
    countEl.textContent = String(totalCount);
    sizeEl.textContent = formatBytes(totalSize);

    if (!chars.length) {
        container.textContent = '';
        empty.style.display = 'block';
        return;
    }

    chars.sort((a, b) => (summary[b].latestTimestamp || 0) - (summary[a].latestTimestamp || 0));
    container.replaceChildren();

    const managementSlots=chars.flatMap(name=>Object.keys(summary[name]?.slots||{})
        .sort((a,b)=>(summary[name]?.slots?.[b]?.latestTimestamp||0)-(summary[name]?.slots?.[a]?.latestTimestamp||0)));
    const callbacksForSlot=async slot=>{
        const name=chars.find(character=>(summary[character]?.slots||{})[slot]);
        const row=name?summary[name].slots[slot]:null;
        const latest=row?.latestImgId ? await getPreview(row.latestImgId).catch(()=>null) : null;
        const messageId=Number(latest?.messageId||0);
        const sameChat=latest?.chatId && String(latest.chatId)===String(getContext()?.chatId);
        return {
            ...(sameChat ? buildSharedGalleryCallbacks(slot,messageId) : {}),
            managementMessageId:messageId,
            managementSlots,
            createManagementCallbacks:callbacksForSlot,
        };
    };
    for (const charName of chars) {
        const charSummary = summary[charName];
        const slotSummaries = charSummary.slots || {};
        const slotIds = Object.keys(slotSummaries)
            .sort((a, b) => ((slotSummaries[b]?.latestTimestamp || 0) - (slotSummaries[a]?.latestTimestamp || 0)));

        const card = document.createElement('div');
        card.className = 'gallery-char-card';

        const head = document.createElement('div');
        head.className = 'gallery-char-head';
        const title = document.createElement('div');
        title.className = 'gallery-char-name';
        title.textContent = charName;
        const meta = document.createElement('div');
        meta.className = 'gallery-char-meta';
        meta.textContent = `${charSummary.count || 0} 张 · ${slotIds.length} 组 · ${formatBytes(charSummary.totalSize || 0)}`;
        head.append(title, meta);

        const grid = document.createElement('div');
        grid.className = 'gallery-slots';

        slotIds.slice(0, 8).forEach((slotId, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gallery-slot-btn';
            button.addEventListener('click', async () => {
                const latest = await getPreview(slotSummaries[slotId]?.latestImgId).catch(() => null);
                await openGallery(slotId, Number(latest?.messageId || 0), await callbacksForSlot(slotId));
            });

            const img = document.createElement('img');
            img.className = 'gallery-slot-thumb';
            img.alt = '';
            void getPreview(slotSummaries[slotId]?.latestImgId).then((latest) => {
                if (latest) img.src = getPreviewDisplayUrl(latest);
            }).catch(() => {});

            const label = document.createElement('div');
            label.className = 'gallery-slot-title';
            label.textContent = `图组 ${index + 1}`;

            const sub = document.createElement('div');
            sub.className = 'gallery-slot-sub';
            sub.textContent = `${slotSummaries[slotId]?.count || 1} 个版本`;

            button.append(img, label, sub);
            grid.appendChild(button);
        });

        card.append(head, grid);
        container.appendChild(card);
    }
}

// 从表单读出各卡片的字段（不含分组：分组由角色库界面按卡片所在位置补上）。
// keepEmpty 为 true 时保留全空的新卡片；只有保存 / 导出时才丢弃它们。
function readCharacterCardsFromForm({ keepEmpty = false } = {}) {
    const existingById = new Map((getSharedDrawSettings().characterTags || [])
        .map((item) => [String(item.id || ''), item])
        .filter(([id]) => id));

    return querySettingsAll('.sd-char-card').map((card, index) => {
        // 已保存记录里的 groupId 可能已过期（草稿里可能刚换过分组），一律丢弃，以卡片所在位置为准。
        const saved = { ...(existingById.get(String(card.dataset.characterId || '')) || {}) };
        delete saved.groupId;
        return {
            ...saved,
            id: card.dataset.characterId || `comfy-char-${Date.now()}-${index}`,
            enabled: getCharacterEnabledFromCard(card),
            name: String(card.querySelector('[data-sd-char-field="name"]')?.value || '').trim(),
            aliases: String(card.querySelector('[data-sd-char-field="aliases"]')?.value || '')
                .split(',')
                .map(item => item.trim())
                .filter(Boolean),
            type: String(card.querySelector('[data-sd-char-field="type"]')?.value || 'girl').trim() || 'girl',
            appearanceZh: String(card.querySelector('[data-sd-char-field="appearanceZh"]')?.value || '').trim(),
            negativeTags: String(card.querySelector('[data-sd-char-field="negativeTags"]')?.value || '').trim(),
            danbooruTag: String(saved.danbooruTag || '').trim(),
            outfits: reconcileChineseNamedLines(
                card.querySelector('[data-sd-char-field="outfits"]')?.value || '',
                JSON.parse(card.querySelector('[data-sd-char-field="outfits"]')?.dataset.originalTags || '[]')),
            dynamicStates: reconcileChineseNamedLines(
                card.querySelector('[data-sd-char-field="dynamicStates"]')?.value || '',
                JSON.parse(card.querySelector('[data-sd-char-field="dynamicStates"]')?.dataset.originalTags || '[]')),
        };
    }).filter((item) => keepEmpty || item.name || item.appearanceZh || item.appearance || item.danbooruTag || item.negativeTags || item.aliases.length || item.outfits?.length || item.dynamicStates?.length);
}

// 当前草稿里的角色（含未保存的编辑与所属分组，已丢弃全空的新卡片），保存与导出用。
function getSharedCharacterTagsFromForm() {
    return characterLibraryUi ? characterLibraryUi.getCharacters() : readCharacterCardsFromForm();
}

function getSharedCharacterGroupsFromForm() {
    return characterLibraryUi ? characterLibraryUi.getGroups() : (getSharedDrawSettings().characterGroups || []);
}

function ensureCharacterLibraryUi() {
    const doc = getSettingsDocument();
    const list = querySettings('#comfy-shared-character-list');
    if (!doc || !list) return null;
    if (characterLibraryUi?.document === doc) return characterLibraryUi;
    characterLibraryUi?.destroy();
    characterLibraryUi = createCharacterLibraryUi({
        document: doc,
        listElement: list,
        readCharacters: readCharacterCardsFromForm,
        renderCard: renderCharacterCard,
        renderEmpty: createCharacterEmptyState,
        onChange: () => refreshSettingsSummary(),
        notify: {
            success: (message) => showSettingsNotice(message, 'success'),
            warning: (message) => showSettingsNotice(message, 'warning'),
            error: (message) => showSettingsNotice(message, 'error'),
        },
    });
    return characterLibraryUi;
}

function destroyCharacterLibraryUi() {
    characterLibraryUi?.destroy();
    characterLibraryUi = null;
}

// 用 tags / groups 重绘整个角色列表（丢弃当前草稿）；groups 缺省时沿用当前草稿的分组。
function renderCharacterTagList(tags = [], groups) {
    const ui = ensureCharacterLibraryUi();
    if (!ui) return;
    ui.render({ characters: tags, groups: groups ?? ui.getGroups() });
}

function createCharacterEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'char-empty sd-char-empty';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-user-plus';
    const title = document.createElement('strong');
    title.textContent = '暂无角色配置';
    const desc = document.createElement('p');
    desc.textContent = '点击左侧"添加角色"，开始建立你的共享角色标签库';
    empty.append(icon, title, desc);
    return empty;
}


// 角色卡片上所有用户可编辑字段的签名，用于检测保存排队期间的并发修改。
function characterDraftSignature(person) {
    const fields = ['name', 'enabled', 'aliases', 'type', 'appearanceZh',
        'negativeTags', 'outfits', 'dynamicStates', 'photoUrl', 'groupId'];
    if (!person) return '';
    return JSON.stringify(fields.map(key => person[key] === undefined ? null : person[key]));
}

async function saveSingleComfyCharacterCard(characterId) {
    const id = String(characterId || '');
    const before = getSharedCharacterTagsFromForm().find(person => String(person.id) === id);
    if (!before) throw new Error('这张角色卡已不存在，请刷新列表');
    if (!before.name?.trim()) throw new Error('请填写角色名再保存');
    const assertCurrentDraft = () => {
        const current = getSharedCharacterTagsFromForm().find(person => String(person.id) === id);
        if (!current || characterDraftSignature(current) !== characterDraftSignature(before)) {
            throw new Error('保存期间当前角色被修改，请重新保存');
        }
    };
    const result = { ...structuredClone(before),
        ...(String(before.appearanceZh || '').trim() ? { appearanceSource: 'chinese' } : {}) };
    assertCurrentDraft();
    const ok = await updateSharedDrawSettingsPersistent(draft => {
        assertCurrentDraft();
        const chars = Array.isArray(draft.characterTags) ? [...draft.characterTags] : [];
        const idx = chars.findIndex(person => String(person.id) === id);
        // A hidden Danbooru compatibility field must survive without being shown in the UI.
        const keep = idx >= 0 ? chars[idx] : {};
        const next = { ...keep, ...result, danbooruTag: keep.danbooruTag || result.danbooruTag || '' };
        if (idx >= 0) chars[idx] = next;
        else chars.push(next);
        draft.characterTags = chars;
    }, '当前角色已保存', { notify: false, silent: false });
    if (!ok) return false;
    // The user may keep typing while persistence is in flight. The saved
    // snapshot is committed, but must not overwrite a newer unsaved draft.
    const liveDraft = getSharedCharacterTagsFromForm().find(person => String(person.id) === id);
    if (!liveDraft || characterDraftSignature(liveDraft) !== characterDraftSignature(before)) return true;
    const card = querySettings('.sd-char-card[data-character-id="' + CSS.escape(id) + '"]');
    if (card) {
        const chinese = card.querySelector('[data-sd-char-field="appearanceZh"]');
        if (chinese) chinese.value = result.appearanceZh || '';
        for (const key of ['outfits','dynamicStates']) {
            const node = card.querySelector('[data-sd-char-field="' + key + '"]');
            if (!node) continue;
            node.dataset.originalTags = JSON.stringify(result[key] || []);
        }
    }
    return true;
}

function openCharacterTestPreview(characterId) {
    const id = String(characterId || '');
    const doc = document;
    doc.getElementById('comfy-role-test-modal')?.remove();
    const overlay = doc.createElement('div');
    overlay.id = 'comfy-role-test-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;height:100%;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;';
    const box = doc.createElement('div');
    box.style.cssText = 'width:min(620px,100%);max-height:calc(var(--vvh, 100vh) - 40px);overflow:auto;background:#181b24;color:#f5f5f6;border:1px solid #444b5a;border-radius:12px;padding:17px;box-shadow:0 10px 45px #0009';
    box.style.maxHeight = 'calc(var(--vvh, 100vh) - 40px)';
    const title = doc.createElement('h3');
    title.textContent = '角色测试出图';
    title.style.cssText = 'margin:0 0 12px;font-size:17px';
    const intro = doc.createElement('p');
    intro.textContent = '仅测试当前角色，不读取聊天剧情和多人规划。先保存该角色的中文与英文提示词，再生成单人测试图。测试图片会保存至图片管理。';
    intro.style.cssText = 'font-size:13px;line-height:1.7;margin:5px 0 12px';
    const label = doc.createElement('label');
    label.textContent = '测试画面';
    label.style.cssText='font-size:13px;margin-right:8px';
    const select = doc.createElement('select');
    select.style.cssText='background:#252c3c;color:white;padding:7px 10px;border:1px solid #586074;border-radius:6px';
    for (const [value,text] of [['full','全身站姿（默认）'],['half','半身肖像']]) {
        const opt=doc.createElement('option');opt.value=value;opt.textContent=text;select.append(opt);
    }
    const status = doc.createElement('p');
    status.setAttribute('role','status');
    status.style.cssText='min-height:21px;font-size:13px;white-space:pre-wrap;line-height:1.6';
    status.textContent='点击「开始测试」将先保存此角色，不会修改其他角色。';
    const image = doc.createElement('img');
    image.style.cssText='max-width:100%;max-height:55vh;object-fit:contain;border-radius:8px;display:none;margin:10px auto';
    const actionRow = doc.createElement('div');
    actionRow.style.cssText='display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px';
    let lastTestImageUrl = '';
    const createButton = (text,handler) => {
        const btn=doc.createElement('button');
        btn.type='button';btn.textContent=text;
        btn.style.cssText='background:#2f394c;color:#fff;border:1px solid #647088;padding:8px 14px;border-radius:7px;cursor:pointer;font-size:13px';
        btn.addEventListener('click',handler);return btn;
    };
    const close = createButton('关闭',()=>overlay.remove());
    const chooseAsPhoto = createButton('设为角色照片',async()=>{
        const card = querySettings('.sd-char-card[data-character-id="' + CSS.escape(id) + '"]');
        const photoButton = card?.querySelector('.comfy-role-photo-button');
        if (!lastTestImageUrl || !photoButton) return;
        chooseAsPhoto.disabled=true;
        try {
            const reply = await fetch(lastTestImageUrl);
            if (!reply.ok) throw new Error('无法读取测试图片');
            const blob = await reply.blob();
            const mime = ['image/png','image/jpeg','image/webp'].includes(blob.type)
                ? blob.type : 'image/png';
            const file = new File([blob],'role-test-photo.png',{type:mime});
            await uploadComfyRolePhoto(card,photoButton,file);
            status.textContent='已将测试图设为这名角色的照片；其他角色没有变化。';
        } catch(error) {
            status.textContent='照片保存失败：'+String(error?.message||error);
        } finally {chooseAsPhoto.disabled=false;}
    });
    chooseAsPhoto.hidden=true;
    const run = createButton('开始测试', async () => {
        if (run.disabled) return;
        run.disabled=true;close.disabled=true;
        image.style.display='none';
        chooseAsPhoto.hidden=true;
        lastTestImageUrl='';
        try {
            status.textContent='正在保存当前角色并同步英文绘图词...';
            if (!await saveSingleComfyCharacterCard(id)) throw new Error('角色保存失败；未开始测试');
            const role=getSharedDrawSettings().characterTags.find(x=>String(x.id)===id);
            if (!role) throw new Error('找不到已保存的角色');
            const compiled=buildCharacterTestPrompt(role, {framing:select.value});
            status.textContent='正在使用当前 ComfyUI 工作流生成测试图...';
            const output=await generateImagesFromText({
                text: compiled.positive, promptOverride:compiled.positive,
                negativePromptOverride:compiled.negative,
                taskCharacters: [{ name: role.name }],
                title: compiled.name, source:'character-test',
            });
            const ready=output.images?.find(entry=>entry.success && entry.displayUrl);
            if (!ready) throw new Error('ComfyUI 没有返回成功的图片；请检查图片管理和后台日志');
            image.src=ready.displayUrl;
            image.style.display='block';
            lastTestImageUrl=ready.displayUrl;
            chooseAsPhoto.hidden=false;
            status.textContent='生成完成：' + compiled.name + '。已使用当前工作流，并将图片保存到图片管理。';
        } catch (error) {
            console.warn('[ComfyDraw] 单角色测试失败:',error);
            status.textContent='测试失败：'+String(error?.message || error).slice(0,250);
        } finally {
            run.disabled=false;close.disabled=false;
            run.textContent='重新测试';
        }
    });
    actionRow.append(close,chooseAsPhoto,run);
    box.append(title,intro,label,select,status,image,actionRow);
    overlay.append(box);
    overlay.addEventListener('click',e=>{if(e.target===overlay && !run.disabled)overlay.remove()});
    doc.body.append(overlay);
    trackVisibleViewportAuto(overlay);
}


// Manually selected role photos are saved on H28K through SillyTavern's own image upload route.
const COMFY_ROLE_PHOTO_FOLDER = 'SillyTavernImage-role-photos';
const COMFY_ROLE_PHOTO_PATH = /^user\/images\/(?:SillyTavernImage|LittleWhiteBox)-role-photos\/[A-Za-z0-9_-]+\.jpg$/;

function normalizeComfyRolePhotoPath(value) {
    const path = String(value || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
    return COMFY_ROLE_PHOTO_PATH.test(path) ? path : '';
}

async function compressComfyRolePhoto(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('请选择 JPG、PNG 或 WebP 照片');
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
        throw new Error('单张照片不能超过 12 MB');
    }
    const objectUrl = URL.createObjectURL(file);
    try {
        const source = new Image();
        await new Promise((resolve, reject) => {
            source.onload = resolve;
            source.onerror = () => reject(new Error('照片无法读取，请换一张'));
            source.src = objectUrl;
        });
        if (!source.naturalWidth || !source.naturalHeight) throw new Error('照片尺寸无效');
        const ratio = Math.min(1, 768 / Math.max(source.naturalWidth, source.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器无法处理照片');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/jpeg', 0.87);
        if (!encoded.startsWith('data:image/jpeg;base64,')) throw new Error('照片压缩失败');
        return encoded.slice('data:image/jpeg;base64,'.length);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function uploadComfyRolePhoto(card, photoButton, file) {
    const id = String(card?.dataset.characterId || '');
    const saved = (getSharedDrawSettings().characterTags || []).find(person => String(person.id) === id);
    if (!saved) throw new Error('请先保存这名角色，再上传照片');
    const photoUrl = await uploadComfyRolePhotoAsset(id, file);
    const ok = await updateSharedDrawSettingsPersistent(draft => {
        const item = (draft.characterTags || []).find(person => String(person.id) === id);
        if (!item) throw new Error('该角色已被删除');
        item.photoUrl = photoUrl;
    }, '角色照片已保存', { notify: false, silent: false });
    if (!ok) throw new Error('上传成功，但图片关联保存失败，请重试');
    const photo = document.createElement('img');
    photo.className = 'comfy-role-photo-image';
    photo.alt = '角色照片';
    photo.loading = 'lazy';
    photo.src = '/' + photoUrl;
    photoButton.replaceChildren(photo);
    photoButton.title = '点击更换角色照片（保存在 H28K）';
    showSettingsNotice('角色照片已保存在 H28K，重新打开仍会显示', 'success');
}


// Save the image via SillyTavern's supported upload route; the role record
// contains only its URL and is never inflated with binary/base64 image data.
async function uploadComfyRolePhotoAsset(id, file) {
    const encoded = await compressComfyRolePhoto(file);
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 44) || 'role';
    const filename = 'role-' + safeId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: encoded, format: 'jpg', filename,
            ch_name: COMFY_ROLE_PHOTO_FOLDER,
        }),
    });
    if (!response.ok) throw new Error('上传 H28K 失败（HTTP ' + response.status + '）');
    const payload = await response.json();
    const photoUrl = normalizeComfyRolePhotoPath(payload.path);
    if (!photoUrl) throw new Error('服务器返回了无效图片路径；未修改任何角色资料');
    return photoUrl;
}

// Existing photo opens a preview instead of forcing another upload.
// No files are deleted when removing a photo association.
function openComfyRolePhotoViewer(card, photoButton) {
    const path = normalizeComfyRolePhotoPath((getSharedDrawSettings().characterTags || [])
        .find(person => String(person.id) === String(card.dataset.characterId))?.photoUrl);
    if (!path) { chooseComfyRolePhoto(card, photoButton); return; }
    const doc = document;
    doc.getElementById('comfy-role-photo-viewer')?.remove();
    const overlay = doc.createElement('div');
    overlay.id = 'comfy-role-photo-viewer';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;height:100%;z-index:2147483003;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;';
    const box = doc.createElement('div');
    box.style.cssText = 'background:#181b24;color:#f4f4f5;border-radius:10px;padding:12px;max-width:min(840px,100%);max-height:calc(var(--vvh, 100vh) - 40px);display:flex;flex-direction:column;gap:9px';
    box.style.maxHeight = 'calc(var(--vvh, 100vh) - 40px)';
    const image = doc.createElement('img');
    image.src = '/' + path;image.alt = '角色照片';
    image.style.cssText = 'display:block;max-width:100%;max-height:77vh;object-fit:contain;border-radius:7px;margin:auto';
    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap';
    const button = (label, click) => {
        const element = doc.createElement('button');
        element.type = 'button'; element.textContent = label;
        element.style.cssText = 'background:#333b4b;color:#f4f4f5;border:1px solid #677084;border-radius:6px;padding:7px 13px;cursor:pointer';
        element.addEventListener('click', click);return element;
    };
    const close = () => overlay.remove();
    const change = button('更换照片', () => { close();chooseComfyRolePhoto(card,photoButton); });
    const unlink = button('清除照片',async()=>{
        if (!await askConfirmDialog('清除这名角色的照片关联？角色的外貌、设定和其他角色不会改变。')) return;
        unlink.disabled = true;
        try {
            const id = String(card.dataset.characterId);
            const ok = await updateSharedDrawSettingsPersistent(draft=>{
                const person=(draft.characterTags||[]).find(item=>String(item.id)===id);
                if(!person)throw new Error('角色已不存在');
                delete person.photoUrl;
            },'该角色照片关联已清除',{notify:false,silent:false});
            if(!ok)throw new Error('保存失败');
            const icon = doc.createElement('i');
            icon.className = 'fa-solid fa-camera';
            photoButton.replaceChildren(icon);
            photoButton.title = '添加角色照片';
            close();showSettingsNotice('已清除照片关联', 'success');
        } catch(error) {
            showSettingsNotice('清除失败：'+String(error?.message||error), 'error');
        } finally { unlink.disabled=false; }
    });
    const done = button('关闭',close);
    actions.append(change,unlink,done);
    box.append(image,actions);overlay.append(box);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
    doc.body.append(overlay);
    trackVisibleViewportAuto(overlay);
}

function chooseComfyRolePhoto(card, photoButton) {
    if (photoButton.disabled) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp';
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        if (!file) return;
        photoButton.disabled = true;
        try {
            await uploadComfyRolePhoto(card, photoButton, file);
        } catch (error) {
            console.error('[SillyTavernImage] 照片上传失败:', error);
            showSettingsNotice(error?.message || '角色照片上传失败', 'error');
        } finally {
            photoButton.disabled = false;
        }
    }, { once: true });
    picker.click();
}

function renderCharacterCard({ character: tag, ordinal }) {
    const index = ordinal - 1;
    const card = document.createElement('div');
    card.className = 'sd-char-card';
    card.dataset.characterId = String(tag.id || `comfy-char-${index + 1}`);

    const top = document.createElement('div');
    top.className = 'sd-char-card-header';
    const title = document.createElement('div');
    title.className = 'sd-char-card-title';
    const photoButton = document.createElement('button');
    photoButton.type = 'button';
    photoButton.className = 'comfy-role-photo-button';
    photoButton.title = '点击添加或更换角色照片（保存在 H28K）';
    photoButton.setAttribute('aria-label', '上传或更换角色照片');
    const photoUrl = typeof tag.photoUrl === 'string'
        && COMFY_ROLE_PHOTO_PATH.test(tag.photoUrl)
        ? tag.photoUrl : '';
    if (photoUrl) {
        const photo = document.createElement('img');
        photo.className = 'comfy-role-photo-image';
        photo.alt = '角色照片';
        photo.loading = 'lazy';
        photo.src = '/' + photoUrl;
        photoButton.append(photo);
    } else {
        const placeholder = document.createElement('i');
        placeholder.className = 'fa-solid fa-camera';
        photoButton.append(placeholder);
    }
    photoButton.addEventListener('click', event => {
        event.stopPropagation();
        openComfyRolePhotoViewer(card, photoButton);
    });
    const titleText = document.createElement('span');
    titleText.textContent = `角色 ${index + 1}`;
    const primary = document.createElement('span');
    primary.dataset.comfyRolePrimary = '';
    primary.className = 'comfy-role-primary';
    primary.textContent = String(tag.name || '').trim() || '未命名角色';
    const secondary = document.createElement('span');
    secondary.dataset.comfyRoleMeta = '';
    secondary.className = 'comfy-role-meta';
    const typeNames = { girl: '女孩', boy: '男孩', woman: '成年女性', man: '成年男性', other: '其他' };
    secondary.textContent = typeNames[tag.type] || tag.type || '未分类';
    title.append(photoButton, titleText, primary, secondary);
    const delButton = document.createElement('button');
    delButton.className = 'btn btn-danger btn-sm';
    delButton.type = 'button';
    delButton.dataset.sdCharDelete = card.dataset.characterId;
    const delIcon = document.createElement('i');
    delIcon.className = 'fa-solid fa-trash';
    const delText = document.createElement('span');
    delText.textContent = '删除';
    delButton.append(delIcon, delText);
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-sm';
    saveButton.dataset.sdCharSave = card.dataset.characterId;
    const saveIcon = document.createElement('i');
    saveIcon.className = 'fa-solid fa-floppy-disk';
    const saveLabel = document.createElement('span');
    saveLabel.textContent = '保存';
    saveButton.append(saveIcon, saveLabel);
    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.className = 'btn btn-sm';
    testButton.dataset.sdCharTest = card.dataset.characterId;
    const testIcon = document.createElement('i');
    testIcon.className = 'fa-solid fa-image';
    const testLabel = document.createElement('span');
    testLabel.textContent = '测试';
    testButton.append(testIcon, testLabel);
    saveButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        void runSaveButtonTask(saveButton,
            () => saveSingleComfyCharacterCard(card.dataset.characterId), {
                pendingText: '正在保存当前角色...',
                successText: '当前角色已保存。',
                errorText: '当前角色保存失败',
                showErrorDetails: true,
                notify: true,
            });
    });
    testButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        openCharacterTestPreview(card.dataset.characterId);
    });

    const actions = document.createElement('div');
    actions.className = 'btn-group';
    const enabledControl = createCharacterEnabledControl(document, card, {
        enabled: tag.enabled !== false,
        label: `角色 ${index + 1}${tag.name ? ` ${tag.name}` : ''}`,
    });
    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'btn btn-sm comfy-role-toggle';
    expandButton.dataset.comfyRoleToggle = '';
    const expandIcon = document.createElement('i');
    const expandText = document.createElement('span');
    expandButton.append(expandIcon, expandText);
    actions.append(expandButton, enabledControl, saveButton, testButton, delButton);
    top.append(title, actions);

    const grid = document.createElement('div');
    grid.className = 'form-row';
    grid.append(
        createCharacterField('角色名', 'name', tag.name || '', '例如 芙蕾雅'),
        createCharacterField('类型', 'type', tag.type || 'girl', '', { choices: typeNames }),
    );

    const body = document.createElement('div');
    body.className = 'comfy-role-card-body';
    body.append(
        grid,
        createCharacterField('别名（逗号分隔）', 'aliases', (tag.aliases || []).join(', '), '例如 小芙, 芙蕾雅'),
        createCharacterField('固定外貌（中文）', 'appearanceZh', tag.appearanceZh || '', '填写脸型、五官、发型、身材；生成图片提示词时由剧情模型转成英文', { multiline: true }),
        createCharacterField('负向标签', 'negativeTags', tag.negativeTags || '', '填写不希望这名角色出现的特征，可用中文', { multiline: true }),
        createChineseNamedTagField('服装参考（中文，每行一套）', 'outfits', tag.outfits || [], '例如：白色衬衫搭配黑色半身裙'),
        createChineseNamedTagField('动态外貌（中文，每行一条）', 'dynamicStates', tag.dynamicStates || [], '例如：害羞，脸颊微红'),
    );
    card.append(top, body);
    // Named roles default to compact; a blank new card expands for direct editing.
    setComfyCharacterCardExpanded(card, expandedComfyCharacterIds.has(card.dataset.characterId) || !String(tag.name || '').trim());
    return card;
}

function createChineseNamedTagField(label, fieldName, original, placeholder) {
    const values = Array.isArray(original) ? original : [];
    const field = createCharacterField(label, fieldName, namedTagsChineseText(values), placeholder, { multiline: true });
    const input = field.querySelector('[data-sd-char-field="' + fieldName + '"]');
    if (input) input.dataset.originalTags = JSON.stringify(values);
    return field;
}

function createCharacterField(labelText, fieldName, value, placeholder, options = {}) {
    const field = document.createElement('div');
    field.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = labelText;
    field.appendChild(label);
    const input = document.createElement(options.choices ? 'select' : options.multiline ? 'textarea' : 'input');
    input.className = 'input';
    input.dataset.sdCharField = fieldName;
    input.placeholder = placeholder;
    if (options.readonly) input.readOnly = true;
    if (options.choices) {
        const choices = { ...options.choices };
        if (value && !Object.prototype.hasOwnProperty.call(choices, value)) choices[value] = '其他（已有分类）';
        for (const [key, text] of Object.entries(choices)) {
            const option = document.createElement('option');
            option.value = key; option.textContent = text; input.appendChild(option);
        }
        input.value = value || 'other';
    } else if (options.multiline) {
        input.rows = 3;
        input.textContent = String(value || '');
    } else {
        input.type = 'text';
        input.value = String(value || '');
    }
    field.appendChild(input);
    return field;
}

function renderFilterRuleRow(rule = { start: '', end: '' }) {
    const list = getSettingsElement('comfy-filter-rules-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'filter-rule-row';
    const start = document.createElement('input');
    start.type = 'text';
    start.placeholder = '起始标记';
    start.value = String(rule.start || '');
    start.dataset.comfyFilterField = 'start';
    const arrow = document.createElement('span');
    arrow.className = 'rule-arrow';
    arrow.textContent = '→';
    const end = document.createElement('input');
    end.type = 'text';
    end.placeholder = '结束标记';
    end.value = String(rule.end || '');
    end.dataset.comfyFilterField = 'end';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-del-rule';
    del.textContent = '×';
    del.addEventListener('click', () => row.remove());
    row.append(start, arrow, end, del);
    list.appendChild(row);
}

function renderFilterRules(rules = []) {
    const list = getSettingsElement('comfy-filter-rules-list');
    if (!list) return;
    list.textContent = '';
    const normalized = Array.isArray(rules) && rules.length ? rules : DEFAULT_MESSAGE_FILTER_RULES;
    normalized.forEach((rule) => renderFilterRuleRow(rule));
}

function collectFilterRules() {
    return querySettingsAll('#comfy-filter-rules-list .filter-rule-row')
        .map((row) => ({
            start: String(row.querySelector('[data-comfy-filter-field="start"]')?.value || '').trim(),
            end: String(row.querySelector('[data-comfy-filter-field="end"]')?.value || '').trim(),
        }))
        .filter((rule) => rule.start || rule.end);
}

function parseWorldbookJson(jsonText, fileName) {
    const data = JSON.parse(jsonText);
    if (!data.entries || typeof data.entries !== 'object') {
        throw new Error('不是有效的世界书文件（缺少 entries 字段）');
    }
    const entries = [];
    for (const [uid, entry] of Object.entries(data.entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const content = String(entry.content || '').trim();
        if (!content) continue;
        entries.push({
            uid: Number(uid),
            comment: String(entry.comment || ''),
            key: Array.isArray(entry.key) ? entry.key : (entry.key ? [entry.key] : []),
            keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
            constant: entry.constant === true,
            disable: entry.disable === true,
            content,
            order: entry.order ?? 100,
        });
    }
    if (!entries.length) {
        throw new Error('世界书中无有效条目（所有条目缺少 content）');
    }
    return { name: fileName, uploadedAt: Date.now(), entries };
}

async function handleWorldbookFiles(files) {
    const sharedDrawSettings = getSharedDrawSettings();
    const worldbooks = sharedDrawSettings.worldbooks || {};
    const uploaded = Array.isArray(worldbooks.uploadedBooks) ? [...worldbooks.uploadedBooks] : [];
    const errors = [];
    let added = 0;

    for (const file of Array.from(files || [])) {
        if (!file.name.toLowerCase().endsWith('.json')) {
            errors.push(`${file.name}: 不是 .json 文件`);
            continue;
        }
        try {
            const book = parseWorldbookJson(await file.text(), file.name);
            const existingIndex = uploaded.findIndex((item) => item.name === book.name);
            if (existingIndex >= 0) uploaded[existingIndex] = book;
            else uploaded.push(book);
            added++;
        } catch (error) {
            errors.push(`${file.name}: ${error?.message || '解析失败'}`);
        }
    }

    sharedDrawSettings.worldbooks = { ...worldbooks, uploadedBooks: uploaded };
    renderUploadedBooks(uploaded);
    if (added > 0) {
        updateStatusText('comfy-worldbook-status', 'success', `已读取 ${added} 个世界书，请点击保存配置`);
    }
    if (errors.length) {
        const container = getSettingsElement('comfy-wb-entries');
        if (container) {
            const message = container.ownerDocument.createElement('p');
            message.className = 'form-hint';
            message.style.color = 'var(--danger)';
            message.textContent = errors.join('\r\n');
            container.replaceChildren(message);
        }
    }
}

function renderUploadedBooks(books = []) {
    const container = getSettingsElement('comfy-wb-uploaded-list');
    if (!container) return;
    const normalized = Array.isArray(books) ? books : [];
    if (!normalized.length) {
        const empty = container.ownerDocument.createElement('p');
        empty.className = 'form-hint';
        empty.textContent = '尚未上传世界书';
        container.replaceChildren(empty);
        const entries = getSettingsElement('comfy-wb-entries');
        if (entries) {
            const hint = entries.ownerDocument.createElement('p');
            hint.className = 'form-hint';
            hint.textContent = '请先上传世界书';
            entries.replaceChildren(hint);
        }
        return;
    }
    const doc = container.ownerDocument;
    const items = normalized.map((book, index) => {
        const entries = Array.isArray(book.entries) ? book.entries : [];
        const activeCount = entries.filter((entry) => !entry.disable).length;
        const item = doc.createElement('div');
        item.className = 'wb-book-item';
        item.dataset.index = String(index);
        const name = doc.createElement('span');
        name.className = 'wb-book-name';
        name.textContent = book.name || `世界书 ${index + 1}`;
        const count = doc.createElement('span');
        count.className = 'wb-book-count';
        count.textContent = `${activeCount}/${entries.length} 条目`;
        const del = doc.createElement('button');
        del.className = 'wb-book-delete';
        del.dataset.index = String(index);
        del.type = 'button';
        del.title = '移除';
        const icon = doc.createElement('i');
        icon.className = 'fa-solid fa-xmark';
        del.append(icon);
        item.append(name, count, del);
        return item;
    });
    container.replaceChildren(...items);

    container.querySelectorAll('.wb-book-item').forEach((item) => {
        item.addEventListener('click', async (event) => {
            if (event.target.closest('.wb-book-delete')) return;
            const book = normalized[Number(item.dataset.index)];
            if (book) renderWorldbookEntries(book);
        });
    });
    container.querySelectorAll('.wb-book-delete').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const sharedDrawSettings = getSharedDrawSettings();
            const worldbooks = sharedDrawSettings.worldbooks || {};
            const nextBooks = Array.isArray(worldbooks.uploadedBooks) ? [...worldbooks.uploadedBooks] : [];
            nextBooks.splice(Number(button.dataset.index), 1);
            sharedDrawSettings.worldbooks = { ...worldbooks, uploadedBooks: nextBooks };
            renderUploadedBooks(nextBooks);
            updateStatusText('comfy-worldbook-status', '', '已移除，请点击保存配置');
        });
    });
}

function renderWorldbookEntries(book) {
    const container = getSettingsElement('comfy-wb-entries');
    if (!container) return;
    const entries = Array.isArray(book.entries) ? book.entries : [];
    if (!entries.length) {
        const empty = container.ownerDocument.createElement('p');
        empty.className = 'form-hint';
        empty.textContent = `${book.name || '世界书'}: 无条目`;
        container.replaceChildren(empty);
        return;
    }
    const doc = container.ownerDocument;
    const title = doc.createElement('p');
    title.className = 'form-hint';
    title.style.marginBottom = '8px';
    title.textContent = `${book.name || '世界书'} (${entries.length} 条)`;
    const entryItems = entries.map((entry) => {
            const state = entry.disable ? 'disabled' : (entry.constant ? 'constant' : 'normal');
            const label = entry.disable ? '已禁用' : (entry.constant ? '常驻' : '关键词触发');
            const keys = (entry.key || []).filter(Boolean).join(', ');
            const item = doc.createElement('div');
            item.className = 'wb-entry-item';
            const lamp = doc.createElement('div');
            lamp.className = `wb-lamp ${state}`;
            lamp.title = label;
            const info = doc.createElement('div');
            info.className = 'wb-entry-info';
            const entryTitle = doc.createElement('div');
            entryTitle.className = 'wb-entry-title';
            entryTitle.textContent = entry.comment || '(未命名)';
            info.append(entryTitle);
            if (keys) {
                const keyLine = doc.createElement('div');
                keyLine.className = 'wb-entry-keys';
                keyLine.textContent = `关键词: ${keys}`;
                info.append(keyLine);
            }
            const preview = doc.createElement('div');
            preview.className = 'wb-entry-preview';
            preview.textContent = String(entry.content || '').slice(0, 200);
            info.append(preview);
            item.append(lamp, info);
            return item;
        });
    container.replaceChildren(title, ...entryItems);
}

function bindWorldbookUploadEvents() {
    const dropzone = getSettingsElement('comfy-wb-dropzone');
    const fileInput = getSettingsElement('comfy-wb-file-input');
    if (!dropzone || !fileInput) return;
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', async (event) => {
        event.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragover');
        if (event.dataTransfer?.files?.length) void handleWorldbookFiles(event.dataTransfer.files);
    });
    fileInput.addEventListener('change', async () => {
        if (fileInput.files?.length) void handleWorldbookFiles(fileInput.files);
        fileInput.value = '';
    });
}

function fillSharedDrawForm() {
    const sharedDrawSettings = getSharedDrawSettings();
    setChecked('comfy-shared-use-worldinfo', sharedDrawSettings.useWorldInfo === true);
    setChecked('comfy-wb-enabled', sharedDrawSettings.worldbooks?.enabled === true);
    setSelectValue('comfy-wb-filter-mode', sharedDrawSettings.worldbooks?.keywordFilterMode || 'auto');
    renderUploadedBooks(sharedDrawSettings.worldbooks?.uploadedBooks || []);
    renderFilterRules(sharedDrawSettings.messageFilterRules || []);
    renderCharacterTagList(sharedDrawSettings.characterTags || [], sharedDrawSettings.characterGroups || []);
}

async function saveSharedDrawSettings({ notify = false } = {}) {
    const draft = getSharedCharacterTagsFromForm();
    const draftSignature = JSON.stringify(draft);
    const assertCurrentDraft = () => {
        if (JSON.stringify(getSharedCharacterTagsFromForm()) !== draftSignature) {
            throw new Error('保存期间角色列表已修改，请重新保存');
        }
    };
    const characterTags = structuredClone(draft).map(person => ({ ...person,
        ...(String(person.appearanceZh || '').trim() ? { appearanceSource: 'chinese' } : {}) }));
    assertCurrentDraft();
    const characterGroups = getSharedCharacterGroupsFromForm();
    const saved = await updateSharedDrawSettingsPersistent((settings) => {
        // The storage writer may queue behind another settings update.
        assertCurrentDraft();
        settings.useWorldInfo = getChecked('comfy-shared-use-worldinfo');
        settings.messageFilterRules = collectFilterRules();
        settings.characterTags = characterTags;
        settings.characterGroups = characterGroups;
        settings.worldbooks = {
            ...(settings.worldbooks || {}),
            enabled: getChecked('comfy-wb-enabled'),
            uploadedBooks: getSharedDrawSettings().worldbooks?.uploadedBooks || [],
            keywordFilterMode: getValue('comfy-wb-filter-mode') || 'auto',
        };
    }, '角色与绘图设置已保存', { notify, silent: false });
    if (saved) {
        const savedById = new Map(characterTags.map(person => [String(person.id), person]));
        querySettingsAll('.sd-char-card').forEach(card => {
            const id = String(card.dataset.characterId || '');
            const person = savedById.get(id);
            if (!person) return;
            // A successful save acknowledges its captured draft, not edits made
            // while the server was writing. Do not overwrite newer form state.
            const current = getSharedCharacterTagsFromForm().find(value => String(value.id) === id);
            if (!current || characterDraftSignature(current) !== characterDraftSignature(person)) return;
            const chinese = card.querySelector('[data-sd-char-field="appearanceZh"]');
            if (chinese) chinese.value = person.appearanceZh || '';
            for (const category of ['outfits', 'dynamicStates']) {
                const box = card.querySelector('[data-sd-char-field="' + category + '"]');
                if (!box) continue;
                box.dataset.originalTags = JSON.stringify(person[category] || []);
            }
        });
    }
    return saved;
}

async function saveAllSettings({ notify = false, triggerButton = null, statusElementId = '' } = {}) {
    let lastSaveFailure = '';
    const saveTask = async () => {
        // 串行提交：先存角色，成功后才写 ComfyUI 配置。
        // 保留保存次序，避免角色保存失败后继续覆盖绘图配置。
        const sharedOk = await saveSharedDrawSettings({ notify: false });
        if (!sharedOk) {
            lastSaveFailure = '角色设置保存失败，绘图配置未改动';
            return false;
        }
        lastSaveFailure = '角色设置已保存，但 ComfyUI 配置写入失败，请重试';
        const comfyOk = await persistSettings(readForm(), 'ComfyUI 设置已保存', { notify: false, silent: false });
        if (!comfyOk) {
            lastSaveFailure = '角色设置已保存，但 ComfyUI 配置写入失败，请重试';
            return false;
        }
        lastSaveFailure = '';
        return true;
    };

    const runPostSaveHooks = async () => {
        try {
            const fp = await import('./floating-panel.js');
            const settings = getSettings();
            fp.updateButtonVisibility?.(settings.showFloorButton !== false, settings.showFloatingButton !== false);
            fp.updateAutoModeUI?.();
        } catch {}
    };

    if (triggerButton) {
        const ok = await runSaveButtonTask(triggerButton, saveTask, {
            statusElementId,
            pendingText: '正在保存...',
            successText: '已保存到独立绘图服务端配置',
            errorText: () => lastSaveFailure || '保存失败，请重试',
            notify,
        });
        if (ok) await runPostSaveHooks();
        return ok;
    }

    let ok = false;
    try {
        ok = await saveTask();
    } catch (error) {
        console.warn('[ComfyDraw] 保存操作失败:', error);
        ok = false;
    }

    if (ok) await runPostSaveHooks();
    if (statusElementId) {
        updateStatusText(
            statusElementId,
            '',
            '',
        );
    }

    if (ok && notify) {
        showSettingsNotice('绘图参数与角色资料已保存', 'success');
    } else if (!ok && notify) {
        showSettingsNotice(lastSaveFailure || '绘图参数或角色资料保存失败', 'error');
    }
    refreshSettingsSummary();
    return ok;
}






function addCharacterTagDraft() {
    ensureCharacterLibraryUi()?.addCharacter();
}


function exportSharedCharacterTags() {
    ensureCharacterLibraryUi()?.openExportDialog();
}

async function importSharedCharacterTags(input) {
    const file = input?.files?.[0];
    try {
        if (file) await ensureCharacterLibraryUi()?.importFile(file);
    } finally {
        if (input) input.value = '';
    }
}

function deleteCharacterTagDraft(characterId = '') {
    ensureCharacterLibraryUi()?.deleteCharacters([String(characterId || '')]);
}

function refreshSettingsSummary() {
    const characterCount = characterLibraryUi?.isRendered()
        ? characterLibraryUi.getCardCount()
        : (getSharedDrawSettings().characterTags?.length || 0);
    const charResultEl = querySettings('#comfy-draw-character-result-count');
    if (charResultEl) charResultEl.textContent = `共 ${characterCount} 名角色`;
}



function setValue(id, value) {
    const el = getSettingsElement(id);
    if (el) el.value = value ?? '';
}

function getValue(id) {
    return getSettingsElement(id)?.value ?? '';
}

function setChecked(id, checked) {
    const el = getSettingsElement(id);
    if (el) el.checked = checked === true;
}

function getChecked(id) {
    return getSettingsElement(id)?.checked === true;
}

function setSelectValue(id, value) {
    const el = getSettingsElement(id);
    if (!el) return;
    const normalized = String(value ?? '');
    if (normalized && !Array.from(el.options).some(opt => opt.value === normalized)) {
        const option = document.createElement('option');
        option.value = normalized;
        option.textContent = normalized;
        el.appendChild(option);
    }
    el.value = normalized;
}

function populateSelect(id, options, { value, emptyLabel = '' } = {}) {
    const select = getSettingsElement(id);
    if (!select) return;
    const current = value ?? select.value;
    select.textContent = '';
    if (emptyLabel) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = emptyLabel;
        select.appendChild(empty);
    }
    for (const item of options) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
    }
    setSelectValue(id, current);
}

export async function openSettings() {
    try {
        await loadSettings();
        await loadSharedDrawSettings();
    } catch {
        return false;
    }
    const overlay = await createOverlay();
    fillForm(getSettings());
    switchSettingsView('params');
    syncOverlayHeight();
    overlay.style.display = 'block';
    return true;
}

export function hideSettings() {
    if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
    viewportSyncFrame = 0;
    settingsViewportState = null;
    promptFieldDraft.clear();
    promptFieldPresetId = null;
    abortPendingRequest();
    destroyCharacterLibraryUi();
    if (promptChainPreviewFrame) cancelAnimationFrame(promptChainPreviewFrame);
    promptChainPreviewFrame = 0;

    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        window.visualViewport?.removeEventListener('resize', resizeHandler);
        window.visualViewport?.removeEventListener('scroll', resizeHandler);
        resizeHandler = null;
    }

    overlayElement?.remove();
    overlayElement = null;
    overlayFrame = null;
    frameReadyPromise = null;
    eventsBound = false;
}

function abortPendingRequest() {
    try { pendingController?.abort(); } catch {}
    pendingController = null;
}

async function testConnection() {
    const settings = getSettings();
    if (!settings.host) {
        toastr.warning('请先填写 ComfyUI 地址');
        return false;
    }

    abortPendingRequest();
    pendingController = new AbortController();

    try {
        await requestComfyTransport('ping', {}, {
            signal: pendingController.signal,
            timeoutMs: settings.timeout || 120000,
        });
        toastr.success('ComfyUI 连接成功');
        updateStatusText('comfy-draw-api-status', 'success', '连接成功');
        return true;
    } catch (error) {
        const message = error?.name === 'AbortError' || error?.message === '生成超时'
            ? '连接超时，请检查地址是否可访问'
            : (error?.message || '无法连接 ComfyUI');
        await writeImageError({
            stage:'ComfyUI 连接测试',errorType:'COMFY_CONNECTION_FAILED',
            errorMessage:message,provider:'ComfyUI',
        }).catch(logError=>console.error('[ComfyDraw] failed to log connection error',logError));
        toastr.error(message, 'ComfyUI 连接失败');
        updateStatusText('comfy-draw-api-status','error',message);
        return false;
    } finally {
        pendingController = null;
    }
}

function composePrompt(prefix, promptText) {
    return joinTags(prefix || '', promptText || '');
}


function updateStatusText(elementId, state, text) {
    const el = getSettingsElement(elementId);
    if (!el) return;
    el.textContent = text || '';
    el.className = `status-text${state ? ` ${state}` : ''}`;
}

function updateComfyOptionStatus(state, text) {
    updateStatusText('comfy-draw-api-status', state, text);
    updateStatusText('comfy-draw-workflow-status', state, text);
}





// submit_scene_plan 字段描述的未保存草稿（路径 → 文案）；保存时与预设里已存的覆写合并。
const promptFieldDraft = new Map();
let promptFieldPresetId = null;

function renderPromptChainPreview(settings = getSettings()) {
    const container = getSettingsElement('comfy-prompt-chain');
    if (!container || !container.closest('details')?.open) return;
    const preset = getActivePromptPreset(settings) || DEFAULT_PROMPT_CONFIG;
    const preview = container.ownerDocument.createElement('pre');
    preview.style.whiteSpace = 'pre-wrap';
    preview.textContent = buildDirectDrawInstruction({
        preset: getActivePreset(settings),
        prompts: { ...preset, topSystem: getValue('comfy-prompt-system'),
            tagGuideContent: getValue('comfy-prompt-guide'), sceneRules: getValue('comfy-prompt-format') },
    });
    container.replaceChildren(preview);
    renderDirectDrawFields(container, {
        descriptions: { ...parseFieldDescriptions(preset.fieldDescriptions || ''), ...Object.fromEntries(promptFieldDraft) },
        onEdit: (path, text) => promptFieldDraft.set(path, text),
        onReset: path => { promptFieldDraft.set(path, ''); renderPromptChainPreview(); },
    });
}

function schedulePromptChainPreview() {
    const container = getSettingsElement('comfy-prompt-chain');
    if (!container?.closest('details')?.open || promptChainPreviewFrame) return;
    promptChainPreviewFrame = requestAnimationFrame(() => {
        promptChainPreviewFrame = 0;
        renderPromptChainPreview();
    });
}

async function withSaveTimeout(promise) {
    try {
        return await promise;
    } catch (error) {
        console.warn('[ComfyDraw] 保存操作失败:', error);
        return false;
    }
}

async function runSaveButtonTask(button, task, {
    statusElementId = '',
    pendingText = '正在保存...',
    successText = '已保存',
    errorText = '保存失败，请重试',
    showErrorDetails = false,
    notify = true,
} = {}) {
    if (button && saveBtnStates.has(button)) return false;
    if (statusElementId) updateStatusText(statusElementId, '', pendingText);
    setSavingState(button);
    let ok = false;
    let failureDetail = '';
    try {
        ok = await Promise.resolve().then(task);
    } catch (error) {
        console.warn('[ComfyDraw] 保存操作失败:', error);
        if (showErrorDetails) failureDetail = describeCharacterSaveError(error);
        ok = false;
    }
    const failureText = typeof errorText === 'function' ? errorText() : errorText;
    const shownError = showErrorDetails
        ? failureText + '：' + (failureDetail || '存储服务未确认保存成功')
        : failureText;
    handleSaveResult(ok, button);
    if (statusElementId) updateStatusText(statusElementId, '', '');
    if (notify) {
        showSettingsNotice(ok ? successText : shownError, ok ? 'success' : 'error');
    }
    refreshSettingsSummary();
    return ok;
}

function setSavingState(button) {
    if (!button) return;
    saveBtnStates.set(button, true);
    const icon = button.querySelector('i');
    if (icon) {
        button._origIcon = icon.className;
        icon.className = 'fa-solid fa-spinner fa-spin';
    }
    button.classList.add('saving');
    button.disabled = true;
}

function handleSaveResult(success, button, fallbackIcon = 'fa-solid fa-floppy-disk') {
    if (!button) return;
    saveBtnStates.delete(button);
    button.classList.remove('saving');
    button.disabled = false;
    const icon = button.querySelector('i');
    if (!icon) return;

    if (success) {
        icon.className = 'fa-solid fa-check';
        button.classList.add('save-success');
        setTimeout(() => {
            button.classList.remove('save-success');
            icon.className = button._origIcon || fallbackIcon;
        }, 1400);
        return;
    }

    icon.className = 'fa-solid fa-xmark';
    button.classList.add('save-failed');
    setTimeout(() => {
        button.classList.remove('save-failed');
        icon.className = button._origIcon || fallbackIcon;
    }, 1800);
}

function generateSlotId() {
    return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateImgId() {
    return `comfy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createGenerationJob(messageId, options) {
    return acquireFloorImageJob(generationJobs, getContext(), messageId, () => ({
        phase: 'starting',
        controller: new AbortController(),
        backendCancel: new AbortController(),
        messageId,
        abortReason: null,
    }), options);
}

function releaseGenerationJob(job) {
    releaseFloorImageJob(generationJobs, job);
}

export function abortGeneration(messageId = null, { reason = 'user', target = captureDrawCancellationTarget(messageId) } = {}) {
    const jobs = messageId !== null && messageId !== undefined
        ? getFloorImageJobs(generationJobs, getContext(), messageId, target)
        : [...generationJobs.values()];
    if (reason === 'user') {
        const cancellation = cancelFloorDrawWork(messageId, { target, jobs });
        if (messageId === null || messageId === undefined) abortPendingRequest();
        return cancellation;
    }
    for (const job of jobs) {
        job.abortReason ||= reason;
        job.controller.abort();
    }
    return jobs.length > 0;
}

export function isGenerating(messageId = null) {
    if (messageId !== null && messageId !== undefined) {
        const job = getFloorImageJob(generationJobs, getContext(), messageId);
        return Boolean(job);
    }
    return generationJobs.size > 0;
}

export function getGenerationPhase(messageId) {
    const job = getFloorImageJob(generationJobs, getContext(), messageId);
    return getFloorImagePhase(job);
}

export function getGenerationState(messageId) {
    return getFloorImageState(generationJobs, getContext(), messageId);
}

async function autoGenerateForLastAI() {
    if (window.xiaobaixComfyDraw?.isEnabled?.() || window.xiaobaixNovelDraw?.isEnabled?.() || window.xiaobaixSdDraw?.isEnabled?.()) return;
    const settings = getSettings();
    if (!moduleInitialized || settings.mode !== 'auto') return;

    const ctx = getContext();
    const chat = ctx.chat || [];
    const lastIdx = chat.length - 1;
    if (lastIdx < 0) return;

    const lastMessage = chat[lastIdx];
    if (!lastMessage || lastMessage.is_user || lastMessage.is_system) return;

    // Previously accepted image slots are the durable source of truth.
    // A pending/accepted run must never submit the same LLM image blocks again.
    if (isGenerating(lastIdx)) return;

    const pending = autoPendingTargets;
    const target = { chatId: String(ctx.chatId), message: lastMessage, text: lastMessage.mes,
        swipeIndex: lastMessage.swipe_id ?? 0, lifecycle: moduleLifecycleGeneration,
        injectedWorldbook: injectedDrawingFacts?.chatId === String(ctx.chatId)
            && injectedDrawingFacts.messageId === lastIdx ? String(injectedDrawingFacts.worldbook || '') : null };
    if (pending.some(item => item.chatId === target.chatId && item.message === target.message
        && item.text === target.text && item.swipeIndex === target.swipeIndex)) return;
    // Retain every completed reply, including intermediate messages arriving
    // while a previous image batch is waiting. This is only an in-memory wait
    // list; the existing floor jobs and owned slots still own actual generation.
    pending.push(target);
    if (autoBusy) return;
    autoBusy = true;
    const lifecycle = moduleLifecycleGeneration;
    try {
        while (pending.length && moduleInitialized && lifecycle === moduleLifecycleGeneration) {
            try { await generateAutomaticTarget(pending[0]); }
            finally { pending.shift(); }
        }
    } finally {
        if (lifecycle === moduleLifecycleGeneration) autoBusy = false;
    }
}

// A chat opened after GENERATION_ENDED can contain complete directives that
// were never recognized. Resume only in explicit auto mode, without asking
// the LLM to regenerate the reply or submitting already owned slots.
function resumeMissedAutomaticDraw(generation = moduleLifecycleGeneration) {
    setTimeout(() => {
        if (!moduleInitialized || generation !== moduleLifecycleGeneration || getSettings().mode !== 'auto') return;
        const ctx = getContext();
        if (ctx.streamingProcessor?.isStopped === false) return;
        const last = ctx.chat?.at(-1);
        if (!last || last.is_user || last.is_system || getDirectDrawReplyState(last).state !== 'ready') return;
        void autoGenerateForLastAI().catch(error => console.error('[ComfyDraw] resume missed draw', error));
    }, 400);
}

async function generateAutomaticTarget(target) {
    const settings = getSettings();
    if (!moduleInitialized || target.lifecycle !== moduleLifecycleGeneration || settings.mode !== 'auto') return;
    if (window.xiaobaixComfyDraw?.isEnabled?.() || window.xiaobaixNovelDraw?.isEnabled?.() || window.xiaobaixSdDraw?.isEnabled?.()) return;
    const lastMessage = target.message;
    let lastIdx = -1;
    const replyIsCurrent = () => {
        const current = getContext();
        lastIdx = current.chat?.indexOf(lastMessage) ?? -1;
        return moduleInitialized && target.lifecycle === moduleLifecycleGeneration
            && String(current.chatId) === target.chatId && lastIdx >= 0
            && !lastMessage.is_user && !lastMessage.is_system
            && lastMessage.mes === target.text && (lastMessage.swipe_id ?? 0) === target.swipeIndex;
    };
    if (!replyIsCurrent() || isGenerating(lastIdx)) return;

    try {
        const ownedSlotIds = await getOwnedImageSlotIds(lastMessage);
        if (!replyIsCurrent()) return;
        const reply = getDirectDrawReplyState(lastMessage,{ownedSlotIds});
        console.info('[STI绘图阶段]',JSON.stringify({stage:'reply-parsed',messageId:lastIdx,
            state:reply.state,directiveCount:reply.directives.length}));
        if(reply.state==='placed')return;
        if(reply.state==='missing'){
            const signature=String(lastMessage.swipe_id??0)+':'+String(lastMessage.mes||'');
            if(autoDrawDiagnostics.get(lastMessage)!==signature){
                autoDrawDiagnostics.set(lastMessage,signature);
                const errorMessage='本轮模型回复未包含可识别的绘图指令（支持 <image>...</image> 和 [image]...[/image]），因此没有提交 ComfyUI。请核对模型实际回复正文或工具的剧情字段；不会复制提示词凑图。';
                await writeImageError({stage:'剧情回复绘图指令检查',errorType:'DRAW_DIRECTIVES_MISSING',
                    errorMessage,provider:'ComfyUI'});
                globalThis.toastr?.warning?.(errorMessage,'自动绘图未启动');
            }
            return;
        }
        const fp = await import('./floating-panel.js');
        if (!replyIsCurrent() || isGenerating(lastIdx)) return;
        const floatingOn = settings.showFloatingButton !== false;
        const floorOn = settings.showFloorButton !== false;
        const useFloatingOnly = floatingOn && floorOn;


        if (floorOn && !useFloatingOnly) {
            const messageEl = document.querySelector(`.mes[mesid="${lastIdx}"]`);
            if (messageEl) {
                fp.ensureComfyDrawPanel?.(messageEl, lastIdx, { force: true });
            }
        }

        console.info('[ComfyDraw] 画面生成：剧情直出');
        await generateAndInsertImages({
            messageId: lastIdx,
            automatic:true,
            injectedWorldbook: target.injectedWorldbook,
            onStateChange: (state, data, liveId) => {
                fp.setStateForMessage(liveId, state, data);
            },
        });

    } catch (error) {
        if (!moduleInitialized || target.lifecycle !== moduleLifecycleGeneration) return;
        if (!error.xbDiagnosticLogged) {
            await writeImageError({
                stage:'自动生图任务',errorType:error?.code || 'AUTO_DRAW_FAILED',
                errorMessage:error?.message || '自动绘图失败',provider:'ComfyUI',
            }).catch(logError=>console.error('[ComfyDraw] failed to log automatic draw error',logError));
        }
        if (!error.drawTaskReported) {
            console.error(error);
            globalThis.toastr?.error(error.message);
        }
    }
}




async function getActiveDrawingWorldbook(chat,shared){
    let worldbook = getDirectDrawWorldbook(chat, shared);
    if (shared.useWorldInfo) {
        const { getWorldInfoPrompt } = await import('/scripts/world-info.js');
        const scan = chat.filter(message => !message?.is_system && !['system', 'developer'].includes(message?.role))
            .map(message => stripDirectDrawSource(message?.mes || ''));
        const native = await getWorldInfoPrompt(scan, 8192, true, { trigger: 'normal' });
        const nativeText = [native.worldInfoBefore,
            ...(native.worldInfoDepth || []).flatMap(item => item.entries || []), native.worldInfoAfter]
            .filter(Boolean).join('\r\n');
        worldbook = [nativeText, worldbook].filter(Boolean).join('\r\n\r\n');
    }
    return worldbook;
}

async function getDirectDrawInstruction(chat = getContext().chat || []) {
    await loadSharedDrawSettings();
    const settings = getSettings();
    const shared = getSharedDrawSettings();
    const prompts = getActivePromptPreset(settings) || DEFAULT_PROMPT_CONFIG;
    // Generation interceptor receives a stripped request clone. Outfit history must
    // come from the active SillyTavern chat where saved directives actually live.
    const activeWardrobeChat = typeof getContext === 'function' && Array.isArray(getContext()?.chat)
        ? getContext().chat : chat;
    const worldbook=await getActiveDrawingWorldbook(chat,shared);
    if(typeof getContext==='function'){
        const ctx=getContext(),active=ctx.chat||[];
        injectedDrawingFacts={chatId:String(ctx.chatId),messageId:active.length-(active.at(-1)?.is_user?0:1),worldbook};
    }
    return expandScenePromptText(buildDirectDrawInstruction({
        preset: getActivePreset(settings), prompts,
        characters: selectEnabledCharacters(characterLibraryFromSettings(shared)),
        worldbook,
        recentAppearances:Object.fromEntries([...buildRecentAppearanceLedger(activeWardrobeChat,{
            readDirectives:readDirectDrawDirectives,
        })].slice(0,24)),
        wardrobeContext: formatWardrobeLedger(buildWardrobeLedger(activeWardrobeChat,{
            knownCharacters:selectEnabledCharacters(characterLibraryFromSettings(shared)),
            readDirectives:readDirectDrawDirectives,
        })),
        filterRules: shared.messageFilterRules?.length ? shared.messageFilterRules : DEFAULT_MESSAGE_FILTER_RULES,
    }), await loadScenePromptRuntime());
}



async function buildTasksFromMessage({ message, signal, promptOverride = '', taskCharacters = [], onStateChange, useInjectedFacts=false, injectedWorldbook }) {
    signal?.throwIfAborted();
    if (promptOverride.trim()) return {
        tasks: [{ scene: promptOverride.trim(), chars: Array.isArray(taskCharacters) ? structuredClone(taskCharacters) : [], placement: { mode: 'tail' } }],
        sceneSource: null,
    };
    const settings = getSettings(), shared = getSharedDrawSettings();
    const knownCharacters=selectEnabledCharacters(characterLibraryFromSettings(shared));
    const ctx=getContext();
    const worldbook=useInjectedFacts&&typeof injectedWorldbook==='string'?injectedWorldbook
        :useInjectedFacts&&injectedWorldbook===undefined&&injectedDrawingFacts?.chatId===String(ctx.chatId)
        &&injectedDrawingFacts.messageId===ctx.chat.indexOf(message)?injectedDrawingFacts.worldbook
        :await getActiveDrawingWorldbook(ctx.chat||[],shared);
    // Every warning shown to the user must also reach the persistent diagnostics.
    // Collect synchronously; flush before returning (or rethrowing) so a partial
    // valid batch never silently loses the rejected image's actual reason.
    const validationNotices = [];
    let tasks;
    try {
        tasks = buildDirectDrawTasks(readDirectDrawDirectives(message), getActivePreset(settings), {
        sourceText: message.mes,
        // SillyTavern already ran its regex/Markdown/extension display pipeline.
        // Only that rendered message may authorize a narrative insertion point.
        hostVisibleText: readHostVisibleNarrative(globalThis.document?.querySelector?.(
            `.mes[mesid="${ctx.chat?.indexOf(message)}"] .mes_text`)),
        knownCharacters,
        requireFemaleImage:true,
        skipInvalidImages:true,
        appearanceSources:{worldbook},
        onCountMismatch:({expected,received})=>{
            const warning = '当前设置 '+expected+' 张，模型本轮提供 '+received+' 条绘图指令；按设置上限和实际有效指令生成，不会复制或补调模型。';
            validationNotices.push({stage:'绘图数量校验',errorType:'DRAW_IMAGE_COUNT_MISMATCH',errorMessage:warning});
            globalThis.toastr?.warning?.(warning,'绘图数量不符');
        },
        onImageRejected:({image,message}) => {
            const detail = '第 '+image+' 张绘图被跳过：'+message;
            validationNotices.push({stage:'第 '+image+' 张绘图指令校验',errorType:'DRAW_IMAGE_REJECTED',errorMessage:detail});
            console.warn('[ComfyDraw] '+detail);
            globalThis.toastr?.warning?.(detail,'绘图过滤');
        },
        wardrobeLedger:buildWardrobeLedger(getContext().chat||[],{
            readDirectives:readDirectDrawDirectives,knownCharacters,excludeMessage:message,
        }),
        recentAppearances:buildRecentAppearanceLedger(getContext().chat||[],{
            readDirectives:readDirectDrawDirectives,excludeMessage:message,
        }),
        filterRules: shared.messageFilterRules?.length ? shared.messageFilterRules : DEFAULT_MESSAGE_FILTER_RULES,
        // Missing story anchors reject only their picture; no scattering.
    });
    } finally {
        if (validationNotices.length) {
            const results = await Promise.allSettled(validationNotices.map(notice => writeImageError({
                ...notice,
                provider: 'ComfyUI',
                source: 'draw-validation',
                chatId: String(ctx.chatId || ''),
                messageId: String(ctx.chat?.indexOf(message) ?? ''),
            })));
            for (const result of results) {
                if (result.status === 'rejected') {
                    console.error('[ComfyDraw] failed to persist drawing validation warning', result.reason);
                }
            }
        }
    }
    signal?.throwIfAborted();
    return { tasks, sceneSource: null };
}

function buildTextSourceGalleryMeta(options = {}) {
    const source = String(options.source || '').trim();
    if (source === 'ebook') {
        const bookId = String(options.bookId || '').trim();
        const bookTitle = String(options.bookTitle || options.title || '未命名书稿').trim() || '未命名书稿';
        const chapterPath = String(options.chapterPath || '').trim();
        const chapterTitle = String(options.chapterTitle || options.title || chapterPath || '章节').trim() || '章节';
        return {
            source,
            bookId,
            bookTitle,
            chapterPath,
            chapterTitle,
            chatId: bookId ? `ebook:${bookId}` : 'ebook',
            characterName: `电纸书 / ${bookTitle}`,
            messageId: `ebook:${bookId || 'unknown'}:${chapterPath || chapterTitle}`,
        };
    }
    if (source === 'tavern') {
        const sessionId = String(options.sessionId || '').trim();
        const messageOrder = Number.isFinite(Number(options.messageOrder))
            ? Math.max(0, Math.floor(Number(options.messageOrder)))
            : null;
        const role = String(options.role || options.title || 'assistant').trim() || 'assistant';
        return {
            source,
            chatId: sessionId || 'tavern',
            characterName: String(options.characterName || '小白酒馆').trim() || '小白酒馆',
            messageId: sessionId
                ? `tavern:${sessionId}:${messageOrder ?? role}`
                : `tavern:${messageOrder ?? role}`,
        };
    }
    return {};
}

export async function generateImagesFromText(options = {}) {
    const monitorGeneration = backendJobMonitors.captureGeneration();
    const text = String(options.text || '');
    if (!text.trim()) throw new Error('正文内容为空，无法配图');
    const signal = options.signal || new AbortController().signal;
    const galleryMeta = buildTextSourceGalleryMeta(options);
    const messageId = String(options.messageId || galleryMeta.messageId || `text:${Date.now()}`);
    const message = {
        mes: text,
        name: String(options.title || options.chapterTitle || '章节'),
        is_user: false,
    };

    ensureDrawImageStyles();
    await openDB();
    options.onStateChange?.('gen', { current: 0, total: 0 });
    const { tasks, sceneSource } = await buildTasksFromMessage({
        message,
        messageId,
        signal,
        promptOverride: options.promptOverride || '',
        taskCharacters: options.taskCharacters || [],
        negativePromptOverride: options.negativePromptOverride || '',
        useWorldbook: false,
        stripImageMarkers: false,
        onStateChange: options.onStateChange,
    });
    if (signal.aborted) throw new Error('已取消');

    const comfySettings = getSettings();
    const sharedDrawSettings = getSharedDrawSettings();
    const images = [];
    let successCount = 0;
    const generationRecipe = createComfyGenerationRecipe({
        settings: comfySettings,
        characterLibrary: characterLibraryFromSettings(sharedDrawSettings),
        paramsOverride: options.paramsOverride || {},
        promptOverride: options.promptOverride || '',
        negativePromptOverride: options.negativePromptOverride || '',
        itemCount: tasks.length,
    });
    const params = generationRecipe.params;
    const compiledBatch = compileComfyScenePlan(tasks, generationRecipe);
    const requests = compiledBatch.artifacts.map(({ task, promptData }) => {
        const slotId = generateSlotId();
        const imgId = generateImgId();
        return {
            task,
            slotId,
            imgId,
            params,
            promptData,
            prompt: promptData.positive,
            negativePrompt: promptData.negative,
        };
    });

    options.onStateChange?.('gen', { current: 0, total: tasks.length });
    await runComfyImageBatch({
        requests,
        compiledBatch,
        signal,
        monitorGeneration,
        queueBatch: {},
        onStateChange: options.onStateChange,
        onItemReady: async ({ index, base64 }) => {
            const { task, slotId, imgId, promptData } = requests[index];
            await storePreview({
                ...galleryMeta,
                imgId,
                slotId,
                messageId,
                base64,
                tags: task.scene || options.promptOverride || '',
                positive: promptData.positive,
                characterPrompts: promptData.characterPrompts,
                negativePrompt: promptData.negative,
                promptTrace: workflowPromptTrace(compiledBatch.items[index]?.request, promptData),
                // 整图正向提示词追加位随图落盘，画廊编辑重生成时才能重建
                postPrompt: task.post_prompt || '',
            });
            await setSlotSelection(slotId, imgId);
            const savedImageUrl = await saveComfyImageToServer(imgId, { slotId });
            successCount++;
            images.push({
                slotId,
                imgId,
                placement: task.placement,
                tags: task.scene || options.promptOverride || '',
                positive: promptData.positive,
                negativePrompt: promptData.negative,
                displayUrl: getPreviewDisplayUrl({ imgId, base64, savedUrl: savedImageUrl }),
                success: true,
            });
        },
        onItemSettled: async ({ index, state, error }) => {
            if (state === 'ready' || signal.aborted) return;
            const { task, slotId, promptData } = requests[index];
            const errorType = classifyError(error) || ErrorType.UNKNOWN;
            await storeFailedPlaceholder({
                ...galleryMeta,
                slotId,
                messageId,
                tags: task.scene || options.promptOverride || '',
                positive: promptData.positive,
                errorType: errorType.code,
                errorMessage: (errorType.desc || '生成失败') + (error?.message ? '：' + String(error.message).slice(0,1800) : ''),
                characterPrompts: promptData.characterPrompts,
                negativePrompt: promptData.negative,
                promptTrace: workflowPromptTrace(compiledBatch.items[index]?.request, promptData),
            });
            images.push({
                slotId,
                placement: task.placement,
                tags: task.scene || options.promptOverride || '',
                positive: promptData.positive,
                negativePrompt: promptData.negative,
                success: false,
                error: errorType,
            });
        },
    });

    options.onStateChange?.('success', { success: successCount, total: tasks.length });
    return {
        ok: true,
        source: options.source || 'text',
        success: successCount,
        total: tasks.length,
        images,
        sourceHash: sceneSource?.sourceHash || '',
    };
}

function setImageState(container, state) {
    container.dataset.state = state;
    const imgEl = container.querySelector('img');
    const menuWrap = container.querySelector('.sti-nd-menu-wrap');
    const isBusy = state === ImageState.SAVING || state === ImageState.REFRESHING;
    if (imgEl) imgEl.style.opacity = isBusy ? '0.5' : '';
    if (menuWrap) {
        menuWrap.style.pointerEvents = isBusy ? 'none' : '';
        menuWrap.style.opacity = isBusy ? '0.3' : '';
    }
    container.style.border = state === ImageState.PREVIEW ? '1px dashed rgba(255,152,0,0.35)' : 'none';
    container.querySelector('.sti-nd-indicator')?.remove();
    // Static draw-owned markup, without user input.
    // eslint-disable-next-line no-unsanitized/method
    if (state === ImageState.SAVING) container.insertAdjacentHTML('afterbegin', IMAGE_SAVING_INDICATOR_HTML);
    else if (state === ImageState.REFRESHING) container.insertAdjacentHTML('afterbegin', '<div class="sti-nd-indicator"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 生成中...</div>');
}

function updateNavControls(container, currentIndex, total) {
    const pill = container.querySelector('.sti-nd-nav-pill');
    if (pill) {
        pill.dataset.current = currentIndex;
        pill.dataset.total = total;
        const text = pill.querySelector('.sti-nd-nav-text');
        if (text) text.textContent = `${total - currentIndex} / ${total}`;
        const prevBtn = pill.querySelector('[data-action="nav-prev"]');
        const nextBtn = pill.querySelector('[data-action="nav-next"]');
        if (prevBtn) prevBtn.disabled = currentIndex >= total - 1;
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.title = currentIndex === 0 ? '重新生成' : '下一版本';
        }
    }
    const wrap = container.querySelector('.sti-nd-img-wrap');
    if (wrap) wrap.dataset.total = total;
}

function syncContainerToPreview(container, preview, historyCount = 1, currentIndex = 0) {
    if (!preview) return;
    if (preview.savedUrl && !preview.base64) {
        container.outerHTML = buildRemotePullPlaceholderHtml({
            slotId: container.dataset.slotId, imgId: preview.imgId,
            messageId: Number(container.dataset.mesid),
        });
        return;
    }
    const imgEl = container.querySelector('.sti-nd-img-wrap > img');
    if (!imgEl) return;
    imgEl.src = getPreviewDisplayUrl(preview);
    container.dataset.imgId = preview.imgId;
    container.dataset.tags = String(preview.tags || '');
    container.dataset.positive = String(preview.positive || '');
    container.dataset.currentIndex = String(currentIndex);
    container.dataset.historyCount = String(historyCount);
    setImageState(container, preview.savedUrl ? ImageState.SAVED : ImageState.PREVIEW);
    updateNavControls(container, currentIndex, historyCount);
    void warmSlotPreviewNeighbors(container.dataset.slotId, currentIndex).catch(() => {});
}

function buildEditedPromptData(sceneTags, characterPrompts = [], params = getEffectiveParams(getSettings()), postPrompt = '') {
    const charPositive = (Array.isArray(characterPrompts) ? characterPrompts : [])
        .map(item => item?.prompt)
        .filter(Boolean)
        .join(', ');
    const charNegative = (Array.isArray(characterPrompts) ? characterPrompts : [])
        .map(item => item?.uc)
        .filter(Boolean)
        .join(', ');
    return {
        // 追加位拼在所有角色之后，与 compileComfyPromptForTask 的顺序保持一致
        positive: joinTags(params.positivePrefix || '', sceneTags, charPositive, postPrompt),
        negative: joinTags(params.negativePrefix || '', charNegative),
    };
}

function appendEditGroup(container, { label, value, type, index = null }) {
    const group = document.createElement('div');
    group.className = 'sti-nd-edit-group';

    const labelEl = document.createElement('div');
    labelEl.className = 'sti-nd-edit-group-label';
    labelEl.textContent = label;
    group.appendChild(labelEl);

    const textarea = document.createElement('textarea');
    textarea.className = 'sti-nd-edit-input';
    textarea.dataset.type = type;
    if (index !== null) textarea.dataset.index = String(index);
    textarea.value = value || '';
    group.appendChild(textarea);

    container.appendChild(group);
}

async function navigateToImage(container, targetIndex) {
    const slotId = container.dataset.slotId;
    const historyCount = parseInt(container.dataset.historyCount) || 1;
    const currentIndex = parseInt(container.dataset.currentIndex) || 0;
    if (targetIndex < 0 || targetIndex >= historyCount || targetIndex === currentIndex) return;
    const previews = await getPreviewsBySlot(slotId);
    const successPreviews = previews.filter(hasPreviewImage);
    if (targetIndex >= successPreviews.length) return;
    const targetPreview = successPreviews[targetIndex];
    const imgEl = container.querySelector('.sti-nd-img-wrap > img');
    if (!imgEl || !targetPreview) return;
    const direction = targetIndex > currentIndex ? 'left' : 'right';
    imgEl.classList.add(`sliding-${direction}`);
    if (targetPreview.base64) setTimeout(() => {
        void preloadPreviewDisplayUrl(targetPreview).catch(() => false);
    }, 0);
    await new Promise(resolve => setTimeout(resolve, 200));
    syncContainerToPreview(container, targetPreview, historyCount, targetIndex);
    await setSlotSelection(slotId, targetPreview.imgId);
    const messageId = Number(container.dataset.mesid);
    if (targetPreview.savedUrl) {
        void syncDrawSavedFromPreview(messageId, targetPreview, { slotId }).catch(() => {});
    } else {
        void clearDrawSavedEntry(messageId, slotId).catch(() => {});
    }
    imgEl.classList.remove(`sliding-${direction}`);
    imgEl.classList.add(`sliding-in-${direction === 'left' ? 'left' : 'right'}`);
    await new Promise(resolve => setTimeout(resolve, 250));
    imgEl.classList.remove('sliding-in-left', 'sliding-in-right');
}

function buildSharedGalleryCallbacks(slotId, messageId) {
    return {
        onDelete: async (sid, deletedImgId, remainingPreviews) => {
            const cont = document.querySelector(`.sti-nd-img[data-slot-id="${sid}"]`);
            if (cont && cont.dataset.imgId === deletedImgId && remainingPreviews.length > 0) {
                syncContainerToPreview(cont, remainingPreviews[0], remainingPreviews.length, 0);
            }
            await syncDrawSavedAfterDeletion(messageId, sid, deletedImgId, remainingPreviews).catch(() => {});
        },
        onBecameEmpty: async (sid, msgId, lastImageInfo = {}) => {
            const cont = document.querySelector(`.sti-nd-img[data-slot-id="${sid}"]`);
            if (cont) {
                // eslint-disable-next-line no-unsanitized/property
                cont.outerHTML = buildFailedPlaceholderHtml({
                    slotId: sid, messageId: msgId,
                    tags: lastImageInfo.tags || '', positive: lastImageInfo.positive || '',
                    errorType: '图片已删除', errorMessage: '点击重试可重新生成',
                });
            }
            await storeFailedPlaceholder({
                slotId: sid, messageId: msgId,
                tags: lastImageInfo.tags || '', positive: lastImageInfo.positive || '',
                errorType: 'deleted', errorMessage: '图片已删除，点击重试可重新生成',
            }).catch(() => {});
            await clearDrawSavedEntry(msgId, sid).catch(() => {});
            if (getSettingsElement('comfy-gallery-container')) {
                await renderGalleryManagement();
            }
        },
    };
}

function renderExistingPanels() {
    const ctx = getContext();
    const chat = ctx.chat || [];

    for (let messageId = chat.length - 1; messageId >= 0; messageId--) {
        const message = chat[messageId];
        if (!message || message.is_user) continue;
        const messageEl = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (messageEl) ensureComfyDrawPanelRef?.(messageEl, messageId);
    }
}


async function handleImageDelegatedClick(event) {
    const container = event.target?.closest?.('.sti-nd-img');
    if (!container) {
        document.querySelectorAll('.sti-nd-menu-wrap.open').forEach(w => w.classList.remove('open'));
        return;
    }

    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (action === 'pull-current-chat-images') {
        const button = event.target.closest('button[data-action="pull-current-chat-images"]');
        if (button) void pullCurrentChatImages(button);
        return;
    }

    if (action === 'pull-server-image') {
        const button = event.target.closest('button[data-action="pull-server-image"]');
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = '正在拉取…';
        try {
            await pullOneRemoteImage(Number(container.dataset.mesid), container.dataset.slotId);
            if (button.isConnected) button.textContent = '已拉取';
        } catch (error) {
            if (button.isConnected) {
                button.textContent = '拉取失败，点击重试';
                button.title = String(error?.message || '请求失败').slice(0, 100);
            }
        } finally {
            button.disabled = false;
        }
        return;
    }

    if (action === 'toggle-menu') {
        const wrap = container.querySelector('.sti-nd-menu-wrap');
        document.querySelectorAll('.sti-nd-menu-wrap.open').forEach(w => {
            if (w !== wrap) w.classList.remove('open');
        });
        wrap?.classList.toggle('open');
        return;
    }

    if (action === 'view-prompt-log') {
        container.querySelector('.sti-nd-menu-wrap')?.classList.remove('open');
        const id=container.dataset.imgId;
        const slotId=container.dataset.slotId;
        let record=id ? await getPreview(id).catch(()=>null) : null;
        // A restored image can have slot history even if its direct ID lookup
        // missed the cache. Never show another image's prompt under this ID.
        if (!record && slotId) {
            const bySlot=await getPreviewsBySlot(slotId).catch(()=>[]);
            record=id ? bySlot.find(item=>item.imgId===id) : bySlot[0];
        }
        openImageDiagnostics(record || {
            imgId:id||'',timestamp:Date.now(),
            positive:container.dataset.positive||'',negativePrompt:'',
        });
        return;
    }
    if (action === 'open-gallery') {
        await openGallery(
            container.dataset.slotId,
            Number(container.dataset.mesid),
            buildSharedGalleryCallbacks(container.dataset.slotId, Number(container.dataset.mesid)),
        );
        return;
    }

    if (action === 'refresh-image' || action === 'nav-next') {
        container.querySelector('.sti-nd-menu-wrap')?.classList.remove('open');
        const currentIndex = parseInt(container.dataset.currentIndex) || 0;
        if (action === 'nav-next' && currentIndex > 0) {
            await navigateToImage(container, currentIndex - 1);
        } else {
            await refreshSingleImage(container);
        }
        return;
    }

    if (action === 'nav-prev') {
        const currentIndex = parseInt(container.dataset.currentIndex) || 0;
        const historyCount = parseInt(container.dataset.historyCount) || 1;
        if (currentIndex < historyCount - 1) {
            await navigateToImage(container, currentIndex + 1);
        }
        return;
    }

    if (action === 'delete-image') {
        container.querySelector('.sti-nd-menu-wrap')?.classList.remove('open');
        await deleteCurrentImage(container);
        return;
    }

    if (action === 'retry-image') { await retryFailedImage(container); return; }
    if (action === 'retry-floor-failed') { await retryFloorFailedImageCards("comfyui", container); return; }
    if (action === 'restore-image') { await restoreImageCard(container); return; }
    if (action === 'edit-tags') { container.querySelector('.sti-nd-menu-wrap')?.classList.remove('open'); toggleEditPanel(container, true); return; }
    if (action === 'cancel-edit') { toggleEditPanel(container, false); return; }
    if (action === 'save-tags') { await saveEditedTags(container); return; }
    if (action === 'save-tags-retry') { await saveTagsAndRetry(container); return; }
    if (action === 'remove-placeholder') { await removePlaceholder(container); }
}

async function toggleEditPanel(container, show) {
    const editPanel = container.querySelector('.sti-nd-edit');
    const btnsPanel = container.querySelector('.sti-nd-btns') || container.querySelector('.sti-nd-failed-btns');

    if (!editPanel) return;

    const origLabel = editPanel.querySelector('[data-draw-edit-label]');
    const origTextarea = Array.from(editPanel.children).find(el =>
        el.tagName === 'TEXTAREA' && !el.dataset.type
    );

    if (show) {
        let preview;
        try { preview = await readCardTagEditor(container); }
        catch (error) {
            console.error(DRAW_SLOT_COPY.tagReadFailed, error);
            toastr.error(error.message);
            return;
        }
        const currentTags = preview?.tags ?? container.dataset.tags ?? '';

        if (origLabel) origLabel.style.display = 'none';
        if (origTextarea) origTextarea.style.display = 'none';

        let scrollWrap = editPanel.querySelector('.sti-nd-edit-scroll');
        if (!scrollWrap) {
            scrollWrap = document.createElement('div');
            scrollWrap.className = 'sti-nd-edit-scroll';
            editPanel.insertBefore(scrollWrap, editPanel.firstChild);
        }

        scrollWrap.replaceChildren();
        appendEditGroup(scrollWrap, { label: '场景', value: currentTags, type: 'scene' });

        if (preview?.characterPrompts?.length > 0) {
            preview.characterPrompts.forEach((char, i) => {
                const name = char.name || `角色 ${i + 1}`;
                appendEditGroup(scrollWrap, { label: name, value: char.prompt || '', type: 'char', index: i });
            });
        }

        // 追加位：与角色框一致，记录里实际存了 post_prompt 才渲染；为空的图不出框
        if (preview?.postPrompt) {
            appendEditGroup(scrollWrap, { label: '追加 (post_prompt)', value: preview.postPrompt, type: 'post_prompt' });
        }

        editPanel.style.display = 'block';

        if (btnsPanel) {
            btnsPanel.style.opacity = '0.3';
            btnsPanel.style.pointerEvents = 'none';
        }

        scrollWrap.querySelector('[data-type="scene"]')?.focus();

    } else {
        const scrollWrap = editPanel.querySelector('.sti-nd-edit-scroll');
        if (scrollWrap) scrollWrap.remove();

        if (origLabel) origLabel.style.display = '';
        if (origTextarea) {
            origTextarea.style.display = '';
            origTextarea.value = container.dataset.tags || '';
        }

        editPanel.style.display = 'none';
        if (btnsPanel) {
            btnsPanel.style.opacity = '';
            btnsPanel.style.pointerEvents = '';
        }
    }
}

async function saveEditedTags(container) {
    try {
        await persistCardTagEdits(container, (tags, characters, record, postPrompt) => {
            // 追加位优先用编辑框的值；面板没有该字段时回落记录里存的
            const data = buildEditedPromptData(tags, characters, undefined, postPrompt ?? record?.postPrompt ?? '');
            return { positive: data.positive, negativePrompt: data.negative ?? record?.negativePrompt ?? '' };
        });
        toggleEditPanel(container, false);
        showSettingsNotice(DRAW_SLOT_COPY.tagSaved, 'success');
        return true;
    } catch (error) {
        console.error(DRAW_SLOT_COPY.tagSaveFailed, error);
        showSettingsNotice(error.message, 'error');
        return false;
    }
}

// Redraw uses the saved, editable direct prompt and the existing slot.
async function refreshSingleImage(container) {
    try { await redrawImageCard('comfyui', container); }
    catch (error) {
        console.error('[ComfyDraw] 直出图片重新生成失败:', error);
        globalThis.toastr?.error(error.message || '重新生成失败');
    }
}

async function retryFailedImage(container) {
    await refreshSingleImage(container);
}

async function saveTagsAndRetry(container) {
    if (!await saveEditedTags(container)) return;
    // Explicitly edited TAGs are authoritative: this action is different from
    // the menu's automatic re-planning and should generate with the manual edit.
    try { await redrawImageCard('comfyui', container); }
    catch (error) {
        console.error(DRAW_SLOT_COPY.redrawFailed, error);
        globalThis.toastr?.error(error.message);
    }
}

async function removePlaceholder(container) {
    if (!await askConfirmDialog(DRAW_SLOT_COPY.removeConfirm)) return;
    try { await removeChatImageSlot(container); }
    catch (error) { console.error(DRAW_SLOT_COPY.removeFailed, error); globalThis.toastr?.error(error.message); }
}

async function deleteCurrentImage(container) {
    const slotId = container.dataset.slotId;
    const imgId = container.dataset.imgId;
    const messageId = Number(container.dataset.mesid);
    if (!slotId) return;
    if (imgId) { try { await deletePreview(imgId); } catch {} }
    const previews = await getPreviewsBySlot(slotId).catch(() => []);
    const successPreviews = previews.filter(hasPreviewImage);
    if (successPreviews.length > 0) {
        const nextPreview = successPreviews[0];
        await setSlotSelection(slotId, nextPreview.imgId).catch(() => {});
        syncContainerToPreview(container, nextPreview, successPreviews.length, 0);
        await syncDrawSavedAfterDeletion(messageId, slotId, imgId, successPreviews).catch(() => {});
        toastr.success(`已删除（剩余 ${successPreviews.length} 张）`);
        return;
    } else {
        try { await removeChatImageSlot(container); }
        catch (error) {
            console.error(DRAW_SLOT_COPY.removeFailed, error);
            globalThis.toastr?.error(error.message);
            return;
        }
    }
    container.remove();
    toastr.success('图片已删除');
}

function setupImageDelegation() {
    if (imageDelegationBound) return;
    imageDelegationBound = true;
    document.addEventListener('click', handleImageDelegatedClick, { capture: true });
}

function cleanupImageDelegation() {
    if (!imageDelegationBound) return;
    document.removeEventListener('click', handleImageDelegatedClick, { capture: true });
    imageDelegationBound = false;
}

let preparedImageDispose = null;

async function runPreparedComfySlots(input) {
    const { ctx, message, messageId, sourceText, tasks, onStateChange } = input;
    const job = input.job || createGenerationJob(messageId);
    try {
        const settings = input.settings || cloneSettingsObject(getSettings());

        const recipe = createComfyGenerationRecipe({
            settings,
            characterLibrary: input.characterLibrary || characterLibraryFromSettings(getSharedDrawSettings()),
            paramsOverride: input.paramsOverride || {},
            promptOverride: input.promptOverride || '',
            negativePromptOverride: input.negativePromptOverride || '',
            itemCount: tasks.length,

        });
        const { compiledBatch, requests, metadata } = prepareImageInput('comfyui', tasks, recipe);
        console.info('[STI绘图阶段]',JSON.stringify({stage:'batch-compiled',messageId,
            taskCount:tasks.length,imageIndices:tasks.map(task=>task.imageIndex??null)}));
        job.phase = 'gen';
        const monitorGeneration = backendJobMonitors.captureGeneration();
        return await submitPreparedChatImages({
            ctx, message, messageId, sourceText, tasks, metadata, swipeIndex: input.swipeIndex,
            nativeMessage: input.nativeMessage, onPrepared: input.onPrepared, placementSource: input.placementSource,
            backend: settings.useImageBackendJobs === true,
            autoSaveToServer: true,
            signal: job.controller.signal, onStateChange, onPlacement: input.onPlacement,
            run: handlers => runComfyImageBatch({
                ...handlers, requests, compiledBatch, generationConfig: settings,
                backendCancelSignal: job.backendCancel.signal, monitorGeneration, queueBatch: job,
            }),
        });
    } finally {
        if (!input.job) releaseGenerationJob(job);
    }
}

export async function generateAndInsertImages({
    messageId,
    promptOverride = '',
    negativePromptOverride = '',
    paramsOverride = {},
    onStateChange,
    automatic=false,
    injectedWorldbook,
} = {}) {
    let resolvedMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : findLastAIMessageId();
    if (resolvedMessageId < 0) throw new Error('未找到可出图的 AI 消息');

    const job = createGenerationJob(resolvedMessageId);
    const signal = job.controller.signal;
    onStateChange = observeFloorImageJob(job, { getCurrentContext: getContext, onStateChange, classifyError });

    try {
        ensureDrawImageStyles();
        await openDB();
        await loadSettings();
        await loadSharedDrawSettings();
        const { ctx, message, messageId: liveId } = resolveFloorImageJobTarget(job, getContext());
        resolvedMessageId = liveId;
        if (!message || message.is_user) throw new Error('消息不存在或不是 AI 消息');

        const comfySettings = cloneSettingsObject(getSettings());
        const sharedSettingsSnapshot = cloneSettingsObject(getSharedDrawSettings());
        let capturedText = message.mes;
        const capturedSwipe = message.swipe_id ?? 0;
        const directives = promptOverride.trim() ? [] : readDirectDrawDirectives(message);
        // Model-authored [image:slot-*] tokens are not actual Draw jobs.
        // Preserve previously owned image slots, but never persist invented IDs
        // next to the four real slots about to be created.
        const ownedBefore = directives.length ? await getOwnedImageSlotIds(message) : null;
        // Display cleanup is independent of compilation/transport success.
        // Keep the original inputs in metadata and synchronize the active swipe.
        const cleanText = directives.length
            ? stripUnownedDrawImageSlots(stripDirectDrawSource(capturedText), ownedBefore)
            : capturedText;
        if (cleanText !== capturedText) {
            rememberDirectDrawDirectives(message, directives);
            setActiveMessageText(message, cleanText);
            capturedText = cleanText;
            await syncRenderedMessageFromState(liveId, { chatId: ctx.chatId, expectedMessage: message });
            const displayedTarget = resolveFloorImageJobTarget(job, getContext());
            if (displayedTarget.message !== message || message.mes !== capturedText || (message.swipe_id ?? 0) !== capturedSwipe
                || isMessageBeingEdited(displayedTarget.messageId)) throw new Error('剧情或回复分支已经变化，请在当前回复重新绘图');
            await saveChatConditional();
        }
        // Do not append an additional full batch to already placed image slots.
        // Explicit single-slot rerolls use the existing-slot path instead.
        if (!promptOverride.trim() && (ownedBefore || await getOwnedImageSlotIds(message)).size) {
            const current = resolveFloorImageJobTarget(job, getContext());
            if (current.message !== message || message.mes !== capturedText || (message.swipe_id ?? 0) !== capturedSwipe)
                throw new Error('剧情或回复分支已经变化，请在当前回复重新绘图');
            await syncRenderedMessageFromState(current.messageId, { chatId: ctx.chatId, expectedMessage: message });
            const renderedTarget = resolveFloorImageJobTarget(job, getContext());
            if (renderedTarget.message !== message || message.mes !== capturedText || (message.swipe_id ?? 0) !== capturedSwipe
                || isMessageBeingEdited(renderedTarget.messageId)) throw new Error('剧情或回复分支已经变化，请在当前回复重新绘图');
            const failedCard = document.querySelector(`.mes[mesid="${current.messageId}"] .sti-nd-img[data-state="failed"]`);
            if (!automatic && failedCard) {
                const retry = await redrawFloorFailedImageCards('comfyui', failedCard);
                if (retry?.submitted > 0) return retry;
            }
            const error = new Error('这条回复已有图片槽位，请等待任务恢复或对指定图片重新生成，不能重复提交整批图片。');
            error.code='DUPLICATE_IMAGE_BATCH';
            throw error;
        }
        const checkedTarget = resolveFloorImageJobTarget(job, getContext());
        if (checkedTarget.message !== message || message.mes !== capturedText || (message.swipe_id ?? 0) !== capturedSwipe)
            throw new Error('剧情或回复分支已经变化，请在当前回复重新绘图');
        const { tasks } = await buildTasksFromMessage({ message, signal, promptOverride, onStateChange,
            useInjectedFacts:automatic, injectedWorldbook });
        const current = resolveFloorImageJobTarget(job, getContext());
        if (current.message !== message || message.mes !== capturedText || (message.swipe_id ?? 0) !== capturedSwipe
            || isMessageBeingEdited(current.messageId)) throw new Error('剧情或回复分支已经变化，请在当前回复重新绘图');
        signal.throwIfAborted();
        const savedTarget = resolveFloorImageJobTarget(job, getContext());
        const expectedText = capturedText;
        if (savedTarget.message !== message || message.mes !== expectedText || (message.swipe_id ?? 0) !== capturedSwipe
            || isMessageBeingEdited(savedTarget.messageId)) throw new Error('保存期间剧情或回复分支已变化，请在当前回复重新绘图');
        return await runPreparedComfySlots({ ctx, message, messageId: savedTarget.messageId, swipeIndex: capturedSwipe,
            sourceText: message.mes, tasks, settings: comfySettings,
            characterLibrary: characterLibraryFromSettings(sharedSettingsSnapshot),
            paramsOverride, promptOverride, negativePromptOverride, job, onStateChange });
    } catch (error) {
        failFloorImageJob(job, error);
        // Covers manual image requests and failures occurring before a backend
        // Draw Run is accepted. The backend reports its own later failures.
        if (!signal.aborted && error?.name !== 'AbortError') {
            void writeImageError({
                stage: '直出指令解析与生图交付',
                errorType: error?.code || 'DRAW_REQUEST_FAILED',
                errorMessage: error?.message || '绘图任务失败',
                provider: 'ComfyUI',
            }).catch(logError=>console.error('[ComfyDraw] manual error logging failed',logError));
            try { error.xbDiagnosticLogged = true; } catch {}
        }
        throw error;
    } finally {
        releaseGenerationJob(job);
    }
}



export async function initComfyDraw() {
    if (moduleInitialized) return true;
    const initGeneration = ++moduleLifecycleGeneration;
    await loadPromptTemplates();
    await loadTagGuide();
    let sharedDrawSettings;
    try {
        await loadSettings();
        sharedDrawSettings = await loadSharedDrawSettings();
    } catch (error) {
        await writeImageError({
            stage:'插件初始化',errorType:'DRAW_INIT_FAILED',
            errorMessage:error?.message || '读取设置失败',provider:'ComfyUI',
        }).catch(logError=>console.error('[ComfyDraw] failed to log initialization',logError));
        return false;
    }
    const [floatingPanel] = await Promise.all([
        import('./floating-panel.js'),
        openDB().then(() => clearExpiredCache(sharedDrawSettings.cacheDays)).catch(() => {}),
    ]);
    if (initGeneration !== moduleLifecycleGeneration || window?.isStImageEnabled === false) return false;

    moduleInitialized = true;
    backendJobMonitors.activate();
    ensureDrawImageStyles();
    setupImageDelegation();
    ensureComfyDrawPanelRef = floatingPanel.ensureComfyDrawPanel;
    destroyComfyDrawPanelsRef = floatingPanel.destroyComfyDrawPanels;
    reportComfyDrawPanelStateRef = floatingPanel.setStateForMessage;
    floatingPanel.initFloatingPanel?.();
    startSharedDrawPreviewRuntime();

    events.on(event_types.CHARACTER_MESSAGE_RENDERED, (data) => {
        const messageId = typeof data === 'number' ? data : data?.messageId ?? data?.mesId;
        if (messageId === undefined) return;
        if (Number(messageId) === findLastAIMessageId()) {
            floatingPanel.refreshDrawRunUiState?.();
        }
        const ctx = getContext();
        const message = ctx.chat?.[messageId];
        if (!message || message.is_user) return;
        const messageEl = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (messageEl) ensureComfyDrawPanelRef?.(messageEl, Number(messageId));
    });

    events.on(event_types.CHAT_CHANGED, () => {
        floatingPanel.refreshDrawRunUiState?.();
        setTimeout(renderExistingPanels, 150);
        resumeMissedAutomaticDraw(initGeneration);
    });
    events.on(event_types.MESSAGE_SWIPED, () => {
        floatingPanel.refreshDrawRunUiState?.();
    });
    events.on(event_types.MESSAGE_SWIPE_DELETED, detail => {
        const ctx = getContext();
        rebaseFloorImageJobsAfterSwipeDeletion(generationJobs, ctx, detail);
        rebaseFloorImageJobsAfterSwipeDeletion(autoPendingTargets, ctx, detail);
        floatingPanel.refreshDrawRunUiState?.();
    });
    events.on(event_types.GENERATION_ENDED, async () => {
        try {
            await autoGenerateForLastAI();
        } catch (error) {
            console.error('[ComfyDraw]', error);
        }
    });

    setTimeout(() => {
        renderExistingPanels();
        resumeMissedAutomaticDraw(initGeneration);
    }, 300);

    preparedImageDispose?.();
    preparedImageDispose = registerPreparedImageProvider("comfyui", createImageCardRedrawProvider({
        execute: runPreparedComfySlots,
        createJob: createGenerationJob,
        releaseJob: releaseGenerationJob,
        getCurrentContext: getContext,
        setStateForMessage: floatingPanel.setStateForMessage,
        classifyError,
    }));
    window.stimageComfyDraw = {
        mountMessagePanel: floatingPanel.ensureComfyDrawPanel,
        releaseMessagePanel: floatingPanel.releaseComfyDrawPanel,
        openSettings,
        getSettings,
        getDirectDrawInstruction,
        getGenerationSnapshot,
        getQuickSettings,
        updateQuickSettings,
        testConnection,
        generateComfyImage,
        generateImagesFromText,
        generateAndInsertImages,
        getEffectiveParams,
        abortGeneration,
        isEnabled: () => moduleInitialized,
    };

    window.registerStImageCleanup?.(MODULE_KEY, cleanupComfyDraw);
    console.log('[ComfyDraw] 模块已初始化');
    return true;
}

export function cleanupComfyDraw() {
    preparedImageDispose?.();
    preparedImageDispose = null;
    moduleLifecycleGeneration++;
    moduleInitialized = false;
    events.cleanup();
    cleanupImageDelegation();
    stopSharedDrawPreviewRuntime();
    backendJobMonitors.deactivate();
    abortPendingRequest();
    abortGeneration(null, { reason: 'teardown' });
    clearFloorImageJobs(generationJobs);
    comfyImageRequestQueue.clear();
    hideSettings();
    destroyComfyDrawPanelsRef?.();
    ensureComfyDrawPanelRef = null;
    destroyComfyDrawPanelsRef = null;
    reportComfyDrawPanelStateRef = null;
    autoPendingTargets.length = 0;
    autoPendingTargets = [];
    autoBusy = false;
    injectedDrawingFacts = null;

    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        window.visualViewport?.removeEventListener('resize', resizeHandler);
        window.visualViewport?.removeEventListener('scroll', resizeHandler);
        resizeHandler = null;
    }

    overlayElement?.remove();
    overlayElement = null;
    overlayFrame = null;
    frameReadyPromise = null;
    eventsBound = false;
    delete window.stimageComfyDraw;
    console.log('[ComfyDraw] 模块已清理');
}

export { classifyError, findLastAIMessageId, fetchComfyModels, fetchComfySamplers };
