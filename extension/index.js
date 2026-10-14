import { extension_settings, getContext } from '../../../../extensions.js';
import { saveSettingsDebounced, getRequestHeaders } from '../../../../../script.js';
import { API_ROOT, DEFAULT_SETTINGS, normalizedSettings, chatCharacter, latestMessageText, generationPayload } from './settings.mjs';

const KEY = 'sillytavernImage';
let settings;
let busy = false;
let root;

function persist() {
  extension_settings[KEY] = settings;
  saveSettingsDebounced();
}
function $(id) { return root.querySelector('#' + id); }
function message(text, bad = false) {
  const el = $('sti-status');
  el.textContent = String(text || '');
  el.classList.toggle('sti-error', bad);
}
async function call(route, body, timeout = 210000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(API_ROOT + route, {
      method: 'POST',
      headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || '服务器响应异常：' + response.status);
    return result;
  } finally { clearTimeout(timer); }
}
function photoUrl(id) {
  return API_ROOT + '/v1/photos/' + encodeURIComponent(id);
}
function currentCharacter() {
  return chatCharacter(getContext());
}
function assignInputs() {
  for (const key of ['host', 'model', 'clip', 'vae', 'negative', 'width', 'height', 'steps']) {
    const el = $('sti-' + key);
    el.value = settings[key] ?? '';
    el.addEventListener('change', () => {
      settings[key] = el.type === 'number' ? Number(el.value) : el.value;
      persist();
    });
  }
  for (const key of ['useReference', 'useAvatarFallback', 'useLastMessage']) {
    const el = $('sti-' + key);
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      persist();
    });
  }
  for (const key of ['positive', 'negative', 'seed', 'size', 'save']) {
    const el = $('sti-map-' + key);
    el.value = settings.nodeMap[key] || '';
    el.addEventListener('change', () => { settings.nodeMap[key] = el.value.trim(); persist(); });
  }
  $('sti-mode').addEventListener('change', () => { settings.mode = $('sti-mode').value; persist(); updatePreset(); });
  $('sti-custom').addEventListener('change', () => {
    settings.selectedCustomId = $('sti-custom').value; persist();
  });
  $('sti-load-chat').addEventListener('click', () => {
    $('sti-prompt').value = latestMessageText(getContext());
    message('已读取最新聊天内容，请检查提示词是否适合直接生图。');
  });
  $('sti-save').addEventListener('click', () => {
    for (const key of ['host','model','clip','vae','negative']) settings[key] = $('sti-' + key).value;
    for (const key of ['width','height','steps']) settings[key] = Number($('sti-' + key).value);
    persist(); message('设置已保存到酒馆当前用户。');
  });
  $('sti-check').addEventListener('click', async () => {
    message('正在检测 ComfyUI 连接…');
    try {
      const result = await call('/v1/check', { host: $('sti-host').value }, 14000);
      message(result.ok ? '连接成功，ComfyUI 已响应。' : '已响应，但状态不完整。', !result.ok);
    } catch (error) { message(error.message, true); }
  });
  $('sti-import').addEventListener('change', importWorkflow);
  $('sti-photo').addEventListener('change', uploadPhoto);
  $('sti-generate').addEventListener('click', generate);
  $('sti-close').addEventListener('click', close);
  $('sti-launcher').addEventListener('click', open);
  $('sti-download').addEventListener('click', event => {
    if (!$('sti-output').src) event.preventDefault();
  });
  updatePreset();
}
function updatePreset() {
  $('sti-mode').value = settings.mode;
  const select = $('sti-custom');
  select.replaceChildren();
  for (const preset of settings.customPresets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    select.append(option);
  }
  select.value = settings.selectedCustomId;
  $('sti-custom-settings').hidden = settings.mode !== 'custom';
  $('sti-krea-settings').hidden = settings.mode === 'custom';
}
function updatePhotoPreview() {
  const current = currentCharacter();
  $('sti-character').textContent = current
    ? '当前角色：' + current.name
    : '没有选中单人角色；可以不带照片直接出图。';
  const refId = current && settings.rolePhotos[current.key];
  const preview = $('sti-photo-preview');
  if (refId) {
    preview.src = photoUrl(refId);
    preview.hidden = false;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
  }
}
function open() {
  $('sti-panel').hidden = false;
  updatePhotoPreview();
  if (settings.useLastMessage) $('sti-prompt').value = latestMessageText(getContext());
}
function close() { $('sti-panel').hidden = true; }
async function encodePhoto(blob) {
  if (!blob?.type?.startsWith('image/')) throw new Error('请上传图片');
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally { bitmap.close(); }
}
async function uploadPhoto() {
  const file = $('sti-photo').files?.[0];
  $('sti-photo').value = '';
  if (!file) return;
  const current = currentCharacter();
  if (!current) { message('请先在酒馆选择一张角色卡，再上传参考照片。', true); return; }
  message('正在保存角色参考照片…');
  try {
    const image = await encodePhoto(file);
    const saved = await call('/v1/photos', { image }, 30000);
    settings.rolePhotos[current.key] = saved.id;
    persist();
    updatePhotoPreview();
    message('角色「' + current.name + '」的参考照片已保存。');
  } catch (error) { message(error.message, true); }
}
async function resolvePhotoId() {
  if (!settings.useReference) return '';
  const current = currentCharacter();
  if (!current) return '';
  const saved = settings.rolePhotos[current.key];
  if (saved) return saved;
  if (!settings.useAvatarFallback || !current.avatar) return '';
  const filename = current.avatar.split('/').at(-1);
  if (!filename) return '';
  const response = await fetch('/characters/' + encodeURIComponent(filename), { credentials: 'same-origin' });
  if (!response.ok) return '';
  const bytes = await response.blob();
  if (!bytes.type.startsWith('image/')) return '';
  const image = await encodePhoto(bytes);
  const uploaded = await call('/v1/photos', { image }, 30000);
  settings.rolePhotos[current.key] = uploaded.id;
  persist();
  updatePhotoPreview();
  return uploaded.id;
}
async function importWorkflow(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 400000) throw new Error('工作流文件不能超过400KB');
    const parsed = JSON.parse(await file.text());
    const workflow = parsed?.prompt && typeof parsed.prompt === 'object' ? parsed.prompt : parsed;
    if (!workflow || Array.isArray(workflow) || typeof workflow !== 'object'
      || !Object.values(workflow).some(node => node?.class_type === 'SaveImage')) {
      throw new Error('请导入 ComfyUI 的 API 格式工作流（包含 SaveImage 节点）');
    }
    const preset = { id: String(Date.now()), name: file.name.replace(/\.json$/i, ''), workflow };
    settings.customPresets.push(preset);
    settings.selectedCustomId = preset.id;
    settings.mode = 'custom';
    persist(); updatePreset();
    message('工作流已导入。请核对节点编号后再生成。');
  } catch (error) { message(error.message, true); }
}
async function generate() {
  if (busy) return;
  busy = true;
  $('sti-generate').disabled = true;
  message('正在准备参考图及生成任务…');
  try {
    for (const key of ['host','model','clip','vae','negative']) settings[key] = $('sti-' + key).value;
    for (const key of ['width','height','steps']) settings[key] = Number($('sti-' + key).value);
    persist();
    const photoId = await resolvePhotoId();
    const body = generationPayload(settings, $('sti-prompt').value, photoId);
    if (!body.request.prompt) throw new Error('请填写画面提示词');
    message('ComfyUI 正在生成图片。首次加载模型可能需要较长时间…');
    const result = await call('/v1/generate', body);
    $('sti-output').src = result.dataUrl;
    $('sti-result').hidden = false;
    $('sti-download').href = result.dataUrl;
    $('sti-download').download = 'SillyTavern-Image-' + result.seed + '.png';
    message('完成。随机种子：' + result.seed + '；用时约 ' + Math.round(result.elapsedMs / 1000) + ' 秒。');
  } catch (error) { message(error.name === 'AbortError' ? '生成超时，请检查后台日志' : error.message, true); }
  finally { busy = false; $('sti-generate').disabled = false; }
}
function init() {
  settings = normalizedSettings(extension_settings[KEY] || DEFAULT_SETTINGS);
  extension_settings[KEY] = settings;
  root = document.createElement('div');
  root.id = 'sti-root';
  root.innerHTML = [
    '<button id="sti-launcher" title="独立文生图">绘图</button>',
    '<section id="sti-panel" hidden role="dialog" aria-label="独立文生图">',
    '<header><strong>独立文生图 · ComfyUI</strong><button id="sti-close" aria-label="关闭">×</button></header>',
    '<div class="sti-scroller">',
    '<p class="sti-hint">不依赖小白 X。此版支持手动生图及单角色参考，自动剧情生图尚未接入。</p>',
    '<label>ComfyUI 地址<input id="sti-host" placeholder="http://你的电脑地址:8188"></label>',
    '<div class="sti-line"><button id="sti-check">测试连接</button><button id="sti-save">保存设置</button></div>',
    '<label>工作流<select id="sti-mode"><option value="krea2">内置 Krea2 纯脸参考</option><option value="custom">导入的 API 工作流</option></select></label>',
    '<div id="sti-custom-settings" hidden><label>已导入的工作流<select id="sti-custom"></select></label>',
    '<label>导入 API 工作流 JSON<input type="file" id="sti-import" accept=".json,application/json"></label>',
    '<p class="sti-hint">节点对应关系：正向 / 负向 / 种子 / 分辨率 / 保存图片</p>',
    '<div class="sti-node-grid"><input id="sti-map-positive" placeholder="正向节点"><input id="sti-map-negative" placeholder="负向节点">',
    '<input id="sti-map-seed" placeholder="种子节点"><input id="sti-map-size" placeholder="宽高节点"><input id="sti-map-save" placeholder="保存节点"></div></div>',
    '<div id="sti-krea-settings">',
    '<label>主模型<input id="sti-model"></label><label>文本编码器<input id="sti-clip"></label><label>图像解码器<input id="sti-vae"></label>',
    '</div>',
    '<div class="sti-line"><label>宽<input id="sti-width" type="number" min="512" max="1536" step="64"></label>',
    '<label>高<input id="sti-height" type="number" min="512" max="1536" step="64"></label>',
    '<label>采样步数<input id="sti-steps" type="number" min="1" max="40"></label></div>',
    '<section class="sti-role"><strong id="sti-character">当前角色</strong>',
    '<div class="sti-line"><img id="sti-photo-preview" hidden alt="角色参考照片"><label>上传脸部参考图<input id="sti-photo" type="file" accept="image/png,image/jpeg"></label></div>',
    '<label class="sti-check"><input id="sti-useReference" type="checkbox"> 启用人物照片参考</label>',
    '<label class="sti-check"><input id="sti-useAvatarFallback" type="checkbox"> 未上传参考照时尝试读取酒馆角色头像</label></section>',
    '<label>场景提示词<textarea id="sti-prompt" rows="5" placeholder="描述画面、人物动作与场景；请使用真实照片风格。"></textarea></label>',
    '<div class="sti-line"><button id="sti-load-chat">读取最新聊天</button><label class="sti-check"><input id="sti-useLastMessage" type="checkbox"> 打开时读取</label></div>',
    '<label>负向提示词<textarea id="sti-negative" rows="2"></textarea></label>',
    '<button id="sti-generate" class="sti-primary">开始生成</button><p id="sti-status" aria-live="polite"></p>',
    '<section id="sti-result" hidden><img id="sti-output" alt="生成结果"><a id="sti-download">保存图片到本机</a></section>',
    '</div></section>',
  ].join('');
  document.body.append(root);
  assignInputs();
  message('插件界面已加载，请先检测 ComfyUI 连接。');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
