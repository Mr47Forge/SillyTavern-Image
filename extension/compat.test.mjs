import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';

test('共存保护只检查小白X绘图，不阻止其其他功能', async () => {
  const { legacyDrawIsActive } = await import('./compat.mjs');
  assert.equal(legacyDrawIsActive({ xiaobaixComfyDraw: { isEnabled: () => true } }), true);
  assert.equal(legacyDrawIsActive({ isXiaobaixEnabled: true }), false);
  assert.equal(legacyDrawIsActive({ xiaobaixComfyDraw: { isEnabled: () => false } }), false);
});

test('旧版图库只复制，重复导入不覆盖独立版记录', async () => {
  const { copyLegacyGallery } = await import('./compat.mjs');
  const open = (name) => new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('previews', { keyPath: 'imgId' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  const old = await open('xb_novel_draw_previews');
  await new Promise(resolve => { const t=old.transaction('previews','readwrite'); t.objectStore('previews').put({imgId:'a', tags:'原图'}); t.oncomplete=resolve; }); old.close();
  const current = await open('sti_novel_draw_previews');
  assert.equal(await copyLegacyGallery(indexedDB, current), 1);
  await new Promise(resolve => { const t=current.transaction('previews','readwrite'); t.objectStore('previews').put({imgId:'a', tags:'已编辑'}); t.oncomplete=resolve; });
  assert.equal(await copyLegacyGallery(indexedDB, current), 0);
  const record=await new Promise(resolve=>{current.transaction('previews').objectStore('previews').get('a').onsuccess=e=>resolve(e.target.result);});
  assert.equal(record.tags,'已编辑'); current.close();
});
