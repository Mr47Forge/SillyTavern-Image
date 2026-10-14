'use strict';

// Resolve only server-owned SillyTavern character photos; never accept arbitrary paths.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { endpoint, basicAuthHeader, createUpstreamError, readErrorText, readJsonResponse } = require('../upstream.js');

const PHOTO_PREFIX = 'lwb-role-photo:';
const PHOTO_PATH = /^user\/images\/LittleWhiteBox-role-photos\/[A-Za-z0-9_-]+\.jpg$/;
const MAX_BYTES = 3 * 1024 * 1024;

async function injectSavedRolePhotos(workflow, { url, auth = '', signal, fetchImpl = fetch, userDataRoot } = {}) {
    const result = structuredClone(workflow);
    const inputNodes = Object.values(result).filter(node =>
        node?.class_type === 'LoadImage' && typeof node?.inputs?.image === 'string'
        && node.inputs.image.startsWith(PHOTO_PREFIX));
    if (!inputNodes.length) return result;
    if (inputNodes.length > 4) throw new Error('Too many character photo references');
    const root = path.resolve(userDataRoot || path.join(process.cwd(), 'data', 'default-user'));
    for (const node of inputNodes) {
        const relative = node.inputs.image.slice(PHOTO_PREFIX.length);
        if (!PHOTO_PATH.test(relative)) throw new Error('Invalid character photo reference');
        const fullPath = path.resolve(root, relative);
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
module.exports = { injectSavedRolePhotos, PHOTO_PREFIX };
