import test from 'node:test';
import assert from 'node:assert/strict';
import {openPromptImportDialog} from '../prompt-import-ui.js';

class Element {
 constructor(tag='div', text=''){
   this.tag=tag;this._text=String(text);this.children=[];this.style={
     cssText:'',
     properties:{},
     setProperty(k,v,priority=''){this.properties[k]={value:v,priority};},
     removeProperty(k){delete this.properties[k];},
   };
   this.hidden=false;this.checked=false;this.readOnly=false;this.value='';this.placeholder='';this.attributes={};
   this.listeners={};
 }
 set textContent(v){this._text=String(v);}
 get textContent(){return this._text;}
 append(...nodes){for(const n of nodes){if(n&&typeof n==='object'){this.children.push(n);n.parentNode=this;}}}
 prepend(node){this.children.unshift(node);node.parentNode=this;}
 replaceChildren(){this.children=[];}
 addEventListener(type,fn){this.listeners[type]=fn;}
 focus(){}
 querySelector(selector) {
   if(selector==='textarea')return this.all().find(e=>e.tag==='textarea')||null;
   if(selector==='input[placeholder="请输入角色名"]')return this.all().find(e=>e.tag==='input'&&e.placeholder==='请输入角色名')||null;
   return null;
 }
 all(){return this.children.flatMap(c=>[c,...(typeof c.all==='function'?c.all():[])]);}
}
function buildDocument(){
 const body=new Element('body');
 return {body,createElement:tag=>new Element(tag),createTextNode:txt=>new Element('#text',txt),
   getElementById:id=>body.all().find(x=>x.id===id)||null};
}
const full={
 name:'',type:'woman',
 appearanceZh:'一名年轻成年女性，脸部轮廓柔和略呈椭圆形，脸颊饱满，下颌圆润，深色大眼睛，眉形自然，鼻尖小巧，淡粉色的嘴唇；深棕色头发向后盘起，侧分细碎刘海，耳侧留有弯曲的垂落发丝，肤色自然白皙，肩腰线条纤细。',
 appearance:'young adult woman, softly oval face, rounded cheeks, almond dark eyes, small nose, pink lips, dark brown updo, side swept wispy bangs, loose face-framing tendrils, fair natural skin, slender shoulders and waist',
 outfits:[{name:'白色罗纹短袖翻领针织衫，黑色波浪饰边领口，深色格纹百褶短裙，黑色腰带与金色扣环',tags:'white ribbed short sleeved polo, scalloped collar trim, charcoal plaid pleated skirt, black belt, gold buckle'}],
 dynamicStates:[{name:'嘴角轻扬，温柔微笑',tags:'soft warm smile'}],excluded:['纯色墙面背景']
};
const previous=globalThis.document;
test('image mode hides text prompt, instructions, classifier actions and shows detailed Chinese preview',()=>{
 globalThis.document=buildDocument();
 try{
  const overlay=openPromptImportDialog({analyze:async()=>[full],save:async()=>'',initialResults:[structuredClone(full)],referenceImage:'data:image/jpeg;base64,/9j/AA=='});
  const items=overlay.all();
  const t=items.map(e=>e.textContent).join('|');
  assert.match(t,/从图片生成角色 · 核对结果/);
  assert.match(t,/固定外貌 · 中文/);
  assert.match(t,/服装参考 · 中文/);
  assert.match(t,/动态状态 · 中文/);
  assert.match(t,/原图对照/);
  assert.doesNotMatch(t,/\?\? AI|\?{5,}/);
  const textPrompt=items.find(e=>e.tag==='textarea'&&e.placeholder.startsWith('在这里粘贴'));
  assert.equal(textPrompt.hidden,true);
  assert.equal(textPrompt.style.properties.display?.value,'none');
  const classifier=items.find(e=>e.tag==='button'&&e.textContent==='AI 识别并分类');
  assert.equal(classifier.hidden,true);
  assert.equal(classifier.style.properties.display?.value,'none');
  const title=items.find(e=>e.tag==='h3');
  assert.equal(title.textContent,'从图片生成角色 · 核对结果');
  const zhField=items.find(e=>e.tag==='textarea'&&e.value===full.appearanceZh);
  assert.ok(zhField);
  assert.equal(zhField.readOnly,false);
  const card=items.find(e=>e.tag==='div'&&e.style.cssText.includes('overflow-x:hidden')&&e.style.cssText.includes('border-radius:8px'));
  assert.ok(card);
  const excludedSummary=items.find(e=>e.tag==='summary'&&e.textContent.includes('已排除'));
  assert.ok(excludedSummary);
  const originalImage=items.find(e=>e.tag==='img');
  assert.equal(originalImage.src,'data:image/jpeg;base64,/9j/AA==');
 }finally{globalThis.document=previous;}
});

test('story import opens editable per-character preview rather than the truncated window.confirm()',()=>{
 globalThis.document=buildDocument();
 try{
  const data={...structuredClone(full),name:'林雪',basis:'AI补充'};
  const overlay=openPromptImportDialog({
   analyze:async()=>[data],save:async()=>'',initialResults:[data],previewMode:'story'
  });
  const children=overlay.all();
  const headings=children.map(x=>x.textContent).join('|');
  assert.match(headings,/从当前剧情生成角色 · 核对结果/);
  assert.match(headings,/剧情人物 1 · AI补充/);
  assert.match(headings,/剧情人物提取已完成/);
  assert.doesNotMatch(headings,/图片识别已完成/);
  const name=children.find(x=>x.tag==='input'&&x.value==='林雪');
  assert.ok(name);
  const detail=children.find(x=>x.tag==='textarea'&&x.value===data.appearanceZh);
  assert.equal(detail.readOnly,false);
  const confirm=children.find(x=>x.tag==='button'&&x.textContent==='确认并保存角色');
  assert.equal(confirm.hidden,false);
 }finally{globalThis.document=previous;}
});

test('image import preview survives a refused or failed same-name replacement',async()=>{
 globalThis.document=buildDocument();
 try{
  const data={...structuredClone(full),name:'林希雅'};
  let saves=0;
  const dialog=openPromptImportDialog({
   analyze:async()=>[data],initialResults:[data],
   save:async()=>{saves++;throw new Error('用户取消替换');},
  });
  const items=dialog.all();
  const button=items.find(x=>x.tag==='button'&&x.textContent==='确认并保存角色');
  assert.ok(button);
  await button.listeners.click();
  assert.equal(saves,1);
  assert.equal(button.hidden,false);
  assert.ok(dialog.all().some(x=>x.tag==='textarea'&&x.value===data.appearanceZh));
  assert.ok(dialog.all().some(x=>x.textContent.includes('没有写入角色库')&&x.textContent.includes('用户取消替换')));
 }finally{globalThis.document=previous;}
});
