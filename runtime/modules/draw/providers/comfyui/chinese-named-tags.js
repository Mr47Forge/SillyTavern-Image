// Role references are Chinese-only. Never carry hidden legacy English tags.
const text = value => String(value ?? '').trim();
export const namedTagsChineseText = items => (Array.isArray(items) ? items : [])
  .map(item => text(item?.name))
  .filter(Boolean)
  .join('\n');

export function reconcileChineseNamedLines(lines) {
  const names = String(lines ?? '').split(/\r?\n/).map(text).filter(Boolean);
  if (names.some(name => !/[\u3400-\u9fff]/u.test(name))) {
    throw new Error('服装与动态状态请直接填写中文描述，无需英文绘图词汇或额外翻译');
  }
  return names.map(name => ({ name }));
}
