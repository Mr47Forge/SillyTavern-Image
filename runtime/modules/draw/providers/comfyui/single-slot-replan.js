import { createDrawImageSlotRegex, stripDrawImageSlots } from '../../shared/image-marker-syntax.js';

/**
 * Redraw a single scene, not the whole message. Take the narrative immediately
 * preceding the original marker; older generated TAGs are intentionally absent.
 */
export function getSingleSlotReplanContext(sourceText, slotId, { maxBefore = 1600 } = {}) {
    const text = String(sourceText ?? '');
    const id = String(slotId || '').trim().toLowerCase();
    const matches = [...text.matchAll(createDrawImageSlotRegex())];
    const target = matches.find(match => String(match[1]).toLowerCase() === id);
    if (!target) throw new Error('原图片位置已经不存在，不能重新规划');
    const preceding = stripDrawImageSlots(text.slice(0, target.index));
    let snippet = preceding.slice(-maxBefore).trim();
    // If a marker was placed at the very beginning of a story, use nearby text
    // rather than submitting an empty/meaningless plan.
    if (!snippet) {
        snippet = stripDrawImageSlots(text.slice(target.index + target[0].length, target.index + target[0].length + maxBefore)).trim();
    }
    if (!snippet) throw new Error('原图片位置附近没有可供分析的剧情文字');
    return snippet;
}

export function normalizeSingleSlotReplanTask(plannedTasks, slotId, oldScene = '') {
    const tasks = Array.isArray(plannedTasks) ? plannedTasks : [];
    if (tasks.length !== 1 || !String(tasks[0]?.scene || '').trim()) {
        throw new Error('重新规划没有返回有效的单张图片提示词');
    }
    const task = tasks[0];
    // Don't silently spend a ComfyUI request on exactly the same image prompt.
    if (String(task.scene).trim() === String(oldScene || '').trim()) {
        throw new Error('重新规划返回了与原图完全相同的提示词，已停止重复生成');
    }
    return {
        ...task,
        placement: { mode: 'existing', slotId },
    };
}

export async function executeSingleSlotReplan({
    sourceText, slotId, oldScene = '', plan, submit, assertCurrent = () => {},
} = {}) {
    if (typeof plan !== 'function' || typeof submit !== 'function') throw new TypeError('缺少规划或绘图执行器');
    assertCurrent();
    const focusedText = getSingleSlotReplanContext(sourceText, slotId);
    const tasks = await plan(focusedText);
    assertCurrent();
    const plannedTask = normalizeSingleSlotReplanTask(tasks, slotId, oldScene);
    return submit(plannedTask);
}
