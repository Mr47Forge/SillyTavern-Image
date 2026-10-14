// Validate single-subject visual analysis results before touching the shared role library.
import { parseAiPromptCategory } from './prompt-import.js';
import { cleanImageCharacterProfile } from './character-appearance-cleanup.js';

export function parseImageCharacterReply(raw) {
  const text=String(raw||'').trim();
  if(!text)throw new Error('视觉模型没有返回识别结果');
  const a=text.indexOf('{'),b=text.lastIndexOf('}');
  if(a<0||b<a)throw new Error('当前模型没有返回图片识别数据。请检查它是否支持识图');
  let data;try{data=JSON.parse(text.slice(a,b+1));}catch{throw new Error('视觉模型返回的资料格式不完整，请重试');}
  if(data?.error==='multiple_people'||data?.error==='no_person'||data?.error==='not_supported'){
    const err=data.error==='multiple_people'?'图片中有多个人物；当前版本只支持单人图片':
      data.error==='no_person'?'图片中没有清晰可识别的人物':
      '本次图片识别没有取得有效图像内容（模型返回 not_supported），请检查图片请求是否被其他插件拦截';
    const failure=new Error(err);
    if(data.error==='not_supported') failure.code='IMAGE_NOT_VISIBLE';
    throw failure;
  }
  const result=cleanImageCharacterProfile(parseAiPromptCategory(text));
  if(!result.appearance||!result.appearanceZh){
    throw new Error('识图结果缺少可辨认的外貌特征，未保存；请更换清晰的单人人像');
  }
  // The image does not tell us an existing character's identity.
  result.name='';
  // Vision models should not invent image-negative terms.
  result.negativeTags='';
  return result;
}

/** Human-readable, detailed visual inventory for a *single* pictured character.
 * Paired Chinese/English descriptions are saved in the plugin's unchanged fields.
 */
export function buildImageCharacterAnalysisPrompt({ strictDetails = false } = {}) {
 const rules = [
  '你是小白 X 的精细角色形象分析器：任务是从一张图片提炼出能复现该人物的外貌特征，不是写影评、场景描述或笼统形容词。',
  '只依据真正看得见的像素。先确认图像里只有一个明显主人物；若多人返回 {"error":"multiple_people"}；没有人物 {"error":"no_person"}；看不到图片或模型无识图能力 {"error":"not_supported"}。不得虚构。',
  '优先辨认每个人区别于普通模板脸的细节；禁止只写“美女、鹅蛋脸、大眼睛、长发、身材纤细”。必须用可观察的具体特征来区分人物，不加入没有依据的赞美、滤镜词。',
  '固定外貌 appearanceZh 要按可见程度逐项观察并自然整合：①脸部整体轮廓、额头与脸颊、颧骨/下颌/下巴；②眉形和浓淡、眼睛大小与轮廓、双眼皮/单眼皮仅在看得清时写；③鼻梁和鼻尖；④唇形、自然唇色；⑤肤色与可以辨认的皮肤质感；⑥头发的深浅色泽、分缝、刘海、发丝纹理、实际盘发/扎发/披发方式、垂落的碎发；⑦可见的肩颈、腰胯和身体比例，未出现在画面中的部位不可描述。',
  '特别分辨：盘发和披散的长发不是一回事；有碎刘海、耳边垂发、发饰也不要省略。不能由上半身照片推断腿长、身高、鞋子或全身曲线。',
  '固定外貌描述尽量写够有辨识度的细节；清晰人像可写约100-220个中文字，但不能凑字数。严禁把观察范围写成角色特征，例如“仅见肩颈以上”“仅露出大腿上部”“无法判断身高腿长”“其余身体部位不可见”。看不到的部位直接不提，不写否定句或裁切说明。',
  'appearance 是 appearanceZh 同一组稳定外貌信息对应的详细英文摄影提示词，适合直接拼入 ComfyUI：写具体结构特征与自然体型，不增删属性，避免夸张比例、统一美颜词、镜头风格。禁止写画面裁切、上半身可见、其余不可见、无法判断、照片中只看到什么等英文说明。',
  'outfits 是穿搭：必须认真检查可见上衣、下装与饰品的版型、袖长、领口、纽扣、罗纹/针织纹路、饰边、印花刺绣、格纹/褶皱、腰带、扣环、耳饰等。如果图片看得到这些，不能统一简写为“白色上衣、短裙”。',
  'outfits 中同一套穿搭通常合成一个对象：{"name":"中文衣物和配饰细节","tags":"与中文一致的英文具体衣着标签"}。只有明显独立可替换的两套才多项；不要把同一件衣服的纽扣和领口拆成两套。',
  'dynamicStates 是这张图里会改变的表情、面部状态或发丝变化，格式同上；当前姿势（举手、双手放身前、站姿）、拍摄角度、背景不写成固定外貌/服装或永久状态。',
  'negativeTags 返回空字符串。excluded 只需用中文概括忽略掉的环境、镜头、光线、构图与姿势，最多5项简短说明，不要把整段场景照抄进预览。',
  '年龄只能写目测的成年/未成年外观，不臆测精确年龄；性别难判断时 type=other；成年女性 type=woman，成年男性 type=man，不随意写 girl/boy；姓名未知，name 必须为空字符串。',
  '输出仅限一个 JSON 对象，字段 name,type,appearanceZh,appearance,outfits,dynamicStates,negativeTags,excluded；只输出 JSON、不能有 Markdown、不能加额外故事或解释。',
 ];
 if (strictDetails) rules.push(
  '这是对上一轮外貌描述过于概括的纠正：逐项认真回看图片可见的脸部结构、眉眼鼻唇、发型盘扎方式、肤色、上装下装饰边材质及扣饰。只补上真实可见的差异，不能为了“详细”而捏造。重新输出完整 JSON。'
 );
 return rules.join('\n');
}

export function evaluateImageCharacterDetail(character) {
 const zh=String(character?.appearanceZh||'');
 const outfit=(Array.isArray(character?.outfits)?character.outfits:[])
  .map(item=>String(item?.name||'')).join('、');
 const warnings=[];
 // Heuristic prompts a visual recheck; never automatically invent a feature.
 if(zh.length<105) warnings.push('固定外貌描述过短，没有足够的辨识特征');
 const faceGroups=[
  /(脸|下颌|颧骨|脸颊|下巴)/,
  /(眉|眼|眼皮)/,
  /(鼻)/,
  /(唇|嘴)/,
  /(发|头发|刘海|盘发)/,
 ];
 const missing=faceGroups.filter(re=>!re.test(zh)).length;
 if(missing>=2) warnings.push('缺少多个可见的脸部或发型细节');
 if(outfit && outfit.length<24) warnings.push('服装描述过于笼统，需要检查衣领、面料、花纹与配饰');
 return warnings;
}

/** First-installation visual prompt preserved as a compatibility fallback. */
export function buildImageCharacterCompatibilityPrompt() {
    const instruction = [
      '你是小白 X ComfyUI 角色图像分析器。只根据输入图片中真正可见的内容描述一个主角。',
      '必须先判断图片是否包含一位清楚可见的真人或写实人物。若多人同框，输出 {"error":"multiple_people"}；没有清楚可见的人物输出 {"error":"no_person"}。',
      '如果你没有获得或无法查看输入的图片，请输出 {"error":"not_supported"}。不能凭想象虚构外貌、衣服或背景。',
      '忽略背景、场景、摄影风格、光线、镜头和构图，不要把它们写入角色资料。',
      '固定外貌 appearance：简洁英文 ComfyUI 写实摄影角色特征，只写可见的脸型、眉眼、鼻唇、发色发型、肤色、自然体型，不猜测看不到的身体部位、纹身或特殊标记。不要写取景、裁切、只露出哪里或无法判断哪些部位；看不见的直接省略。',
      'appearanceZh 是与 appearance 完全一致、自然易懂的中文外貌说明，不允许夹带英文。',
      'outfits：角色当前穿戴的服装和饰品；每项包含 name 中文名称和 tags 对应英文描述。',
      'dynamicStates：可见的表情或临时外观状态；每项包含 name 中文名称和 tags 对应英文描述。',
      '角色姓名无法从外观判断，name 必须是空字符串；type 仅为 woman、man、girl、boy 或 other，不确定年龄或性别时 other。',
      'negativeTags 返回空字符串。excluded 列出被排除的环境或摄影元素，使用简短中文说明。',
      '只返回 JSON 对象，字段必须是 name,type,appearance,appearanceZh,outfits,dynamicStates,negativeTags,excluded。不得输出前后解释或 Markdown。',
    ].join('\n');
    return instruction;
}

/** Retry only explicitly missing image content; never guess an invisible appearance. */
export async function runImageCharacterCompatibilityRetry(primary, fallback, onRetry = () => {}) {
    try {
        return await primary();
    } catch (error) {
        if (error?.code !== 'IMAGE_NOT_VISIBLE') throw error;
        onRetry();
        return await fallback();
    }
}
