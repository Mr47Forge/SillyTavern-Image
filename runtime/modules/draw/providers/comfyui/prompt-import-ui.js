import { reconcileChineseNamedLines } from './chinese-named-tags.js';

// 浮层贴住键盘上方的可见区：安卓键盘弹出时 innerHeight 不变，只有 visualViewport 会变。
function followVisibleViewport(overlay) {
    let timer = 0;
    const apply = () => {
        if (!overlay.isConnected) { if (timer) clearInterval(timer); return; }
        const vv = window.visualViewport;
        const height = Math.round((vv && vv.height) || window.innerHeight || 0);
        const top = Math.round((vv && vv.offsetTop) || 0);
        overlay.style.setProperty('top', top + 'px', 'important');
        overlay.style.setProperty('height', height + 'px', 'important');
        overlay.style.setProperty('bottom', 'auto', 'important');
    };
    apply();
    timer = setInterval(apply, 100);
}
// Standalone, scoped prompt import dialog. Does not change the host plugin's role-card schema.
export function openPromptImportDialog({ analyze, save, initialResults = null, referenceImage = null, previewMode = 'image' }) {
  const doc=document;
  const prior=doc.getElementById('lwb-comfy-ai-prompt-dialog');
  if(prior){prior.querySelector('textarea')?.focus();return;}
  const overlay=doc.createElement('div');
  overlay.id='lwb-comfy-ai-prompt-dialog';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;height:100%;z-index:2147483000;background:rgba(0,0,0,.73);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
  const panel=doc.createElement('div');
  panel.style.cssText='width:min(860px,100%);min-width:0;max-height:calc(var(--vvh, 100vh) - 40px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:#1e232c;color:#e7ebef;border:1px solid #424b57;border-radius:12px;padding:18px;box-sizing:border-box;font-size:14px';
  panel.style.maxHeight='calc(var(--vvh, 100vh) - 40px)';
  overlay.append(panel);followVisibleViewport(overlay);
  function el(tag,text,styles=''){
    const node=doc.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(styles)node.style.cssText=styles;
    return node;
  }
  const title=el('h3','AI 智能拆分提示词','margin:0 0 6px;font-size:18px;color:#f0c58a');
  const info=el('p','粘贴英文或中文人物提示词，AI 自动分成固定外貌、服装、动态状态和负向标签。画质、镜头、姿势等不默认加入角色。','font-size:13px;color:#b7c0cb;margin:0 0 10px;line-height:1.6');
  const help=el('p','多个人物可用「角色名：名字」分开；不写角色名也能分析，保存前再填写名字。','font-size:12px;color:#9daaba;margin:0 0 8px');
  const input=el('textarea');
  input.placeholder='在这里粘贴完整提示词。可以一次粘贴多组，每组用「角色名：xxx」开头。';
  input.style.cssText='width:100%;min-height:170px;resize:vertical;background:#141922;color:#f3f4f6;border:1px solid #485360;border-radius:6px;padding:12px;box-sizing:border-box;line-height:1.6';
  const options=el('div',undefined,'display:flex;flex-wrap:wrap;gap:12px;margin:12px 0');
  function toggle(label,initial=false){
    const wrap=el('label',undefined,'display:flex;gap:6px;align-items:center;cursor:pointer;font-size:13px');
    const check=el('input');check.type='checkbox';check.checked=initial;
    wrap.append(check,doc.createTextNode(label));options.append(wrap);return check;
  }
  const negative=toggle('同时导入负向标签（多人可能互相影响，默认关闭）');
  const overwrite=toggle('覆盖已有角色外貌（默认关闭）');
  const note=el('p','已有角色默认只补充空白外貌，并追加不重复的服装和动态状态。','font-size:12px;color:#abb4bd;margin:2px 0 12px');
  const status=el('div','尚未开始识别','font-size:13px;color:#d9bf92;margin:10px 0;min-height:20px');
  const buttons=el('div',undefined,'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin:12px 0 0;padding:12px 0 4px;position:sticky;bottom:-18px;z-index:2;background:#1e232c;border-top:1px solid #3c4854');
  function btn(label){
    const button=el('button',label,'border-radius:6px;padding:8px 16px;background:#343e4b;color:#f4f4f4;border:1px solid #576171;cursor:pointer');
    button.type='button';return button;
  }
  const cancel=btn('关闭');const run=btn('AI 识别并分类');run.style.background='#8e6239';
  const commit=btn('确认并保存角色');commit.style.background='#3c725b';commit.hidden=true;
  const preview=el('div',undefined,'display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;width:100%;max-width:100%;box-sizing:border-box;overflow-x:hidden');
  buttons.append(cancel,run,commit);
  panel.append(title,info,help,input,options,note,status,preview,buttons);
  doc.body.append(overlay);
  let items=[],busy=false,versions=0;
  function setBusy(flag){
    busy=flag;run.disabled=flag;commit.disabled=flag;cancel.disabled=false;
    run.style.opacity=flag?'.5':'1';commit.style.opacity=flag?'.5':'1';
  }
  function box(title,value,editable=false){
    const holder=el('div',undefined,'margin-top:9px;min-width:0;max-width:100%;box-sizing:border-box');
    const label=el('label',title,'display:block;margin:0 0 4px;color:#cfdae4');
    const area=el('textarea');area.value=value||'';area.readOnly=!editable;area.rows=editable?3:2;
    area.style.cssText='display:block;min-width:0;width:100%;max-width:100%;box-sizing:border-box;resize:vertical;overflow-wrap:anywhere;white-space:pre-wrap;background:#121820;color:#e8ecf1;border:1px solid #465364;border-radius:5px;padding:8px;line-height:1.5';
    holder.append(label,area);return {holder,area};
  }
  function display(results){
    preview.replaceChildren();
    const hint=el('p','请核对每个人的外貌和分类。这里只预览，不会立即修改角色库。点击「确认并保存角色」才会写入。','color:#ddc695;font-size:12px;margin:8px 0');
    preview.append(hint);
    results.forEach((item,index)=>{
      const card=el('div',undefined,'border:1px solid #4a545e;background:#222a34;border-radius:8px;padding:12px;min-width:0;max-width:100%;box-sizing:border-box;overflow-x:hidden');
      const head=el('div',undefined,'display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0');
      const enabled=el('input');enabled.type='checkbox';enabled.checked=true;
      const label=el('span',(previewMode === 'story' ? ('剧情人物 ' + (index + 1) + ' · ' + (item.basis || '待确认')) : '导入第 '+(index+1)+' 个人物'),'white-space:nowrap;color:#f0c58a');
      const name=el('input');name.value=item.name||'';
      name.placeholder='请输入角色名';name.style.cssText='flex:1 1 160px;min-width:0;width:100%;max-width:100%;box-sizing:border-box;background:#111923;color:#f4f4f4;border:1px solid #53606c;border-radius:5px;padding:8px';
      head.append(enabled,label,name);card.append(head);
      const z=box('固定外貌 · 中文（可修改）',item.appearanceZh,true);
      const dress=box('服装参考 · 中文（每行一套，可修改）',item.outfits.map(x=>x.name).join('\n'),true);
      const dynamic=box('动态状态 · 中文（每行一条，可修改）',item.dynamicStates.map(x=>x.name).join('\n'),true);
      const ignored=box('不导入项 · 中文说明',item.excluded.join('\n'),false);
      const ignoredDetails=el('details',undefined,'margin-top:10px;border-top:1px solid #46505b;padding-top:9px;min-width:0');
      ignoredDetails.append(el('summary','已排除的场景、光线、姿势等（点击查看）','color:#b6c0cd;cursor:pointer'),ignored.holder);
      const advanced=el('details',undefined,'margin-top:10px;border-top:1px solid #46505b;padding-top:9px');
      advanced.append(el('summary','英文绘图词与负向标签（高级，点击展开）','color:#b6c0cd;cursor:pointer'));
      const en=box('固定外貌 · 英文绘图词（系统自动管理）',item.appearance,false);
      const clothingEn=box('服装 · 英文绘图词（后台使用）',item.outfits.map(x=>x.tags).join('\n'),false);
      const dynamicEn=box('动态状态 · 英文绘图词（后台使用）',item.dynamicStates.map(x=>x.tags).join('\n'),false);
      const neg=box('负向标签 · 英文（默认不导入）',item.negativeTags,false);
      advanced.append(en.holder,clothingEn.holder,dynamicEn.holder,neg.holder);
      card.append(z.holder,dress.holder,dynamic.holder,ignoredDetails,advanced);
      preview.append(card);
      item._fields={enabled,name,zh:z.area,english:en.area,clothes:dress.area,dynamic:dynamic.area,negative:neg.area};
    });
  }
  cancel.addEventListener('click',()=>{if(busy)return;overlay.remove();});
  overlay.addEventListener('click',event=>{if(event.target===overlay&&!busy)overlay.remove();});
  run.addEventListener('click',async()=>{
    if(busy)return;
    const text=input.value.trim();if(!text){status.textContent='请先粘贴提示词';return;}
    const current=++versions;items=[];preview.replaceChildren();commit.hidden=true;setBusy(true);
    status.textContent='正在调用 AI 分析...';
    try{
      const result=await analyze(text,(state)=>{if(current===versions)status.textContent=state;});
      items=result;
      display(items);
      status.textContent='识别完成：'+items.length+' 组。请检查各人物的分类后再保存。';
      commit.hidden=false;
    }catch(error){status.textContent='识别失败：'+(error?.message||'请重试');}
    finally{setBusy(false);}
  });
  commit.addEventListener('click',async()=>{
    if(busy||!items.length)return;
    const selected=items.filter(x=>x._fields.enabled.checked);
    if(!selected.length){status.textContent='请至少选择一名角色';return;}
    let reviewed;
    try { reviewed=selected.map(x=>({...x,
      name:x._fields.name.value.trim(),
      _editedZh:x._fields.zh.value.trim()!==x.appearanceZh,
      appearanceZh:x._fields.zh.value.trim(),
      appearance:x._fields.english.value.trim(),
      negativeTags:x._fields.negative.value.trim(),
      outfits:reconcileChineseNamedLines(x._fields.clothes.value,x.outfits),
      dynamicStates:reconcileChineseNamedLines(x._fields.dynamic.value,x.dynamicStates),
    })); } catch (error) {
      status.textContent='检查中文输入失败：'+(error?.message||'请检查内容');
      return;
    }
    setBusy(true);status.textContent='正在检查角色库，尚未保存...';
    try{
      const result=await save(reviewed,{includeNegative:negative.checked,overwrite:overwrite.checked},(msg)=>{status.textContent=msg;});
      status.textContent=result;
      items=[];commit.hidden=true;preview.replaceChildren();
    }catch(e){status.textContent='没有写入角色库：'+(e?.message||'保存失败');}
    finally{setBusy(false);}
  });
  if (Array.isArray(initialResults) && initialResults.length) {
    items = initialResults;
    title.textContent = previewMode === 'story' ? '从当前剧情生成角色 · 核对结果' : '从图片生成角色 · 核对结果';
    info.textContent = previewMode === 'story'
      ? '以下是 AI 根据当前剧情整理的具名角色候选档案。「剧情明确」表示外貌有文本依据，「AI补充」是尚待你确认的外貌建议。核对中文说明、服装和动态状态后才保存。'
      : '请核对图片识别的外貌、服装和动态状态。输入已有角色的正式名称后，系统会明确询问是否替换原角色资料；保留原角色ID。取消或保存失败不会清空本次识别结果。';
    status.textContent = previewMode === 'story' ? '剧情人物提取已完成，请逐人核对后保存。' : '图片识别已完成，请检查下方中文信息。';
    for(const element of [input,help,run,options,note]){
      element.hidden = true;
      element.style.setProperty('display','none','important');
    }
    negative.checked = false;
    overwrite.checked = false;
    display(items);
    if (typeof referenceImage === 'string' && /^data:image\//.test(referenceImage)) {
      const photo=el('details',undefined,'margin:8px 0;min-width:0;max-width:100%');
      photo.append(el('summary','原图对照（点击展开）','color:#e9c78d;cursor:pointer'));
      const image=el('img');
      image.alt='用于提取角色的原图';
      image.src=referenceImage;
      image.style.cssText='display:block;max-width:100%;max-height:380px;object-fit:contain;margin:10px auto;border-radius:8px';
      photo.append(image);
      preview.prepend(photo);
    }
    commit.hidden = false;
    commit.style.removeProperty('display');
    preview.querySelector('input[placeholder="请输入角色名"]')?.focus();
  } else {
    input.focus();
  }
  return overlay;
}
