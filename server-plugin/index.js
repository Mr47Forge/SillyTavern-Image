'use strict';
const manifest = require('./manifest.json');
const { mountRuntime, closeRuntime } = require('./lib/runtime');
const { mountSettingsRoutes } = require('./lib/settings');
const { mountImageRetention } = require('./lib/image-retention');
let stopImageRetention;

const info = { id: manifest.id, name: manifest.name,
  version: manifest.version, description: manifest.description };
async function init(router) {
  stopImageRetention = mountImageRetention(router);
  mountSettingsRoutes(router);
  await mountRuntime(router);
  router.get('/status', (_req, res) => res.json({ ok: true, version: info.version, plugin: info.id }));
  console.log('[SillyTavern-Image] Independent server plugin loaded (v' + info.version + ')');
}
module.exports = { info, init, exit: async () => { await stopImageRetention?.(); await closeRuntime(); } };
