'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');

const NAME = 'SillyTavernImage_ComfyDraw.json';
const BASE = '/api/plugins/sillytavern-image-server/v1/settings/';
const ORIGINAL = {
  config: {
    positive: '原正向', negative: '原负向', worldbook: { selected: ['世界书甲'], enabled: true },
    characters: [{ name: '人物甲', prompt: '人物提示词', photoId: 'private-photo' }],
    customWorkflow: { '8': { inputs: { seed: 27 } } }, unknownFutureField: { preserved: ['完整保留'] },
  },
  anotherKey: { value: 42 },
};

async function fixture(t, { initial = ORIGINAL } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sti-settings-'));
  const dirs = Object.fromEntries(['alice', 'bob'].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await fs.mkdir(directory);
  if (initial !== null) await fs.writeFile(path.join(dirs.alice, NAME), JSON.stringify(initial));
  const app = express();
  app.set('env', 'test');
  app.use(express.json());
  app.use((req, _res, next) => {
    const handle = req.get('x-test-user');
    if (dirs[handle]) req.user = { profile: { handle }, directories: { files: dirs[handle], images: dirs[handle] } };
    next();
  });
  // Keep the old transport available so the first regression reproduces real stale overwrites.
  app.get('/user/files/:filename', async (req, res) => {
    try { res.type('json').send(await fs.readFile(path.join(dirs.alice, req.params.filename), 'utf8')); }
    catch (error) { res.status(error.code === 'ENOENT' ? 404 : 500).end(); }
  });
  app.post('/api/files/upload', async (req, res) => {
    await fs.writeFile(path.join(dirs.alice, req.body.name), Buffer.from(req.body.data, 'base64'));
    res.json({ ok: true });
  });
  const router = express.Router();
  const modulePath = path.join(__dirname, '../lib/settings.js');
  if (existsSync(modulePath)) require(modulePath).mountSettingsRoutes(router);
  app.use('/api/plugins/sillytavern-image-server', router);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return {
    root, dirs,
    request: (method, filename = NAME, { user = 'alice', headers = {}, data, raw } = {}) => fetch(origin + BASE + encodeURIComponent(filename), {
      method, headers: { ...(user ? { 'x-test-user': user } : {}), ...(data !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw !== undefined ? raw : data === undefined ? undefined : JSON.stringify(data),
    }),
    fetch: (url, options = {}) => fetch(origin + url, { ...options, headers: { 'x-test-user': 'alice', 'Content-Type': 'application/json', ...options.headers } }),
    read: async () => JSON.parse(await fs.readFile(path.join(dirs.alice, NAME), 'utf8')),
  };
}

async function storageClass() {
  return (await import(pathToFileURL(path.resolve(__dirname, '../../runtime/core/storage-file.js')))).StorageFile;
}

test('两个设备读取同一旧配置后，第二个保存必须拒绝并保留第一个设备的全部字段', async t => {
  t.mock.method(console, 'error', () => {});
  const f = await fixture(t);
  const StorageFile = await storageClass();
  const options = { versioned: true, fetch: f.fetch, maxRetries: 0, debounce: () => () => {} };
  const first = new StorageFile(NAME, options);
  const second = new StorageFile(NAME, options);
  const a = await first.getStrict('config');
  const b = await second.getStrict('config');
  a.positive = '第一台的新正向';
  assert.equal(await first.setAndSave('config', a, { silent: false }), true);
  b.negative = '第二台未保存负向';
  await assert.rejects(second.setAndSave('config', b, { silent: false }), error => error.code === 'STORAGE_VERSION_CONFLICT' && /刷新/.test(error.message));
  assert.deepEqual(await second.getStrict('config'), b);
  const expected = structuredClone(ORIGINAL);
  expected.config.positive = '第一台的新正向';
  assert.deepEqual(await f.read(), expected);
  // Reloading the browser is required; automatically fetching a new revision would reapply old data.
  assert.equal(await second.setAndSave('config', b, { silent: true }), false);
  assert.deepEqual(await f.read(), expected);
});

test('版本化读取和完整保存不丢失世界书、人物、正负向及未知字段', async t => {
  const f = await fixture(t);
  const read = await f.request('GET');
  assert.equal(read.status, 200);
  const version = read.headers.get('etag');
  assert.match(version, /^"[a-f0-9]{64}"$/);
  assert.deepEqual(await read.json(), ORIGINAL);
  const next = structuredClone(ORIGINAL);
  next.config.negative = '更新负向';
  const saved = await f.request('PUT', NAME, { headers: { 'If-Match': version }, data: next });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.headers.get('etag'), version);
  assert.deepEqual(await f.read(), next);
});

test('首次创建要求条件，两个并发创建仅一个成功', async t => {
  const f = await fixture(t, { initial: null });
  assert.equal((await f.request('GET')).status, 404);
  assert.equal((await f.request('PUT', NAME, { data: ORIGINAL })).status, 428);
  const responses = await Promise.all(['甲', '乙'].map(label => f.request('PUT', NAME, {
    headers: { 'If-None-Match': '*' }, data: { label },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);
  assert.ok(['甲', '乙'].includes((await f.read()).label));
});

test('相同版本的两个并发更新仅一个成功，失效版本不能再次覆盖', async t => {
  const f = await fixture(t);
  const version = (await f.request('GET')).headers.get('etag');
  const responses = await Promise.all(['甲', '乙'].map(label => f.request('PUT', NAME, {
    headers: { 'If-Match': version }, data: { ...ORIGINAL, label },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);
  const saved = await f.read();
  assert.equal((await f.request('PUT', NAME, { headers: { 'If-Match': version }, data: { lost: true } })).status, 412);
  assert.deepEqual(await f.read(), saved);
});

test('拒绝未登录、越界文件名及非白名单文件，用户目录互不影响', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('GET', NAME, { user: null })).status, 403);
  assert.equal((await f.request('PUT', NAME, { user: null, data: ORIGINAL })).status, 403);
  for (const filename of ['../alice/' + NAME, 'SillyTavernImage_../../config.json', 'config.yaml', 'SillyTavernImage_Unknown.json']) {
    assert.equal((await f.request('GET', filename)).status, 400);
    assert.equal((await f.request('PUT', filename, { headers: { 'If-None-Match': '*' }, data: {} })).status, 400);
  }
  assert.equal((await f.request('GET', NAME, { user: 'bob' })).status, 404);
  assert.equal((await f.request('PUT', NAME, { user: 'bob', headers: { 'If-None-Match': '*' }, data: { private: '乙' } })).status, 200);
  assert.deepEqual(await f.read(), ORIGINAL);
});

test('无效JSON和非对象数据不能覆盖已有文件', async t => {
  const f = await fixture(t);
  const version = (await f.request('GET')).headers.get('etag');
  for (const raw of ['{', '[]', 'null', '"text"']) {
    assert.equal((await f.request('PUT', NAME, { headers: { 'If-Match': version }, raw })).status, 400);
  }
  assert.deepEqual(await f.read(), ORIGINAL);
});

test('原子替换失败保留旧数据并清理临时文件，之后可用原版本重试', async t => {
  const f = await fixture(t);
  const version = (await f.request('GET')).headers.get('etag');
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === path.join(f.dirs.alice, NAME)) throw Object.assign(new Error('模拟磁盘写入失败'), { code: 'EACCES' });
    return rename(from, to);
  };
  let failed;
  try { failed = await f.request('PUT', NAME, { headers: { 'If-Match': version }, data: { next: true } }); }
  finally { fs.rename = rename; }
  assert.equal(failed.status, 500);
  assert.deepEqual(await f.read(), ORIGINAL);
  assert.deepEqual(await fs.readdir(f.dirs.alice), [NAME]);
  assert.equal((await f.request('PUT', NAME, { headers: { 'If-Match': version }, data: { next: true } })).status, 200);
});

test('版本化自动保存冲突后停止重试，未保存修改仍保留在本设备', async t => {
  t.mock.method(console, 'error', () => {});
  const f = await fixture(t);
  const StorageFile = await storageClass();
  const store = new StorageFile(NAME, { versioned: true, fetch: f.fetch, maxRetries: 2, debounce: () => () => {} });
  t.after(() => { if (store._retryTimer) clearTimeout(store._retryTimer); });
  await store.load({ strict: true });
  await store.set('pending', { text: '本机未保存输入' });
  await fs.writeFile(path.join(f.dirs.alice, NAME), JSON.stringify({ external: '其他设备已保存' }));
  assert.equal(await store.saveNow(), false);
  assert.equal(store._retryTimer, null);
  assert.deepEqual(await store.getStrict('pending'), { text: '本机未保存输入' });
  assert.deepEqual(await f.read(), { external: '其他设备已保存' });
});

test('默认旧传输仍可读取并保存，版本化客户端首次创建后继续使用新版本', async t => {
  const f = await fixture(t, { initial: null });
  const StorageFile = await storageClass();
  const versioned = new StorageFile(NAME, { versioned: true, fetch: f.fetch });
  assert.deepEqual(await versioned.load({ strict: true }), {});
  assert.equal(await versioned.setAndSave('config', ORIGINAL.config, { silent: false }), true);
  assert.equal(await versioned.setAndSave('anotherKey', ORIGINAL.anotherKey, { silent: false }), true);
  assert.deepEqual(await f.read(), ORIGINAL);
  const legacy = new StorageFile(NAME, { fetch: f.fetch });
  assert.deepEqual(await legacy.load({ strict: true }), ORIGINAL);
  assert.equal(await legacy.setAndSave('legacy', true, { silent: false }), true);
  assert.equal((await f.read()).legacy, true);
});

test('不允许通过已存在的链接或同名目录读写目录外数据', async t => {
  const f = await fixture(t, { initial: null });
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.json'), JSON.stringify({ private: '不应读取' }));
  await fs.symlink(outside, path.join(f.dirs.alice, NAME), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await f.request('GET')).status, 400);
  assert.equal((await f.request('PUT', NAME, { headers: { 'If-None-Match': '*' }, data: { changed: true } })).status, 400);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outside, 'private.json'), 'utf8')), { private: '不应读取' });
});

test('已有文件损坏时禁止覆盖，非法或重复版本条件也不能保存', async t => {
  const f = await fixture(t);
  for (const headers of [{ 'If-Match': '*' }, { 'If-Match': 'W/"old"' }, { 'If-None-Match': '"old"' }, { 'If-Match': '"' + 'a'.repeat(64) + '"', 'If-None-Match': '*' }]) {
    assert.equal((await f.request('PUT', NAME, { headers, data: {} })).status, 400);
  }
  assert.deepEqual(await f.read(), ORIGINAL);
  await fs.writeFile(path.join(f.dirs.alice, NAME), '{broken');
  assert.equal((await f.request('GET')).status, 422);
  assert.equal((await f.request('PUT', NAME, { headers: { 'If-None-Match': '*' }, data: {} })).status, 422);
  assert.equal(await fs.readFile(path.join(f.dirs.alice, NAME), 'utf8'), '{broken');
});

test('上传失败不会报告保存成功或推进本地版本，恢复后可重试', async t => {
  t.mock.method(console, 'error', () => {});
  const f = await fixture(t);
  const StorageFile = await storageClass();
  const store = new StorageFile(NAME, { versioned: true, fetch: f.fetch });
  const config = await store.getStrict('config');
  config.positive = '等待成功保存';
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === path.join(f.dirs.alice, NAME)) throw Object.assign(new Error('模拟磁盘写入失败'), { code: 'EACCES' });
    return rename(from, to);
  };
  try { assert.equal(await store.setAndSave('config', config), false); }
  finally { fs.rename = rename; }
  assert.deepEqual(await f.read(), ORIGINAL);
  assert.equal(await store.setAndSave('config', config, { silent: false }), true);
  assert.equal((await f.read()).config.positive, '等待成功保存');
});
