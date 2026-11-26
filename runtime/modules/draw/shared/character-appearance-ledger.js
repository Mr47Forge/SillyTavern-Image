// Image-only character identity: reuse the latest explicit appearance for the
// same person. No edits to SillyTavern story, worldbooks, system prompts or chat.
const key = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();

const FACE_TRAITS = [
    /\b(?:jaw(?:line)?|chin|(?:round|oval|square|heart[- ]shaped|long|narrow|broad|angular|oblong|diamond[- ]shaped) face)\b|脸型|圆脸|方脸|长脸|鹅蛋脸|瓜子脸|下颌|下巴/iu,
    /\b(?:cheekbones?|(?:high|flat|full) cheeks?)\b|颧骨|脸颊/iu,
    /\b(?:brows?|eyebrows?)\b|眉/iu,
    /\b(?:eyelids?|monolids?|(?:wide[- ]set|close[- ]set|deep[- ]set|hooded|almond(?:[- ]shaped)?|round|narrow|upturned|downturned|slanted|small|large) eyes?)\b|眼型|眼距|眼尾|眼睑|单双眼皮|单眼皮|双眼皮|内双|杏眼|圆眼|细长眼/iu,
    /\b(?:brown|black|blue|green|grey|gray|hazel|amber|dark|light) eyes?\b|\biris\b|瞳色|虹膜|[棕褐黑蓝绿灰]色眼/iu,
    /\b(?:nose|nostrils?)\b|鼻/iu,
    /\b(?:lips?|philtrum|cupid.s bow|mouth shape)\b|唇|嘴型/iu,
];

// An older record can be incomplete. Fill only missing facial categories from
// short appearance clauses, leaving existing identity and non-face traits alone.
function fillMissingFaceTraits(prior, current) {
    const occupied = new Set(FACE_TRAITS.filter(pattern => pattern.test(prior)));
    const additions = [];
    for (const raw of String(current || '').split(/[,，、;；。\n]+/u)) {
        const part = raw.trim();
        if (!part || /\b(?:hair|haired|wig|makeup|eyeliner|lipstick|clothing|dress|shirt|coat|skin)\b|发型|头发|刘海|妆|服装|肤色/iu.test(part)) continue;
        const matches = FACE_TRAITS.filter(pattern => pattern.test(part));
        if (!matches.length || matches.some(pattern => occupied.has(pattern))) continue;
        additions.push(part);
        matches.forEach(pattern => occupied.add(pattern));
    }
    return [prior, ...additions].join(', ');
}
export function buildRecentAppearanceLedger(chat=[], { readDirectives, excludeMessage, maxMessages=80 }={}) {
    const ledger=new Map();
    if(typeof readDirectives!=='function')return ledger;
    let examined=0;
    const current=excludeMessage?chat.indexOf(excludeMessage):-1;
    for(let i=(current>=0?current:chat.length)-1;i>=0 && examined<maxMessages;i--){
        const message=chat[i];
        if(!message || message===excludeMessage || message.is_user || message.is_system)continue;
        examined++;
        const owned=message.extra?.sti_comfy_slots;
        const directives=owned?Object.values(owned).filter(p=>p.status==='success')
            .map(p=>({characters:p.input?.characters||[]})):readDirectives(message)||[];
        for(let j=directives.length-1;j>=0;j--){
            for(const person of directives[j]?.characters||[]){
                if(!person||typeof person!=='object')continue;
                const name=key(person.name),appear=String(person.appear||'').trim();
                if(!name||appear.length<12||ledger.has(name))continue;
                ledger.set(name,appear);
            }
        }
    }
    return ledger;
}
export function pinImageCharacterAppearances(characters=[],recent=new Map(),known=[],sources={}) {
    return characters.map(person=>{
        const name=key(person?.name);
        // A registered user character's configured appearance is authoritative.
        const registered=known.find(item=>[item.name,...(item.aliases||[])].some(alias=>key(alias)===name));
        if(String(registered?.appearanceZh||registered?.danbooruTag||'').trim())return person;
        const quote=String(person.appear_evidence||'').trim();
        const names=[person.name,...(registered?.aliases||[])].filter(Boolean);
        // Exact source facts override generated translations. A model-authored
        // appearance alone is never evidence of a change to a recurring person.
        if(quote.length>=8&&quote.length<=800&&names.some(n=>quote.includes(n))
            &&[sources.worldbook,sources.narrative].some(s=>String(s||'').includes(quote)))
            return {...person,appear:quote};
        const prior=recent.get(name);
        return prior ? {...person, appear:fillMissingFaceTraits(prior, person.appear)} : person;
    });
}
