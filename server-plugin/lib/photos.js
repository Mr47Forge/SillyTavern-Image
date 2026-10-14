'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;

function bad(message, status = 400) {
  const error = new Error(message); error.status = status; return error;
}
function userPhotosDirectory(user) {
  const images = user?.directories?.images;
  if (typeof images !== 'string' || !path.isAbsolute(images)) throw bad('无法获取当前用户的私人图片目录', 403);
  return path.join(images, 'SillyTavern-Image');
}
function identifyImage(bytes) {
  if (bytes.length > 10 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: '.jpg', mime: 'image/jpeg' };
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: '.png', mime: 'image/png' };
  }
  throw bad('只支持 JPG 或 PNG 图片');
}
function parseImageDataUrl(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 256) throw bad('图片过大');
  const match = value.match(/^data:image\/(?:png|jpeg);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw bad('无效的图片编码');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes.length > MAX_PHOTO_BYTES) throw bad('参考图应在100字节到2MB之间');
  return { bytes, ...identifyImage(bytes) };
}
async function storePhoto(user, dataUrl) {
  const { bytes, extension } = parseImageDataUrl(dataUrl);
  const directory = userPhotosDirectory(user);
  await fs.mkdir(directory, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  // Exclusive write. Photo is never accessible across user directories.
  await fs.writeFile(path.join(directory, id + extension), bytes, { mode: 0o600, flag: 'wx' });
  return { id, bytes: bytes.length };
}
async function readPhoto(user, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw bad('角色照片编号无效');
  const directory = userPhotosDirectory(user);
  for (const extension of ['.jpg', '.png']) {
    try {
      const p = path.join(directory, id + extension);
      const bytes = await fs.readFile(p);
      if (bytes.length > MAX_PHOTO_BYTES) throw bad('角色照片过大');
      return { bytes, ...identifyImage(bytes) };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  throw bad('角色照片不存在，请重新上传', 404);
}
module.exports = { storePhoto, readPhoto, parseImageDataUrl, userPhotosDirectory };
