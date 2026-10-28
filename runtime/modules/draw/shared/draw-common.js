import { getContext } from "/scripts/extensions.js";
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { formatScenePlannerProgress, toScenePlannerProgress } from './draw-capsule-copy.js';

// 出场角色检测放在 present-characters.js（同样不依赖宿主模块，便于单测），这里保持原有导出位置。
export { detectPresentCharacters };
// 纯函数放在 draw-capsule-copy.js（不依赖酒馆宿主模块，便于单测），这里保持原有导出位置。
export { formatScenePlannerProgress, toScenePlannerProgress };
import {
    getDisplayPreviewForSlot,
    getPreviewsBySlot,
    getPreviewDisplayUrl,
    subscribeGalleryCacheChanges,
    warmSlotPreviewNeighbors,
    getPreview,
    storePreview,
    pullServerImageManually,
    deletePreview,
} from "./gallery-cache.js";
import { patchImageCard, reportImageCardReadError } from './image-card-view.js';
import { IMAGE_SAVING_INDICATOR_HTML } from './image-save-ui.js';
import {
    ScenePlannerError,
} from "./scene-plan-contract.js";
import { ScenePlacementError } from './scene-placement.js';
import { getRenderedSceneSlotIds, replaceSceneSlotElements } from './scene-slot-dom.js';
import {shouldUsePortableSavedImage} from './saved-preview-selection.js';
import {isUnclaimedImageSlot} from './image-slot-validity.js';
import {mountImageCardAtVisibleAnchor} from './visible-image-anchor.js';
import {getImageSlotDirective,getImageSlotRecord} from './image-directive-identity.js';
import { protectDrawImageMarkers, restoreDrawImageMarkers } from './scene-slot-protection.js';
import { getPendingImageJobSlots, PendingJobState } from './pending-image-jobs.js';
import { findImageJobDeliverySlot } from './image-job-delivery-target.js';
import { createDrawImageSlotRegex, stripDrawImageDirectives } from './image-marker-syntax.js';
import { hasPreviewImage, PreviewStatus, DRAW_SLOT_COPY, DRAW_SLOT_ERRORS } from './image-record.js';
import { getSlotActivity } from './slot-activity.js';
import { classifyScenePlannerErrorForUi } from "./scene-planner-error-ui.js";
import { detectPresentCharacters } from './present-characters.js';
import { joinTags } from './character-prompts.js';
import { createModuleEvents, event_types } from "../../../core/event-manager.js";
import {
    GENERATE_INTERCEPTOR_ORDER,
    registerGenerateInterceptor,
    unregisterGenerateInterceptor,
} from "../../../shared/common/generate-interceptor.js";

const DRAW_IMAGE_HTML_REGEX = /<div\b[^>]*class=(["'])[^"']*\bsti-nd-img\b[^"']*\1[^>]*>[\s\S]*?<\/div>/gi;
const DRAW_SAVED_EXTRA_KEY = 'stimageDrawSaved';
const LEGACY_NOVEL_SAVED_EXTRA_KEY = 'novelDrawSaved';
const INITIAL_RENDER_MESSAGE_LIMIT = 1;

let drawPreviewRuntimeEvents = null;
let drawPreviewRuntimeRefs = 0;
let drawPreviewMessageObserver = null;
let drawPreviewRuntimeGeneration = 0;
let drawPreviewCacheSyncCleanup = null;
let manualRemotePullClickListener = null;
let manualChatPullController = null;

const drawPreviewPendingTimers = new Set();
const drawPreviewRenderQueues = new WeakMap();

export const ImageState = {
    PREVIEW: 'preview',
    SAVING: 'saving',
    SAVED: 'saved',
    REFRESHING: 'refreshing',
    FAILED: 'failed',
};

export const ErrorType = {
    INPUT: { code: 'input', label: '正文输入', desc: '正文没有可用的配图内容' },
    NETWORK: { code: 'network', label: '网络', desc: '连接超时或网络不稳定' },
    AUTH: { code: 'auth', label: '认证', desc: '认证信息无效或过期' },
    QUOTA: { code: 'quota', label: '额度', desc: '额度不足' },
    BUSY: { code: 'busy', label: '繁忙', desc: '当前并发繁忙，请稍后重试' },
    PARSE: { code: 'parse', label: '解析失败', desc: 'LLM 输出未解析为图片任务' },
    LLM: { code: 'llm', label: 'LLM失败', desc: '场景分析失败' },
    LLM_EMPTY: { code: 'llm_empty', label: '空回', desc: 'LLM 未返回内容' },
    TIMEOUT: { code: 'timeout', label: '超时', desc: '请求超时' },
    AGENT_CONFIG: { code: 'agent_config', label: 'Agent 配置', desc: '共享 Agent 主预设不可用' },
    PROMPT_EXPANSION: { code: 'prompt_expansion', label: 'Prompt 展开', desc: 'Prompt 宏展开失败，请检查提示词中的变量宏' },
    TOOL_PROTOCOL: { code: 'tool_protocol', label: 'Tool 协议', desc: '模型没有按要求调用场景规划 Tool' },
    SCENE_SCHEMA: { code: 'scene_schema', label: '计划校验', desc: '模型提交的场景计划不符合契约' },
    PROVIDER: { code: 'provider', label: 'Provider', desc: '模型 Provider 请求失败' },
    SCENE_PLACEMENT: { code: 'scene_placement', label: '插图位置', desc: '正文位置已变化，未写入图片' },
    ABORTED: { code: 'aborted', label: '已取消', desc: '场景规划已取消' },
    UNKNOWN: { code: 'unknown', label: '错误', desc: '未知错误' },
    CACHE_LOST: { code: 'cache_lost', label: '缓存丢失', desc: '图片缓存已过期' },
    JOB_EXPIRED: { code: 'job_expired', label: '后台任务已失效', desc: '后台任务已过期或被清理，可重新生成' },
    JOB_NOT_SUBMITTED: { code: 'job_not_submitted', label: '任务未提交', desc: '后台任务未提交成功，可重新生成' },
};

export const DEFAULT_MESSAGE_FILTER_RULES = [
    { start: '<think>',    end: '</think>' },
    { start: '<thinking>', end: '</thinking>' },
    { start: '<system>',   end: '</system>' },
    { start: '<meta>',     end: '</meta>' },
    { start: '<options>',  end: '</options>' },
    { start: '<WorldState>', end: '</WorldState>' },
    { start: '<state>',    end: '</state>' },
    { start: '<UpdateVariable>', end: '</UpdateVariable>' },
    { start: '<—',         end: '—>' },
    { start: '',           end: '</think>' },
];

export function createPlaceholder(slotId) {
    return `[image:${slotId}]`;
}

function stripDrawImageHtml(text) {
    const value = String(text || '');
    if (!value.includes('sti-nd-img')) return value;
    if (typeof document === 'undefined') return value.replace(DRAW_IMAGE_HTML_REGEX, '');

    const template = document.createElement('template');
    // Local chat markup generated by the draw modules.
    // eslint-disable-next-line no-unsanitized/property
    template.innerHTML = value;
    template.content.querySelectorAll('.sti-nd-img').forEach(node => node.remove());
    return template.innerHTML || '';
}

export function stripDrawArtifactsFromMessage(text) {
    // This legacy helper is intentionally restricted to STI-owned artifacts.
    // Generic <image> and other extension/roleplay containers are NOT ours.
    const original = String(text ?? '');
    const stripOwned = part => stripDrawImageHtml(part)
        .replace(/\n{0,2}<sti-draw-instruction>[\s\S]*?<\/sti-draw-instruction>/g, '')
        .replace(/\[image\s*:\s*slot-[a-z0-9_-]+\]/gi, '');
    // Preserve hidden protocol containers byte-for-byte, including unclosed ones.
    const hidden = /<hidden\b[^>]*>[\s\S]*?(?:<\/hidden\s*>|$)/gi;
    let result = '', previous = 0;
    for (const match of original.matchAll(hidden)) {
        result += stripOwned(original.slice(previous, match.index)) + match[0];
        previous = match.index + match[0].length;
    }
    return result + stripOwned(original.slice(previous));
}

const DRAW_EXTENSION_PROMPT_KEY = 'SillyTavernImage.DirectDraw';

function setDrawPrompt(value = '') {
    // Use the host's independent extension prompt channel. A USER-role prompt
    // respects the existing preset's SYSTEM/DEVELOPER output contract.
    setExtensionPrompt(DRAW_EXTENSION_PROMPT_KEY, value, extension_prompt_types.IN_CHAT, 0,
        false, extension_prompt_roles.USER);
}

async function injectDrawDirectiveInstruction(chat) {
    // Clear the previous turn first so disabled/failed turns cannot leak rules.
    setDrawPrompt('');
    if (!Array.isArray(chat) || !chat.length) return;
    const instruction = await window.stimageComfyDraw?.getDirectDrawInstruction?.(chat);
    if (!instruction) throw new Error('绘图模块未提供本轮绘图指令，请检查插件初始化状态');
    // The active tool-transport preset archives ordinary extension messages.
    // Its already-established guide marker is the one current-instruction
    // channel. Adapt our own prompt only when that transport is running.
    const engine = window.__antiTruncationEngine;
    const viaGuide = engine?.installed === true && engine?.enabled !== false;
    const currentInstruction = viaGuide
        ? '\u3010ToolCall\u5f15\u5bfc\u3011[UserDrawingInstructions]\n' + instruction
        : instruction;
    setDrawPrompt(currentInstruction);
    console.info('[STI Draw]',JSON.stringify({stage:'instruction-injected',
        channel:viaGuide?'toolcall-user-guide':'in-chat',depth:0,characters:instruction.length}));
}

export function stripDrawArtifactsFromChat(chat) {
    if (!Array.isArray(chat)) return;
    for (const msg of chat) {
        if (!msg) continue;
        if (msg.is_system || msg.role === 'system' || msg.role === 'developer') continue;
        if (typeof msg.mes === 'string') {
            msg.mes = stripDrawArtifactsFromMessage(msg.mes);
        }
        if (typeof msg.content === 'string') {
            msg.content = stripDrawArtifactsFromMessage(msg.content);
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && typeof part.text === 'string') {
                    part.text = stripDrawArtifactsFromMessage(part.text);
                }
            }
        }
    }
}

export function setupDrawGenerateInterceptor(options = {}) {
    const shouldInject = typeof options.shouldStrip === 'function' ? options.shouldStrip : () => true;
    registerGenerateInterceptor('draw', async (chat, _size, _abort, type) => {
        if(['quiet','impersonate'].includes(type)){setDrawPrompt('');return;}
        if (!shouldInject()) {
            setDrawPrompt('');
            return;
        }
        // Never mutate the host's chat messages, <hidden>, <content>, or
        // any other preset/extension-owned markup.
        await injectDrawDirectiveInstruction(chat);
    }, GENERATE_INTERCEPTOR_ORDER.DRAW);
}

export function cleanupDrawGenerateInterceptor() {
    unregisterGenerateInterceptor('draw');
    setDrawPrompt('');
}

export { joinTags };

export function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function findLastAIMessageId() {
    const ctx = getContext();
    const chat = ctx.chat || [];
    let id = chat.length - 1;
    while (id >= 0 && chat[id]?.is_user) id--;
    return id;
}

export function classifyError(error) {
    if (error instanceof ScenePlannerError) {
        return classifyScenePlannerErrorForUi(error, ErrorType);
    }
    if (error instanceof ScenePlacementError) {
        return { ...ErrorType.SCENE_PLACEMENT, desc: error.message || ErrorType.SCENE_PLACEMENT.desc };
    }
    if (error?.errorType) return error.errorType;
    // 带 HTTP status 的后端错误优先按 status 分类：上游正文常常不写数字，靠 message 匹配会退化成未知错误。
    const status = Number(error?.status) || 0;
    if (status === 401 || status === 403) return ErrorType.AUTH;
    if (status === 402) return ErrorType.QUOTA;
    if (status === 429) return ErrorType.BUSY;
    if (status === 408 || status === 504) return ErrorType.TIMEOUT;
    const msg = String(error?.message || error || '').toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) return ErrorType.NETWORK;
    if (msg.includes('401') || msg.includes('key') || msg.includes('auth')) return ErrorType.AUTH;
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('请求频繁') || msg.includes('busy')) return ErrorType.BUSY;
    if (msg.includes('402') || msg.includes('anlas') || msg.includes('quota')) return ErrorType.QUOTA;
    if (msg.includes('timeout') || msg.includes('abort')) return ErrorType.TIMEOUT;
    if (msg.includes('输出为空') || msg.includes('empty_output') || msg.includes('未返回内容')) return ErrorType.LLM_EMPTY;
    if (msg.includes('parse') || msg.includes('json')) return ErrorType.PARSE;
    if (msg.includes('无法解析') || msg.includes('未解析到图片任务')) return ErrorType.PARSE;
    if (msg.includes('llm') || msg.includes('xbgenraw')) return ErrorType.LLM;
    return { ...ErrorType.UNKNOWN, desc: error?.message || '未知错误' };
}

export function ensureDrawImageStyles() {
    if (document.getElementById('stimage-draw-image-styles')) return;
    const style = document.createElement('style');
    style.id = 'stimage-draw-image-styles';
    style.textContent = `
.sti-nd-img{margin:0.8em 0;text-align:center;position:relative;display:block;width:100%;border-radius:14px;padding:4px;box-sizing:border-box}
.sti-nd-img[data-state="preview"]{outline:1px dashed rgba(255,152,0,0.35);outline-offset:-1px}
.sti-nd-img[data-state="failed"]{border:1px dashed rgba(248,113,113,0.5);background:rgba(248,113,113,0.05);padding:20px}
.sti-nd-img[data-state="pending"]{border:1px dashed rgba(212,165,116,0.4);background:rgba(212,165,116,0.06);padding:18px;color:inherit}
.sti-nd-img.busy img{opacity:0.5}
.sti-nd-img-wrap{position:relative;overflow:hidden;border-radius:10px;touch-action:pan-y pinch-zoom}
.sti-nd-img img{width:auto;height:auto;max-width:100%;border-radius:10px;cursor:pointer;box-shadow:0 3px 15px rgba(0,0,0,0.25);display:block;user-select:none;-webkit-user-drag:none;transition:transform 0.25s ease,opacity 0.2s ease}
.sti-nd-img img.sliding-left{animation:ndSlideOutLeft 0.25s ease forwards;will-change:transform,opacity}
.sti-nd-img img.sliding-right{animation:ndSlideOutRight 0.25s ease forwards;will-change:transform,opacity}
.sti-nd-img img.sliding-in-left{animation:ndSlideInLeft 0.25s ease forwards;will-change:transform,opacity}
.sti-nd-img img.sliding-in-right{animation:ndSlideInRight 0.25s ease forwards;will-change:transform,opacity}
@keyframes ndSlideOutLeft{from{transform:translateX(0);opacity:1}to{transform:translateX(-30%);opacity:0}}
@keyframes ndSlideOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(30%);opacity:0}}
@keyframes ndSlideInLeft{from{transform:translateX(30%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes ndSlideInRight{from{transform:translateX(-30%);opacity:0}to{transform:translateX(0);opacity:1}}
.sti-nd-nav-pill{position:absolute;bottom:10px;left:10px;display:inline-flex;align-items:center;gap:2px;background:rgba(0,0,0,0.75);border-radius:20px;padding:4px 6px;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;user-select:none;z-index:5;opacity:0.72;transition:opacity 0.2s}
.sti-nd-nav-pill:hover{opacity:0.92}
.sti-nd-nav-arrow{width:24px;height:24px;border:none;background:transparent;color:rgba(255,255,255,0.8);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:14px;transition:background 0.15s,color 0.15s;padding:0}
.sti-nd-nav-arrow:hover{background:rgba(255,255,255,0.15);color:#fff}
.sti-nd-nav-arrow:disabled{opacity:0.3;cursor:not-allowed}
.sti-nd-nav-text{min-width:36px;text-align:center;font-variant-numeric:tabular-nums;padding:0 2px}
@media(hover:none),(pointer:coarse){.sti-nd-nav-pill{opacity:0.78;padding:5px 8px}}
.sti-nd-menu-wrap{position:absolute;top:8px;right:8px;z-index:10}
.sti-nd-menu-wrap.busy{pointer-events:none;opacity:0.3}
.sti-nd-menu-trigger{width:32px;height:32px;border-radius:50%;border:none;background:rgba(0,0,0,0.75);color:rgba(255,255,255,0.85);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;opacity:0.85}
.sti-nd-menu-trigger:hover,.sti-nd-menu-wrap.open .sti-nd-menu-trigger{background:rgba(0,0,0,.9);opacity:1}
.sti-nd-menu-wrap.open .sti-nd-dropdown{display:flex;opacity:1;visibility:visible;transform:translateY(0) scale(1);pointer-events:auto}
.sti-nd-dropdown{position:absolute;top:calc(100% + 4px);right:0;background:rgba(20,20,24,0.98);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:4px;display:none;flex-direction:column;gap:2px;opacity:0;visibility:hidden;transform:translateY(-4px) scale(0.96);transform-origin:top right;transition:all 0.15s ease;box-shadow:0 8px 24px rgba(0,0,0,0.4);pointer-events:none}
.sti-nd-dropdown button{width:32px;height:32px;border:none;background:transparent;color:rgba(255,255,255,0.85);cursor:pointer;font-size:14px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.15s;padding:0;margin:0}
.sti-nd-dropdown button:hover{background:rgba(255,255,255,.15)}
.sti-nd-dropdown [data-action="delete-image"]{color:rgba(248,113,113,.9)}
.sti-nd-indicator{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);padding:8px 16px;border-radius:8px;color:#fff;font-size:12px;z-index:10}
.sti-nd-status-overlay{position:absolute;inset:auto 8px 8px;z-index:11;padding:12px;border-radius:10px;background:rgba(0,0,0,.9);color:#fff;max-height:calc(100% - 16px);overflow:auto}
.sti-nd-status-overlay .sti-nd-indicator{position:static;transform:none;background:none;padding:0}
.sti-nd-view-notice{padding:12px;overflow-wrap:anywhere}
.sti-nd-view-notice button{margin-inline-start:8px;min-height:44px;padding:6px 12px;border:1px solid rgba(127,127,127,.4);border-radius:8px;background:rgba(127,127,127,.1);color:inherit;cursor:pointer}
.sti-nd-view-empty .sti-nd-img-wrap{padding:12px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.06)}
.sti-nd-view-empty img{display:none}
.sti-nd-view-empty .sti-nd-nav-pill{position:static;margin-inline-end:40px}
.sti-nd-view-empty .sti-nd-menu-wrap{top:16px;right:16px}
.sti-nd-view-empty .sti-nd-view-notice{padding:12px 0 0}
.sti-nd-view-empty .sti-nd-status-overlay{position:static;max-height:none}
.sti-nd-edit{animation:nd-slide-up 0.2s ease-out}
.sti-nd-edit-scroll{max-height:250px;overflow-y:auto;margin-bottom:8px}
.sti-nd-edit-scroll::-webkit-scrollbar{width:4px}
.sti-nd-edit-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:2px}
.sti-nd-edit-group{margin-bottom:8px}
.sti-nd-edit-group:last-child{margin-bottom:0}
.sti-nd-edit-group-label{font-size:11px;color:inherit;opacity:.8;margin-bottom:4px}
.sti-nd-edit-input{box-sizing:border-box;width:100%;min-height:60px;background:rgba(127,127,127,0.1);border:1px solid rgba(127,127,127,0.4);border-radius:6px;color:inherit;font-size:12px;padding:8px;resize:vertical;font-family:monospace}
.sti-nd-edit-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sti-nd-edit-actions button{min-height:36px;padding:6px 12px;border:1px solid rgba(127,127,127,.4);background:rgba(127,127,127,.1);border-radius:6px;color:inherit;cursor:pointer;white-space:nowrap}
.sti-nd-edit-actions [data-action="save-tags"]{flex:1;background:rgba(212,165,116,.2)}
.sti-nd-img button:focus-visible,.sti-nd-edit-input:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.sti-nd-failed-icon{color:rgba(248,113,113,0.9);font-size:24px;margin-bottom:8px}
.sti-nd-failed-title{color:inherit;font-size:13px;margin-bottom:4px}
.sti-nd-failed-desc{color:inherit;opacity:.75;font-size:12px;margin-bottom:12px;overflow-wrap:anywhere}
.sti-nd-failed-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.sti-nd-failed-btns button{padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer;transition:all 0.15s}
.sti-nd-tag-actions{display:inline-flex;margin-inline-start:12px;vertical-align:middle}
.sti-nd-tag-actions button{min-height:44px;min-width:64px}
.sti-nd-retry-btn{border:1px solid rgba(212,165,116,0.5);background:rgba(212,165,116,0.2);color:inherit}
.sti-nd-edit-btn{border:1px solid rgba(127,127,127,0.4);background:rgba(127,127,127,0.1);color:inherit}
.sti-nd-remove-btn{border:1px solid rgba(248,113,113,0.3);background:transparent;color:rgba(248,113,113,0.8)}
@media(prefers-reduced-motion:reduce){.sti-nd-img img,.sti-nd-edit{animation:none;transition:none}}
@keyframes nd-slide-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeInOut{0%{opacity:0;transform:translateX(-50%) translateY(-10px)}15%{opacity:1;transform:translateX(-50%) translateY(0)}85%{opacity:1;transform:translateX(-50%) translateY(0)}100%{opacity:0;transform:translateX(-50%) translateY(-10px)}}
`;
    document.head.appendChild(style);
}

export function buildImageHtml({ slotId, imgId, url, tags, positive, messageId, state = ImageState.PREVIEW, historyCount = 1, currentIndex = 0 }) {
    const escapedTags = escapeHtml(tags);
    const escapedPositive = escapeHtml(positive);
    const isBusy = state === ImageState.SAVING || state === ImageState.REFRESHING;
    let indicator = '';
    if (state === ImageState.SAVING) indicator = IMAGE_SAVING_INDICATOR_HTML;
    else if (state === ImageState.REFRESHING) indicator = '<div class="sti-nd-indicator"><i class="fa-solid fa-rotate" aria-hidden="true"></i> 生成中...</div>';

    const lazyAttr = String(url || '').startsWith('data:') ? '' : 'loading="lazy"';
    const displayVersion = historyCount - currentIndex;
    const navPill = `<div class="sti-nd-nav-pill" data-total="${historyCount}" data-current="${currentIndex}">
        <button class="sti-nd-nav-arrow" data-action="nav-prev" title="上一版本" ${currentIndex >= historyCount - 1 ? 'disabled' : ''}>‹</button>
        <span class="sti-nd-nav-text">${displayVersion} / ${historyCount}</span>
        <button class="sti-nd-nav-arrow" data-action="nav-next" title="${currentIndex === 0 ? '重新生成' : '下一版本'}">›</button>
    </div>`;
    const menuBusy = isBusy ? ' busy' : '';
    const menuHtml = `<div class="sti-nd-menu-wrap${menuBusy}">
        <button class="sti-nd-menu-trigger" data-action="toggle-menu" title="操作">⋮</button>
        <div class="sti-nd-dropdown">
            <button data-action="refresh-image" title="重新生成">⟳</button>
            <button data-action="view-prompt-log" title="本张图片提示词日志">日志</button>
            <button data-action="edit-tags" title="编辑TAG">✐️</button>
            <button data-action="delete-image" title="删除">✕</button>
        </div>
    </div>`;

    return `<div class="sti-nd-img ${isBusy ? 'busy' : ''}" data-slot-id="${escapeHtml(slotId)}" data-img-id="${escapeHtml(imgId)}" data-tags="${escapedTags}" data-positive="${escapedPositive}" data-mesid="${escapeHtml(messageId)}" data-state="${state}" data-current-index="${currentIndex}" data-history-count="${historyCount}" style="margin:0.8em auto;position:relative;display:block;width:fit-content;max-width:100%;border-radius:14px;padding:4px;">
${indicator}
<div class="sti-nd-img-wrap" data-total="${historyCount}">
    <img src="${escapeHtml(url)}" style="max-width:100%;width:auto;height:auto;border-radius:10px;cursor:pointer;box-shadow:0 3px 15px rgba(0,0,0,0.25);${isBusy ? 'opacity:0.5;' : ''}" data-action="open-gallery" ${lazyAttr}>
    ${navPill}
</div>
${menuHtml}
${buildTagEditor(tags, false)}
</div>`;
}

function buildTagEditor(tags, failed) {
    return `<div class="sti-nd-edit" style="display:none;${failed ? 'margin-top:12px;' : 'position:absolute;bottom:8px;left:8px;right:8px;background:rgba(0,0,0,.94);color:#fff;z-index:15;'}border-radius:10px;padding:10px;text-align:left;">
    <label data-draw-edit-label style="display:block;font-size:11px;margin-bottom:6px;">${DRAW_SLOT_COPY.editTags}</label>
    <textarea class="sti-nd-edit-input" aria-label="${DRAW_SLOT_COPY.editTags}">${escapeHtml(tags)}</textarea>
    <div class="sti-nd-edit-actions">
        <button data-action="save-tags">${DRAW_SLOT_COPY.saveTags}</button>
        ${failed ? `<button data-action="save-tags-retry">${DRAW_SLOT_COPY.saveAndRetry}</button>` : ''}
        <button data-action="cancel-edit">${DRAW_SLOT_COPY.cancelEdit}</button>
    </div>
</div>`;
}

// 未完成槽位的统一占位卡。label 由调用方按真实状态给出（等待生成 / 接回后台任务 /
// 等待重新连接…），绝不伪造进度：chat 正文里只持久化 [image:slotId] 这个排版事实，
// 状态文案永远是当前运行时和后端状态动态渲染出来的。
export function buildPendingImageHtml({ slotId, messageId, index = 0, total = 0, label = '等待生成', loading = false }) {
    const progress = total > 0 ? `${Math.max(1, Number(index) || 1)} / ${total}` : '';
    return `<div class="sti-nd-img" data-slot-id="${escapeHtml(slotId)}" data-mesid="${escapeHtml(messageId)}" data-state="pending"${loading ? ' data-sti-draw-loading' : ''} style="margin:0.8em 0;text-align:center;position:relative;display:block;width:100%;border:1px dashed rgba(212,165,116,0.4);border-radius:14px;padding:18px;background:rgba(212,165,116,0.06);color:inherit;">
<div class="sti-nd-indicator" style="position:static;transform:none;display:inline-block;">🎨 ${escapeHtml(label)}${progress ? ` · ${progress}` : ''}</div>
</div>`;
}

function getMesTextElement(messageId) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return null;
    return document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
}

export function isMessageBeingEdited(messageId) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return false;
    const mesElement = document.querySelector(`.mes[mesid="${id}"]`);
    if (!mesElement) return false;
    return mesElement.querySelector('textarea.edit_textarea') !== null || mesElement.classList.contains('editing');
}

export function isAnyMessageBeingEdited() {
    return document.querySelector('#chat .mes.editing, #chat .mes textarea.edit_textarea') !== null;
}

export function buildDrawSlotSelector(slotId) {
    const escaped = Array.from(String(slotId ?? '')).map((char) => {
        const code = char.codePointAt(0);
        if (char === '\0') return '\\fffd ';
        if ((code >= 1 && code <= 31) || code === 127) return `\\${code.toString(16)} `;
        if (char === '"' || char === '\\') return `\\${char}`;
        return char;
    }).join('');
    return `.sti-nd-img[data-slot-id="${escaped}"]`;
}

export function extractSlotIds(mes) {
    const ids = new Set();
    if (!mes) return ids;
    let match;
    const regex = createDrawImageSlotRegex();
    while ((match = regex.exec(mes)) !== null) ids.add(match[1]);
    return ids;
}

export async function getOwnedImageSlotIds(message){
    const pending=await getPendingImageJobSlots();
    const owned=new Set();
    for(const id of extractSlotIds(message?.mes)){
        if(message.extra?.sti_comfy_slots?.[id]||getDrawSavedEntry(message,id)||getSlotActivity(id)
            ||pending.has(id)||(await getPreviewsBySlot(id)).length)owned.add(id);
    }
    return owned;
}

// Project an existing text slot immediately, before gallery I/O. This is only a
// loading surface: it cannot create slots, claim requests or rebuild host text.
function mountImageSlotShells(content, messageId, message) {
    // A model can invent [image:slot-*] IDs. Do not display those as loading
    // pictures before gallery hydration proves that an actual job owns them.
    const shellFor = (slotId, options) => {
        const html = buildPendingImageHtml({ slotId, messageId, loading: true, ...options });
        const claimed = message.extra?.sti_comfy_slots?.[slotId]
            || getDrawSavedEntry(message, slotId) || getSlotActivity(slotId);
        return claimed ? html : html.replace('class="sti-nd-img"',
            'class="sti-nd-img" data-sti-unverified-slot="1"')
            .replace(/style="([^"]*)"/, 'style="$1;display:none;"');
    };
    const replacements = [...extractSlotIds(message.mes)]
        .filter(slotId => !content.querySelector(buildDrawSlotSelector(slotId)))
        .map(slotId => {
            const activity = getSlotActivity(slotId);
            return { slotId, html: shellFor(slotId, {
                label: activity?.label || DRAW_SLOT_COPY.loading,
                index: activity ? activity.index + 1 : 0, total: activity?.total || 0 }) };
        });
    replaceSceneSlotElements(content, replacements, { shouldReplaceExisting: () => false });
    // Re-entering a chat must preserve already mounted, visible inline cards.
    // Raw <hidden> text and source slot order do not describe the *rendered*
    // message after the host and other regex plugins format it. Never relocate
    // those cards solely because source markup was called hidden/out-of-order.
    let gallery=content.querySelector('[data-sti-visible-gallery]');
    const actuallyHidden=element=>{
        for(let parent=element;parent && parent!==content;parent=parent.parentElement){
            if(parent.hidden || parent.getAttribute?.('aria-hidden')==='true'
                || parent.tagName?.toLowerCase()==='status_block'
                || parent.tagName?.toLowerCase()==='template'
                || parent.style?.display==='none'||parent.style?.visibility==='hidden')return true;
            try{
                const css=parent.ownerDocument?.defaultView?.getComputedStyle?.(parent);
                if(css?.display==='none'||css?.visibility==='hidden'||css?.visibility==='collapse')return true;
            }catch{ /* Lack of computed style is not evidence of invisibility. */ }
        }
        return false;
    };
    // Keep the exact original slot ID, saved image and generated card markup.
    // A card that is visible in its original paragraph must NEVER be moved.
    let preceding=null;
    for(const slotId of extractSlotIds(message.mes)){
        let card=content.querySelector(buildDrawSlotSelector(slotId));
        // A hidden verification shell at its original marker is not a lost card:
        // moving it to the end changes scene order and can expose fake slots.
        const needsRescue=!card || (!card.hasAttribute('data-sti-unverified-slot') && actuallyHidden(card));
        if(!card){
            const holder=content.ownerDocument.createElement('template');
            holder.innerHTML=shellFor(slotId,{label:DRAW_SLOT_COPY.loading});
            card=holder.content.firstElementChild;
        }
        if(!card)continue;
        // Host regexes may drop the image marker but keep its original prose.
        // Recover next to the matching *visible* story sentence before using
        // the message-end gallery. This is a display-only recovery.
        let restored=false;
        const after=needsRescue?getImageSlotDirective(message,slotId)?.after:'';
        if(needsRescue && after){
            restored=mountImageCardAtVisibleAnchor(content,card,after);
            // Only this newly rescued card can move. Existing visible cards
            // are never reordered, even if later source metadata disagrees.
            if(restored&&preceding?.isConnected&&(preceding.compareDocumentPosition(card)&2))preceding.after(card);
        }
        if(needsRescue && !restored){
            // If the story quote is not visible, keep the generated picture
            // beside the preceding picture, without cloning or rekeying it.
            if(preceding && preceding.isConnected && !actuallyHidden(preceding)){
                preceding.after(card);
            }else{
                if(!gallery){
                    gallery=content.ownerDocument.createElement('div');
                    gallery.setAttribute('data-sti-visible-gallery','');
                    gallery.className='sti-nd-visible-gallery';
                    gallery.style.cssText='display:block;position:relative;width:100%;margin:0.7em 0;';
                    content.append(gallery);
                }
                gallery.append(card);
            }
        }
        preceding=card;
    }
}

async function persistChatSilently() {
    const ctx = getContext();
    if (!ctx?.saveChat) return;
    await Promise.resolve(ctx.saveChat());
}

function getSavedMap(message, key) {
    const savedMap = message?.extra?.[key];
    return savedMap && typeof savedMap === 'object' ? savedMap : null;
}

function ensureMessageExtra(message) {
    if (!message) return null;
    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    return message.extra;
}

function ensureSavedMap(message, key) {
    const extra = ensureMessageExtra(message);
    if (!extra) return null;
    if (!extra[key] || typeof extra[key] !== 'object') {
        extra[key] = {};
    }
    return extra[key];
}

function sanitizeSavedUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/user/images/') && !/[\s<>"']/.test(url)) return url;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
    if (/^blob:https?:\/\//i.test(url)) return url;
    return '';
}

function sanitizeImgId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
}

function normalizeDrawSavedEntry(slotId, data = {}) {
    const safeUrl = sanitizeSavedUrl(data && data.savedUrl);
    if (!slotId || !safeUrl) return null;
    return {
        slotId,
        imgId: sanitizeImgId(data.imgId),
        savedUrl: safeUrl,
        tags: data.tags || '',
        positive: data.positive || '',
        characterPrompts: data.characterPrompts ?? null,
        negativePrompt: data.negativePrompt ?? null,
        postPrompt: data.postPrompt ?? null,
        updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : 0,
    };
}

export function getDrawSavedEntry(message, slotId) {
    if (!slotId) return null;
    const current = normalizeDrawSavedEntry(slotId, getSavedMap(message, DRAW_SAVED_EXTRA_KEY)?.[slotId]);
    if (current) return current;
    const fromX = normalizeDrawSavedEntry(slotId, getSavedMap(message, 'xiaobaixDrawSaved')?.[slotId]);
    if (fromX) return fromX;
    return normalizeDrawSavedEntry(slotId, getSavedMap(message, LEGACY_NOVEL_SAVED_EXTRA_KEY)?.[slotId]);
}

export function getDrawSavedPreview(message, slotId, messageId, chatId) {
    const saved = getDrawSavedEntry(message, slotId);
    return saved ? { ...saved, imgId: saved.imgId || `saved-${slotId}`,
        messageId, chatId, characterName: message.name || '', status: PreviewStatus.SUCCESS } : null;
}

// A portable chat reference becomes a regular history version before an action
// can replace it. Editors and redraw delivery share this one materialization.
export async function materializeDrawSavedPreview(message, slotId, { messageId, chatId, expectedImgId } = {}) {
    const saved = getDrawSavedPreview(message, slotId, messageId, chatId);
    if (expectedImgId && saved?.imgId !== expectedImgId) throw new Error(DRAW_SLOT_COPY.missingRecord);
    if (!saved) return null;
    const sourceChat = getContext().chat;
    const stillSaved = () => {
        const current = getDrawSavedPreview(message, slotId, messageId, chatId);
        // Saved metadata may outlive a deletion (notably when saving then
        // switching chats). The original message/slot, including inactive
        // branches, owns archival authority; a portable URL alone does not.
        return sourceChat.includes(message) && findImageJobDeliverySlot([message], slotId)
            && current?.imgId === saved.imgId && current.savedUrl === saved.savedUrl;
    };
    if (!stillSaved()) throw new Error(DRAW_SLOT_COPY.sourceChanged);
    const existing = await getPreview(saved.imgId);
    if (!stillSaved()) throw new Error(DRAW_SLOT_COPY.sourceChanged);
    if (existing) {
        if (existing.slotId !== slotId) throw new Error(DRAW_SLOT_COPY.missingRecord);
        return existing;
    }
    await storePreview(saved);
    // Explicit deletion can finish while IndexedDB is yielding. An archive is
    // not an independent image purchase and must not resurrect that old image.
    if (!stillSaved()) {
        await deletePreview(saved.imgId);
        throw new Error(DRAW_SLOT_COPY.sourceChanged);
    }
    return saved;
}

export async function setDrawSavedEntry(messageId, slotId, data) {
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    const entry = normalizeDrawSavedEntry(slotId, {...data,updatedAt:data?.updatedAt??Date.now()});
    if (!message || !entry) return false;

    const savedMap = ensureSavedMap(message, DRAW_SAVED_EXTRA_KEY);
    if (!savedMap) return false;

    const previous = savedMap[slotId];
    const unchanged = previous &&
        previous.imgId === entry.imgId &&
        previous.savedUrl === entry.savedUrl &&
        previous.tags === entry.tags &&
        previous.positive === entry.positive &&
        previous.negativePrompt === entry.negativePrompt &&
        previous.postPrompt === entry.postPrompt &&
        JSON.stringify(previous.characterPrompts) === JSON.stringify(entry.characterPrompts);
    const legacyMap = getSavedMap(message, LEGACY_NOVEL_SAVED_EXTRA_KEY);
    const hasLegacyEntry = !!legacyMap?.[slotId];
    if (unchanged && !hasLegacyEntry) return true;

    savedMap[slotId] = entry;
    if (hasLegacyEntry) {
        delete legacyMap[slotId];
        if (Object.keys(legacyMap).length === 0) {
            delete message.extra[LEGACY_NOVEL_SAVED_EXTRA_KEY];
        }
    }
    await persistChatSilently();
    return true;
}

export async function clearDrawSavedEntry(messageId, slotId) {
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    if (!message?.extra || !slotId) return false;

    let changed = false;
    for (const key of [DRAW_SAVED_EXTRA_KEY, LEGACY_NOVEL_SAVED_EXTRA_KEY, 'xiaobaixDrawSaved']) {
        const savedMap = getSavedMap(message, key);
        if (!savedMap?.[slotId]) continue;
        delete savedMap[slotId];
        changed = true;
        if (Object.keys(savedMap).length === 0) delete message.extra[key];
    }

    if (!changed) return false;
    await persistChatSilently();
    return true;
}

export async function syncDrawSavedFromPreview(messageId, preview, overrides = {}) {
    const slotId = overrides.slotId || preview?.slotId;
    if (!slotId) return false;

    return setDrawSavedEntry(messageId, slotId, { ...preview, ...overrides });
}

export async function syncDrawSavedAfterDeletion(messageId, slotId, deletedImgId, remainingPreviews = []) {
    const message = getContext().chat?.[messageId];
    const currentSaved = getDrawSavedEntry(message, slotId);
    if (!currentSaved) return false;
    if (deletedImgId && currentSaved.imgId && currentSaved.imgId !== deletedImgId) return false;

    const replacement = remainingPreviews.find(item => item?.savedUrl);
    if (replacement) return syncDrawSavedFromPreview(messageId, replacement, { slotId });
    return clearDrawSavedEntry(messageId, slotId);
}

export function insertPreviewIntoRenderedMessage({ messageId, slotId, html }) {
    const mesTextEl = getMesTextElement(messageId);
    if (!mesTextEl || !slotId || !html) return false;
    const insertedSlotIds = replaceSceneSlotElements(mesTextEl, [{ slotId, html }]);
    if (insertedSlotIds.has(slotId)) return true;
    return mesTextEl.querySelector(buildDrawSlotSelector(slotId)) !== null;
}

async function resolveRenderPreviewForSlot(message, messageId, slotId) {
    const display = await getDisplayPreviewForSlot(slotId);
    const savedEntry = getDrawSavedPreview(message, slotId, messageId);
    // The gallery selection is the explicit choice, also after a detached
    // delivery or recovery. A chat's saved URL is only a portable fallback; it
    // must not overrule a newer choice (including a selected failed attempt).
    if (shouldUsePortableSavedImage(savedEntry,display)) {
        const previews = await getPreviewsBySlot(slotId);
        const successPreviews = previews.filter(hasPreviewImage);
        const selectedIndex = successPreviews.findIndex(p => p.imgId === savedEntry.imgId);
        const matchedPreview = selectedIndex >= 0 ? successPreviews[selectedIndex] : null;

        return {
            preview: {
                ...matchedPreview,
                slotId,
                imgId: savedEntry.imgId,
                savedUrl: savedEntry.savedUrl,
                tags: savedEntry.tags ?? matchedPreview?.tags ?? '',
                positive: savedEntry.positive ?? matchedPreview?.positive ?? '',
                messageId,
            },
            historyCount: selectedIndex >= 0 ? successPreviews.length : 1,
            currentIndex: selectedIndex >= 0 ? selectedIndex : 0,
            hasData: true,
            isFailed: false,
        };
    }

    return display;
}

// A cross-device cache miss is an explicit placeholder, never an <img src>.
// H28K is contacted only after a user presses its pull button.
export function buildRemotePullPlaceholderHtml({ slotId, imgId, messageId }) {
    return `<div class="sti-nd-img sti-nd-remote-placeholder"
        data-slot-id="${escapeHtml(slotId)}" data-img-id="${escapeHtml(imgId)}"
        data-mesid="${escapeHtml(messageId)}" data-state="remote"
        style="margin:0.8em auto;max-width:380px;border:1px dashed rgba(180,180,180,.45);border-radius:12px;padding:22px;text-align:center;">
        <div class="sti-nd-remote-body">
        <div style="margin-bottom:12px;">图片已保存在 H28K，当前设备尚未缓存</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
            <button type="button" data-action="pull-server-image"
                style="border:1px solid rgba(180,180,180,.5);border-radius:8px;padding:8px 14px;background:rgba(100,100,100,.18);color:inherit;cursor:pointer;">拉取这张</button>
            <button type="button" data-action="pull-current-chat-images"
                style="border:1px solid rgba(180,180,180,.5);border-radius:8px;padding:8px 14px;background:rgba(100,100,100,.18);color:inherit;cursor:pointer;">拉取本轮图片</button>
        </div>
        </div>
    </div>`;
}

export function buildFailedPlaceholderHtml({ slotId, imgId = '', messageId, tags, positive, errorType, errorMessage, historyCount = 0 }) {
    const escapedTags = escapeHtml(tags);
    const escapedPositive = escapeHtml(positive);
    return `<div class="sti-nd-img" data-slot-id="${escapeHtml(slotId)}" data-img-id="${escapeHtml(imgId)}" data-tags="${escapedTags}" data-positive="${escapedPositive}" data-mesid="${escapeHtml(messageId)}" data-state="failed" style="margin:0.8em 0;text-align:center;position:relative;display:block;width:100%;border:1px dashed rgba(248,113,113,0.5);border-radius:14px;padding:20px;background:rgba(248,113,113,0.05);">
<div class="sti-nd-failed-icon">⚠️</div>
<div class="sti-nd-failed-title">${escapeHtml(errorType || '生成失败')}</div>
<div class="sti-nd-failed-desc">${escapeHtml(errorMessage || '点击重试')}</div>
<div class="sti-nd-failed-btns">
    <button class="sti-nd-retry-btn" data-action="retry-image">⟳ 重新生成</button>
    <button class="sti-nd-retry-btn" data-action="retry-floor-failed" title="重新生成本楼层所有失败或结果未知的图片，已成功的不受影响">⟳ 重生本楼失败项</button>
    <button class="sti-nd-edit-btn" data-action="view-prompt-log">提示词日志</button>
    <button class="sti-nd-edit-btn" data-action="edit-tags">✐ 编辑TAG</button>
    ${historyCount > 0 ? `<button class="sti-nd-edit-btn" data-action="restore-image">${DRAW_SLOT_COPY.restoreImage}</button>` : ''}
    <button class="sti-nd-remove-btn" data-action="remove-placeholder">✕ 移除</button>
</div>
${buildTagEditor(tags, true)}
</div>`;
}

// 整条重写楼层 DOM 会销毁其它扩展（如酒馆助手）挂在 <pre> 上已渲染的 iframe，而它们只在楼层事件时才重新处理。
// 重写完成后补发 MESSAGE_UPDATED 让它们重新渲染该楼层。楼层里没有 <pre> 时没有可被渲染器挂载的对象，
// 重写不会破坏什么，就不通知，避免无谓地打扰其它监听方。
export async function notifyMessageRewritten(messageId) {
    try {
        if (!getMesTextElement(messageId)?.querySelector('pre')) return;
        const eventSource = getContext()?.eventSource;
        if (eventSource?.emit && event_types?.MESSAGE_UPDATED) {
            await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
        }
    } catch (error) {
        console.warn('[DrawCommon] 通知楼层重写失败:', error);
    }
}

async function rebuildRenderedMessageFromState(messageId, {
    chatId,
    expectedMessage,
} = {}) {
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    if (!message || (chatId !== undefined && String(ctx.chatId || '') !== String(chatId || ''))
        || (expectedMessage && message !== expectedMessage) || isMessageBeingEdited(messageId)) return false;
    const { messageFormatting } = await import('/script.js');
    const live = getContext();
    if (String(live.chatId || '') !== String(ctx.chatId || '')
        || live.chat?.[messageId] !== message || isMessageBeingEdited(messageId)) return false;
    const mesTextEl = getMesTextElement(messageId);
    if (!mesTextEl) return false;
    // Image markers are not Markdown links and must retain their exact source
    // position. Protect each marker before formatting, restore as plain text,
    // then replace each with its own DOM image card. Never mutate message.mes.
    const protectedSlots = protectDrawImageMarkers(stripDrawImageDirectives(message.mes));
    const formatted = messageFormatting(
        protectedSlots.text,
        message.name,
        message.is_system,
        message.is_user,
        messageId,
    );
    // Host-generated message markup.
    // eslint-disable-next-line no-unsanitized/property
    mesTextEl.innerHTML = formatted;
    restoreDrawImageMarkers(mesTextEl, protectedSlots.markers);
    mountImageSlotShells(mesTextEl, messageId, message);
    await notifyMessageRewritten(messageId);
    return true;
}

async function renderPreviewsForMessageNow(messageId, {
    refreshSlotIds = [],
    expectedChatId,
    expectedMessage,
    content,
    signal,
} = {}) {
    if (signal?.aborted) return;
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    if (!message?.mes
        || String(ctx.chatId || '') !== String(expectedChatId || '')
        || message !== expectedMessage) return;

    const sourceText = message.mes;
    const swipeIndex = message.swipe_id ?? 0;
    const slotIds = extractSlotIds(sourceText);
    const mesTextEl = getMesTextElement(messageId);
    if (!mesTextEl || (content && content !== mesTextEl)) return;
    // Projection observes the host's DOM, including filtered/hidden markers.
    // Only an explicit text commit may request a whole-message rebuild.
    const renderedSlots = getRenderedSceneSlotIds(mesTextEl);
    // Other extensions may intentionally hide source markers. Only our explicit
    // text synchronization rebuilds the message, with marker protection enabled.
    const refreshSlots = new Set((Array.isArray(refreshSlotIds) ? refreshSlotIds : [])
        .map(slotId => String(slotId || '').trim())
        .filter(Boolean));
    for (const slotId of refreshSlots) {
        if (!slotIds.has(slotId)) mesTextEl.querySelector(buildDrawSlotSelector(slotId))?.remove();
    }
    if (slotIds.size === 0) return;

    const replacements = [];
    // 待接回的后台任务槽位：只在真的需要判定时读一次，避免每条消息都白跑一次 IndexedDB。
    let pendingSlotsPromise = null;
    const resolvePendingSlot = async (slotId) => {
        pendingSlotsPromise ??= getPendingImageJobSlots();
        return (await pendingSlotsPromise).get(slotId) || null;
    };
    for (const slotId of slotIds) {
        if (!renderedSlots.has(slotId)) continue;
        const existing = mesTextEl.querySelector(buildDrawSlotSelector(slotId));
        if (!refreshSlots.has(slotId) && existing && !existing.hasAttribute('data-sti-draw-loading')) continue;
        let replacementHtml, imageHtml;
        try {
            let displayData = await resolveRenderPreviewForSlot(message, messageId, slotId);
            const activity = getSlotActivity(slotId);
            const pendingSlot = await resolvePendingSlot(slotId);
            const savedEntry = getDrawSavedEntry(message,slotId);
            const slotIdentity=message.extra?.sti_comfy_slots?.[slotId];
            const portable=getImageSlotRecord(message,slotId);
            if(!displayData.hasData&&!displayData.isFailed&&portable){
                displayData={...displayData,isFailed:true,preview:portable,failedInfo:portable};
            }
            if (isUnclaimedImageSlot({savedEntry,activity,pendingSlot,displayData,slotIdentity})) {
                // Render-only suppression. Do not alter any original chat text;
                // a later genuine job will re-activate its slot automatically.
                replacements.push({ slotId, removeOrphan:true });
                continue;
            }
            if (activity || pendingSlot || displayData.isFailed) {
                const versions = displayData.hasData ? [] : await getPreviewsBySlot(slotId);
                const visibleUrl = existing?.querySelector('img')?.getAttribute('src');
                const retained = displayData.hasData ? displayData.preview
                    : versions.find(item => hasPreviewImage(item) && getPreviewDisplayUrl(item) === visibleUrl)
                        ?? versions.find(hasPreviewImage)
                        ?? getDrawSavedPreview(message, slotId, messageId, String(ctx.chatId));
                if (retained && hasPreviewImage(retained)) imageHtml = buildImageHtml({ slotId, imgId: retained.imgId,
                    url: getPreviewDisplayUrl(retained), tags: retained.tags || '', positive: retained.positive || '',
                    messageId, state: retained.savedUrl ? ImageState.SAVED : ImageState.PREVIEW });
            }
            if (activity || pendingSlot) {
                replacementHtml = buildPendingImageHtml({
                    slotId,
                    messageId,
                    index: (activity || pendingSlot).index + 1,
                    total: (activity || pendingSlot).total,
                    label: activity?.label || (pendingSlot.state === PendingJobState.CANCELLING ? '正在取消' : DRAW_SLOT_COPY.generating),
                });
            } else if (displayData.isFailed) {
                const interrupted = displayData.isPending
                    ? (displayData.preview?.status === PreviewStatus.UNKNOWN
                        ? DRAW_SLOT_ERRORS.unknown : DRAW_SLOT_ERRORS.interrupted) : null;
                replacementHtml = buildFailedPlaceholderHtml({
                    slotId,
                    imgId: displayData.preview?.imgId,
                    historyCount: displayData.historyCount,
                    messageId,
                    tags: displayData.failedInfo?.tags || '',
                    positive: displayData.failedInfo?.positive || '',
                    errorType: interrupted?.label || displayData.failedInfo?.errorType || ErrorType.CACHE_LOST.label,
                    errorMessage: interrupted?.desc || displayData.failedInfo?.errorMessage || ErrorType.CACHE_LOST.desc,
                });
            } else if (displayData.hasData && displayData.preview) {
                // A saved H28K URL is already an actual image. Display it
                // directly in the chat on every device; do not require a
                // manual sync step for an image that has already been saved.
                // The URL is validated by the saved-entry normalizer.

                const url = getPreviewDisplayUrl(displayData.preview);
                replacementHtml = buildImageHtml({
                    slotId,
                    imgId: displayData.preview.imgId,
                    url,
                    tags: displayData.preview.tags || '',
                    positive: displayData.preview.positive || '',
                    messageId,
                    state: displayData.preview.savedUrl ? ImageState.SAVED : ImageState.PREVIEW,
                    historyCount: displayData.historyCount,
                    currentIndex: displayData.currentIndex ?? 0,
                });
                void warmSlotPreviewNeighbors(slotId, displayData.currentIndex ?? 0).catch(() => {});
            } else if(slotIdentity){
                replacementHtml=buildFailedPlaceholderHtml({slotId,messageId,
                    errorType:'未找到可恢复的图片记录',errorMessage:'槽位尚在，但本设备没有完整图片输入或任务记录。请检查服务器保存记录，不能把它视为正在生成。'});
            } else {
                // A saved image on another device cannot be downloaded unless
                // the chat itself carries the H28K file reference.
                // Never promise a pull button if no server URL exists.
                replacementHtml = buildFailedPlaceholderHtml({
                    slotId,
                    messageId,
                    tags: '',
                    positive: '',
                    errorType: '当前设备没有可同步图片',
                    errorMessage: '此图片位置没有 H28K 保存地址：可能尚未生成，或图片只保存在其他设备的缓存中。请先在有图的设备上保存到酒馆，再刷新本设备；也可以重新生成。',
                });
            }
        } catch (error) {
            console.error(`[DrawCommon] 渲染 ${slotId} 失败:`, error);
            replacements.push({ slotId, error });
            continue;
        }
        replacements.push({ slotId, html: replacementHtml, imageHtml });
    }

    if (replacements.length === 0) return;
    const isMounted = () => {
        const live = getContext();
        return !(signal?.aborted || String(live.chatId || '') !== String(ctx.chatId || '')
        || live.chat?.[messageId] !== message
        || (message.swipe_id ?? 0) !== swipeIndex
        || getMesTextElement(messageId) !== mesTextEl
        || isMessageBeingEdited(messageId));
    };
    const isCurrent = () => isMounted() && message.mes === sourceText;
    if (!isCurrent()) return;
    for (const replacement of replacements) {
        const card = mesTextEl.querySelector(buildDrawSlotSelector(replacement.slotId));
        if (!card) continue;
        if(replacement.removeOrphan) {
            card.remove();
            continue;
        }
        const retry = () => {
            // A continuation invalidates the old snapshot, not this mounted
            // slot. Re-read current facts; never let the stale load paint them.
            if (isMounted() && extractSlotIds(message.mes).has(replacement.slotId)) {
                void renderPreviewsForMessage(messageId, { refreshSlotIds: [replacement.slotId], content: mesTextEl, signal })
                    .catch(error => console.error(DRAW_SLOT_COPY.renderFailed, error));
            }
        };
        if (replacement.error) reportImageCardReadError(card, replacement.error, retry);
        else patchImageCard(card, replacement, { isCurrent, retry });
    }
}

// 同一楼层只允许一个异步投影在运行。图片落库、恢复状态变化和消息事件可能在同一时刻
// 发起刷新；串行执行保证较早读取的旧事实一定先完成，最后留在 DOM 的总是较新的投影。
// 队列只绑定当前 message 对象，聊天切换或宿主替换消息对象后，旧任务会被上面的身份守卫丢弃。
export function renderPreviewsForMessage(messageId, { refreshSlotIds = [], content, signal } = {}) {
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    if (!message?.mes) return Promise.resolve();
    const expectedChatId = ctx.chatId;

    const root = getMesTextElement(messageId);
    if (!signal?.aborted && root && (!content || content === root) && !isMessageBeingEdited(messageId)) {
        mountImageSlotShells(root, messageId, message);
    }

    let queue = drawPreviewRenderQueues.get(message);
    if (!queue) {
        queue = { tail: Promise.resolve() };
        drawPreviewRenderQueues.set(message, queue);
    }
    const requestedSlots = Array.isArray(refreshSlotIds) ? [...refreshSlotIds] : [];
    const render = queue.tail.then(() => renderPreviewsForMessageNow(messageId, {
        refreshSlotIds: requestedSlots,
        expectedChatId,
        expectedMessage: message,
        content,
        signal,
    }));
    const tail = render.catch(() => {});
    queue.tail = tail;
    void tail.then(() => {
        if (queue.tail === tail) drawPreviewRenderQueues.delete(message);
    });
    return render;
}

// Draw Run adoption 会在酒馆完成楼层渲染之后才把 slots 写进 message.mes。
// 仅替换已有 DOM 锚点不够，必须先按宿主规则重建活动楼层，再把 slots 渲染成 pending/图片卡。
export async function syncRenderedMessageFromState(messageId, { chatId, expectedMessage, insertedSlotIds = [] } = {}) {
    // A validated placement commit may already have synchronously handed its
    // slots to the mounted chat view. Do not format that content a second time.
    const ctx = getContext();
    const rendered = getRenderedSceneSlotIds(getMesTextElement(messageId));
    if (insertedSlotIds.length && insertedSlotIds.every(id => rendered.has(id))) {
        if (String(ctx.chatId) !== String(chatId) || ctx.chat?.[messageId] !== expectedMessage) return false;
        await renderPreviewsForMessage(messageId);
        return true;
    }
    const rebuilt = await rebuildRenderedMessageFromState(messageId, { chatId, expectedMessage });
    if (!rebuilt) return false;
    await renderPreviewsForMessage(messageId);
    return true;
}

function initDrawPreviewMessageObserver() {
    if (drawPreviewMessageObserver) return;
    drawPreviewMessageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const mesEl = entry.target;
            drawPreviewMessageObserver.unobserve(mesEl);
            delete mesEl.dataset.ndLazyObserved;
            const messageId = parseInt(mesEl.getAttribute('mesid'), 10);
            if (!Number.isNaN(messageId)) {
                renderPreviewsForMessage(messageId);
            }
        });
    }, { rootMargin: '600px 0px', threshold: 0.01 });
}

function observeMessageForDrawPreviewLazyRender(messageId) {
    const mesEl = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (!mesEl || mesEl.dataset.ndLazyObserved === '1') return;
    initDrawPreviewMessageObserver();
    mesEl.dataset.ndLazyObserved = '1';
    drawPreviewMessageObserver.observe(mesEl);
}

function isMessageNearViewport(mesEl) {
    if (!mesEl) return false;
    const root = document.getElementById('chat');
    const rootRect = root?.getBoundingClientRect?.() || { top: 0, bottom: window.innerHeight || 0 };
    const rect = mesEl.getBoundingClientRect();
    return rect.bottom >= rootRect.top - 600 && rect.top <= rootRect.bottom + 600;
}

function cleanupDrawPreviewMessageObserver() {
    if (drawPreviewMessageObserver) {
        drawPreviewMessageObserver.disconnect();
        drawPreviewMessageObserver = null;
    }
    document.querySelectorAll('[data-nd-lazy-observed="1"]').forEach(el => {
        delete el.dataset.ndLazyObserved;
    });
}

export async function renderAllDrawPreviews() {
    const ctx = getContext();
    const chat = ctx.chat || [];
    let rendered = 0;

    for (let i = chat.length - 1; i >= 0; i--) {
        if (extractSlotIds(chat[i]?.mes).size === 0) continue;
        const mesEl = document.querySelector(`.mes[mesid="${i}"]`);
        if (rendered < INITIAL_RENDER_MESSAGE_LIMIT || isMessageNearViewport(mesEl)) {
            await renderPreviewsForMessage(i);
            rendered++;
        } else {
            observeMessageForDrawPreviewLazyRender(i);
        }
    }
}

function clearPendingDrawPreviewTimers() {
    for (const timer of drawPreviewPendingTimers) {
        clearTimeout(timer);
    }
    drawPreviewPendingTimers.clear();
}

function scheduleRenderAllDrawPreviews(delay = 150) {
    const generation = drawPreviewRuntimeGeneration;
    const timer = setTimeout(() => {
        drawPreviewPendingTimers.delete(timer);
        if (!drawPreviewRuntimeEvents || generation !== drawPreviewRuntimeGeneration) return;
        cleanupDrawPreviewMessageObserver();
        void renderAllDrawPreviews();
    }, delay);
    drawPreviewPendingTimers.add(timer);
}

function handleDrawPreviewMessageRendered(data) {
    const messageId = typeof data === 'number' ? data : data?.messageId ?? data?.mesId;
    if (messageId !== undefined) void renderPreviewsForMessage(messageId);
}

function handleDrawPreviewMessageModified(data) {
    const raw = typeof data === 'object' ? (data?.messageId ?? data?.mesId) : data;
    const messageId = parseInt(raw, 10);
    if (Number.isNaN(messageId)) return;
    setTimeout(() => {
        void renderPreviewsForMessage(messageId);
    }, 100);
}

function handleGalleryCacheChanged({ slotIds } = {}) {
    const changedSlots = slotIds === null ? null : new Set(Array.isArray(slotIds) ? slotIds : []);
    if (changedSlots && changedSlots.size === 0) return;
    const chat = getContext().chat || [];
    for (let messageId = 0; messageId < chat.length; messageId++) {
        const messageSlots = extractSlotIds(chat[messageId]?.mes);
        const refreshSlotIds = changedSlots
            ? [...messageSlots].filter(slotId => changedSlots.has(slotId))
            : [...messageSlots];
        if (refreshSlotIds.length > 0) {
            void renderPreviewsForMessage(messageId, { refreshSlotIds });
        }
    }
}

export async function pullOneRemoteImage(messageId, slotId, { signal } = {}) {
    const ctx = getContext();
    const chatId = String(ctx?.chatId || '');
    const message = ctx?.chat?.[messageId];
    if (!message || !extractSlotIds(message.mes).has(slotId)) {
        throw new Error('当前图片占位已不存在');
    }
    const saved = getDrawSavedPreview(message, slotId, messageId, chatId);
    if (!saved?.savedUrl) throw new Error('这张图片没有 H28K 保存地址');
    const existing = await getPreview(saved.imgId);
    if (existing?.base64) {
        await renderPreviewsForMessage(messageId, { refreshSlotIds: [slotId] });
        return false;
    }
    await pullServerImageManually(saved, { signal });
    // Never project an old conversation's image onto a newly opened chat.
    const current = getContext();
    if (String(current.chatId || '') === chatId && current.chat?.[messageId] === message
        && extractSlotIds(message.mes).has(slotId)) {
        await renderPreviewsForMessage(messageId, { refreshSlotIds: [slotId] });
    }
    return true;
}

function handleManualRemoteImageClick(event) {
    const button = event.target?.closest?.('button[data-action="pull-server-image"], button[data-action="pull-current-chat-images"]');
    if (!button || !button.closest('.sti-nd-remote-placeholder')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    if (button.dataset.action === 'pull-current-chat-images') {
        void pullCurrentChatImages(button);
        return;
    }
    const card = button.closest('.sti-nd-img');
    const messageId = Number(card?.dataset.mesid);
    const slotId = String(card?.dataset.slotId || '');
    if (!Number.isSafeInteger(messageId) || messageId < 0 || !slotId) return;
    button.disabled = true;
    button.textContent = '正在拉取…';
    void pullOneRemoteImage(messageId, slotId).then(() => {
        if (button.isConnected) button.textContent = '已拉取';
    }).catch(error => {
        if (!button.isConnected) return;
        button.textContent = '拉取失败，点击重试';
        button.title = String(error?.message || '请求失败').slice(0, 110);
    }).finally(() => { button.disabled = false; });
}

export async function pullCurrentChatImages(button) {
    if (!button) return;
    if (manualChatPullController) {
        manualChatPullController.abort();
        return;
    }
    const controller = new AbortController();
    manualChatPullController = controller;
    const ctx = getContext();
    const chatId = String(ctx?.chatId || '');
    const pending = [];
    for (const [messageId, message] of (ctx?.chat || []).entries()) {
        for (const slotId of extractSlotIds(message?.mes)) {
            const saved = getDrawSavedPreview(message, slotId, messageId, chatId);
            if (saved?.savedUrl) pending.push({ messageId, slotId, imgId: saved.imgId });
        }
    }
    let done = 0, skipped = 0, failed = 0;
    try {
        for (const entry of pending) {
            if (controller.signal.aborted || String(getContext().chatId || '') !== chatId) break;
            button.textContent = '停止拉取 ' + (done + skipped + failed) + '/' + pending.length;
            button.title = '再次点击可停止拉取；只处理当前聊天的服务器图片';
            const current = getContext();
            const message = current.chat?.[entry.messageId];
            const saved = getDrawSavedPreview(message, entry.slotId, entry.messageId, chatId);
            if (!saved?.savedUrl || saved.imgId !== entry.imgId) { skipped++; continue; }
            try {
                const cached = await getPreview(saved.imgId);
                if (cached?.base64) { skipped++; continue; }
                await pullOneRemoteImage(entry.messageId, entry.slotId, { signal: controller.signal });
                done++;
            } catch (error) {
                if (controller.signal.aborted) break;
                failed++;
                console.warn('[ComfyDraw] Manual image pull failed:', String(error?.message || '').slice(0, 110));
            }
        }
        if (controller.signal.aborted) globalThis.toastr?.info('已停止拉取本轮图片');
        else globalThis.toastr?.info('本轮图片拉取完成：新下载 ' + done + '，本地已有/跳过 '
            + skipped + (failed ? '，失败 ' + failed : ''));
    } finally {
        manualChatPullController = null;
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = '拉取本轮图片';
            button.title = '手动拉取当前聊天里尚未缓存在本设备的图片';
        }
    }
}

function installManualImagePullControls() {
    if (typeof document === 'undefined') return;
    // The global toolbar action was removed; the batch action belongs only
    // to a missing-image card. Also remove any stale toolbar button.
    document.getElementById('sti-pull-current-chat-images')?.remove();
    if (!manualRemotePullClickListener) {
        manualRemotePullClickListener = handleManualRemoteImageClick;
        document.addEventListener('click', manualRemotePullClickListener, true);
    }
}

function uninstallManualImagePullControls() {
    manualChatPullController?.abort();
    manualChatPullController = null;
    document.getElementById('sti-pull-current-chat-images')?.remove();
    if (manualRemotePullClickListener) {
        document.removeEventListener('click', manualRemotePullClickListener, true);
        manualRemotePullClickListener = null;
    }
}

export function startSharedDrawPreviewRuntime() {
    drawPreviewRuntimeRefs++;
    if (drawPreviewRuntimeEvents) return;

    drawPreviewRuntimeGeneration++;
    drawPreviewRuntimeEvents = createModuleEvents('drawPreviewRuntime');
    drawPreviewRuntimeEvents.on(event_types.CHARACTER_MESSAGE_RENDERED, handleDrawPreviewMessageRendered);
    drawPreviewRuntimeEvents.on(event_types.USER_MESSAGE_RENDERED, handleDrawPreviewMessageRendered);
    drawPreviewRuntimeEvents.on(event_types.CHAT_CHANGED, () => scheduleRenderAllDrawPreviews(150));
    drawPreviewRuntimeEvents.on(event_types.MORE_MESSAGES_LOADED, () => scheduleRenderAllDrawPreviews(150));
    drawPreviewRuntimeEvents.on(event_types.MESSAGE_EDITED, handleDrawPreviewMessageModified);
    drawPreviewRuntimeEvents.on(event_types.MESSAGE_UPDATED, handleDrawPreviewMessageModified);
    drawPreviewRuntimeEvents.on(event_types.MESSAGE_SWIPED, handleDrawPreviewMessageModified);
    drawPreviewCacheSyncCleanup = subscribeGalleryCacheChanges(handleGalleryCacheChanged);
    installManualImagePullControls();

    setTimeout(() => {
        if (!drawPreviewRuntimeEvents) return;
        void renderAllDrawPreviews();
    }, 300);
}

export function stopSharedDrawPreviewRuntime() {
    drawPreviewRuntimeRefs = Math.max(0, drawPreviewRuntimeRefs - 1);
    if (drawPreviewRuntimeRefs > 0) return;

    drawPreviewRuntimeEvents?.cleanup();
    drawPreviewRuntimeEvents = null;
    drawPreviewCacheSyncCleanup?.();
    drawPreviewCacheSyncCleanup = null;
    uninstallManualImagePullControls();
    drawPreviewRuntimeGeneration++;
    clearPendingDrawPreviewTimers();
    cleanupDrawPreviewMessageObserver();
}
