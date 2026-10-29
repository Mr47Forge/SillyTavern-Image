import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';

const dir=dirname(fileURLToPath(import.meta.url));
const source=readFileSync(resolve(dir,'../comfy-draw.js'),'utf8');
const html=readFileSync(resolve(dir,'../comfy-draw.html'),'utf8');
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing section '+start);
 return source.slice(a,b);
}
const compact=section('const expandedComfyCharacterIds = new Set();','let promptChainPreviewFrame = 0;');
const render=section('function renderCharacterCard({ character: tag, ordinal }) {','function createChineseNamedTagField(');
const fields=section('function createChineseNamedTagField(','function renderFilterRuleRow(');
const read=section('function readCharacterCardsFromForm(','function getSharedCharacterTagsFromForm(');

class FakeElement{
 constructor(tag='div'){
  this.tagName=tag.toLowerCase();this.children=[];this.dataset={};
  this._text='';this.className='';this.hidden=false;this.value='';this.attributes={};
  this.classList={
   contains:(name)=>this.className.split(/\s+/).includes(name),
   toggle:(name,on)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));const result=on===undefined?!set.has(name):!!on;if(result)set.add(name);else set.delete(name);this.className=[...set].join(' ');return result;},
  };
 }
 set textContent(v){this._text=String(v);if(this.tagName==='textarea')this.value=String(v);}
 get textContent(){return this._text;}
 append(...nodes){for(const node of nodes){if(node&&typeof node==='object'){node.parentNode=this;this.children.push(node);}}}
 appendChild(node){this.append(node);return node;}
 addEventListener(type,handler){(this._listeners??={})[type]??=[];this._listeners[type].push(handler);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 querySelector(selector){
  const matches=node=>{
   if(selector[0]==='.')return node.className.split(/\s+/).includes(selector.slice(1));
   const match=selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
   if(match){
    const key=match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    return Object.prototype.hasOwnProperty.call(node.dataset,key)&&(match[2]===undefined||node.dataset[key]===match[2]);
   }
   return false;
  };
  const visit=node=>{for(const child of node.children){if(matches(child))return child;const deep=visit(child);if(deep)return deep;}return null;};
  return visit(this);
 }
}
let cards=[];
const tag={
 id:'role-1',name:'Lin Xiya',type:'girl',enabled:true,
 aliases:['Xiya'],appearance:'oval face, black hair',
 appearanceZh:'\u9e45\u86cb\u8138\uff0c\u9ed1\u8272\u957f\u53d1',
 outfits:[{name:'\u7070\u8272\u536b\u8863',tags:'grey hoodie'}],
 dynamicStates:[{name:'\u5bb3\u7f9e',tags:'shy'}],
 negativeTags:'',danbooruTag:'',
};
const ctx={
 document:{createElement:tag=>new FakeElement(tag)},
 isDanbooruDBLoaded:()=>true,
 createCharacterEnabledControl:(doc)=>doc.createElement('input'),
 namedTagsChineseText:(v)=>v.map(x=>x.name).join('\n'),
 querySettingsAll:()=>cards,
 getSharedDrawSettings:()=>({characterTags:[tag]}),
 getCharacterEnabledFromCard:()=>true,
 reconcileChineseNamedLines:(value)=>String(value).split('\n').filter(Boolean).map(name=>({name})),
};
const functions=vm.runInNewContext(
 compact+'\n'+render+'\n'+fields+'\n'+read+'\n({renderCharacterCard,setComfyCharacterCardExpanded,updateComfyCharacterCardTitle,readCharacterCardsFromForm})',
 ctx,
);
test('saved named roles start collapsed with a compact header',()=>{
 const card=functions.renderCharacterCard({character:tag,ordinal:1});cards=[card];
 assert.equal(card.classList.contains('comfy-role-collapsed'),true);
 assert.equal(card.querySelector('.comfy-role-card-body').hidden,true);
 assert.equal(card.querySelector('[data-comfy-role-primary]').textContent,'Lin Xiya');
 assert.equal(card.querySelector('[data-comfy-role-toggle]').attributes['aria-expanded'],'false');
});
test('collapsed cards preserve exact hidden fields for save and export',()=>{
 const result=functions.readCharacterCardsFromForm()[0];
 assert.equal(result.name,tag.name);
 assert.equal(Object.hasOwn(result,'appearance'),false);
 assert.equal(result.appearanceZh,tag.appearanceZh);
 assert.deepEqual(result.outfits,tag.outfits.map(({name})=>({name})));
 assert.deepEqual(result.dynamicStates,tag.dynamicStates.map(({name})=>({name})));
 assert.equal(result.aliases.join(','),'Xiya');
});
test('expand and collapse change display only, not the role data',()=>{
 const card=cards[0];
 functions.setComfyCharacterCardExpanded(card,true);
 assert.equal(card.querySelector('.comfy-role-card-body').hidden,false);
 assert.equal(card.querySelector('[data-comfy-role-toggle]').attributes['aria-expanded'],'true');
 functions.setComfyCharacterCardExpanded(card,false);
 assert.equal(card.querySelector('.comfy-role-card-body').hidden,true);
 assert.equal(functions.readCharacterCardsFromForm()[0].appearanceZh,tag.appearanceZh);
});
test('role title reflects edits without wiping draft fields',()=>{
 const card=cards[0];
 card.querySelector('[data-sd-char-field="name"]').value='Another Name';
 functions.updateComfyCharacterCardTitle(card);
 assert.equal(card.querySelector('[data-comfy-role-primary]').textContent,'Another Name');
 assert.equal(functions.readCharacterCardsFromForm()[0].name,'Another Name');
});
test('new empty roles automatically open for immediate editing',()=>{
 const newRole={id:'new',name:'',type:'other'};
 const card=functions.renderCharacterCard({character:newRole,ordinal:2});
 assert.equal(card.querySelector('.comfy-role-card-body').hidden,false);
});

test('role cards expose Chinese fields without a legacy English editor or preview',()=>{
 const card=functions.renderCharacterCard({character:tag,ordinal:1});
 assert.ok(card.querySelector('[data-sd-char-field="appearanceZh"]'));
 assert.equal(card.querySelector('[data-sd-char-field="appearance"]'),null);
 assert.equal(card.querySelector('.char-english-details'),null);
});

test('role type uses Chinese choices and keeps its stored value',()=>{
 const card=functions.renderCharacterCard({character:tag,ordinal:1});
 const field=card.querySelector('[data-sd-char-field="type"]');
 assert.equal(field.tagName,'select');
 assert.equal(field.value,tag.type);
 assert.ok(field.children.some(option=>option.textContent==='成年女性'));
 const old=functions.renderCharacterCard({character:{...tag,type:'legacy-custom-type'},ordinal:1});
 assert.equal(old.querySelector('[data-sd-char-field="type"]').value,'legacy-custom-type');
});
test('group and batch management controls remain in the page',()=>{
 assert.ok(html.includes('id="comfy-role-collapse-all"'));
 assert.ok(html.includes('id="comfy-role-expand-all"'));
 assert.ok(!html.includes('id="comfy-shared-character-toolbar"'));
 assert.ok(html.includes('.sd-char-card.comfy-role-collapsed'));
});

test('the current role save control uses popup feedback without the removed duplicate shortcut',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML(html);
 const save=[...document.querySelectorAll('[data-comfy-save-shared]')].find(button=>button.textContent.includes('保存角色'));
 assert.ok(save);assert.equal(save.type||save.getAttribute('type'),'button');
 assert.equal(document.querySelector('#comfy-role-save-status'),null);
 const count=document.querySelector('#comfy-draw-character-result-count');assert.equal(count.getAttribute('role'),'status');assert.equal(count.getAttribute('aria-live'),'polite');
 assert.ok(document.querySelector('#comfy-role-collapse-all'));assert.ok(document.querySelector('#comfy-shared-character-list'));
 assert.ok(source.includes("querySettingsAll('[data-comfy-save-shared]').forEach"));
 assert.ok(source.includes('await saveAllSettings({ notify: true, triggerButton: event.currentTarget, statusElementId })'));
 assert.equal(document.querySelector('#comfy-role-save-edits'),null,'the current UI has one shared save control instead of the retired duplicate');
});
