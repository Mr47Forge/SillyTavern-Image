import { getRequestHeaders } from '../../../../../../../script.js';
// Image diagnostics for LittleWhiteBox ComfyUI. No API keys, host URLs,
// character images or raw entire workflow files are included in these records.
const ERROR_DB = 'xb_comfy_draw_error_logs';
const ERROR_STORE = 'errors';
const ERROR_LIMIT = 300;
let errorDatabase = null;
const ERROR_SERVER_ENDPOINT = '/api/plugins/littlewhitebox-server/v1/diagnostics/errors';
async function serverDiagnosticRequest(method, data = null) {
    const res = await fetch(ERROR_SERVER_ENDPOINT, {
        method,
        headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(7000),
        ...(data === null ? {} : { body: JSON.stringify(data) }),
    });
    if (!res.ok) throw new Error('H28K 日志服务 HTTP ' + res.status);
    const answer = await res.json();
    if (!answer.ok) throw new Error('H28K 未确认日志操作');
    return answer;
}
function errorMetadata(entry) {
    return {
        stage: entry.stage, errorType: entry.errorType, message: entry.message,
        provider: entry.provider, model: entry.model, source: entry.source,
    };
}
function dbOpen() {
    if (errorDatabase) return Promise.resolve(errorDatabase);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve,reject) => {
        const request = indexedDB.open(ERROR_DB,1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(ERROR_STORE)) {
                request.result.createObjectStore(ERROR_STORE, { keyPath:'id', autoIncrement:true });
            }
        };
        request.onsuccess = () => {
            errorDatabase=request.result;
            errorDatabase.onversionchange = () => { errorDatabase.close(); errorDatabase=null; };
            resolve(errorDatabase);
        };
        request.onerror=() => reject(request.error);
    });
}
function safeText(input,max=8000) { return String(input??'').slice(0,max); }
export function workflowPromptTrace(request = {}, fallback = {}) {
    const workflow = request?.workflow || {};
    const nodes=Object.entries(workflow).filter(([,v])=>v && typeof v==='object');
    const textNodes=[];
    for (const [id,node] of nodes) {
        if (!['CLIPTextEncode','TextEncodeKrea2Reference','CLIPTextEncodeSDXL'].includes(String(node.class_type||''))) continue;
        const value=node.inputs?.prompt ?? node.inputs?.text ?? node.inputs?.text_g ?? '';
        if (typeof value !== 'string' || !value.trim()) continue;
        textNodes.push({ id:safeText(id,16), type:safeText(node.class_type,52), text:safeText(value,12000) });
    }
    const sampler=nodes.find(([,v])=>v.class_type==='KSampler' || v.class_type==='KSamplerAdvanced')?.[1]?.inputs || {};
    const imageNode=nodes.find(([,v])=>v.class_type==='LoadImage')?.[1];
    return {
        positive: safeText(fallback.positive || '',12000),
        negative: safeText(fallback.negative || '',12000),
        nodes:textNodes.slice(0,15),
        seed: sampler.seed ?? sampler.noise_seed ?? null,
        steps: sampler.steps ?? null,
        cfg: sampler.cfg ?? null,
        sampler: safeText(sampler.sampler_name || '',65),
        scheduler: safeText(sampler.scheduler || '',65),
        referencePhoto: Boolean(imageNode),
        savedAt:Date.now(),
    };
}
export async function writeImageError(info={}) {
    const entry={
        time:Date.now(), provider:safeText(info.provider || 'ComfyUI',65), model:safeText(info.model || '',95), source:safeText(info.source || 'frontend',40),
        slotId:safeText(info.slotId,140),imgId:safeText(info.imgId,140),
        chatId:safeText(info.chatId,140), messageId:safeText(info.messageId,100),
        stage:safeText(info.stage||'生成',100),errorType:safeText(info.errorType||'错误',150),
        message:safeText(info.errorMessage || '未知错误',3000),
        positive:safeText(info.positive,12000),negative:safeText(info.negativePrompt,12000),
    };
    // Server persistence first; IndexedDB remains a backward compatible local copy.
    try {
        const saved = await serverDiagnosticRequest('POST', errorMetadata(entry));
        if (saved?.item?.time) entry.time = saved.item.time;
    } catch (error) {
        console.error('[LittleWhiteBox] Error log was NOT saved on H28K', error);
        globalThis.toastr?.error?.('H28K 错误日志保存失败：' + String(error?.message || error), '小白 X');
    }
    const db=await dbOpen();
    if (!db) return entry;
    await new Promise((resolve,reject)=>{
        const tx=db.transaction(ERROR_STORE,'readwrite');
        tx.objectStore(ERROR_STORE).add(entry);
        tx.oncomplete=resolve;
        tx.onerror=tx.onabort=()=>reject(tx.error);
    });
    // Keep only the latest 300 errors without affecting any gallery images.
    await new Promise((resolve,reject)=>{
        const tx=db.transaction(ERROR_STORE,'readwrite');
        const store=tx.objectStore(ERROR_STORE);
        let kept=0;
        store.openCursor(null,'prev').onsuccess=e=>{
            const cursor=e.target.result;
            if (!cursor) return;
            if (++kept>ERROR_LIMIT) cursor.delete();
            cursor.continue();
        };
        tx.oncomplete=resolve;
        tx.onerror=tx.onabort=()=>reject(tx.error);
    });
    return entry;
}
export async function readImageErrors(limit=100) {
    const max=Math.min(300,Math.max(1,Number(limit)||100));
    // Never pretend logs are empty if the server cannot be reached.
    const persistent=(await serverDiagnosticRequest('GET')).items || [];
    const db=await dbOpen();
    if (!db) return persistent.slice(0,max);
    const local=await new Promise((resolve,reject)=>{
        const rows=[];
        const tx=db.transaction(ERROR_STORE,'readonly');
        const cursor=tx.objectStore(ERROR_STORE).openCursor(null,'prev');
        cursor.onsuccess=e=>{
            if (e.target.result && rows.length<max) {
                rows.push(e.target.result.value);
                e.target.result.continue();
            }
        };
        tx.oncomplete=()=>resolve(rows);
        tx.onerror=tx.onabort=()=>reject(tx.error);
    }).catch(error => {
        console.warn('[LittleWhiteBox] Previous browser logs unreadable',error);
        return [];
    });
    const seen=new Set(persistent.map(e=>[e.time,e.stage,e.message].join('|')));
    return [...persistent,...local.filter(e=>!seen.has([e.time,e.stage,e.message].join('|')))]
        .sort((a,b)=>Number(b.time||0)-Number(a.time||0)).slice(0,max);
}
export async function clearImageErrors() {
    await serverDiagnosticRequest('DELETE');
    const db=await dbOpen();
    if (!db) return;
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(ERROR_STORE,'readwrite');
        tx.objectStore(ERROR_STORE).clear();
        tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
    });
}
function addLabeledSection(container,label,text,doc) {
    if (text===null || text===undefined || text==='') return;
    const heading=doc.createElement('div');
    heading.style.cssText='font-size:12px;color:#55e6b0;margin:10px 0 6px';
    heading.textContent=label;
    const detail=doc.createElement('pre');
    detail.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 Consolas,monospace;margin:0 0 10px;background:#252a35;border-radius:7px;padding:10px;color:#f4f4f5';
    detail.textContent=String(text);
    container.append(heading,detail);
}
export function formatImageLog(record={}) {
    const info=record.promptTrace || {};
    return {
        time:new Date(record.timestamp||info.savedAt||Date.now()).toLocaleString('zh-CN'),
        status:record.status==='failed'?'失败':'成功',
        positive:safeText(info.positive || record.positive || '',12000),
        negative:safeText(info.negative || record.negativePrompt || '',12000),
        traceNodes:Array.isArray(info.nodes)?info.nodes:[],
        sampler:info.sampler||'',
        scheduler:info.scheduler||'',
        steps:info.steps,seed:info.seed,cfg:info.cfg,
        error:safeText(record.errorMessage||'',3000),
        errorType:safeText(record.errorType||'',150),
        id:safeText(record.imgId,140),
        referencePhoto:info.referencePhoto,
    };
}
export function openImageDiagnostics(record={},opts={}) {
    const doc=opts.document || document;
    const old=doc.getElementById('xb-draw-diagnostics-overlay');
    old?.remove();
    const overlay=doc.createElement('div');
    overlay.id='xb-draw-diagnostics-overlay';
    Object.assign(overlay.style,{
        position:'fixed',inset:'0',zIndex:'100012',
        background:'rgba(0,0,0,.77)',display:'flex',alignItems:'center',
        justifyContent:'center',padding:'16px',
    });
    const card=doc.createElement('div');
    Object.assign(card.style,{
        background:'#191d26',color:'#f4f4f5',border:'1px solid #444b5a',
        borderRadius:'12px',width:'min(760px,96vw)',maxHeight:'90vh',
        display:'flex',flexDirection:'column',overflow:'hidden',
    });
    const header=doc.createElement('div');
    Object.assign(header.style,{display:'flex',padding:'15px 18px',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid #444b5a'});
    const title=doc.createElement('strong');
    title.textContent=opts.errors?'小白 X · 错误日志':'本张图片 · 提示词日志';
    const close=doc.createElement('button');
    close.textContent='关闭';close.type='button';
    Object.assign(close.style,{background:'#293140',color:'#f4f4f5',border:'1px solid #444b5a',borderRadius:'7px',padding:'6px 12px',cursor:'pointer'});
    header.append(title,close);
    const body=doc.createElement('div');
    Object.assign(body.style,{overflowY:'auto',padding:'15px 18px',lineHeight:'1.5',fontSize:'13px',whiteSpace:'normal'});
    const raw=record||{};
    if (opts.errors) {
        if (!opts.items?.length) body.textContent='暂无错误记录。';
        for(const e of opts.items||[]) {
            const section=doc.createElement('section');
            section.style.cssText='margin:0 0 15px;padding:10px;border:1px solid #4b3440;border-radius:8px;';
            addLabeledSection(section,'时间 / 阶段 / 错误类型',new Date(e.time).toLocaleString('zh-CN')+' / '+e.stage+' / '+e.errorType,doc);
            addLabeledSection(section,'错误详情',e.message,doc);
            addLabeledSection(section,'图片编号',e.imgId || e.slotId,doc);
            addLabeledSection(section,'当时正向提示词',e.positive,doc);
            addLabeledSection(section,'当时负向提示词',e.negative,doc);
            body.append(section);
        }
    } else {
        const info=formatImageLog(raw);
        addLabeledSection(body,'图片 / 时间 / 状态',info.id+' · '+info.time+' · '+info.status,doc);
        addLabeledSection(body,'最终正向提示词',info.positive,doc);
        addLabeledSection(body,'最终负向提示词',info.negative,doc);
        for(const node of info.traceNodes) addLabeledSection(body,'工作流节点 '+node.id+'（'+node.type+'）',node.text,doc);
        const params=['Seed: '+(info.seed??'无记录'),'Steps: '+(info.steps??'无记录'),'CFG: '+(info.cfg??'无记录'),info.sampler,info.scheduler].filter(Boolean).join(' · ');
        addLabeledSection(body,'生成参数',params,doc);
        if(info.error) addLabeledSection(body,'错误详情',info.errorType+': '+info.error,doc);
    }
    card.append(header,body);overlay.append(card);doc.body.append(overlay);
    function done(){overlay.remove();doc.removeEventListener('keydown',onKey,true);}
    function onKey(e){if(e.key==='Escape'){e.stopPropagation();done();}}
    close.addEventListener('click',done);
    overlay.addEventListener('click',e=>{if(e.target===overlay)done();});
    doc.addEventListener('keydown',onKey,true);
    return overlay;
}
