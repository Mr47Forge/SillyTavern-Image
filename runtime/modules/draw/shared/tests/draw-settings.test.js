import test from 'node:test';
import assert from 'node:assert/strict';

import {
    mergeSharedDrawSettingsIntoStorageRoot,
    normalizeSharedDrawSettings,
} from '../draw-settings.js';

test('shared draw settings retain current domain data and discard former LLM configuration', () => {
    const normalized = normalizeSharedDrawSettings({
        cacheDays: 9,
        timeout: 45000,
        useWorldInfo: true,
        danbooruLocalDB: true,
        characterTags: [{
            id: 'char-1',
            name: '阿璃',
            aliases: ['小璃', ''],
            type: 'girl',
            appearance: 'silver hair',
            negativeTags: 'bad hands',
            danbooruTag: 'ali_(original)',
            outfits: [{ name: '常服', tags: 'white dress' }],
            dynamicStates: [{ name: '害羞', tags: 'blush' }],
        }],
        messageFilterRules: [{ start: '<think>', end: '</think>' }],
        worldbooks: {
            enabled: true,
            uploadedBooks: [{ name: '设定集', entries: [] }],
            keywordFilterMode: 'all_active',
        },
        llmApi: { provider: 'openai', key: 'must-disappear' },
        useStream: true,
        disablePrefill: true,
        unknownLegacyField: 'must-disappear',
    });

    assert.equal(normalized.cacheDays, 9);
    assert.equal(normalized.timeout, 45000);
    assert.equal(normalized.useWorldInfo, true);
    assert.equal(normalized.worldbooks.keywordFilterMode, 'all_active');
    assert.deepEqual(normalized.characterTags[0].aliases, ['小璃']);
    assert.deepEqual(normalized.characterTags[0].dynamicStates, [{ name: '害羞' }]);
    assert.equal(Object.hasOwn(normalized.characterTags[0], 'appearance'), false);
    assert.equal(normalized.characterTags[0].enabled, true);
    assert.equal(Object.hasOwn(normalized, 'llmApi'), false);
    assert.equal(Object.hasOwn(normalized, 'useStream'), false);
    assert.equal(Object.hasOwn(normalized, 'disablePrefill'), false);
    assert.equal(Object.hasOwn(normalized, 'unknownLegacyField'), false);
});



test('shared character settings preserve explicit disabled state and default older records to enabled', () => {
    const normalized = normalizeSharedDrawSettings({
        characterTags: [
            { id: 'disabled', name: '同名角色', enabled: false },
            { id: 'legacy', name: '同名角色' },
        ],
    });

    assert.equal(normalized.characterTags[0].enabled, false);
    assert.equal(normalized.characterTags[1].enabled, true);
});



test('settings without groups normalize to an empty group list and no groupId keys', () => {
    const normalized = normalizeSharedDrawSettings({ characterTags: [{ id: 'a', name: 'A' }] });
    assert.deepEqual(normalized.characterGroups, []);
    assert.equal(Object.hasOwn(normalized.characterTags[0], 'groupId'), false);
    assert.deepEqual(normalizeSharedDrawSettings({}).characterGroups, []);
});



test('an old client saving characters without groups keeps stored groups and group membership', () => {
    const stored = normalizeSharedDrawSettings({
        characterGroups: [{ id: 'g1', name: '主线' }],
        characterTags: [{ id: 'a', name: '阿璃', groupId: 'g1' }],
    });
    // 旧 iframe 就地修改对象并整体回传 characterTags，不带 characterGroups。
    const edited = { ...stored.characterTags[0], appearance: 'silver hair' };
    const next = normalizeSharedDrawSettings({ ...stored, characterTags: [edited], characterGroups: stored.characterGroups });
    assert.equal(next.characterTags[0].groupId, 'g1');
    assert.equal(next.characterGroups.length, 1);
});







test('current shared-save preserves image-provider secrets without reviving removed LLM fields', () => {
    const stored = {
        apiKey:'image-provider-secret', useImageBackendJobs:true,
        paramsPresets:[{id:'preset-a'}],
        llmApi:{key:'retired-api-secret'},
    };
    const saved=mergeSharedDrawSettingsIntoStorageRoot(stored, {
        characterTags:[{id:'adult-a',name:'Character A',appearanceZh:'brown hair'}],
        characterGroups:[],
    });
    assert.equal(saved.apiKey,'image-provider-secret');
    assert.equal(saved.useImageBackendJobs,true);
    assert.equal(saved.paramsPresets[0].id,'preset-a');
    assert.equal(saved.characterTags[0].id,'adult-a');
    assert.equal(Object.hasOwn(saved,'llmApi'),false);
});

test('current shared-save preserves disabled group states and membership', () => {
    const root={apiKey:'image-provider-secret'};
    const shared=normalizeSharedDrawSettings({
        characterGroups:[{id:'g',name:'Hidden group',enabled:false}],
        characterTags:[{id:'a',name:'Character A',groupId:'g'}],
    });
    const saved=mergeSharedDrawSettingsIntoStorageRoot(root,shared);
    assert.deepEqual(saved.characterGroups,shared.characterGroups);
    assert.equal(saved.characterTags[0].groupId,'g');
    assert.equal(saved.characterGroups[0].enabled,false);
    assert.equal(saved.apiKey,'image-provider-secret');
});

test('groups that never used the switch stay byte-identical (no enabled key invented)', () => {
    const normalized = normalizeSharedDrawSettings({ characterGroups: [{ id: 'g1', name: '主线' }], characterTags: [] });
    assert.equal(JSON.stringify(normalized.characterGroups), '[{"id":"g1","name":"主线"}]');
});
