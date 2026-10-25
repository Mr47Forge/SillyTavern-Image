'use strict';
// Persistent, per-user diagnostics. Accept only short error metadata; no prompts,
// message bodies, host URLs, image content, access keys or provider request payloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const DIAG_PATH = '/v1/diagnostics/errors';
const RETAIN = 300;
const queues = new Map();
const DEFAULT_DIR = path.join(__dirname, 'data', 'error-logs');
function sanitize(value, max = 700) {
    let s = String(value ?? '').slice(0, max * 3);
    s = s.replace(/(?:sk-|gh[pousr]_|AIza|Bearer\s+)[A-Za-z0-9_./+=-]{6,}/gi, '[已隐藏密钥]');
    s = s.replace(/(?:https?:\/\/|wss?:\/\/)[^\s<>"']+/gi, '[已隐藏地址]');
    s = s.replace(/(?:api[_-]?key|token|authorization|password|cookie|secret)\s*[:=]\s*\S+/gi, '[已隐藏凭证]');
    s = s.replace(/([?&](?:key|token|api_key|apikey|auth)=)[^&\s]+/gi, '$1[已隐藏]');
    return s.slice(0, max);
}
function safeEntry(entry = {}) {
    const src = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    return {
        time: Date.now(),
        stage: sanitize(src.stage || '运行错误', 85),
        errorType: sanitize(src.errorType || 'ERROR', 90),
        message: sanitize(src.message || src.errorMessage || '未知错误', 700),
        provider: sanitize(src.provider || '', 65),
        model: sanitize(src.model || '', 95),
        source: sanitize(src.source || 'frontend', 40),
    };
}
function filePath(owner, dataDir = DEFAULT_DIR) {
    const name = createHash('sha256').update(String(owner)).digest('hex') + '.json';
    return path.join(dataDir, name);
}
async function read(owner, dataDir = DEFAULT_DIR) {
    try {
        const data = JSON.parse(await fs.readFile(filePath(owner,dataDir), 'utf8'));
        return Array.isArray(data) ? data.slice(-RETAIN).reverse() : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}
function serialize(owner, task) {
    const old = queues.get(owner) || Promise.resolve();
    const next = old.catch(() => {}).then(task);
    queues.set(owner, next);
    void next.finally(() => { if (queues.get(owner) === next) queues.delete(owner); }).catch(() => {});
    return next;
}
async function append(owner, entry, dataDir = DEFAULT_DIR) {
    return serialize(owner, async () => {
        const file = filePath(owner,dataDir);
        await fs.mkdir(dataDir,{recursive:true, mode:0o700});
        const previous=(await read(owner,dataDir)).reverse();
        const next=[...previous,safeEntry(entry)].slice(-RETAIN);
        const temp=file+'.'+process.pid+'.tmp';
        try {
            await fs.writeFile(temp,JSON.stringify(next),'utf8');
            await fs.chmod(temp,0o600);
            await fs.rename(temp,file);
        } finally {
            await fs.unlink(temp).catch(()=>{});
        }
        return next[next.length-1];
    });
}
async function clear(owner,dataDir=DEFAULT_DIR) {
    return serialize(owner,async()=>{await fs.rm(filePath(owner,dataDir),{force:true});});
}
function registerDiagnosticRoutes(router,{dataDir=DEFAULT_DIR}={}) {
    const auth=(req,res)=> {
        const handle=req.user?.profile?.handle;
        if(typeof handle!=='string' || !handle.trim()){
            res.status(403).send({ok:false,error:'Login required'});
            return null;
        }
        return handle;
    };
    router.get(DIAG_PATH,async(req,res)=>{
        res.setHeader('Cache-Control','no-store');
        const owner=auth(req,res);if(!owner)return;
        try{res.status(200).send({ok:true,items:await read(owner,dataDir)});}
        catch(error){res.status(503).send({ok:false,error:'日志读取失败'});}
    });
    router.post(DIAG_PATH,async(req,res)=>{
        res.setHeader('Cache-Control','no-store');
        const owner=auth(req,res);if(!owner)return;
        if(Buffer.byteLength(JSON.stringify(req.body||null))>5000) return res.status(413).send({ok:false,error:'日志内容过大'});
        try{res.status(201).send({ok:true,item:await append(owner,req.body,dataDir)});}
        catch(error){res.status(503).send({ok:false,error:'日志保存失败'});}
    });
    router.delete(DIAG_PATH,async(req,res)=>{
        res.setHeader('Cache-Control','no-store');
        const owner=auth(req,res);if(!owner)return;
        try{await clear(owner,dataDir);res.status(200).send({ok:true});}
        catch(error){res.status(503).send({ok:false,error:'清理失败'});}
    });
}
module.exports={DIAG_PATH,registerDiagnosticRoutes,safeEntry,append,read,clear};
