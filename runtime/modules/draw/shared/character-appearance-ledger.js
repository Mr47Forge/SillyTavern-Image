// Image-only character identity: reuse the latest explicit appearance for the
// same person. No edits to SillyTavern story, worldbooks, system prompts or chat.
const key = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
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
        if(String(registered?.appearanceZh||registered?.appearance||registered?.danbooruTag||'').trim())return person;
        const quote=String(person.appear_evidence||'').trim();
        const names=[person.name,...(registered?.aliases||[])].filter(Boolean);
        // Exact source facts override generated translations. A model-authored
        // appearance alone is never evidence of a change to a recurring person.
        if(quote.length>=8&&quote.length<=800&&names.some(n=>quote.includes(n))
            &&[sources.worldbook,sources.narrative].some(s=>String(s||'').includes(quote)))
            return {...person,appear:quote};
        const prior=recent.get(name);
        return prior?{...person,appear:prior}:person;
    });
}
