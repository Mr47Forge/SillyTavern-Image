import assert from 'node:assert/strict';
import test from 'node:test';
import { protectDrawImageMarkers } from '../scene-slot-protection.js';
import { createDrawImageSlotRegex } from '../image-marker-syntax.js';

test('two source image markers remain distinct and keep original positions', () => {
    const source = '开始\n\n[image:story-123-1]\n剧情继续\n\n[image:story-123-2]\n结束';
    const protectedValue = protectDrawImageMarkers(source);
    assert.equal(protectedValue.markers.length, 2);
    assert.notEqual(protectedValue.markers[0].token, protectedValue.markers[1].token);
    assert.deepEqual(protectedValue.markers.map(x => x.id), ['story-123-1', 'story-123-2']);
    const reconstructed = protectedValue.markers.reduce((text, x) => text.replace(x.token, x.marker), protectedValue.text);
    assert.equal(reconstructed, source);
    assert.equal((source.match(createDrawImageSlotRegex()) || []).length, 2);
});
test('single and zero markers are safe and the real message stays untouched', () => {
    for(const source of ['只是剧情','[image:one-1]\n之后的剧情']) {
        const expected = source.includes('image:') ? 1 : 0;
        const result = protectDrawImageMarkers(source);
        assert.equal(result.markers.length, expected);
        assert.equal(result.text.includes('[image:'), false);
    }
});
test('literal marker-like substrings do not make a second image disappear', () => {
    const source = 'Some X B I M A G E\n[image:one-1]\n\n[image:two-2]';
    const result = protectDrawImageMarkers(source);
    assert.equal(result.markers.length, 2);
    assert.deepEqual(result.markers.map(x => x.id), ['one-1','two-2']);
});
