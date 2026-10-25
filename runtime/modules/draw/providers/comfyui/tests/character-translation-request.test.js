import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableCharacterTranslationError, requestCharacterTranslation, describeCharacterSaveError } from '../character-translation-request.js';

test('transient upstream 502 retries once then returns translation', async () => {
    let calls = 0, waits = 0;
    const adapter = { async chat() { calls++; if (calls === 1) throw Object.assign(new Error('Bad gateway'), { status: 502 }); return { text: '{"translations":[]}' }; } };
    const result = await requestCharacterTranslation(adapter, { toolChoice: 'none' }, async (ms) => { waits++; assert.equal(ms, 1000); });
    assert.equal(result.text, '{"translations":[]}');
    assert.equal(calls, 2);
    assert.equal(waits, 1);
});

test('second 502 is not retried indefinitely', async () => {
    let calls = 0;
    const adapter = { async chat() { calls++; throw Object.assign(new Error('Bad gateway'), { status: 502 }); } };
    await assert.rejects(requestCharacterTranslation(adapter, {}, async () => {}), /Bad gateway/);
    assert.equal(calls, 2);
});

test('authorization and policy refusals are not retried', async () => {
    for (const issue of [Object.assign(new Error('not authorized'), { status: 401 }), new Error('content_filter blocked')]) {
        let calls = 0;
        const adapter = { async chat() { calls++; throw issue; } };
        await assert.rejects(requestCharacterTranslation(adapter, {}, async () => {}));
        assert.equal(calls, 1);
    }
});

test('user-facing save error does not expose secrets', () => {
    assert.match(describeCharacterSaveError(Object.assign(new Error('Bad Gateway'), { status: 502 })), /502/);
    assert.match(describeCharacterSaveError(new Error('content_filter blocked')), /拒绝处理/);
    assert.doesNotMatch(describeCharacterSaveError(new Error('Bearer abc.example token')), /abc\.example/);
});
