import { extension_settings } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../../script.js';
import { ComfyDrawStorage } from '../runtime/core/server-storage.js';
import { initComfyDraw, cleanupComfyDraw } from '../runtime/modules/draw/providers/comfyui/comfy-draw.js';
import { setupDrawGenerateInterceptor, cleanupDrawGenerateInterceptor } from '../runtime/modules/draw/shared/draw-common.js';
import { startGroupPresetWatcher, stopGroupPresetWatcher } from '../runtime/modules/draw/shared/character-group-presets-runtime.js';
import { startImageJobRecovery, stopImageJobRecovery } from '../runtime/modules/draw/shared/image-job-recovery-runtime.js';
import { initChatMessageImages, cleanupChatMessageImages } from '../runtime/modules/draw/shared/chat-message-images.js';
import { installDrawFacade } from './draw-facade.mjs';
import { getCurrentUserHandle } from '/scripts/user.js';
import { configurePendingImageJobOwner } from '../runtime/modules/draw/shared/pending-image-jobs.js';

configurePendingImageJobOwner(getCurrentUserHandle);

let started = false;
let starting = null;
const cleanups = new Map();
window.isStImageEnabled = false;
window.registerStImageCleanup = (key, cleanup) => cleanups.set(key, cleanup);
installDrawFacade();

async function start() {
  if (started) return true;
  if (starting) return starting;
  starting = (async () => {
    try {
      const saved = await ComfyDrawStorage.getStrict('config', null);
      if (!saved) {
        const old = extension_settings.sillytavernImage || {};
        const defaults = { host: String(old.host || ''), mode: 'manual', connectionMode: 'proxy' };
        if (!await ComfyDrawStorage.setAndSave('config', defaults, { silent: true })) throw new Error('独立绘图配置保存失败');
      }
      window.isStImageEnabled = true;
      if (!await initComfyDraw()) throw new Error('独立绘图初始化失败，请检查日志');
      setupDrawGenerateInterceptor({ shouldStrip: () => window.isStImageEnabled });
      startGroupPresetWatcher();
      startImageJobRecovery();
      initChatMessageImages();
      started = true;
      console.log('[独立绘图] 已启动');
      return true;
    } catch (error) {
      stop();
      console.error('[独立绘图] 启动失败:', error);
      return false;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

function stop() {
  window.isStImageEnabled = false;
  cleanupChatMessageImages();
  stopImageJobRecovery();
  stopGroupPresetWatcher();
  cleanupDrawGenerateInterceptor();
  cleanupComfyDraw();
  cleanups.clear();
  started = false;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void start(); }, { once: true });
} else {
  void start();
}
eventSource?.once?.(event_types.APP_READY, () => { void start(); });
