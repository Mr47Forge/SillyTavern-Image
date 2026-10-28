'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCurrentUser } = require('./user-context');

const FILES = new Set([
  'NovelDraw', 'ComfyDraw',
].map(name => `SillyTavernImage_${name}.json`));
const pending = new Map();
const conflictMessage = '设置已在其他设备或页面更新，本次未保存。请先保留当前输入，再刷新页面重新加载后修改。';

function failure(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function version(bytes) {
  return '"' + crypto.createHash('sha256').update(bytes).digest('hex') + '"';
}
async function settingsPath(req) {
  const user = getCurrentUser(req);
  const directory = user?.directories?.files;
  if (!user || typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw failure('请先登录酒馆', 403);
  }
  if (!FILES.has(req.params.filename)) throw failure('设置文件名无效', 400);
  // The authenticated directory is the only root; no path or user is accepted from the request.
  const root = await fs.realpath(directory);
  return path.join(root, req.params.filename);
}
async function serialized(filename, operation) {
  const key = process.platform === 'win32' ? filename.toLowerCase() : filename;
  const previous = pending.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  pending.set(key, next);
  try { return await next; }
  finally { if (pending.get(key) === next) pending.delete(key); }
}
async function readSettings(filename) {
  let stat;
  try { stat = await fs.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw failure('设置文件不能是链接或目录', 400);
  const bytes = await fs.readFile(filename);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw failure('现有设置文件格式无效，已禁止覆盖', 422); }
  if (!isRecord(data)) throw failure('现有设置文件格式无效，已禁止覆盖', 422);
  return { data, revision: version(bytes) };
}
function checkCondition(req, current) {
  const match = req.get('If-Match');
  const absent = req.get('If-None-Match');
  if (!match && !absent) throw failure('保存设置必须携带读取时的版本', 428);
  if ((match && absent) || (absent && absent !== '*') || (match && !/^"[a-f0-9]{64}"$/.test(match))) {
    throw failure('设置版本条件无效', 400);
  }
  if ((absent && current) || (match && current?.revision !== match)) {
    throw failure(conflictMessage, 412, 'STORAGE_VERSION_CONFLICT');
  }
}
async function replaceSettings(filename, json) {
  const temporary = path.join(path.dirname(filename), '.' + path.basename(filename) + '.' + crypto.randomBytes(12).toString('hex') + '.tmp');
  try {
    await fs.writeFile(temporary, json, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function respondError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  return res.status(status).json({
    ok: false, code: error.code && status < 500 ? error.code : 'SETTINGS_REQUEST_FAILED',
    error: status < 500 ? error.message : '设置保存或读取失败，请稍后重试',
  });
}
function mountSettingsRoutes(router) {
  router.get('/v1/settings/:filename', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const filename = await settingsPath(req);
      const current = await serialized(filename, () => readSettings(filename));
      if (!current) return res.status(404).json({ ok: false, code: 'SETTINGS_FILE_MISSING', error: '设置文件尚未创建' });
      return res.set('ETag', current.revision).json(current.data);
    } catch (error) { return respondError(res, error); }
  });
  router.put('/v1/settings/:filename', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const filename = await settingsPath(req);
      if (!isRecord(req.body)) throw failure('设置内容必须是JSON对象', 400);
      const json = JSON.stringify(req.body);
      const revision = await serialized(filename, async () => {
        const current = await readSettings(filename);
        checkCondition(req, current);
        await replaceSettings(filename, json);
        return version(json);
      });
      return res.set('ETag', revision).json({ ok: true });
    } catch (error) { return respondError(res, error); }
  });
}

module.exports = { mountSettingsRoutes };
