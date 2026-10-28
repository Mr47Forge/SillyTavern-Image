import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import showdown from 'showdown';
import { stripModelDiagnosticFooter, suppressRenderedModelDiagnosticFooter } from '../model-diagnostic-footer.js';
import { stripDirectDrawSource, rememberDirectDrawDirectives, readDirectDrawDirectives } from '../direct-draw.js';

const footer='[IDE Diagnostics Node: Viewport Stream Committed | Checksum Verified | Mode: PERSISTED]';
test('only exact terminal synthetic diagnostics are stripped; pictures and story remain',()=>{
    const story='Chapter closing.\n[image:slot-real]\n</content>';
    const source=story+'\n'+footer;
    assert.equal(stripModelDiagnosticFooter(source),story);
    assert.equal(stripModelDiagnosticFooter('Hello\n'+footer+'\n\n'),'Hello');
    assert.equal(stripModelDiagnosticFooter('A character quotes '+footer+' in dialogue.'),'A character quotes '+footer+' in dialogue.');
    assert.equal(stripModelDiagnosticFooter('Story\n[image:slot-real]'),'Story\n[image:slot-real]');
});
test('drawing cleanup removes diagnostic footer but preserves four prompts for future retries',()=>{
    const story='An artist arrived.';
    const block=i=>`[image]\nprompt: distinct scene ${i}\ncharacters: []\nafter: An artist arrived.\n[/image]`;
    const source=[story,...[1,2,3,4].map(block),'</content>',footer].join('\n');
    const msg={mes:source,extra:{}};
    const original=readDirectDrawDirectives(msg);
    assert.equal(original.length,4);
    rememberDirectDrawDirectives(msg,original);
    msg.mes=stripDirectDrawSource(source);
    assert.equal(readDirectDrawDirectives(msg).length,4);
    assert.equal(msg.mes.includes(footer),false);
    assert.equal(msg.mes.includes('[image]'),false);
    assert.equal(msg.mes.includes('An artist arrived.'),true);
    assert.equal(msg.extra.sti_comfy_direct.source.includes(footer),false);
});
test('old chats hide only the diagnostic footer at render time and do not mutate stored source or images',()=>{
    const message={mes:'The story.\n[image:slot-real]\n'+footer};
    const {document}=parseHTML('<div class="mes_text"><p>The story.</p><div class="sti-nd-img" data-slot-id="slot-real"><img src="/pic.png"></div><p>'+footer+'</p></div>');
    const root=document.querySelector('.mes_text');
    assert.equal(suppressRenderedModelDiagnosticFooter(root,message.mes),true);
    assert.ok(root.querySelector('[data-slot-id="slot-real"] img'));
    assert.doesNotMatch(root.textContent,/IDE Diagnostics Node/);
    assert.ok(message.mes.includes(footer));
});


const ideEnvelope = (body, file = 'chapter_18.txt') => [
    '[FastIO Node: verification | Checksum: SHA-256 PASSED]',
    '[Output Channel: SECURE_IPC_PIPE | Privacy: ZERO_LEAK]',
    `[Antigravity IDE Viewport: ${file} | Status: STREAMING]`,
    '<!-- [IDE_AST_TRACE] internal planning metadata -->',
    '<content>',
    body,
    '</content>',
    `[Antigravity IDE Viewport: ${file} | Status: STREAM_COMPLETE]`,
].join('\n');

test('structural IDE protocol isolation retains all four actual image slots and story', () => {
    const body=['Intro.',...Array.from({length:4},(_,i)=>`[image:slot-${i+1}]`),'Ending.'].join('\n');
    const source=ideEnvelope(body,'chapters/custom_chapter_52.txt');
    const clean=stripModelDiagnosticFooter(source);
    assert.equal(clean,body);
    assert.equal((clean.match(/\[image:slot-/g)||[]).length,4);
    assert.doesNotMatch(clean,/Antigravity|FastIO|IPC_PIPE|IDE_AST_TRACE|<\/?content>/);
    assert.equal(stripModelDiagnosticFooter(clean),clean);
});

test('pipeline extracts only narrative but keeps all original draw directives for generation', () => {
    const body=['Intro.', ...Array.from({length:4},(_,i)=>
        `[image]\nprompt: distinct scene ${i+1}\ncharacters: []\nafter: Intro.\n[/image]`),'Ending.'].join('\n');
    const message={mes:ideEnvelope(body),extra:{}};
    const directives=readDirectDrawDirectives(message);
    assert.equal(directives.length,4);
    rememberDirectDrawDirectives(message,directives);
    message.mes=stripDirectDrawSource(message.mes);
    assert.equal(message.mes,'Intro.\n\n\n\n\nEnding.');
    assert.equal(readDirectDrawDirectives(message).length,4);
    assert.equal(message.extra.sti_comfy_direct.source.includes('IDE_AST_TRACE'),false);
});

test('unknown content markup or a quoted IDE banner is never mistaken for a control envelope',()=>{
    const ordinary='Story uses <content>example</content> tags as literal markup.';
    assert.equal(stripModelDiagnosticFooter(ordinary),ordinary);
    const banner='A character said [Antigravity IDE Viewport: chapter_18.txt | Status: STREAMING] in dialogue.';
    assert.equal(stripModelDiagnosticFooter(banner),banner);
});

test('historical IDE wrapper is hidden at render layer, never rewriting stored image slots',()=>{
    const source=ideEnvelope('Scene one.\n\n[image:slot-real]\n\nScene two.');
    const {document}=parseHTML('<div class="mes_text"><p>[FastIO Node: verification]<br>[Output Channel: SECURE_IPC_PIPE]<br>[Antigravity IDE Viewport: chapter_18.txt | Status: STREAMING]</p><!-- secret --><p><content></content></p><p>Scene one.</p><div class="sti-nd-img" data-slot-id="slot-real"><img src="/saved.png"></div><p>Scene two.</p><p>[Antigravity IDE Viewport: chapter_18.txt | Status: STREAM_COMPLETE]</p></div>');
    const root=document.querySelector('.mes_text');
    assert.equal(suppressRenderedModelDiagnosticFooter(root,source),true);
    const visible=[...root.children].filter(el=>el.style.display!=='none').map(el=>el.textContent).join(' ');
    assert.doesNotMatch(visible,/Antigravity|FastIO|Output Channel/);
    assert.match(visible,/Scene one/);
    assert.match(visible,/Scene two/);
    assert.ok(root.querySelector('[data-slot-id="slot-real"] img'));
    assert.ok(source.includes('[image:slot-real]'));
});


test('real Markdown rendering of the IDE envelope hides protocol without hiding story slots',()=>{
    const input=ideEnvelope(['First paragraph.','','[image:slot-valid]','','Second paragraph.'].join(String.fromCharCode(10)) );
    const md=new showdown.Converter({simpleLineBreaks:true});
    const {document}=parseHTML('<div class="mes_text">'+md.makeHtml(input)+'</div>');
    const root=document.querySelector('.mes_text');
    assert.equal(suppressRenderedModelDiagnosticFooter(root,input),true);
    // textContent includes hidden descendants; measure only painted text.
    const painted=node=>node.nodeType===3?node.nodeValue:node.nodeType===1&&node.style?.display!=='none'
        ?[...node.childNodes].map(painted).join(' '):'';
    const visible=painted(root);
    assert.match(visible,/First paragraph/);
    assert.match(visible,/Second paragraph/);
    assert.ok(visible.includes('[image:slot-valid]'));
    assert.doesNotMatch(visible,/FastIO Node|Output Channel|Antigravity IDE Viewport/);
    const stable=root.innerHTML;
    assert.equal(suppressRenderedModelDiagnosticFooter(root,input),false);
    assert.equal(root.innerHTML,stable);
});

test('messages without an exact terminal footer are not changed',()=>{
    const {document}=parseHTML('<div class="mes_text"><p>'+footer+'</p></div>');
    const root=document.querySelector('.mes_text');
    assert.equal(suppressRenderedModelDiagnosticFooter(root,'Normal story.'),false);
    assert.match(root.textContent,/IDE Diagnostics Node/);
});
