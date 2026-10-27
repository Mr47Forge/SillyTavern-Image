const text = (value, limit = 2400) => String(value ?? '').trim().slice(0, limit);
const named = items => (Array.isArray(items) ? items : []).slice(0, 24)
    .map(item => ({ name: text(typeof item === 'string' ? item : item?.name, 500), tags: '' }))
    .filter(item => item.name);

export function buildAiPromptCharacters(items) {
    return items.map((item, index) => {
        const name = text(item.name, 70);
        const appearanceZh = text(item.appearanceZh);
        if (!name || name.startsWith('待命名')) throw new Error('请给第 ' + (index + 1) + ' 名人物填写名称');
        if (!appearanceZh || !/[\u3400-\u9fff]/u.test(appearanceZh)) throw new Error('请填写该角色的中文外貌资料');
        return { name, aliases: [], type: item.type || 'other', appearance: '', appearanceZh,
            appearanceSource: 'chinese', negativeTags: '', danbooruTag: '',
            outfits: named(item.outfits), dynamicStates: named(item.dynamicStates) };
    });
}

export function resolveAiOutputBudgets(config = {}) {
    const configured = Number(config.maxTokens);
    const ceiling = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 8192;
    return { initial: Math.min(8192, ceiling), retry: Math.min(16384, ceiling) };
}
