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
export function openPromptImportDialog({ save, initialResults = [] }) {
  const doc=document;
  const prior=doc.getElementById('lwb-comfy-ai-prompt-dialog');
  if(prior){prior.querySelector('textarea')?.focus();return;}
  if(!Array.isArray(initialResults)||!initialResults.length)throw new Error('没有可核对的剧情人物资料');
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
  const title=el('h3','从当前剧情生成角色 · 核对结果','margin:0 0 6px;font-size:18px;color:#f0c58a');
  const info=el('p','请核对人物的中文外貌、服装和动态状态。只整理中文档案，生成绘图指令时再转换。','font-size:13px;color:#b7c0cb;margin:0 0 10px;line-height:1.6');
  const status=el('div','尚未开始识别','font-size:13px;color:#d9bf92;margin:10px 0;min-height:20px');
  const buttons=el('div',undefined,'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin:12px 0 0;padding:12px 0 4px;position:sticky;bottom:-18px;z-index:2;background:#1e232c;border-top:1px solid #3c4854');
  function btn(label){
    const button=el('button',label,'border-radius:6px;padding:8px 16px;background:#343e4b;color:#f4f4f4;border:1px solid #576171;cursor:pointer');
    button.type='button';return button;
  }
  const cancel=btn('关闭');
  const commit=btn('确认并保存角色');commit.style.background='#3c725b';commit.hidden=true;
  const preview=el('div',undefined,'display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;width:100%;max-width:100%;box-sizing:border-box;overflow-x:hidden');
  buttons.append(cancel,commit);
  panel.append(title,info,status,preview,buttons);
  doc.body.append(overlay);
  let items=[],busy=false;
  function setBusy(flag){
    busy=flag;commit.disabled=flag;cancel.disabled=flag;
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
      const label=el('span',('剧情人物 ' + (index + 1) + ' · ' + (item.basis || '待确认')),'white-space:nowrap;color:#f0c58a');
      const name=el('input');name.value=item.name||'';
      name.placeholder='请输入角色名';name.style.cssText='flex:1 1 160px;min-width:0;width:100%;max-width:100%;box-sizing:border-box;background:#111923;color:#f4f4f4;border:1px solid #53606c;border-radius:5px;padding:8px';
      head.append(enabled,label,name);card.append(head);
      const z=box('固定外貌 · 中文（可修改）',item.appearanceZh,true);
      const dress=box('服装参考 · 中文（每行一套，可修改）',item.outfits.map(x=>x.name).join('\n'),true);
      const dynamic=box('动态状态 · 中文（每行一条，可修改）',item.dynamicStates.map(x=>x.name).join('\n'),true);
      const ignored=box('不导入项 · 中文说明',item.excluded.join('\n'),false);
      const ignoredDetails=el('details',undefined,'margin-top:10px;border-top:1px solid #46505b;padding-top:9px;min-width:0');
      ignoredDetails.append(el('summary','已排除的场景、光线、姿势等（点击查看）','color:#b6c0cd;cursor:pointer'),ignored.holder);
      card.append(z.holder,dress.holder,dynamic.holder,ignoredDetails);
      preview.append(card);
      item._fields={enabled,name,zh:z.area,clothes:dress.area,dynamic:dynamic.area};
    });
  }
  cancel.addEventListener('click',()=>{if(busy)return;overlay.remove();});
  overlay.addEventListener('click',event=>{if(event.target===overlay&&!busy)overlay.remove();});
  commit.addEventListener('click',async()=>{
    if(busy||!items.length)return;
    const selected=items.filter(x=>x._fields.enabled.checked);
    if(!selected.length){status.textContent='请至少选择一名角色';return;}
    let reviewed;
    try { reviewed=selected.map(x=>({...x,
      name:x._fields.name.value.trim(),
      appearanceZh:x._fields.zh.value.trim(),
      appearance:'',
      negativeTags:'',
      outfits:reconcileChineseNamedLines(x._fields.clothes.value).map(value=>({name:value.name,tags:''})),
      dynamicStates:reconcileChineseNamedLines(x._fields.dynamic.value).map(value=>({name:value.name,tags:''})),
    })); } catch (error) {
      status.textContent='检查中文输入失败：'+(error?.message||'请检查内容');
      return;
    }
    setBusy(true);status.textContent='正在检查角色库，尚未保存...';
    try{
      const result=await save(reviewed,(msg)=>{status.textContent=msg;});
      status.textContent=result;
      items=[];commit.hidden=true;preview.replaceChildren();
    }catch(e){status.textContent='没有写入角色库：'+(e?.message||'保存失败');}
    finally{setBusy(false);}
  });
  items=initialResults;
  display(items);
  status.textContent='剧情人物提取已完成，请逐人核对后保存。';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  commit.hidden=false;
  return overlay;
}
