'use strict';

// Resolve only server-owned SillyTavern character photos; never accept arbitrary paths.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { endpoint, basicAuthHeader, createUpstreamError, readErrorText, readJsonResponse } = require('../upstream.js');

const PHOTO_PREFIX = 'lwb-role-photo:';
const PHOTO_PATH = /^user\/images\/(?:SillyTavernImage|LittleWhiteBox)-role-photos\/[A-Za-z0-9_-]+\.jpg$/;
const MAX_BYTES = 3 * 1024 * 1024;
const ownerImagesDirectories = new Map();
function setOwnerImagesDirectory(owner, directory) {
    if (typeof owner !== 'string' || !owner || !path.isAbsolute(directory)) throw new Error('当前用户图片目录无效');
    ownerImagesDirectories.set(owner, directory);
}

async function injectSavedRolePhotos(workflow, { url, auth = '', signal, fetchImpl = fetch, owner, imagesDirectory } = {}) {
    const result = structuredClone(workflow);
    const inputNodes = Object.values(result).filter(node =>
        node?.class_type === 'LoadImage' && typeof node?.inputs?.image === 'string'
        && node.inputs.image.startsWith(PHOTO_PREFIX));
    if (!inputNodes.length) return result;
    if (inputNodes.length > 4) throw new Error('Too many character photo references');
    const directory = imagesDirectory || ownerImagesDirectories.get(owner);
    if (!directory || !path.isAbsolute(directory)) throw new Error('无法获取当前用户的角色图片目录');
    const root = path.resolve(directory);
    for (const node of inputNodes) {
        const relative = node.inputs.image.slice(PHOTO_PREFIX.length);
        if (!PHOTO_PATH.test(relative)) throw new Error('Invalid character photo reference');
        const fullPath = path.resolve(root, relative.slice('user/images/'.length));
        if (!fullPath.startsWith(root + path.sep)) throw new Error('Character photo escapes user data directory');
        const stats = await fs.stat(fullPath);
        if (!stats.isFile() || stats.size < 100 || stats.size > MAX_BYTES) {
            throw new Error('Character photo has an invalid size');
        }
        const bytes = await fs.readFile(fullPath);
        // Hash-based name avoids collisions, duplicate reuploads are safe.
        const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24);
        const filename = 'lwb-role-' + hash + '.jpg';
        const form = new FormData();
        form.append('image', new Blob([bytes], { type: 'image/jpeg' }), filename);
        form.append('type', 'input');
        form.append('overwrite', 'true');
        const headers = auth ? { Authorization: basicAuthHeader(auth) } : {};
        const response = await fetchImpl(endpoint(url, '/upload/image', { appendPath: true }), {
            method: 'POST', headers, body: form, signal,
        });
        if (!response.ok) {
            throw createUpstreamError(response, await readErrorText(response));
        }
        const uploaded = await readJsonResponse(response);
        if (!uploaded || !/^[A-Za-z0-9_.-]+\.jpg$/.test(String(uploaded.name || ''))
            || (uploaded.subfolder && String(uploaded.subfolder).trim())) {
            throw new Error('ComfyUI returned an invalid character photo filename');
        }
        node.inputs.image = uploaded.name;
    }
    return result;
}
// A template may be submitted directly from a preset editor or through a stale
// compiled job. Never send its placeholder as a ComfyUI image filename.
// With no resolved photograph the only safe behavior is genuine text-only mode.
function stripUnresolvedRolePhoto(workflow) {
    const result = structuredClone(workflow);
    const unresolved = Object.entries(result).filter(([_, node]) =>
        node?.class_type === 'LoadImage' && node.inputs?.image === '__LWB_ROLE_PHOTO__');
    if (!unresolved.length) return result;
    if (unresolved.length !== 1 || unresolved[0][0] !== '15'
        || result['5']?.class_type !== 'TextEncodeKrea2Reference'
        || result['18']?.class_type !== 'CLIPTextEncode'
        || result['8']?.class_type !== 'KSampler') {
        throw new Error('Krea2 reference photo was unresolved and has no safe text-only fallback');
    }
    const scene = String(result['5'].inputs?.prompt || result['18'].inputs?.text || '').trim();
    if (!scene || scene.length > 12000) {
        throw new Error('Krea2 scene text is missing; cannot fall back safely');
    }
    result['18'].inputs.text = scene;
    result['8'].inputs.positive = ['18', 0];
    delete result['15'];
    delete result['5'];
    console.warn('[ComfyUI] unresolved role-photo placeholder removed; using text-only generation');
    return result;
}
module.exports = { injectSavedRolePhotos, stripUnresolvedRolePhoto, PHOTO_PREFIX, setOwnerImagesDirectory };
