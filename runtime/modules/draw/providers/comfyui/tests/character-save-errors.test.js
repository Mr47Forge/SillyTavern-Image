import test from 'node:test';
import assert from 'node:assert/strict';
import {describeCharacterSaveError} from '../character-save-errors.js';
test('user-facing save error does not expose secrets', () => {
    assert.match(describeCharacterSaveError(Object.assign(new Error('Bad Gateway'), { status: 502 })), /502/);
    assert.match(describeCharacterSaveError(new Error('content_filter blocked')), /拒绝处理/);
    assert.doesNotMatch(describeCharacterSaveError(new Error('Bearer abc.example token')), /abc\.example/);
});

test('settings version conflicts explain that current values were not overwritten',()=>{assert.match(describeCharacterSaveError(Object.assign(new Error('conflict'),{code:'STORAGE_VERSION_CONFLICT'})),/未覆盖/);});
