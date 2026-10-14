export const DEFAULT_SETTINGS = Object.freeze({
  host: '',
  mode: 'krea2',
  width: 768,
  height: 1152,
  steps: 8,
  useReference: true,
  useAvatarFallback: true,
  useLastMessage: false,
  model: 'Moody\\moodyAmateurMixFreeKrea2_5ProsumerShots_int4.safetensors',
  clip: 'qwen3vl_4b_bf16.safetensors',
  vae: 'qwen_image_vae.safetensors',
  negative: 'anime, CGI, distorted anatomy, plastic skin',
  rolePhotos: {},
  customPresets: [],
  selectedCustomId: '',
  nodeMap: { positive: '5', negative: '6', seed: '8', size: '7', save: '11' },
});
export const API_ROOT = '/api/plugins/sillytavern-image-server';
export function normalizedSettings(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...value,
    rolePhotos: value.rolePhotos && typeof value.rolePhotos === 'object' && !Array.isArray(value.rolePhotos) ? value.rolePhotos : {},
    customPresets: Array.isArray(value.customPresets) ? value.customPresets : [],
    nodeMap: { ...DEFAULT_SETTINGS.nodeMap, ...(value.nodeMap || {}) },
  };
}
export function chatCharacter(ctx) {
  const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
  const id = ctx?.characterId;
  const index = Number(id);
  const item = Number.isInteger(index) && index >= 0 ? characters[index] : null;
  if (!item) return null;
  const key = String(item.avatar || item.name || '').trim();
  return key ? { key, name: String(item.name || ctx?.name2 || '当前角色'), avatar: String(item.avatar || '') } : null;
}
export function latestMessageText(ctx) {
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  for (let i = chat.length - 1; i >= 0; i--) {
    const item = chat[i];
    const raw = String(item?.mes || '').trim();
    if (raw && !item?.is_system) return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3800);
  }
  return '';
}
export function generationPayload(settings, prompt, photoId = '') {
  const s = normalizedSettings(settings);
  const request = {
    mode: s.mode === 'custom' ? 'custom' : 'krea2',
    prompt: String(prompt || '').trim(),
    negative: String(s.negative || ''),
    width: Number(s.width), height: Number(s.height), steps: Number(s.steps),
    models: { model: s.model, clip: s.clip, vae: s.vae },
    photoId: s.useReference ? String(photoId || '') : '',
  };
  if (request.mode === 'custom') {
    const p = s.customPresets.find(x => x.id === s.selectedCustomId);
    if (!p?.workflow) throw new Error('请先导入并选择 API 工作流');
    request.workflow = p.workflow;
    request.nodeMap = s.nodeMap;
  }
  return { host: s.host, request };
}
