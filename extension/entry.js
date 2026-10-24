import { extension_settings } from '../../../../extensions.js';
import { getRequestHeaders, eventSource, event_types } from '../../../../../script.js';
import { ComfyDrawStorage } from '../runtime/core/server-storage.js';
import { initComfyDraw, cleanupComfyDraw, openSettings, updateSettingsPersistent, applyComfyDrawRunAutoLearn } from '../runtime/modules/draw/providers/comfyui/comfy-draw.js';
import { setupDrawGenerateInterceptor, cleanupDrawGenerateInterceptor } from '../runtime/modules/draw/shared/draw-common.js';
import { startGroupPresetWatcher, stopGroupPresetWatcher } from '../runtime/modules/draw/shared/character-group-presets-runtime.js';
import { startImageJobRecovery, stopImageJobRecovery } from '../runtime/modules/draw/shared/image-job-recovery-runtime.js';
import { initChatMessageImages, cleanupChatMessageImages } from '../runtime/modules/draw/shared/chat-message-images.js';
import { openDB } from '../runtime/modules/draw/shared/gallery-cache.js';
import { installDrawFacade } from './draw-facade.mjs';
import { legacyDrawIsActive, copyLegacyGallery } from './compat.mjs';

let started = false;
let starting = null;
let refreshRequired = false;
const cleanups = new Map();
window.isStImageEnabled = false;
window.registerStImageCleanup = (key, cleanup) => cleanups.set(key, cleanup);
installDrawFacade();

function status(text) { document.getElementById('sti-home-status').textContent = text; }
async function readIdentityPreset() {
  const response = await fetch(new URL('../server-plugin/workflows/krea2-identity-api.json', import.meta.url));
  if (!response.ok) throw new Error('无法读取内置锁脸工作流');
  return { id: 'sti-krea2-identity-4-1024-8', name: 'Krea2锁脸 · 力度4 · 1024 · 对齐 · 8步提速',
    json: JSON.stringify(await response.json(), null, 2), nodePositive: '84', nodeNegative: '',
    nodeWidth: '82', nodeHeight: '82', nodeSeed: '53', nodeSaveImage: '29' };
}
function addIdentityPreset(settings, preset, select = false) {
  settings.workflowPresets ||= [];
  if (!settings.workflowPresets.some(item => item.id === preset.id)) settings.workflowPresets.push(preset);
  if (select) {
    settings.selectedWorkflowPresetId = preset.id;
    settings.workflowMode = 'custom';
    settings.presets ||= [{ id: 'default', name: '默认', width: 768, height: 1152, steps: 8, cfg: 1 }];
    settings.selectedPresetId ||= settings.presets[0].id;
  }
  return settings;
}
async function start() {
  if (refreshRequired) { status('配置已复制，请刷新页面后使用独立绘图。'); return false; }
  if (started) return true;
  if (legacyDrawIsActive(window)) {
    status('小白X的绘图功能仍在运行。请先在小白X中关闭绘图，再点击“启动独立绘图”；其他功能可以继续使用。');
    return false;
  }
  if (starting) return starting;
  starting = (async () => {
    try {
      const saved = await ComfyDrawStorage.getStrict('config', null);
      if (!saved) {
        const old = extension_settings.sillytavernImage || {};
        const defaults = addIdentityPreset({ host: String(old.host || ''), mode: 'manual', connectionMode: 'proxy' }, await readIdentityPreset(), true);
        if (!await ComfyDrawStorage.setAndSave('config', defaults, { silent: true })) throw new Error('独立绘图配置保存失败');
      }
      window.isStImageEnabled = true;
      if (!await initComfyDraw()) throw new Error('独立绘图初始化失败，请检查日志');
      setupDrawGenerateInterceptor({ shouldStrip: () => window.isStImageEnabled });
      startGroupPresetWatcher();
      startImageJobRecovery({ providerAdoptionEffects: { comfyui: applyComfyDrawRunAutoLearn } });
      initChatMessageImages();
      started = true;
      status('独立绘图已启动。角色、剧情规划、图片管理和任务恢复均使用独立版。');
      return true;
    } catch (error) {
      stop(); status(error.message); return false;
    } finally { starting = null; }
  })();
  return starting;
}
function stop() {
  window.isStImageEnabled = false;
  cleanupChatMessageImages(); stopImageJobRecovery(); stopGroupPresetWatcher(); cleanupDrawGenerateInterceptor();
  cleanupComfyDraw(); cleanups.clear(); started = false;
}
function init() {
  if (document.getElementById('sti-home')) return;
  const root = document.createElement('div'); root.id = 'sti-home';
  root.innerHTML = '<button id="sti-home-toggle" type="button">独立绘图</button>' +
    '<section id="sti-home-panel" hidden aria-label="独立绘图">' +
    '<header><strong>独立定制绘图</strong><button id="sti-home-close" type="button" aria-label="关闭">×</button></header>' +
    '<p id="sti-home-status" role="status">正在启动…</p><div class="sti-home-actions">' +
    '<button id="sti-home-open" type="button">打开绘图设置</button>' +
    '<button id="sti-home-start" type="button">启动独立绘图</button>' +
    '<button id="sti-home-import" type="button">从小白X复制绘图配置和本机图库</button>' +
    '<button id="sti-home-identity" type="button">使用已测试的8步锁脸预设</button>' +
    '<button id="sti-home-manual" type="button">打开原版手动面板</button></div>' +
    '<small>绘图模块基于 <a href="https://github.com/RT15548/LittleWhiteBox" target="_blank" rel="noopener noreferrer" title="Based on LittleWhiteBox by biex">小白X（LittleWhiteBox），作者 biex</a></small></section>';
  document.body.append(root);
  const panel = root.querySelector('#sti-home-panel');
  root.querySelector('#sti-home-toggle').onclick = () => { panel.hidden = !panel.hidden; };
  root.querySelector('#sti-home-close').onclick = () => { panel.hidden = true; };
  function action(id, task) {
    const button=root.querySelector(id);
    button.onclick=async()=>{ button.disabled=true; try{await task();}catch(error){status(error.message);}finally{button.disabled=false;} };
  }
  action('#sti-home-start', start);
  action('#sti-home-open', async () => { if (await start()) await openSettings(); });
  action('#sti-home-identity', async () => {
    if (!await start()) return;
    const preset = await readIdentityPreset();
    if (!await updateSettingsPersistent(settings => addIdentityPreset(settings, preset, true), '已选择8步锁脸预设')) throw new Error('预设保存失败');
    status('已选择力度4、1024、对齐、8步提速。请在角色库添加参考照片，并核对生图服务地址。');
  });
  action('#sti-home-import', async () => {
    if (legacyDrawIsActive(window)) throw new Error('请先关闭小白X的绘图功能，等待原任务完成后再复制配置');
    if (!window.confirm('将复制当前酒馆用户的小白X绘图配置、角色库和规划模型设置，以及当前浏览器的旧图库。当前独立配置会先备份，原小白X文件保留。请确认原绘图任务已完成。')) return;
    stop();
    const response = await fetch('/api/plugins/sillytavern-image-server/v1/migrate-x', {
      method:'POST', headers:{...getRequestHeaders(),'Content-Type':'application/json'}, body:'{}', credentials:'same-origin',
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || '配置复制失败');
    refreshRequired = true;
    const count = await copyLegacyGallery(indexedDB, await openDB());
    status('已复制' + result.imported.length + '项配置和' + count + '张图库记录。原数据保留，请刷新页面后使用独立绘图。');
    root.querySelector('#sti-home-start').disabled=true;
    root.querySelector('#sti-home-open').disabled=true;
    root.querySelector('#sti-home-identity').disabled=true;
  });
  action('#sti-home-manual', async () => { await import('./index.js'); document.querySelector('#sti-launcher')?.click(); });
  void start();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
eventSource?.once?.(event_types.APP_READY, () => { void start(); });
