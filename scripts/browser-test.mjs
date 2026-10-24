import express from 'express';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const plugin = require('../server-plugin/index.js');
const root = resolve('.');
const directory = await mkdtemp(join(tmpdir(), 'sti-browser-'));
const files = join(directory, 'files'), images = join(directory, 'images');
await mkdir(files); await mkdir(join(images, 'LittleWhiteBox-role-photos'), { recursive:true });
await writeFile(join(images, 'LittleWhiteBox-role-photos', 'fixture.jpg'), Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(300)]));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0h0AAAAASUVORK5CYII=', 'base64');
const submitted = [], uploads = [], errors = [], calls = [], browserLogs = [];
const comfy = express(); comfy.use(express.json({limit:'2mb'}));
comfy.post('/upload/image', async (req,res)=>{ for await (const _ of req) {} uploads.push(true);res.json({name:'stimage-fixture.jpg',subfolder:''}); });
comfy.post('/prompt',(req,res)=>{submitted.push(req.body.prompt);res.json({prompt_id:'fixture-task-'+submitted.length});});
comfy.get('/history/:id',(req,res)=>res.json({[req.params.id]:{status:{completed:true,status_str:'success'},outputs:{29:{images:[{filename:'fixture.png',subfolder:'',type:'output'}]}}}}));
comfy.get('/view',(_req,res)=>res.type('png').send(png));
const comfyServer = await new Promise(resolve=>{const server=comfy.listen(0,'127.0.0.1',()=>resolve(server));});
const comfyURL='http://127.0.0.1:'+comfyServer.address().port;
const graph=JSON.parse(await readFile('server-plugin/workflows/krea2-identity-api.json','utf8'));
const workflow={id:'identity',name:'锁脸测试',json:JSON.stringify(graph),nodePositive:'84',nodeNegative:'',nodeWidth:'82',nodeHeight:'82',nodeSeed:'53',nodeSaveImage:'29'};
const config={host:comfyURL,useImageBackendJobs:true,connectionMode:'proxy',mode:'manual',workflowMode:'custom',workflowPresets:[workflow],selectedWorkflowPresetId:workflow.id,
  presets:[{id:'default',name:'默认',width:768,height:1152,steps:8,cfg:1}],selectedPresetId:'default'};
await writeFile(join(files,'SillyTavernImage_ComfyDraw.json'),JSON.stringify({config}));
await writeFile(join(files,'SillyTavernImage_NovelDraw.json'),JSON.stringify({settings:{characterTags:[{id:'alice',name:'测试角色甲',type:'woman',appearance:'adult woman',photoUrl:'user/images/LittleWhiteBox-role-photos/fixture.jpg',enabled:true}],characterGroups:[]}}));
const app=express(); app.use(express.json({limit:'10mb'}));
app.use((req,res,next)=>{ req.user={profile:{handle:'fixture'},directories:{files,userImages:images,root:directory}};calls.push(req.path);next(); });
const router=express.Router(); await plugin.init(router); app.use('/api/plugins/sillytavern-image-server',router);
app.use('/user/files',express.static(files)); app.use('/user/images',express.static(images));
app.post('/api/files/upload',async(req,res)=>{const name=String(req.body.name||'');if(!/^[\w.-]+$/.test(name))return res.sendStatus(400);await writeFile(join(files,name),Buffer.from(req.body.data,'base64'));res.json({path:'user/files/'+name});});
let chat=[];
app.post('/api/chats/save',(req,res)=>{chat=req.body.chat||[];res.json({ok:true});});
app.post('/api/chats/get',(_req,res)=>res.json(chat));
app.post('/api/sd/comfy/:kind',async(req,res)=>{
  if(req.params.kind==='generate') {
    submitted.push(JSON.parse(req.body.prompt).prompt);
    return res.json({data:png.toString('base64')});
  }
  const response=await fetch(comfyURL+'/'+req.params.kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body)});
  res.status(response.status).send(await response.text());
});
const hostScript=`
export const chat=window.fixture.chat,name1='用户',name2='测试角色甲';
export const eventSource=window.fixture.events,event_types=new Proxy({},{get:(_,key)=>key});
export const getRequestHeaders=()=>({'Content-Type':'application/json'});
export const saveSettingsDebounced=()=>{},syncMesToSwipe=()=>{},substituteParams=x=>x;
export const messageFormatting=x=>x.replaceAll('\\n','<br>');`;
app.get('/script.js',(_req,res)=>res.type('js').send(hostScript));
app.get('/scripts/extensions.js',(_req,res)=>res.type('js').send(`export const getContext=()=>window.fixture;export const extension_settings={};`));
app.get('/scripts/user.js',(_req,res)=>res.type('js').send(`export const getCurrentUserHandle=()=>'fixture';`));
app.get('/scripts/variables.js',(_req,res)=>res.type('js').send(`export const getLocalVariable=()=>'',setLocalVariable=()=>{};`));
app.get('/scripts/utils.js',(_req,res)=>res.type('js').send(`export const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}};export const uuidv4=()=>crypto.randomUUID();export const saveBase64AsFile=async()=>'/user/images/fixture.png';`));
const base='/scripts/extensions/third-party/SillyTavern-Image'; app.use(base,express.static(root));
app.get('/',(_req,res)=>res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${base}/extension/style.css"></head><body style="background:#24272f;color:#eee"><div id="chat"><div class="mes" mesid="0"><div class="mes_text">测试剧情</div></div></div><script>
const handlers=new Map();const events={on(k,f){const a=handlers.get(k)||[];a.push(f);handlers.set(k,a);},removeListener(k,f){handlers.set(k,(handlers.get(k)||[]).filter(x=>x!==f));},once(k,f){const h=(...a)=>{events.removeListener(k,h);return f(...a);};events.on(k,h);},makeFirst(){},makeLast(){},async emit(k,...a){for(const f of handlers.get(k)||[])await f(...a);}};
window.fixture={chatId:'fixture-chat',characterId:0,characters:[{name:'测试角色甲',avatar:'alice.png'}],groups:[],chat:[{mes:'测试角色甲在晴天公园散步。',name:'测试角色甲',is_user:false,extra:{},swipe_id:0}],chatMetadata:{stiDrawTagFormat:1},eventSource:events,events,getRequestHeaders:()=>({'Content-Type':'application/json'}),async saveChat(){await fetch('/api/chats/save',{method:'POST',headers:this.getRequestHeaders(),body:JSON.stringify({chat:[{chat_metadata:this.chatMetadata},...this.chat]})});},async saveMetadata(){}};
window.toastr=Object.fromEntries(['info','success','warning','error'].map(k=>[k,(...a)=>console.log(k,...a)]));
window.xiaobaixDraw={sentinel:true};window.xbEventCenter={sentinel:true};window.xbLog={sentinel:true};
</script><script type="module" src="${base}/extension/entry.js"></script></body></html>`));
const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>browserLogs.push(message.text()));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{const other=document.createElement('button');other.textContent='人物档案';other.style.cssText='position:fixed;right:18px;bottom:70px;width:90px;height:44px;z-index:100001';document.body.append(other);});
  await page.waitForFunction(()=>document.querySelector('#sti-home-status')?.textContent.includes('已启动'),null,{timeout:15000});
  assert(await page.evaluate(()=>window.xiaobaixDraw.sentinel&&window.xbEventCenter.sentinel&&window.xbLog.sentinel));
  await page.click('#sti-home-toggle'); await page.click('#sti-home-open');
  const frame=page.frameLocator('#stimage-comfy-draw-iframe');
  await frame.locator('[data-comfy-view="characters"]').first().click();
  await frame.getByText('测试角色甲',{exact:true}).first().waitFor();
  await frame.locator('[data-comfy-view="workflow"]').first().click();
  assert.equal(await frame.locator('#comfy-workflow-preset-select').inputValue(),'identity');
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['workflow','params','prompts']) {
      await frame.locator(`[data-comfy-view="${view}"]:visible`).first().click();
      const escaped = await frame.locator('.view.active .preset-bar button').evaluateAll(buttons=>buttons.flatMap(button=>{
        const bounds=button.getBoundingClientRect();
        for (const node of button.childNodes) {
          if (node.nodeType!==Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range=document.createRange();range.selectNodeContents(node);
          const text=range.getBoundingClientRect();
          if(text.left<bounds.left+1 || text.right>bounds.right-1) return [button.id];
        }
        return [];
      }));
      assert.deepEqual(escaped,[],`${width}px ${view}：文字必须在按钮边框内`);
    }
  }
  await frame.locator('[data-comfy-view="workflow"]:visible').first().click();
  await page.setViewportSize({width:390,height:844});
  const overflow=await frame.locator('body').evaluate(body=>body.scrollWidth>body.ownerDocument.documentElement.clientWidth+2);
  assert.equal(overflow,false,'手机页面不能横向溢出');
  await page.setViewportSize({width:1280,height:900});
  const result=await page.evaluate(async base=>{
    const {buildComfyImageRequest}=await import(base+'/runtime/modules/draw/providers/comfyui/compiler.js');
    const draw=window.stimageComfyDraw,settings=draw.getSettings();
    const shared=await import(base+'/runtime/modules/draw/shared/draw-settings.js');
    await shared.loadSharedDrawSettings();
    const workflow=settings.workflowPresets.find(x=>x.id==='identity');
    const request=buildComfyImageRequest({prompt:'测试角色甲在晴天公园散步。',params:{width:768,height:1152},seed:123,
      recipe:{workflowMode:'custom',customWorkflow:workflow,knownCharacters:shared.getSharedDrawSettings().characterTags}});
    const endpoint='/api/plugins/sillytavern-image-server/runtime/v1/jobs';
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'comfyui',requestId:'browser-fixture',context:{url:settings.host},delay:{min:1,max:1},items:[{request,timeout:10000}]})});
    const submitted=await response.json();if(!response.ok)throw Error(JSON.stringify(submitted));
    for(let i=0;i<100;i++){
      const body=await(await fetch(endpoint+'/'+submitted.job.id)).json();
      if(body.job.items[0].state==='ready')return {jobId:submitted.job.id,workflow:request.workflow};
      if(body.job.items[0].state==='failed')throw Error(JSON.stringify(body.job.items[0].error));
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('后台任务未完成');
  },base);
  assert.equal(result.workflow['79'].inputs.ref_boost,4);
  assert.equal(submitted.length,1); assert.equal(uploads.length,1);
  assert.equal(submitted[0]['72'].inputs.image,'stimage-fixture.jpg');
  assert.equal(submitted[0]['84'].inputs.grounding_px,1024);
  assert.equal(submitted[0]['53'].inputs.steps,8);
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/plugins/sillytavern-image-server/runtime/v1/jobs/'+result.jobId+'/results/0');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  // A role button must bind that exact role even when the prompt contains no name.
  await frame.locator('[data-comfy-view="characters"]').first().click();
  await frame.locator('[data-sd-char-test="alice"]').click();
  await page.getByRole('button',{name:'开始测试',exact:true}).click();
  await page.waitForFunction(()=>/生成完成|测试失败/.test(document.querySelector('#comfy-role-test-modal [role="status"]')?.textContent||''),null,{timeout:10000});
  if (!(await page.locator('#comfy-role-test-modal [role="status"]').innerText()).includes('生成完成')) console.log({browserLogs:browserLogs.slice(-5),calls:calls.slice(-15),submitted:submitted.length});
  assert.match(await page.locator('#comfy-role-test-modal [role="status"]').innerText(),/生成完成/);
  assert.equal(submitted.length,2); assert.equal(uploads.length,2);
  assert.equal(submitted[1]['72'].inputs.image,'stimage-fixture.jpg');
  assert.equal(errors.length,0,errors.join('\n'));
  assert.deepEqual(browserLogs.filter(text=>text.includes('Refused to apply style')&&text.includes('/runtime/')),[],'独立界面样式必须完整可用');
  if(process.env.STI_SCREENSHOT)await page.screenshot({path:process.env.STI_SCREENSHOT,fullPage:true});
  console.log('浏览器检查通过：独立入口、旧插件共存、角色与工作流页面、手机布局、参考图上传、独立后台任务、单角色测试照片绑定和取图。');
} finally {
  await browser?.close(); await plugin.exit();
  await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>comfyServer.close(resolve))]);
  await rm(directory,{recursive:true,force:true});
}
