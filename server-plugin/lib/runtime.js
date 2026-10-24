'use strict';
const runtime = require('../runtime/index.js');
const path = require('node:path');
const { getCurrentUser } = require('./user-context');
const { setOwnerImagesDirectory } = require('../runtime/providers/comfyui/role-photo-upload.js');

async function mountRuntime(router) {
  router.use('/runtime', (req, res, next) => {
    const user = getCurrentUser(req);
    const owner = user?.profile?.handle;
    const images = user?.directories?.images;
    if (!owner || typeof images !== 'string' || !path.isAbsolute(images)) {
      return res.status(403).json({ ok: false, error: '请先登录酒馆' });
    }
    setOwnerImagesDirectory(owner, images);
    next();
  });
  const scoped = Object.fromEntries(['get','post','put','patch','delete','use'].map(method => [method,
    (route, ...handlers) => router[method]('/runtime' + route, ...handlers)]));
  await runtime.init(scoped);
}
module.exports = { mountRuntime, closeRuntime: runtime.exit };
