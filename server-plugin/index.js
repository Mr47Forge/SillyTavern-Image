'use strict';
// SillyTavern native server plugin. No dependency on LittleWhiteBox.
const manifest = require('./manifest.json');
const { storePhoto, readPhoto } = require('./lib/photos');
const { checkConnection, runGeneration } = require('./lib/transport');
const { mountRuntime, closeRuntime } = require('./lib/runtime');
const { getCurrentUser } = require('./lib/user-context');

const info = {
  id: manifest.id, name: manifest.name,
  version: manifest.version, description: manifest.description,
};
const running = new Set();
function user(req) {
  return getCurrentUser(req);
}
function errorResponse(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
    ? error.status : 502;
  console.error('[SillyTavern-Image] ' + String(error?.message || error).slice(0, 250));
  return res.status(status).json({ ok: false, error: String(error?.message || '请求失败').slice(0, 450) });
}
async function init(router) {
  await mountRuntime(router);
  router.get('/status', (req, res) => res.json({ ok: true, version: info.version, plugin: info.id }));
  router.post('/v1/check', async (req, res) => {
    if (!user(req)) return res.status(403).json({ ok: false, error: '请先登录酒馆' });
    try {
      const result = await checkConnection({
        host: req.body?.host, signal: AbortSignal.timeout(12000),
      });
      res.json(result);
    } catch (error) { errorResponse(res, error); }
  });
  router.post('/v1/photos', async (req, res) => {
    const owner = user(req);
    if (!owner) return res.status(403).json({ ok: false, error: '请先登录酒馆' });
    try {
      const result = await storePhoto(owner, req.body?.image);
      res.status(201).json({ ok: true, ...result });
    } catch (error) { errorResponse(res, error); }
  });
  router.get('/v1/photos/:id', async (req, res) => {
    const owner = user(req);
    if (!owner) return res.status(403).end();
    try {
      const result = await readPhoto(owner, req.params.id);
      res.set('Cache-Control', 'private, no-store');
      res.type(result.mime).send(result.bytes);
    } catch (error) { errorResponse(res, error); }
  });
  router.post('/v1/generate', async (req, res) => {
    const owner = user(req);
    if (!owner) return res.status(403).json({ ok: false, error: '请先登录酒馆' });
    const id = String(owner.profile.handle);
    if (running.has(id)) return res.status(409).json({ ok: false, error: '已有生成任务正在运行，请等待完成' });
    running.add(id);
    try {
      const result = await runGeneration({
        host: req.body?.host, request: req.body?.request || {},
        user: owner, signal: AbortSignal.timeout(205000),
      });
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) { errorResponse(res, error); }
    finally { running.delete(id); }
  });
  console.log('[SillyTavern-Image] Independent server plugin loaded (v' + info.version + ')');
}
async function exit() { running.clear(); await closeRuntime(); }
module.exports = { info, init, exit };
