'use strict';
const { materialize } = require('./workflow');
const { readPhoto } = require('./photos');

function bad(message, status = 502) { const error = new Error(message); error.status = status; return error; }
function upstreamURL(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw bad('请输入 ComfyUI 的完整地址', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw bad('ComfyUI 地址只能是 HTTP 或 HTTPS', 400);
  }
  return url;
}
function endpoint(base, suffix) {
  const url = upstreamURL(base);
  const target = new URL(String(suffix).replace(/^\/+/, ''), 'http://placeholder.invalid/');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + target.pathname.replace(/^\/+/, '');
  url.search = target.search;
  return url;
}
async function fetchOrThrow(fetchImpl, url, options = {}) {
  let response;
  try { response = await fetchImpl(url, options); }
  catch (error) { throw bad('无法连接 ComfyUI：' + String(error.message || error).slice(0, 150)); }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 350);
    throw bad('ComfyUI 请求失败（' + response.status + '）：' + detail);
  }
  return response;
}
async function jsonOrThrow(response) {
  try { return await response.json(); } catch { throw bad('ComfyUI 返回了无效的数据'); }
}
async function checkConnection({ host, fetchImpl = fetch, signal } = {}) {
  const response = await fetchOrThrow(fetchImpl, endpoint(host, '/system_stats'), { signal });
  const data = await jsonOrThrow(response);
  return { ok: !!data?.system, version: String(data?.system?.comfyui_version || '') };
}
async function uploadReference({ host, photo, fetchImpl, signal }) {
  const form = new FormData();
  const filename = 'stimage-' + cryptoHash(photo.bytes) + photo.extension;
  form.append('image', new Blob([photo.bytes], { type: photo.mime }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const response = await fetchOrThrow(fetchImpl, endpoint(host, '/upload/image'),
    { method: 'POST', body: form, signal });
  const result = await jsonOrThrow(response);
  const name = String(result?.name || '');
  if (!/^[a-zA-Z0-9_.-]+\.(?:jpg|png)$/.test(name) || result.subfolder) throw bad('ComfyUI 图片上传返回了无效文件名');
  return name;
}
function cryptoHash(bytes) { return require('node:crypto').createHash('sha256').update(bytes).digest('hex').slice(0, 24); }
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || bad('任务已取消'));
  const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
  function abort() { cleanup(); reject(signal.reason || bad('任务已取消')); }
  function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  signal?.addEventListener('abort', abort, { once: true });
});
function findImage(outputs, preferred) {
  const first = output => output?.images?.[0] || null;
  if (preferred && first(outputs?.[preferred])) return first(outputs[preferred]);
  for (const output of Object.values(outputs || {})) if (first(output)) return first(output);
  return null;
}
async function runGeneration({ host, request, user, fetchImpl = fetch, signal, pollMs = 1200 }) {
  const started = Date.now();
  const photo = request?.photoId ? await readPhoto(user, request.photoId) : null;
  const filename = photo ? await uploadReference({ host, photo, fetchImpl, signal }) : '';
  const { workflow, saveNode, seed } = materialize(request, filename);
  const response = await fetchOrThrow(fetchImpl, endpoint(host, '/prompt'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }), signal,
  });
  const responseData = await jsonOrThrow(response);
  if (responseData.node_errors && Object.keys(responseData.node_errors).length) {
    throw bad('ComfyUI 工作流节点校验失败：' + JSON.stringify(responseData.node_errors).slice(0, 380));
  }
  const id = responseData.prompt_id;
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(id || ''))) throw bad('ComfyUI 没有返回任务编号');
  let image = null;
  const maxPolls = Math.ceil(180000 / pollMs);
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    await sleep(pollMs, signal);
    const hist = await jsonOrThrow(await fetchOrThrow(fetchImpl, endpoint(host, '/history/' + id), { signal }));
    const entry = hist?.[id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      const errors = (entry.status.messages || []).filter(x => x[0] === 'execution_error');
      const detail = errors.map(x => x[1]?.exception_message || x[1]?.exception_type).join('; ');
      throw bad('ComfyUI 执行失败：' + detail.slice(0, 360));
    }
    image = findImage(entry.outputs, saveNode);
    if (image) break;
    if (entry.status?.completed === true || entry.status?.status_str === 'success') {
      throw bad('ComfyUI 已完成，但没有找到保存的图片');
    }
  }
  if (!image) throw bad('生成等待超时（180秒）', 504);
  const name = String(image.filename || '');
  if (!name || name.length > 300 || /[/\\]/.test(name)) throw bad('返回了无效的图片文件名');
  const params = new URLSearchParams({ filename: name, subfolder: String(image.subfolder || ''), type: String(image.type || 'output') });
  const imgResponse = await fetchOrThrow(fetchImpl, endpoint(host, '/view?' + params.toString()), { signal });
  const length = Number(imgResponse.headers?.get?.('content-length') || 0);
  if (length > 16 * 1024 * 1024) throw bad('输出图片过大');
  const bytes = Buffer.from(await imgResponse.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 16 * 1024 * 1024) throw bad('返回图片大小不正常');
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return { ok: true, dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64'), seed, elapsedMs: Date.now() - started };
}
module.exports = { runGeneration, checkConnection, endpoint, findImage, upstreamURL };
