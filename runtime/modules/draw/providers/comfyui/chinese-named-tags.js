// Chinese presentation for the host plugin's existing { name, tags } structure.
const text = value => String(value ?? '').trim();
export const namedTagsChineseText = items => (Array.isArray(items) ? items : [])
  .map(item => text(item?.name) || '（此项没有中文名称）')
  .join('\n');

export function reconcileChineseNamedLines(lines, existing = []) {
  const names = String(lines ?? '').split(/\r?\n/).map(text).filter(Boolean);
  const old = Array.isArray(existing) ? existing : [];
  const original = old.map(entry => ({ name: text(entry?.name), tags: text(entry?.tags) }));
  if (names.some(name => !/[\u3400-\u9fff]/u.test(name))) {
    throw new Error('服装和动态状态请用中文填写；英文绘图词会自动生成');
  }
  return names.map((name, i) => {
    if (name === '（此项没有中文名称）' && !original[i]?.name) {
      return { name: '', tags: original[i]?.tags || '' };
    }
    const originalExact = original.find((entry, index) => index >= i && entry.name === name);
    if (originalExact) return { name, tags: originalExact.tags };
    const before = original[i];
    return { name, tags: before?.name === name ? before.tags : '' };
  });
}
