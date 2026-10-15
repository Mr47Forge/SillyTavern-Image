'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const root='/home/node/app',plugin=root+'/plugins/littlewhitebox-server';
const {createAsyncImageJobManager}=require(plugin+'/image-jobs/job-manager.js');
const {createImageJobService}=require(plugin+'/image-jobs/service.js');
const adapter=require(plugin+'/providers/comfyui/adapter.js');
const cfg=JSON.parse(fs.readFileSync(root+'/data/default-user/user/files/LittleWhiteBox_ComfyDraw.json','utf8')).config;
const wf=JSON.parse(fs.readFileSync(root+'/data/default-user/user/workflows/Krea2_纯脸参考_角色照片自动匹配.json','utf8'));
const story=[
'暴雨落在海边的旧城。二十九岁的调查记者沈知微握着一张褪色的车票，站在废弃钟楼下。七年前一场海难带走了她的哥哥，也让整座城市习惯了沉默。一封没有署名的信把她重新带回故乡：如果还想知道真相，就在今夜九点到钟楼，找到第十三下钟声。她推开铁门，沿盘旋的台阶走上去，墙壁上留着少年们用粉笔画出的身高刻度。风从裂开的玻璃吹入，钟摆停在八点五十九分，机械深处却传来了脚步声。',
'[image:perf-scene-one]',
'脚步声属于林澈，三十二岁的港口机械师，也是哥哥以前最信任的朋友。他没有带武器，只抱着一本潮湿的航海日志。两人在钟楼的阴影里争执，旧事一件件掀开：那天夜里关闭灯塔的不是风暴，而是人。林澈拿出多年来收集的检修记录，指着同一处被反复涂改的签名，说有人提前三小时切断了引航灯电源。沈知微不肯相信。她记得哥哥最后一通电话里还在笑，问她第二天要不要一起吃早餐。林澈沉默良久，说哥哥早已发现危险，留下的最后一句话不是求救，而是让所有人远离码头北侧仓库。',
'风雨转急，潮水漫过城南的旧轨道。两人沿废弃铁路线赶到北仓库，发现大门外竟有新鲜的车辙。库房里堆着旧救生圈和成排的木箱，一张巨幅航道图挂在潮湿的墙上。沈知微从航海日志里找出一串数字，按照顺序敲击铁柜密码锁。铁门轻响，露出一台还在工作的老式录音机。录音里传来哥哥的声音，他平静而急促地逐一念出船只、日期和失踪者的姓名。那些声音像从时间深处浮上来，把每个人努力压住的记忆重新带回岸边。',
'[image:perf-scene-two]',
'门外响起汽车引擎声，刺眼的车灯穿过木板缝隙。林澈关掉录音机，沈知微把磁带装进外套内袋。两人从仓库另一侧的暗门逃出去，走进雨幕。她回望海面，远处那座多年未亮的灯塔忽然划过一道光，像有人终于决定回应这座城市迟到的疑问。黎明之前，他们还要找到当年的值班记录和存活的引航员，但至少从这一刻开始，真相不再只是一封匿名信。沈知微握紧磁带，在浪声中对林澈说：这一次，不准再有人替我们决定应该忘记什么。'
].join('\n\n');
const prompts=[
 'Cinematic realistic documentary photograph, stormy night at a disused seaside clock tower, one adult Chinese female investigative journalist age 29, long black hair and a dark navy raincoat, standing by an antique stopped clock mechanism near a tall broken window, raindrops reflecting old city lights, natural skin and lighting, environmental wide shot, no text',
 'Cinematic realistic documentary photograph inside an abandoned harbor warehouse at night, two Chinese adults, female journalist age 29 with long black hair wearing a navy raincoat and male harbor mechanic age 32 in a brown work jacket, studying an old cassette recorder and weathered nautical chart under a swinging yellow lamp, rain visible through wooden panels, natural faces, atmospheric wide shot, no text'
];
const owner='perf-bench-'+crypto.randomBytes(5).toString('hex'),jobId='story-bench-'+Date.now();
const start=performance.now(),ms=()=>Math.round(performance.now()-start);
function emit(name,info={}){console.log('EVENT '+JSON.stringify({at_ms:ms(),name,...info}));}
const originalFetch=globalThis.fetch.bind(globalThis);
let poll=0;
globalThis.fetch=async(input,options)=>{
 const u=new URL(String(input)),kind=u.pathname.endsWith('/prompt')?'prompt':u.pathname.includes('/history/')?'history':u.pathname.endsWith('/view')?'view':'other';
 const startFetch=performance.now();
 const response=await originalFetch(input,options);
 if(kind==='prompt')emit('comfy_prompt_response',{ms:Math.round(performance.now()-startFetch),status:response.status});
 if(kind==='history' && response.ok){poll++;const copy=await response.clone().json().catch(()=>({}));if(Object.values(copy).some(v=>Object.values(v.outputs||{}).some(o=>o.images?.length)))emit('comfy_image_ready',{poll_count:poll,ms:Math.round(performance.now()-startFetch)});}
 if(kind==='view'){emit('image_headers',{ms:Math.round(performance.now()-startFetch),status:response.status});const read=response.arrayBuffer.bind(response);
 response.arrayBuffer=async()=>{const t=performance.now(),bytes=await read();emit('image_download',{bytes:bytes.byteLength,download_ms:Math.round(performance.now()-t)});return bytes;};}
 return response;
};
async function run(){
 emit('benchmark_started',{story_chars:story.length,markers:(story.match(/\[image:/g)||[]).length,width:768,height:1152,steps:8});
 const queue=await(await originalFetch(cfg.host.replace(/\/$/,'')+'/queue')).json();
 if(queue.queue_running.length||queue.queue_pending.length)throw Error('ComfyUI busy: test skipped safely');
 const items=prompts.map((prompt,index)=>{const work=structuredClone(wf);delete work['5'];delete work['15'];work['18'].inputs.text=prompt;work['6'].inputs.text='anime, CGI, plastic skin, bad anatomy, extra fingers';work['8'].inputs.positive=['18',0];work['8'].inputs.seed=608410+index;work['11'].inputs.filename_prefix='StoryTimingBenchmark_20261014_'+(index+1);return {request:{workflow:work,preferredSaveImageNodeId:'11'},timeout:240000};});
 const manager=createAsyncImageJobManager({adapters:{comfyui:adapter},maxConcurrentItems:1});
 const service=createImageJobService({manager,adapters:{comfyui:adapter}});
 const job=service.create(owner,{provider:'comfyui',requestId:jobId,context:{url:cfg.host,auth:cfg.auth||''},delay:{min:1,max:1},items});
 emit('job_created',{state:job.state});
 const lastState={};let final;
 for(let n=0;n<2600;n++){await new Promise(r=>setTimeout(r,150));const snapshot=manager.getJob(owner,jobId);
 for(const entry of snapshot.items){if(lastState[entry.index]!==entry.state){lastState[entry.index]=entry.state;emit('item_state',{index:entry.index,state:entry.state,error:entry.error?.message||''});}}
 if(snapshot.state==='completed'||snapshot.state==='cancelled'){final=snapshot;break;}}
 if(!final)throw Error('Timeout waiting for job');
 for(let index=0;index<2;index++){const item=manager.getResult(owner,jobId,index),t=performance.now();if(item?.state!=='ready'){emit('result_unavailable',{index,state:item?.state||'null'});continue;}
 const base64=item.buffer.toString('base64');emit('backend_binary_ready',{index,bytes:item.buffer.length,encode_ms:Math.round(performance.now()-t),base64_chars:base64.length});manager.consumeResult(owner,jobId,index);}
 emit('benchmark_finished',{total_ms:ms(),state:final.state,items:final.items.map(x=>x.state)});
}
run().catch(error=>{emit('BENCHMARK_FAILED',{message:String(error.stack||error).slice(0,420)});process.exitCode=1;});
