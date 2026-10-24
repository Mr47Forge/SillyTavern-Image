import { resolveAutoLearnCharacter } from '../novelai/novel-character-learning.js';
import { buildAutoLearnCreateOp, buildAutoLearnUpdateOp, snapshotAutoLearnFields } from '../../shared/auto-learn-merge.js';

const GENERIC = /^(?:\u89d2\u8272\d*|\u4eba\u7269\d*|\u914d\u89d2.*|\u8def\u4eba.*|\u5973\u4eba\d*|\u7537\u4eba\d*|\u5973\u5b69\d*|\u7537\u5b69\d*|\u5c11\u5973\d*|\u5c11\u7537\d*|\u5973\d*|\u7537\d*|npc\d*|girl\d*|woman\d*|man\d*|boy\d*|unknown|stranger|passerby|teacher|boss|doctor|assistant|user|\u4f60|\u6211)$/i;

export function planComfyAutoLearn(tasks = [], characters = [], mode = 'new_only') {
    const pending = Array.isArray(characters) ? characters.map(item => ({ ...item })) : [];
    const operations = [];
    const seen = new Set();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        for (const source of Array.isArray(task?.chars) ? task.chars : []) {
            const name = String(source?.name || '').trim();
            const type = String(source?.type || '').trim();
            const appearance = String(source?.appear || '').trim()
                .replace(/\b\S*faceless\S*\b/gi, '').replace(/,\s*,/g, ',').replace(/^,\s*|\s*,$/g, '').trim();
            if (name.length < 2 || GENERIC.test(name) || (!appearance && !type)) continue;
            if (seen.has(name.toLocaleLowerCase())) continue;
            seen.add(name.toLocaleLowerCase());
            const candidate = { name, type, appear: appearance, danbooru: String(source?.danbooru || '').trim() };
            const resolved = resolveAutoLearnCharacter(candidate, pending);
            if (resolved.action === 'create' && type) {
                const newCharacter = {
                    id: 'comfy-learn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
                    enabled: true, name, aliases: [], type, appearance,
                    negativeTags: '', danbooruTag: candidate.danbooru,
                    outfits: [], dynamicStates: [],
                };
                operations.push(buildAutoLearnCreateOp(newCharacter, { candidate }));
                pending.push(newCharacter);
            } else if (resolved.action === 'update' && mode === 'auto_update') {
                const target = resolved.character;
                const before = snapshotAutoLearnFields(target);
                const next = { ...target };
                if (!next.appearance && appearance) next.appearance = appearance;
                if (!next.danbooruTag && candidate.danbooru) next.danbooruTag = candidate.danbooru;
                if (!target.appearance && !appearance && type) next.type = type;
                const op = buildAutoLearnUpdateOp(next, before);
                if (op) {
                    operations.push(op);
                    Object.assign(target, next);
                }
            }
        }
    }
    return operations;
}

export { resolveAutoLearnCharacter };
