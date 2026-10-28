import {createDrawImageSlotRegex} from './image-marker-syntax.js';
import {assembleCharacterPrompts} from './character-prompts.js';
import {PreviewStatus,DRAW_SLOT_ERRORS} from './image-record.js';
const savedKeys=['stimageDrawSaved','xiaobaixDrawSaved','novelDrawSaved'];
const text=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const saved=(message,id)=>savedKeys.map(key=>message?.extra?.[key]?.[id]).find(p=>p?.savedUrl);

export function hasOwnedImageSlots(message,{ownedSlotIds=new Set()}={}){
    return [...String(message?.mes||'').matchAll(createDrawImageSlotRegex())].some(m=>
        message?.extra?.sti_comfy_slots?.[m[1]]||saved(message,m[1])||ownedSlotIds.has(m[1]));
}

export function getImageSlotDirective(message,slotId){
    let identity=message?.extra?.sti_comfy_slots?.[slotId]||saved(message,slotId)?.directiveIdentity;
    if(!identity){
        const scene=text(saved(message,slotId)?.tags);
        const ds=message?.extra?.sti_comfy_direct?.directives||[];
        const matches=scene?ds.map((d,i)=>({...d,imageIndex:d.imageIndex??i})).filter(d=>text(d.prompt)===scene):[];
        if(matches.length!==1)return null;
        identity=matches[0];
    }
    // This is the identity saved at the original, host-visible placement.
    // Recovery must not re-filter the source with a different preset-specific
    // narrative rule; mountImageCardAtVisibleAnchor verifies DOM visibility.
    return {imageIndex:identity.imageIndex,after:String(identity.after||identity.requestedAfter||'').replace(/\s+/g,' ').trim()};
}

export function bindImageSlotDirectives(message,tasks,ids,metadata=[],{jobId='',backend=false}={}){
    message.extra||={};message.extra.sti_comfy_slots||={};
    tasks.forEach((task,i)=>{
        const id=ids[i].slotId,previous=message.extra.sti_comfy_slots[id];
        const identity=task.directiveIdentity||getImageSlotDirective(message,id)||{};
        const input=metadata[i]||previous?.input||{};
        message.extra.sti_comfy_slots[id]={...identity,status:PreviewStatus.PENDING,imgId:ids[i].imgId,
            jobId,jobIndex:i,backend,updatedAt:Date.now(),input:structuredClone({...input,
                characters:task.chars?.some(p=>p.appear)?task.chars:previous?.input?.characters||task.chars||[]})};
    });
}

export function recordImageSlotResult(message,slotId,preview){
    const entry=message?.extra?.sti_comfy_slots?.[slotId];
    if(!entry||!preview)return false;
    Object.assign(entry,{status:preview.status,imgId:preview.imgId,updatedAt:preview.timestamp||Date.now(),
        errorType:preview.errorType||null,errorMessage:preview.errorMessage||null});
    return true;
}

export function getImageSlotRecord(message,slotId){
    const entry=message?.extra?.sti_comfy_slots?.[slotId];
    if(!entry)return null;
    let input=entry.input;
    if(!input){
        const ds=message.extra?.sti_comfy_direct?.directives||[];
        const d=ds.find((d,i)=>(d.imageIndex??i)===entry.imageIndex);
        const chars=entry.characters||d?.characters||[];
        const tags=entry.prompt||d?.prompt;
        if(!tags)return null;
        input={tags,characterPrompts:assembleCharacterPrompts(chars),extraNegativePrompt:d?.negative||'',postPrompt:d?.post_prompt||''};
    }
    if(!String(input.tags||'').trim())return null;
    const uncertain=[PreviewStatus.PENDING,PreviewStatus.UNKNOWN].includes(entry.status);
    return {...input,slotId,imgId:entry.imgId||`attempt-${slotId}`,timestamp:entry.updatedAt||0,
        status:uncertain?PreviewStatus.UNKNOWN:PreviewStatus.FAILED,
        errorType:uncertain?DRAW_SLOT_ERRORS.unknown.label:entry.errorType||'图片记录未找到',
        errorMessage:uncertain?'未找到当前设备可确认的任务记录；可能已提交，请先接回后台任务。':entry.errorMessage||'未找到已保存图片，可使用原输入重新生成。'};
}
