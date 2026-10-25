const FIELDS = {
    'images[].scene': '画面描述', 'images[].insert_after': '插图位置（现在使用原文定位句）',
    'images[].characters[].name': '人物姓名', 'images[].characters[].type': '人物身份',
    'images[].characters[].appear': '新人物外貌', 'images[].characters[].costume': '当前服装',
    'images[].characters[].action': '动作与动态状态', 'images[].characters[].interact': '人物互动',
    'images[].characters[].uc': '人物额外负向', 'images[].post_prompt': '整图追加词',
};

export function renderDirectDrawFields(container, { descriptions = {}, onEdit, onReset }) {
    const doc = container.ownerDocument;
    const list = doc.createElement('div');
    list.className = 'chain-fields';
    for (const key of new Set([...Object.keys(FIELDS), ...Object.keys(descriptions)])) {
        const row = doc.createElement('div'); row.className = 'chain-field';
        const label = doc.createElement('label'); label.textContent = FIELDS[key] || '原有绘图补充规则';
        const input = doc.createElement('textarea'); input.className = 'chain-field-desc'; input.rows = 2;
        input.dataset.path = key;
        input.value = descriptions[key] || ''; input.setAttribute('aria-label', label.textContent);
        input.addEventListener('input', () => onEdit(key, input.value));
        label.append(input); row.append(label);
        const reset = doc.createElement('button'); reset.className = 'btn btn-sm'; reset.type = 'button';
        reset.textContent = '清空补充'; reset.addEventListener('click', () => onReset(key));
        row.append(reset); list.append(row);
    }
    container.append(list);
}
