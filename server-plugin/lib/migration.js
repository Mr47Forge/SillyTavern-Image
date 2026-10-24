'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const SHARED = ['cacheDays','useWorldInfo','timeout','plannerMaxRetries','characterTags','characterGroups',
  'characterGroupPresets','characterGroupPresetApplied','danbooruLocalDB','messageFilterRules','worldbooks','updatedAt'];
const FILES = ['ComfyDraw','NovelDraw','Assistant'];
const LIMIT = 8 * 1024 * 1024;

async function importLegacySettings(user) {
  const directory = user?.directories?.files;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('无法获取当前用户的设置目录');
  const prepared = [];
  // Validate every source before modifying any destination.
  for (const kind of FILES) {
    const source = path.join(directory, `LittleWhiteBox_${kind}.json`);
    let bytes;
    try {
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw new Error('原绘图配置文件无效或过大');
      bytes = await fs.readFile(source);
    } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('原绘图配置格式无效');
    let data = parsed;
    if (kind === 'NovelDraw') {
      const settings = parsed.settings || {};
      data = { settings: Object.fromEntries(SHARED.filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]])) };
    }
    prepared.push({ kind, target: path.join(directory, `SillyTavernImage_${kind}.json`), data });
  }
  const imported = [];
  const stamp = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  for (const {kind,target,data} of prepared) {
    try { await fs.copyFile(target, target + '.before-import-' + stamp, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = target + '.import-' + stamp;
    try {
      await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
    imported.push(kind);
  }
  return { ok: true, imported };
}
module.exports = { importLegacySettings };
