import test from 'node:test';
import assert from 'node:assert/strict';
import { namedTagsChineseText, reconcileChineseNamedLines } from '../chinese-named-tags.js';

test('Chinese references show only their visible names, never legacy English tags', () => {
  const old = [{ name: '白色衬衫', tags: 'white shirt' }, { name: '黑色半身裙', tags: 'black midi skirt' }];
  assert.equal(namedTagsChineseText(old), '白色衬衫\n黑色半身裙');
  assert.deepEqual(reconcileChineseNamedLines(namedTagsChineseText(old), old),
    [{ name: '白色衬衫' }, { name: '黑色半身裙' }]);
});

test('editing names cannot smuggle unchanged English tags into storage', () => {
  const old = [{ name: '灰色卫衣', tags: 'grey hoodie' }, { name: '黑色短裙', tags: 'black skirt' }];
  assert.deepEqual(reconcileChineseNamedLines('白色卫衣\n黑色短裙', old),
    [{ name: '白色卫衣' }, { name: '黑色短裙' }]);
});

test('English-only nameless legacy entries are never recreated from invisible data', () => {
  const old = [{ name: '', tags: 'black boots' }];
  assert.equal(namedTagsChineseText(old), '');
  assert.deepEqual(reconcileChineseNamedLines(namedTagsChineseText(old), old), []);
});

test('non-Chinese labels cannot silently become Chinese references', () => {
  assert.throws(() => reconcileChineseNamedLines('white shirt'), /中文/);
});
