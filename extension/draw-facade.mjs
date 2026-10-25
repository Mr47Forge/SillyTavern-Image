import { joinTags } from '../runtime/modules/draw/shared/character-prompts.js';
import { generateSharedImage, checkGeneratedImageCache, clearExpiredGeneratedImageCache } from '../runtime/modules/draw/shared/generated-image-runtime.js';

export function installDrawFacade(host = window) {
  const provider = () => host.stimageComfyDraw;
  const enabled = () => host.isStImageEnabled === true && provider()?.isEnabled?.() === true;
  function buildPromptData(input = {}) {
    const payload = typeof input === 'string' ? { prompt: input } : input;
    const characters = Array.isArray(payload.characterPrompts) ? payload.characterPrompts : [];
    const effective = provider()?.getEffectiveParams?.(provider().getSettings(), payload.params || {}) || {};
    return {
      tags: String(payload.prompt || payload.tags || '').trim(),
      positive: joinTags(effective.positivePrefix, payload.prompt || payload.tags, ...characters.map(x => x.prompt)),
      negativePrompt: joinTags(effective.negativePrefix, payload.negativePrompt || payload.negative, ...characters.map(x => x.uc)),
      characterPrompts: characters, params: effective,
    };
  }
  function prepareGeneration(input = {}) {
    if (!enabled()) throw new Error('独立绘图尚未启动');
    const payload = typeof input === 'string' ? { prompt: input } : input;
    const promptData = structuredClone(buildPromptData(payload));
    const snapshot = provider().getGenerationSnapshot?.(payload) || {};
    return {
      fingerprint: { version: 1, provider: 'comfyui', promptData, providerConfig: structuredClone(snapshot.fingerprint || null) },
      execute: ({ signal, onQueueStateChange } = {}) => provider().generateComfyImage({
        prompt: promptData.positive, negativePrompt: promptData.negativePrompt,
        params: promptData.params, generationConfig: snapshot.execution, signal, onQueueStateChange,
      }),
    };
  }
  const facade = {
    getProvider: () => 'comfyui', isEnabled: enabled,
    getStatus: () => ({ provider: 'comfyui', enabled: enabled(), ready: enabled() }),
    buildPromptData, prepareGeneration, generateSharedImage, checkGeneratedImageCache,
    generateImage(input = {}) { return prepareGeneration(input).execute(input); },
    generateImagesFromText(input = {}) {
      if (!enabled()) throw new Error('独立绘图尚未启动');
      return provider().generateImagesFromText(input);
    },
    mountMessagePanel(element, messageId) {
      if (enabled()) provider()?.mountMessagePanel?.(element, messageId, { force: true });
      return () => provider()?.releaseMessagePanel?.(element, messageId);
    },
  };
  host.stimageDraw = facade;
  host.sillytavernImage = facade;
  void clearExpiredGeneratedImageCache().catch(console.error);
  return facade;
}
