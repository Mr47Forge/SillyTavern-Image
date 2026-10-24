// Remove observations about source image boundaries without changing physical traits.
const chineseNonTraits = /(?:画面|图片|照片|镜头|取景|构图|截图|拍摄|图中|可见范围|画幅).{0,28}(?:仅|只|截|裁|入镜|看到|露出|显示|呈现|停留|范围)|(?:仅|只)(?:见|能看到|看到|露出|显示|拍到|呈现)|(?:不可|无法|不能|难以|未能|看不|不易)(?:从.{0,8})?(?:判断|确认|推断|辨认|看出|观察|确定)|(?:不在画面|画面外|不可见|未入镜|未出镜|没有拍到|未展示|看不到|被裁切)|(?:其余|其他|剩余).{0,16}(?:看不见|不可见|未出镜)/u;
const englishNonTraits = /\b(?:only|just)\s+(?:the\s+)?(?:head|face|neck|shoulders?|upper\s+body|torso|thighs?|waist|chest).{0,38}\b(?:visible|shown|seen|in\s+(?:the\s+)?frame)|\b(?:cannot|can't|unable\s+to|impossible\s+to|not\s+possible\s+to)\s+(?:be\s+)?(?:determine|determined|judge|judged|assess|assessed|infer|inferred|see|seen|observe|observed|tell|confirm|confirmed)|\b(?:not\s+visible|out\s+of\s+(?:the\s+)?frame|not\s+shown|outside\s+the\s+image|not\s+pictured|cropped\s+(?:at|to|above|below)|cropped\s+(?:portrait|image|photo)|waist[- ]up\s+(?:shot|portrait|framing)|head[- ]and[- ]shoulders\s+(?:shot|portrait)|close[- ]up\s+(?:shot|portrait)|upper[- ]body\s+(?:only|shot|portrait)|image\s+(?:only\s+)?shows|photo\s+(?:only\s+)?shows)\b/i;
export function cleanCharacterAppearanceText(value, language = 'en') {
    const original = String(value || '').trim();
    if (!original) return '';
    const zh = language === 'zh';
    const separator = zh ? '，' : ', ';
    const chunks = original.split(zh ? /[，,。；;\n]+/ : /[,;\n]+/);
    const bad = zh ? chineseNonTraits : englishNonTraits;
    const kept = chunks.map(s => s.trim()).filter(s => s && !bad.test(s));
    return kept.join(separator).trim();
}
export function cleanImageCharacterProfile(profile) {
    const cleanNamed = entries => (Array.isArray(entries) ? entries : [])
        .map(item => ({ ...item,
            name: cleanCharacterAppearanceText(item.name, 'zh'),
            tags: cleanCharacterAppearanceText(item.tags, 'en'),
        })).filter(item => item.name || item.tags);
    return {
        ...profile,
        appearanceZh: cleanCharacterAppearanceText(profile?.appearanceZh, 'zh'),
        appearance: cleanCharacterAppearanceText(profile?.appearance, 'en'),
        outfits: cleanNamed(profile?.outfits),
        dynamicStates: cleanNamed(profile?.dynamicStates),
    };
}
