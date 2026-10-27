// 独立绘图 画图正文槽位的唯一语法定义。调用方需要独立 RegExp，避免共享 global lastIndex。
export const DRAW_IMAGE_SLOT_PATTERN = String.raw`\[image\s*:\s*([a-z0-9_-]+)\]`;

export function createDrawImageSlotRegex(flags = 'gi') {
    return new RegExp(DRAW_IMAGE_SLOT_PATTERN, flags);
}

export function stripDrawImageSlots(sourceText) {
    return String(sourceText ?? '').replace(createDrawImageSlotRegex(), '');
}
// 剧情直出标记：剧情模型在回复尾部输出 <image>...</image> 块，插件解析后直接出图（跳过场景规划）。
export function parseDrawImageDirectives(sourceText,{skipInvalid=false}={}) {
    const text = String(sourceText ?? '');
    const results = [];
    let start = 0;
    let imageIndex = 0;
    while (true) {
        const opening=/<image\s*>/ig;opening.lastIndex=start;
        const match=opening.exec(text);
        if(!match)break;
        const open=match.index;
        const closing=/<\/image\s*>/ig;closing.lastIndex=open+match[0].length;
        const end=closing.exec(text);
        if(!end)break;
        const close=end.index;
        const body = text.slice(open + match[0].length, close);
        const lines = body.split(String.fromCharCode(10));
        let prompt = '';
        let negative = '';
        let charactersRaw = '';
        let after = '';
        let postPrompt = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const idx = line.indexOf(':');
            if (idx < 0) continue;
            const key = line.slice(0, idx).trim().toLowerCase();
            const val = line.slice(idx + 1).trim();
            if (!val && key !== 'characters' && key !== '\u89d2\u8272') continue;
            if (key === 'prompt' || key === 'positive' || key === '提示词' || key === '正向') prompt = val;
            else if (key === 'negative' || key === '负向' || key === '负向提示词') negative = val;
            else if (key === 'characters' || key === '角色') {
                charactersRaw = val;
                if (!charactersRaw && lines[i + 1]?.trim().startsWith('[')) {
                    charactersRaw = lines[++i].trim();
                }
                if (charactersRaw.startsWith('[')) {
                    while (i + 1 < lines.length) {
                        try {
                            JSON.parse(charactersRaw);
                            break;
                        } catch { /* Continue collecting a multiline JSON array. */ }
                        charactersRaw += '\n' + lines[++i].trim();
                    }
                }
            }
            else if (key === 'after' || key === '插图位置' || key === '插入位置') after = val;
            else if (key === 'post_prompt') postPrompt = val;
        }
        let characters = [];
        let parseError='';
        try{
        if (charactersRaw.startsWith('[')) {
            try { characters = JSON.parse(charactersRaw); }
            catch { throw new Error('绘图指令的人物资料格式不完整，请重新生成这条剧情回复'); }
            if (!Array.isArray(characters)) throw new Error('绘图指令的人物资料必须是列表');
        } else if (charactersRaw) characters = charactersRaw.split(/[,，、]/).map(x => x.trim()).filter(Boolean);
        }catch(error){if(!skipInvalid)throw error;parseError=error.message;}
        if (prompt || negative || characters.length) {
            results.push({ imageIndex, prompt, negative, characters,...(parseError?{parseError}:{}), ...(after ? { after } : {}), ...(postPrompt ? { post_prompt: postPrompt } : {}) });
        }
        imageIndex++;
        start = close + end[0].length;
    }
    return results;
}

export function stripDrawImageDirectives(sourceText) {
    return String(sourceText??'').replace(/<image\s*>[\s\S]*?<\/image\s*>/gi,'');
}
