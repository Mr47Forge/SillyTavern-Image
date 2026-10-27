const txt = v=>String(v??'').trim();
export function buildStoryIndexInstruction(){
 return [
  '你是酒馆聊天中的角色索引器。阅读提供的当前剧情消息，定位实际出现、被明确提及的具名角色（包括 AI 自创的临时 NPC），不是分析世界书、系统模板或角色卡。',
  '每个人都必须在原消息中有真实出现的名字或明确别名；不能把“她、老板、路人、我”等无确定身份的泛称当成新人物。',
  'user 是玩家输入，不把玩家第二人称叙事当成独立 NPC。不根据剧情世界设定凭空发明人物。',
  '最多返回 20 位确实有具名依据的人物，优先近期仍在剧情里的。保留明确属于同一人的别名，别名不能与其他角色冲突。',
  '只返回 {"characters":[{"name":"原文出现的姓名","aliases":["原文明确的别名"]}]}，没有则空数组。不输出外貌，不输出其他文字。',
 ].join('\n');
}
export function parseStoryIndex(reply,messages,{max=20}={}){
 const raw=txt(reply),a=raw.indexOf('{'),b=raw.lastIndexOf('}');
 if(a<0||b<=a)throw new Error('AI 没有返回完整的剧情人物索引');
 let data;try{data=JSON.parse(raw.slice(a,b+1));}catch{throw new Error('剧情人物索引格式不完整');}
 const people=Array.isArray(data?.characters)?data.characters:[];
 const full=messages.map(x=>txt(x?.text)).join('\n');
 const seen=new Set(),result=[];
 for(const entry of people){
  const name=txt(entry?.name).slice(0,60);
  if(name.length<2||!full.includes(name)||seen.has(name.toLocaleLowerCase()))continue;
  if(/^(?:user|assistant|narrator|{{user}}|{{char}})$/i.test(name))continue;
  seen.add(name.toLocaleLowerCase());
  const aliases=(Array.isArray(entry?.aliases)?entry.aliases:[])
   .map(v=>txt(v).slice(0,60)).filter(v=>v.length>=2&&full.includes(v)&&v!==name).slice(0,8);
  result.push({name,aliases});
  if(result.length>=max)break;
 }
 return result;
}
export function selectCharacterStoryEvidence(messages,people,{maxChars=13000,maxMessages=36}={}){
 const list=Array.isArray(messages)?messages:[];
 const names=people.flatMap(p=>[p.name,...(Array.isArray(p.aliases)?p.aliases:[])]).filter(Boolean);
 const anchors=[];
 for(let i=0;i<list.length;i++){
  const body=txt(list[i]?.text);
  if(names.some(name=>body.includes(name)))anchors.push(i);
 }
 const pick=new Set();
 // Evidence paragraphs, plus direct neighbors that often resolve pronouns / context.
 for(const i of anchors){
  pick.add(i);
  if(i>0)pick.add(i-1);
  if(i+1<list.length)pick.add(i+1);
 }
 // Favor later context but preserve chronological presentation.
 const candidates=[...pick].sort((a,b)=>b-a);
 const output=[];let remaining=maxChars;
 for(const i of candidates){
  if(output.length>=maxMessages||remaining<80)break;
  const raw=txt(list[i]?.text);
  if(!raw)continue;
  const cut=raw.slice(0,Math.min(1800,remaining));
  output.push({index:list[i]?.index??i,speaker:list[i]?.speaker||'narrator',text:cut});
  remaining-=cut.length;
 }
 return output.reverse();
}
export function buildStoryDetailInstruction(){
 return [
  '你是酒馆写实角色固定外貌的精细档案员。只根据此批具名人物和提供的剧情证据，分别建立有辨识度的角色档案，禁止把不同人物混成同一张模板脸。',
  '只能处理 targetCharacters 中的角色，不能凭空创建新人或偷加玩家主角。每位角色姓名、别名必须与 targetCharacters 对应。',
  '针对每个角色逐一寻找剧情明确描述的：脸型、眉眼与眼皮、鼻唇、肤色、发色、头发长短及盘扎刘海、身材、肩腰胯和已被明确提到的独特特征。优先忠实保留已描述的罕见特点，而不是统一“鹅蛋脸、杏眼、细腰、黑长直”。',
  'appearanceZh 用具体、自然的中文完整写出已知的固定外貌；只整理中文档案，不生成英文标签。证据丰富时应保留所有重要差异，通常约100-230个中文字；证据有限时不得凑字数。',
  '剧情未给出的普通脸部细节可以提出自然合理的外貌候选，但必须将 basis 标成“AI补充”，并放入本次待用户确认候选。不要擅自加独特疤痕、纹身、特殊身高、出身、性癖和身份。不得把猜测写成“剧情明确”。',
  '有 existingProfiles 时，已登记的 appearanceZh 是固定外貌依据，不重生为另一张脸。仅有 legacyAppearance 的旧档案在本次整理中忠实转成中文，不新增特征。',
  '服装 outfits 仅记录剧情描述过的、可供复用的明确服装细节，name 为中文具体描述，不生成英文标签。一次性动作或场景背景不能写进服装。',
  'dynamicStates 可记录文本明确提到的可变化表情或外貌状态，不能把单次姿势、镜头、背景写入固定人物特征。',
  'type 为 woman/man/girl/boy/other，不确定年龄/性别用 other；不能只凭名字判断。negativeTags 禁止生成。',
  '结果 JSON 顶层 characters 数组，每项必须包含 name,aliases,type,appearanceZh,basis,outfits,dynamicStates。basis 仅“剧情明确”或“AI补充”；outfits/dynamicStates 是 [{"name":"中文"}]；无内容返回空数组。',
  '每名目标人物都要尽力给出一套可用、互相可区分的候选档案；实在缺少任何明确证据的，要谨慎保持简短，不能捏造外貌依据。只输出 JSON，不要 Markdown 或解释。',
 ].join('\n');
}
