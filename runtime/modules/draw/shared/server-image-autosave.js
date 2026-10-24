import { getContext } from '/scripts/extensions.js';
import { getPreview, savePreviewImage } from './gallery-cache.js';
import { syncDrawSavedFromPreview } from './draw-common.js';
import { isSceneSlotAlive } from './scene-placement.js';

// A completed ComfyUI image belongs to SillyTavern's server image storage,
// not a particular device's IndexedDB. The chat stores only its portable URL.
export async function saveComfyImageToServer(imgId, {
    slotId = '', chatId = '', messageId = null, expectedMessage = null,
    filePrefix = 'comfy_auto',
} = {}) {
    const assertTarget = () => {
        if (!expectedMessage) return;
        const ctx = getContext();
        if (String(ctx?.chatId || '') !== String(chatId || '')
            || ctx.chat?.[messageId] !== expectedMessage
            || !isSceneSlotAlive(expectedMessage.mes, slotId)) {
            const error = new Error('图片归属聊天已切换，等待重新接回后保存');
            error.code = 'IMAGE_SAVE_TARGET_CHANGED';
            throw error;
        }
    };
    assertTarget();
    const savedUrl = await savePreviewImage(imgId, filePrefix);
    const preview = await getPreview(imgId);
    if (!savedUrl || !preview || preview.savedUrl !== savedUrl) {
        throw new Error('图片未成功写入酒馆服务器');
    }
    assertTarget();
    if (expectedMessage) {
        if (!Number.isInteger(messageId) || messageId < 0) {
            throw new Error('图片的聊天消息编号无效');
        }
        const synced = await syncDrawSavedFromPreview(messageId, preview, { slotId, savedUrl });
        if (!synced) throw new Error('图片已存服务器，但聊天图片地址未保存');
    }
    return savedUrl;
}
