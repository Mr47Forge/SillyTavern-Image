import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDrawRunMarkerAndConfirm, classifyMissingDrawRun } from '../draw-run-coordinator.js';
import { createDrawRunMarker, getDrawRunAutomaticCompletion, getDrawRunMarker, listDrawRunMarkers, setDrawRunMarker } from '../draw-run-markers.js';
import { createDrawRunId } from '../draw-run-identifiers.js';
import { withConfirmableChatMutation } from '../confirmable-chat-save.js';

function createMessage() {
    return {
        mes: 'Hello.',
        extra: {},
        swipe_id: 0,
        swipes: ['Hello.', 'Other.'],
        swipe_info: [{ extra: {} }, { extra: {} }],
    };
}

function syncMessage(message) {
    return () => {
        message.swipe_info[message.swipe_id].extra = structuredClone(message.extra);
        return true;
    };
}

test('Draw Run ids fall back to cryptographic random bytes when randomUUID is unavailable', () => {
    const runId = createDrawRunId({
        getRandomValues(bytes) {
            bytes.forEach((_value, index) => { bytes[index] = index; });
            return bytes;
        },
    });

    assert.equal(runId, '00010203-0405-4607-8809-0a0b0c0d0e0f');
});



test('Draw Run marker accessor mirrors active swipe and isolates inactive swipes', () => {
    const message = createMessage();
    const syncActiveSwipe = syncMessage(message);
    setDrawRunMarker({
        message,
        messageId: 0,
        runId: 'run-test-101',
        marker: { provider: 'novelai', sourceHash: 'hash-1', targetHash: 'target-1', createdAt: 100 },
        syncActiveSwipe,
    });
    setDrawRunMarker({
        message,
        messageId: 0,
        swipeIndex: 1,
        runId: 'run-test-102',
        marker: { provider: 'comfyui', sourceHash: 'hash-2', targetHash: 'target-2', createdAt: 200 },
        syncActiveSwipe,
    });

    assert.equal(message.swipe_info[0].extra.stiDrawRuns['run-test-101'].sourceHash, 'hash-1');
    assert.equal(Object.hasOwn(message.extra.stiDrawRuns, 'run-test-102'), false);
    assert.equal(getDrawRunMarker(message, 1, 'run-test-102').provider, 'comfyui');
    assert.deepEqual(listDrawRunMarkers(message).map(item => item.runId), ['run-test-101', 'run-test-102']);
});



test('Draw Run marker preserves a validated cancellation intent across swipe mirroring', () => {
    const message = createMessage();
    const syncActiveSwipe = syncMessage(message);
    const marker = createDrawRunMarker({
        provider: 'novelai',
        sourceHash: 'hash-1',
        targetHash: 'target-1',
        createdAt: 100,
        cancelRequestedAt: 200,
    });
    setDrawRunMarker({
        message,
        messageId: 0,
        runId: 'run-test-111',
        marker,
        syncActiveSwipe,
    });
    assert.equal(getDrawRunMarker(message, 0, 'run-test-111').cancelRequestedAt, 200);
    assert.equal(message.swipe_info[0].extra.stiDrawRuns['run-test-111'].cancelRequestedAt, 200);
    assert.throws(() => createDrawRunMarker({
        provider: 'novelai', sourceHash: 'hash-1', targetHash: 'target-1', createdAt: 100, cancelRequestedAt: 0,
    }), /取消时间无效/);
});



test('a message without swipe_id treats only swipe zero as the active working copy', () => {
    const message = {
        mes: 'Hello.',
        extra: {},
        swipes: ['Hello.', 'Other.'],
        swipe_info: [{ extra: {} }, { extra: {} }],
    };
    setDrawRunMarker({
        message,
        messageId: 0,
        swipeIndex: 0,
        runId: 'run-test-105',
        marker: { provider: 'novelai', sourceHash: 'hash-1', targetHash: 'target-1', createdAt: 100 },
    });
    setDrawRunMarker({
        message,
        messageId: 0,
        swipeIndex: 1,
        runId: 'run-test-106',
        marker: { provider: 'novelai', sourceHash: 'hash-2', targetHash: 'target-2', createdAt: 200 },
    });

    assert.equal(message.extra.stiDrawRuns['run-test-105'].sourceHash, 'hash-1');
    assert.equal(message.swipe_info[0].extra.stiDrawRuns, undefined);
    assert.equal(message.swipe_info[1].extra.stiDrawRuns['run-test-106'].sourceHash, 'hash-2');
});



test('an uncertain marker removal restores the local deletion handle for read-back recovery', async () => {
    const message = createMessage();
    const ctx = { chatId: 'chat-1', chat: [message], getRequestHeaders: () => ({}) };
    const marker = setDrawRunMarker({
        message,
        messageId: 0,
        runId: 'run-test-115',
        marker: {
            provider: 'novelai', sourceHash: 'hash-1', targetHash: 'target-1', createdAt: 100,
            automatic: true,
        },
        syncActiveSwipe: syncMessage(message),
    });

    await assert.rejects(clearDrawRunMarkerAndConfirm({
        ctx,
        message,
        messageId: 0,
        swipeIndex: 0,
        runId: 'run-test-115',
        marker,
        syncActiveSwipe: syncMessage(message),
        completeAutomatic: true,
        saveAndConfirm: async () => {
            assert.equal(getDrawRunAutomaticCompletion(message, 0, 'novelai'), true);
            throw new Error('readback lost');
        },
    }), /readback lost/);

    assert.deepEqual(getDrawRunMarker(message, 0, 'run-test-115'), marker);
    assert.equal(getDrawRunAutomaticCompletion(message, 0, 'novelai'), false);
});



test('successful automatic handoff replaces its marker with the existing provider auto-done fact', async () => {
    const message = createMessage();
    const ctx = { chatId: 'chat-1', chat: [message], getRequestHeaders: () => ({}) };
    const syncActiveSwipe = syncMessage(message);
    const marker = setDrawRunMarker({
        message,
        messageId: 0,
        runId: 'run-test-116',
        marker: {
            provider: 'sd-webui',
            sourceHash: 'hash-1',
            targetHash: 'target-1',
            createdAt: 100,
            automatic: true,
        },
        syncActiveSwipe,
    });
    const persistedBefore = structuredClone(message);

    await clearDrawRunMarkerAndConfirm({
        ctx,
        message,
        messageId: 0,
        swipeIndex: 0,
        runId: 'run-test-116',
        marker,
        syncActiveSwipe,
        completeAutomatic: true,
        saveAndConfirm: async ({ precondition, verify }) => {
            assert.equal(await precondition([{ chat_metadata: {} }, persistedBefore]), true);
            assert.equal(await verify([{ chat_metadata: {} }, structuredClone(message)]), true);
        },
    });

    assert.equal(getDrawRunMarker(message, 0, 'run-test-116'), null);
    assert.equal(message.extra.sti_sd_auto_done, true);
    assert.equal(message.swipe_info[0].extra.sti_sd_auto_done, true);
});



test('marker cleanup ignores unrelated chat drift but still rejects a changed target swipe', async () => {
    const message = createMessage();
    const unrelated = { mes: 'Local runtime-only value.', extra: { localOnly: true } };
    const ctx = { chatId: 'chat-1', chat: [message, unrelated], getRequestHeaders: () => ({}) };
    const syncActiveSwipe = syncMessage(message);
    const marker = setDrawRunMarker({
        message,
        messageId: 0,
        runId: 'run-test-117',
        marker: {
            provider: 'novelai',
            sourceHash: 'hash-1',
            targetHash: 'target-1',
            createdAt: 100,
        },
        syncActiveSwipe,
    });
    const persistedTarget = structuredClone(message);

    await clearDrawRunMarkerAndConfirm({
        ctx,
        message,
        messageId: 0,
        swipeIndex: 0,
        runId: 'run-test-117',
        marker,
        syncActiveSwipe,
        saveAndConfirm: async ({ precondition, verify }) => {
            assert.equal(await precondition([
                { chat_metadata: {} },
                persistedTarget,
                { mes: 'Different persisted value.', extra: {} },
            ]), true);
            assert.equal(await precondition([
                { chat_metadata: {} },
                { ...persistedTarget, mes: 'The target was edited elsewhere.' },
                { mes: 'Different persisted value.', extra: {} },
            ]), false);
            assert.equal(await verify([
                { chat_metadata: {} },
                structuredClone(message),
                { mes: 'Different persisted value.', extra: {} },
            ]), true);
        },
    });

    assert.equal(getDrawRunMarker(message, 0, 'run-test-117'), null);
});



test('missing Draw Runs stay uncertain for 120 seconds before marker cleanup', () => {
    assert.equal(classifyMissingDrawRun(1_000, 120_999), 'wait');
    assert.equal(classifyMissingDrawRun(1_000, 121_000), 'clear');
});



test('a page farewell narrows only its interrupted Draw Run submission window to 20 seconds', () => {
    const farewell = { kind: 'run', id: 'run-test-farewell', at: 100_000 };
    assert.equal(classifyMissingDrawRun(1_000, 119_999, farewell), 'wait');
    assert.equal(classifyMissingDrawRun(1_000, 120_000, farewell), 'clear');
    assert.equal(classifyMissingDrawRun(1_000, 120_000), 'wait');
});
