import { stripDrawImageDirectives, stripDrawImageSlots } from './image-marker-syntax.js';

// Derive active outfits from current chat and selected branch. No extra network or persistent state.
const RESET = /(?:第二天|次日|翌日|隔天|几天后|数日后|数周后|数月后|多年后|第[二三四五六七八九十\d]+天|一(?:周|月|年)后|the next (?:day|morning|week)|days? later|weeks? later|months? later|years? later)/i;
const CHANGE = /(?:换装|更衣|换(?:上|下|掉|回|了)?(?:一套|衣服|外套|上衣|衬衫|裤子|裙子|鞋子|袜子|制服|睡衣|新装)|脱(?:下|掉|去|了)?(?:外套|衣服|上衣|衬衫|裤子|裙子|鞋子|袜子|制服|睡衣)|\u7a7f(?:上|回|了)?(?:外套|衣服|上衣|衬衫|裤子|裙子|鞋子|袜子|制服|睡衣)|衣(?:服|衫|裙|裤).{0,9}(?:湿透|撕裂|破损|弄脏|染血)|湿透|淋湿|撕破|弄脏|changed? (?:clothes|outfit)|changing (?:clothes|outfit)|put on (?:a |her |his )?(?:coat|shirt|dress|uniform|jacket)|take off (?:a |her |his )?(?:coat|shirt|dress|uniform|jacket)|undressed|wet (?:clothes|dress|shirt|coat)|torn (?:clothes|dress|shirt|coat))/i;
// Natural-language variants such as "changed into the red dress", "changed her coat"
// or Chinese descriptions with colors and demonstratives between verbs and garments.
const CHANGE_EXTRA = /(?:\u6362.{0,12}(?:\u8863|\u88d9|\u88e4|\u978b|\u889c|\u670d|\u88c5|\u895f|\u888d|\u5957|\u886b)|\u8131.{0,12}(?:\u8863|\u88d9|\u88e4|\u978b|\u889c|\u670d|\u88c5|\u895f|\u888d|\u5957|\u886b)|\u7a7f.{0,12}(?:\u8863|\u88d9|\u88e4|\u978b|\u889c|\u670d|\u88c5|\u895f|\u888d|\u5957|\u886b)|\u89e3\u5f00.{0,5}\u6263\u5b50|\u6263\u597d.{0,5}\u6263\u5b50|changed? into|slipped into (?:a |her |his )?(?:new |clean )?(?:coat|dress|shirt|uniform|outfit)|took off (?:her |his |the )?(?:coat|dress|shirt|uniform|jacket)|now wearing (?:a |her |his )?(?:new |clean )?(?:dress|coat|shirt|uniform|jacket))/i;
const hasClothingEvent=text=>CHANGE.test(text)||CHANGE_EXTRA.test(text);
// Lasting per-character visual changes: injuries, dirt, wetness, bandages and carried objects.
const STATE_CHANGE = /(?:\u53d7\u4f24|\u4f24\u53e3|\u64e6\u4f24|\u6de4\u9752|\u5305\u624e|\u6d41\u8840|\u6b62\u8840|\u75ca\u6108|\u5eb7\u590d|\u64e6\u5e72|\u6d17\u51c0|\u6dcb\u6e7f|\u6e7f\u900f|\u6cbe\u6ee1|\u6c61\u6e0d|\u62ff\u8d77|\u653e\u4e0b|\u4e22\u6389|\u4e22\u5f03|\u6361\u8d77|\u63e1\u4f4f|\u653e\u5f00|injured|wounded|bandaged|bleeding|healed|cleaned|dried off|picked up|put down|dropped|carrying (?:a |the )?(?:bag|umbrella|sword|book))/i;
const hasStateEvent=text=>STATE_CHANGE.test(text);
const key=name=>String(name||'').normalize('NFKC').trim().toLocaleLowerCase();
function canonical(value, known) {
    const name=String(value||'').trim().slice(0,100);
    if(!name)return '';
    const hit=(known||[]).find(p=>[p?.name,...(p?.aliases||[])]
        .some(a=>key(a)===key(name)));
    return String(hit?.name||name).trim();
}
const outfit=value=>String(value||'').trim().slice(0,700);
function clearPropertyForEvent(ledger,text,known,test,field) {
    if(!test(text))return false;
    const chunks=String(text).split(/[.!?;\n\u3002\uFF0C\uFF01\uFF1F\uFF1B]+/).filter(test);
    const affected=[];
    for(const [id,item] of ledger){
        const person=(known||[]).find(p=>key(p.name)===id);
        if(chunks.some(chunk=>[item.name,...(person?.aliases||[])]
            .some(name=>name&&chunk.includes(name))))affected.push(id);
    }
    if (!affected.length) return false; // Unresolved pronoun is not authority to clear every character.
    const ids=affected;
    for(const id of ids){
        const next={...ledger.get(id)};
        delete next[field];
        if(next.costume||next.state)ledger.set(id,next);
        else ledger.delete(id);
    }
    return true;
}
function transition(ledger,text,known){
    if(!text)return {};
    if(RESET.test(text)){ledger.clear();return {};}
    return {
        costume: hasClothingEvent(text) && !clearPropertyForEvent(ledger,text,known,hasClothingEvent,'costume'),
        state: hasStateEvent(text) && !clearPropertyForEvent(ledger,text,known,hasStateEvent,'state'),
    };
}

function directivesInOrder(directives,narrative) {
    return directives.map((item,index)=>{
        const after=String(item?.after||'').trim();
        const at=Number.isInteger(item?.sourceOffset)?item.sourceOffset:
            after&&narrative.includes(after)?narrative.indexOf(after)+after.length:Number.MAX_SAFE_INTEGER;
        return {item,index,at};
    }).sort((a,b)=>a.at-b.at||a.index-b.index);
}
function record(ledger,characters,known){
    for(const item of Array.isArray(characters)?characters:[]){
        const name=canonical(typeof item==='string'?item:item?.name,known);
        const costume=outfit(typeof item==='object'?item?.costume:'');
        const state=outfit(typeof item==='object'?item?.state:'');
        if(!name||(!costume&&!state))continue;
        const prior=ledger.get(key(name))||{name};
        ledger.set(key(name),{...prior,...(costume?{costume}:{}),...(state?{state}:{})});
    }
}
export function buildWardrobeLedger(chat=[],{knownCharacters=[],readDirectives,excludeMessage=null,maxMessages=600}={}) {
    const all=Array.isArray(chat)?chat:[];
    const found=excludeMessage?all.indexOf(excludeMessage):-1;
    const end=found>=0?found:all.length;
    const ledger=new Map();
    for(const msg of all.slice(Math.max(0,end-maxMessages),end)){
        if(msg?.is_system||['system','developer'].includes(msg?.role))continue;
        const narrative=stripDrawImageSlots(stripDrawImageDirectives(String(msg?.mes||'')));
        if(msg?.is_user||msg?.role==='user'){transition(ledger,narrative,knownCharacters);continue;}
        const directives=typeof readDirectives==='function'?readDirectives(msg):[];
        if(!directives?.length){transition(ledger,narrative,knownCharacters);continue;}
        let previous=0;
        for(const {item,at} of directivesInOrder(directives,narrative)){
            const pos=Math.min(narrative.length,at===Number.MAX_SAFE_INTEGER?narrative.length:at);
            transition(ledger,narrative.slice(previous,pos),knownCharacters);
            record(ledger,item.characters,knownCharacters);
            previous=pos;
        }
        transition(ledger,narrative.slice(previous),knownCharacters);
    }
    return Array.from(ledger.values()).slice(-24);
}
export function formatWardrobeLedger(entries=[]) {
    const active=(entries||[]).filter(p=>p?.name&&(p?.costume||p?.state)).slice(-20);
    if(!active.length)return '';
    return '\u8fde\u7eed\u89c6\u89c9\u72b6\u6001\u8d26\u672c\uff08\u4ec5\u5bf9\u539f\u6709\u5b9e\u9645\u51fa\u955c\u4eba\u7269\u751f\u6548\uff09\uff1a\n'
        +active.map(p=>'- '+p.name+
            (p.costume?'\uff0c\u670d\u88c5\uff1a'+p.costume:'')+
            (p.state?'\uff0c\u6301\u7eed\u72b6\u6001\uff1a'+p.state:'')).join('\n');
}

export function applyWardrobeContinuity(tasks=[],entries=[],{narrative='',knownCharacters=[]}={}) {
    const ledger=new Map((entries||[]).filter(p=>p?.name&&(p?.costume||p?.state))
        .map(p=>[key(p.name),{name:p.name,...(p.costume?{costume:outfit(p.costume)}:{}),
            ...(p.state?{state:outfit(p.state)}:{})}]));
    const adjusted=tasks.map(t=>({...t,chars:(t.chars||[]).map(p=>({...p}))}));
    const ordered=adjusted.map((t,index)=>({t,index,at:Number.isInteger(t?.placement?.offset)?t.placement.offset:Number.MAX_SAFE_INTEGER}))
        .sort((a,b)=>a.at-b.at||a.index-b.index);
    let previous=0;
    for(const {t,at} of ordered){
        const pos=Math.min(narrative.length,at===Number.MAX_SAFE_INTEGER?narrative.length:at);
        const segment=narrative.slice(previous,pos);
        const unresolved=transition(ledger,segment,knownCharacters);
        for(const field of ['costume','state']){
            if(!unresolved[field])continue;
            // A pronoun never clears everyone. One explicit scene change identifies its owner.
            const candidates=t.chars.filter(person=>{
                const prior=ledger.get(key(canonical(person.name,knownCharacters)));
                return prior?.[field] && outfit(person[field]) && outfit(person[field])!==prior[field];
            });
            if(candidates.length!==1)continue;
            const id=key(canonical(candidates[0].name,knownCharacters));
            const next={...ledger.get(id)};
            delete next[field];
            if(next.costume||next.state)ledger.set(id,next);
            else ledger.delete(id);
        }
        for(const person of t.chars){
            const name=canonical(person.name,knownCharacters),prev=ledger.get(key(name));
            let currentCostume=outfit(person.costume),currentState=outfit(person.state);
            if(prev?.costume && currentCostume!==prev.costume){
                person.costume=prev.costume;currentCostume=prev.costume;
                t.characterPrompts=null;
            }
            if(prev?.state && currentState!==prev.state){
                person.state=prev.state;currentState=prev.state;
                t.characterPrompts=null;
            }
            if(name && (currentCostume||currentState)) {
                ledger.set(key(name),{...prev,name,
                    ...(currentCostume?{costume:currentCostume}:{}),
                    ...(currentState?{state:currentState}:{})});
            }
        }
        previous=pos;
    }
    return adjusted;
}
