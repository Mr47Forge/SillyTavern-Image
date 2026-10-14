'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', 'krea2-reference-api.json'), 'utf8'));
const DEFAULTS = Object.freeze({
  model: 'Moody\\moodyAmateurMixFreeKrea2_5ProsumerShots_int4.safetensors',
  clip: 'qwen3vl_4b_bf16.safetensors',
  vae: 'qwen_image_vae.safetensors',
});
const PLACEHOLDER = '__ST_IMAGE_ROLE__';

function failure(message) { const error = new Error(message); error.status = 400; return error; }
function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function limitInteger(value, fallback, min, max) {
  const n = Number(value);
  if (value === null || value === '' || value === undefined) return fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw failure('参数超出范围');
  return n;
}
function validateModel(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 180 || /[\r\n\0]/.test(value)) throw failure('模型名称不正确');
  return value;
}
function writeText(node, text) {
  if (!node || !plainObject(node.inputs)) throw failure('工作流中的提示词节点不存在');
  for (const field of ['prompt', 'text', 'positive']) {
    if (typeof node.inputs[field] === 'string') { node.inputs[field] = text; return; }
  }
  throw failure('工作流提示词节点没有文本输入');
}
function requireNode(workflow, id, kind) {
  const node = workflow[String(id)];
  if (!plainObject(node) || (kind && node.class_type !== kind)) throw failure('工作流节点不匹配：' + id);
  return node;
}
function normalizePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw failure('请输入不超过6000字的提示词');
  return prompt.trim();
}
function materialize(request, photoFilename = '') {
  const prompt = normalizePrompt(request?.prompt);
  const negative = String(request?.negative || '').slice(0, 3500);
  const width = limitInteger(request?.width, 768, 512, 1536);
  const height = limitInteger(request?.height, 1152, 512, 1536);
  if (width % 64 !== 0 || height % 64 !== 0) throw failure('宽高须为64的倍数');
  const seed = request?.seed == null || request?.seed === ''
    ? crypto.randomInt(0, 4294967296)
    : limitInteger(request.seed, 0, 0, 4294967295);
  let workflow, saveNode;
  if (request.mode === 'custom') {
    if (!plainObject(request.workflow) || Object.keys(request.workflow).length > 160) throw failure('请导入有效的API工作流');
    if (Buffer.byteLength(JSON.stringify(request.workflow)) > 400000) throw failure('工作流过大');
    workflow = structuredClone(request.workflow);
    const map = request.nodeMap;
    if (!plainObject(map)) throw failure('自定义工作流缺少节点映射');
    const positive = String(map.positive || '');
    const negativeNode = String(map.negative || '');
    const sampler = String(map.seed || '');
    const latent = String(map.size || '');
    saveNode = String(map.save || '');
    writeText(requireNode(workflow, positive), prompt);
    if (negativeNode) writeText(requireNode(workflow, negativeNode), negative);
    if (sampler) {
      const inputs = requireNode(workflow, sampler).inputs;
      const key = Object.hasOwn(inputs, 'seed') ? 'seed' : 'noise_seed';
      if (!Object.hasOwn(inputs, key)) throw failure('随机种子节点未找到');
      inputs[key] = seed;
    }
    if (latent) {
      const inputs = requireNode(workflow, latent).inputs;
      if (!Object.hasOwn(inputs, 'width') || !Object.hasOwn(inputs, 'height')) throw failure('分辨率节点不正确');
      inputs.width = width; inputs.height = height;
    }
    requireNode(workflow, saveNode, 'SaveImage');
    const placeholders = Object.values(workflow).filter(n => n?.class_type === 'LoadImage' && n.inputs?.image === PLACEHOLDER);
    if (placeholders.length > 1) throw failure('暂不支持多张角色照片');
    if (placeholders.length && !photoFilename) throw failure('该自定义工作流要求上传角色照片');
    if (placeholders.length) placeholders[0].inputs.image = photoFilename;
  } else {
    workflow = structuredClone(BASE);
    const models = plainObject(request?.models) ? request.models : {};
    workflow['1'].inputs.unet_name = validateModel(models.model, DEFAULTS.model);
    workflow['2'].inputs.clip_name = validateModel(models.clip, DEFAULTS.clip);
    workflow['10'].inputs.vae_name = validateModel(models.vae, DEFAULTS.vae);
    workflow['6'].inputs.text = negative || workflow['6'].inputs.text;
    workflow['7'].inputs.width = width;
    workflow['7'].inputs.height = height;
    workflow['8'].inputs.seed = seed;
    workflow['8'].inputs.steps = limitInteger(request?.steps, 8, 1, 40);
    saveNode = '11';
    if (photoFilename) {
      workflow['15'].inputs.image = photoFilename;
      workflow['5'].inputs.prompt =
        'Use character1 from image1 as the same person. Preserve facial identity and hairstyle only. ' +
        'Change the background, outfit, pose and lighting according to the scene. ' + prompt;
    } else {
      workflow['18'].inputs.text = prompt;
      workflow['8'].inputs.positive = ['18', 0];
      delete workflow['5'];
      delete workflow['15'];
    }
  }
  return { workflow, saveNode, seed };
}
module.exports = { materialize, normalizePrompt, DEFAULTS, PLACEHOLDER };
