// Repair only the DOM projection of image slots swallowed by host formatting.
// Do not change roleplay text, LLM prompts, the original image or its slot ID.
const punctuation=/[\p{P}\p{Z}\s\u200B-\u200F\uFEFF]/gu;
const normalize = value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(punctuation,'');

export function findUniqueVisibleAnchorEnd(runs=[],after=''){
    const exact=String(after||'').trim();
    const raw=runs.map(run=>String(run?.text??'')).join('');
    const at=exact?raw.indexOf(exact):-1;
    if(at>=0&&(normalize(exact).length>=8||/[。！？.!?][”’」』\s]*$/.test(exact))&&raw.indexOf(exact,at+1)<0){
        let end=at+exact.length;
        for(let run=0;run<runs.length;run++){
            const length=String(runs[run]?.text??'').length;
            if(end<=length)return {run,end};
            end-=length;
        }
    }
    const needle=normalize(after);
    if(needle.length<8)return null;
    let full='';
    const positions=[];
    for(let i=0;i<runs.length;i++){
        const text=String(runs[i]?.text??'');
        for(let cursor=0;cursor<text.length;){
            const point=String.fromCodePoint(text.codePointAt(cursor));
            const end=cursor+point.length;
            const part=normalize(point);
            for(let k=0;k<part.length;k++){
                full+=part[k];
                positions.push({run:i,end});
            }
            cursor=end;
        }
    }
    const first=full.indexOf(needle);
    if(first<0||full.indexOf(needle,first+1)>=0)return null;
    const result=positions[first+needle.length-1];
    if(!result)return null;
    const endRun=String(runs[result.run]?.text??'');
    let end=result.end;
    // The normalized match strips punctuation. Include the sentence's closing
    // marks when inserting a card after raw unwrapped text (not inside a <p>).
    while(end<endRun.length && /[.,!?\u3002\uff0c\uff01\uff1f\u201d\u2019\u300d\u300f]/u.test(endRun[end]))end++;
    return {...result,end};
}

function isActuallyHidden(node,root){
    for(let el=node?.parentElement;el&&el!==root;el=el.parentElement){
        const tag=el.tagName?.toLowerCase();
        if(tag==='script'||tag==='style'||tag==='template'||tag==='status_block'
            ||tag==='textarea'||tag==='button'||tag==='select'
            ||el.classList?.contains('sti-nd-img')||el.hidden
            ||el.getAttribute?.('aria-hidden')==='true')return true;
        try {
            const style=el.ownerDocument?.defaultView?.getComputedStyle?.(el);
            if(style?.display==='none'||style?.visibility==='hidden'||style?.visibility==='collapse')return true;
        } catch { /* Unknown CSS is not enough to discard a story paragraph. */ }
    }
    return false;
}

export function mountImageCardAtVisibleAnchor(root,card,after){
    if(!root||!card||!after)return false;
    const walker=root.ownerDocument.createTreeWalker(root,4);
    const runs=[];
    let node;
    while((node=walker.nextNode())){
        if(!node.nodeValue||isActuallyHidden(node,root))continue;
        runs.push({node,text:node.nodeValue});
    }
    const match=findUniqueVisibleAnchorEnd(runs,after);
    if(!match)return false;
    const selected=runs[match.run]?.node;
    if(!selected||!selected.isConnected)return false;
    // Split at the matched text boundary. A generic DIV may contain the entire
    // story, so it is never an authority to move a card after all its prose.
    // Lift through inline wrappers and a paragraph only when the anchor is
    // at their very end; otherwise keep the exact boundary inside the wrapper.
    let boundary=selected;
    if(match.end<selected.nodeValue.length){
        const rest=root.ownerDocument.createTextNode(selected.nodeValue.slice(match.end));
        selected.nodeValue=selected.nodeValue.slice(0,match.end);
        selected.after(rest);
    }
    while(boundary.parentElement && boundary.parentElement!==root
        && /^(SPAN|EM|STRONG|B|I|U|S|A|P|LI|BLOCKQUOTE)$/.test(boundary.parentElement.tagName||'')
        && !boundary.nextSibling){
        boundary=boundary.parentElement;
    }
    boundary.after(card);
    return true;
}
