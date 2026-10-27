import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
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
test('messages without an exact terminal footer are not changed',()=>{
    const {document}=parseHTML('<div class="mes_text"><p>'+footer+'</p></div>');
    const root=document.querySelector('.mes_text');
    assert.equal(suppressRenderedModelDiagnosticFooter(root,'Normal story.'),false);
    assert.match(root.textContent,/IDE Diagnostics Node/);
});
