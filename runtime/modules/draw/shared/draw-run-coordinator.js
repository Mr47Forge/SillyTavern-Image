// Current runtime: endpoint, missing-run expiry and durable marker cleanup.
// The retired frontend planner submission path must not ship in production.
import { SERVER_PLUGIN_BASE } from '../../../shared/server-plugin/identity.js';
import { PAGE_FAREWELL_PREPARING_GRACE_MS } from './page-farewell.js';
import { withConfirmableChatMutation } from './confirmable-chat-save.js';
import {
 getDrawRunMarkerText,
 getDrawRunAutomaticCompletion,
 persistedChatHasDrawRunAutomaticCompletion,
 persistedChatHasDrawRunMarker,
 persistedDrawRunTargetMatches,
 removeDrawRunMarker,
 setDrawRunAutomaticCompletion,
 setDrawRunMarker,
} from './draw-run-markers.js';
export const DRAW_RUNS_ENDPOINT = `${SERVER_PLUGIN_BASE}/v1/draw-runs`;
export const SUBMISSION_UNCERTAINTY_WINDOW_MS = 120_000;

export function classifyMissingDrawRun(markerCreatedAt, now = Date.now(), farewell = null) {
    if (farewell?.kind === 'run' && Number.isFinite(Number(farewell.at))) {
        return Number(now) - Number(farewell.at) < PAGE_FAREWELL_PREPARING_GRACE_MS
            ? 'wait'
            : 'clear';
    }
    const age = Math.max(0, Number(now) - Number(markerCreatedAt));
    return age < SUBMISSION_UNCERTAINTY_WINDOW_MS ? 'wait' : 'clear';
}

export async function clearDrawRunMarkerAndConfirm({
    ctx,
    message,
    messageId,
    swipeIndex,
    runId,
    marker,
    syncActiveSwipe,
    saveAndConfirm,
    fetchImpl,
    completeAutomatic = false,
}) {
    return withConfirmableChatMutation(ctx, async () => {
        const expectedText = getDrawRunMarkerText({ message, swipeIndex });
        const shouldCompleteAutomatic = completeAutomatic === true && marker?.automatic === true;
        const automaticWasComplete = shouldCompleteAutomatic
            ? getDrawRunAutomaticCompletion(message, swipeIndex, marker.provider)
            : false;
        const restoreAutomaticCompletion = () => {
            if (!shouldCompleteAutomatic || automaticWasComplete) return;
            setDrawRunAutomaticCompletion({
                message,
                messageId,
                swipeIndex,
                provider: marker.provider,
                completed: false,
                syncActiveSwipe,
            });
        };
        let removed = false;
        try {
            if (shouldCompleteAutomatic) {
                setDrawRunAutomaticCompletion({
                    message,
                    messageId,
                    swipeIndex,
                    provider: marker.provider,
                    completed: true,
                    syncActiveSwipe,
                });
            }
            removed = removeDrawRunMarker({
                message,
                messageId,
                swipeIndex,
                runId,
                syncActiveSwipe,
            });
        } catch (error) {
            restoreAutomaticCompletion();
            throw error;
        }
        if (!removed) {
            restoreAutomaticCompletion();
            return;
        }
        try {
            await saveAndConfirm({
                ctx,
                fetchImpl,
                precondition: persistedChat => persistedDrawRunTargetMatches(
                    persistedChat,
                    runId,
                    expectedText,
                    marker,
                ),
                verify: persistedChat => !persistedChatHasDrawRunMarker(persistedChat, runId)
                    && (!shouldCompleteAutomatic || persistedChatHasDrawRunAutomaticCompletion(
                        persistedChat,
                        { messageId, swipeIndex, provider: marker.provider },
                    )),
            });
        } catch (error) {
            // 无论保存是否已经尝试，本页都必须恢复 marker：保存结果不确定时，
            // 后续恢复器会读回持久化聊天，区分「远端已删」与「仍需再次删除」。
            // 否则本页只剩 journal，面对远端仍在的 marker 将永远失去删除入口。
            // auto_done 只有读回确认后才是本页事实；若远端其实已经写入，恢复器
            // 会在确认 marker 已消失时把该事实重新同步回来。
            restoreAutomaticCompletion();
            setDrawRunMarker({
                message,
                messageId,
                swipeIndex,
                runId,
                marker,
                syncActiveSwipe,
            });
            throw error;
        }
    });
}

export async function reconcileMissingDrawRunMarker({
    marker,
    farewell = null,
    clear,
    now = Date.now,
} = {}) {
    if (classifyMissingDrawRun(marker?.createdAt, now(), farewell) === 'wait') return { action: 'wait' };
    await clear();
    return { action: 'cleared' };
}
