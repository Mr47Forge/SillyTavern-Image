// Prompt categories are determined by the configured AI, not by a local keyword dictionary.
const str=(v,n=2000)=>String(v??'').trim().slice(0,n);
const list=(v)=>Array.isArray(v)?v:[];
const named=(items)=>list(items).slice(0,24).map((x,i)=>typeof x==='string'?{name:'参考'+(i+1),tags:str(x,500)}:{name:str(x?.name,80),tags:str(x?.tags,500)}).filter(x=>x.name || x.tags);
export function splitPromptImportSource(text,{chunkSize=1600,maxTotal=70000}={}){
 const raw=str(text,maxTotal+1).replace(/\r\n?/g,'\n');
 if(!raw)throw Error('请先粘贴提示词');
 if(raw.length>maxTotal)throw Error('提示词过长，请分批导入');
 const sections=[];let item={name:'',raw:''};
 const flush=()=>{if(item.raw.trim())sections.push(item);item={name:'',raw:''};};
 for(const line of raw.split('\n')){
  const h=line.trim().match(/^(?:#\s*)?(?:角色名(?:称)?|人物名(?:称)?|name|character)\s*[:：]\s*(.+)$/i);
  const md=line.trim().match(/^#{1,4}\s+(?!positive|negative|正向|负向)(.{2,60})$/i);
  if(h||md){flush();item.name=str(h?.[1]||md?.[1],70);continue;}
  if(/^[-=]{4,}$/.test(line.trim())){flush();continue;}
  item.raw+=line+'\n';
 }flush();
 if(sections.length>25)throw Error('一次最多处理 25 组人物提示词');
 const jobs=[];
 sections.forEach((s,group)=>{
  let remaining=s.raw.trim(),part=0;
  while(remaining){
   if(part>=50)throw Error('单个人物提示词过长，请分批');
   let end=Math.min(chunkSize,remaining.length);
   if(end<remaining.length){
    const cut=Math.max(remaining.lastIndexOf(',',end),remaining.lastIndexOf('\n',end),remaining.lastIndexOf(';',end));
    if(cut>chunkSize/2)end=cut+1;
   }
   const rawPart=remaining.slice(0,end).trim();
   remaining=remaining.slice(end);
   if(rawPart)jobs.push({group,part:part++,name:s.name,text:rawPart});
  }
 });
 if(jobs.length>85)throw Error('内容太多，请拆成多批');
 return jobs;
}
export function parseAiPromptCategory(reply,{name=''}={}){
 const raw=str(reply,35000);const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
 if(a<0||b<a)throw Error('AI 没有返回有效分类，请缩短文本重试');
 let data;try{data=JSON.parse(raw.slice(a,b+1));}catch{throw Error('AI 分类结果不完整，请重试');}
 const x=data?.character??data;
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('AI 分类结果格式错误');
 const out={name:str(name||x.name,70),type:['girl','boy','woman','man','other'].includes(x.type)?x.type:'other',
  appearance:str(x.appearance,2400),appearanceZh:str(x.appearanceZh,2400),negativeTags:str(x.negativeTags,2400),
  outfits:named(x.outfits),dynamicStates:named(x.dynamicStates),
  excluded:list(x.excluded).slice(0,40).map(v=>str(typeof v==='string'?v:v?.reason||v?.text,180)).filter(Boolean)};
 if(out.appearance&&/[\u3400-\u9fff]/u.test(out.appearance))throw Error('英文绘图词混入中文，请重新解析');
 if(out.appearanceZh&&!/[\u3400-\u9fff]/u.test(out.appearanceZh))throw Error('AI 没有给出中文外貌，请重试');
 if(Boolean(out.appearance)!==Boolean(out.appearanceZh))throw Error('中文与英文固定外貌缺少对应内容，请重试');
 if(!(out.appearance||out.outfits.length||out.dynamicStates.length||out.negativeTags))throw Error('没有识别到可复用的人物信息');
 return out;
}
function appendNamed(old,newer){
 const result=[...old],seen=new Set(old.map(v=>String(v.tags||v.name).toLowerCase()));
 for(const x of newer){const k=String(x.tags||x.name).toLowerCase();if(!seen.has(k)){result.push(x);seen.add(k);}}
 return result;
}
export function combineAiPromptChunks(jobs,parts){
 if(jobs.length!==parts.length)throw Error('提示词片段结果不完整');
 const map=new Map();
 jobs.forEach((job,i)=>{
  const now=parts[i],before=map.get(job.group);
  if(!before){map.set(job.group,{...now,name:job.name||now.name});return;}
  before.appearance=[before.appearance,now.appearance].filter(Boolean).join(', ');
  before.appearanceZh=[before.appearanceZh,now.appearanceZh].filter(Boolean).join('；');
  before.negativeTags=[before.negativeTags,now.negativeTags].filter(Boolean).join(', ');
  before.outfits=appendNamed(before.outfits,now.outfits);
  before.dynamicStates=appendNamed(before.dynamicStates,now.dynamicStates);
  before.excluded.push(...now.excluded);
  if(before.type==='other')before.type=now.type;
 });
 return [...map.values()];
}
export function buildAiPromptCharacters(items,{includeNegative=false}={}){
 return items.map((x,i)=>{
  const name=str(x.name,70);
  if(!name||name.startsWith('待命名'))throw Error('请给第 '+(i+1)+' 名人物填写名称');
  return {name,aliases:[],type:x.type||'other',appearance:str(x.appearance,2400),appearanceZh:str(x.appearanceZh,2400),
   negativeTags:includeNegative?str(x.negativeTags,2400):'',danbooruTag:'',
   outfits:named(x.outfits),dynamicStates:named(x.dynamicStates)};
 });
}
export function mergeAiPromptCharacters(library,items,{overwrite=false}={}){
 const characters=list(library?.characters).map(x=>({...x})),groups=list(library?.groups);
 const seen=new Set();let created=0,updated=0,skipped=0;
 for(const x of items){
  const key=x.name.toLocaleLowerCase();
  if(seen.has(key))throw Error('导入列表有重复角色名：'+x.name);
  seen.add(key);
  const old=characters.find(c=>String(c.name||'').toLocaleLowerCase()===key||list(c.aliases).some(a=>String(a).toLocaleLowerCase()===key));
  if(!old){characters.push({...x,id:'comfy-ai-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),enabled:true});created++;continue;}
  let changed=false;
  // Treat the Chinese and English face as an indivisible identity pair.
  if(x.appearance&&x.appearanceZh&&(overwrite||(!old.appearance&&!old.appearanceZh))){
   if(old.appearance!==x.appearance||old.appearanceZh!==x.appearanceZh){old.appearance=x.appearance;old.appearanceZh=x.appearanceZh;changed=true;}
  }
  if(x.negativeTags&&(overwrite||!old.negativeTags)&&x.negativeTags!==old.negativeTags){old.negativeTags=x.negativeTags;changed=true;}
  for(const field of ['outfits','dynamicStates']){
   const was=list(old[field]),next=appendNamed(was,list(x[field]));
   if(was.length!==next.length){old[field]=next;changed=true;}
  }
  if(changed)updated++;else skipped++;
 }
 return {characters,groups,created,updated,skipped,changed:created+updated>0};
}


export function resolveAiOutputBudgets(config = {}) {
 const configured = Number(config?.maxTokens);
 const ceiling = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 8192;
 return { initial: Math.min(8192, ceiling), retry: Math.min(16384, ceiling) };
}
export function isAiOutputTruncated(error) {
 return error?.code === 'AGENT_RESPONSE_TRUNCATED'
  || error?.code === 'OPENAI_RESPONSES_INCOMPLETE' && error?.reason === 'max_output_tokens'
  || /Model response reached its output limit/i.test(String(error?.message || ''));
}


/** Image-derived profile replaces a *specific canonical-name match* after caller confirmation.
 * Preserve id, aliases, group, active state, negative safeguards and custom metadata.
 * Do not match a user's image to someone else merely because the text matches an alias.
 */
export function mergeImageCharacterByExactName(library, incoming = []) {
 const characters = list(library?.characters).map(c => ({...c}));
 const groups = list(library?.groups);
 const seen = new Set(), replacedNames = [], addedNames = [];
 for(const entry of incoming) {
  const name = String(entry?.name || '').trim(), key = name.toLocaleLowerCase();
  if(!name) throw new Error('请填写角色名后再保存');
  if(!entry.appearance || !entry.appearanceZh)
    throw new Error('角色“'+name+'”缺少完整的中英文固定外貌，不能覆盖');
  if(seen.has(key)) throw new Error('本次图片导入有重复角色名：'+name);
  seen.add(key);
  const matches = characters.filter(role => String(role.name||'').trim().toLocaleLowerCase()===key);
  if(matches.length>1) throw new Error('角色库内有多名“'+name+'”，无法确认替换哪一个，请先区分角色');
  const existing = matches[0];
  if(!existing) {
    const aliasCollision = characters.some(role=>list(role.aliases).some(alias=>String(alias).trim().toLocaleLowerCase()===key));
    if(aliasCollision) throw new Error('“'+name+'”是已有角色的别名，请使用角色正式名称替换，避免覆盖错人');
    characters.push({...entry,id:'comfy-image-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),enabled:true});
    addedNames.push(name);
    continue;
  }
  // Only replace the profile fields sourced from the image. Keep stable role identity and protections.
  const updated = {...existing,
    appearance:entry.appearance,appearanceZh:entry.appearanceZh,
    outfits:list(entry.outfits).map(x=>({...x})),
    dynamicStates:list(entry.dynamicStates).map(x=>({...x})),
    type:entry.type && entry.type!=='other' ? entry.type : existing.type,
  };
  const changed=['appearance','appearanceZh','outfits','dynamicStates','type']
    .some(field=>JSON.stringify(updated[field])!==JSON.stringify(existing[field]));
  if(changed) {
    characters[characters.indexOf(existing)] = updated;
    replacedNames.push(name);
  }
 }
 return {characters,groups,created:addedNames.length,updated:replacedNames.length,
  skipped:incoming.length-addedNames.length-replacedNames.length,
  changed:!!(addedNames.length+replacedNames.length),replacedNames,addedNames};
}
