import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { openImageDiagnostics } from '../image-diagnostics.js';

function withDocument(height, fn) {
    const { document, window } = parseHTML('<html><body></body></html>');
    const oldWindow = globalThis.window;
    const oldTimer = globalThis.setInterval;
    globalThis.window = window;
    globalThis.window.visualViewport = { height, offsetTop: 0 };
    globalThis.setInterval = () => 0;
    try { return fn(document); }
    finally {
        globalThis.setInterval = oldTimer;
        if (oldWindow === undefined) delete globalThis.window;
        else globalThis.window = oldWindow;
    }
}

test('image prompt modal has real viewport height and scrollable readable text, not a collapsed flex body', () => {
    withDocument(680, document => {
        const source = 'long positive prompt '.repeat(250);
        const overlay = openImageDiagnostics({ imgId:'img-1', positive:source,
            negativePrompt:'bad anatomy, blurry image',
            promptTrace:{nodes:[{id:3,type:'CLIPTextEncode',text:'workflow prompt'}]} }, {document});
        const card = overlay.firstElementChild, body = card.lastElementChild;
        assert.match(card.style.height, /min\(760px/);
        assert.equal(overlay.style.getPropertyValue('--sti-diagnostics-vvh'), '680px');
        assert.equal(body.style.flex, '1 1 auto');
        assert.equal(body.style.overflowY, 'auto');
        assert.equal(body.style.minHeight, '0');
        assert.ok(body.textContent.includes(source));
        assert.ok(body.textContent.includes('bad anatomy'));
        assert.ok(body.textContent.includes('workflow prompt'));
        assert.ok([...body.querySelectorAll('pre')].every(item => item.style.maxWidth === '100%'));
        overlay.querySelector('button').click();
        assert.equal(document.getElementById('sti-draw-diagnostics-overlay'), null);
    });
});

test('small mobile viewport uses its actual height rather than a stale settings CSS variable', () => {
    withDocument(340, document => {
        const overlay = openImageDiagnostics({positive:'test prompt'}, {document});
        assert.equal(overlay.style.getPropertyValue('--sti-diagnostics-vvh'), '340px');
        assert.match(overlay.firstElementChild.style.height,/sti-diagnostics-vvh/);
        assert.match(overlay.firstElementChild.style.maxHeight,/sti-diagnostics-vvh/);
        assert.ok(overlay.lastElementChild.lastElementChild.textContent.includes('test prompt'));
        overlay.remove();
    });
});

test('missing historical prompt record displays clear reason, not an apparently blank log', () => {
    withDocument(620, document => {
        const overlay = openImageDiagnostics({imgId:'cached-id', positive:'', tags:'original scene words'}, {document});
        const text = overlay.lastElementChild.textContent;
        assert.match(text,/原始绘图提示词/);
        assert.match(text,/original scene words/);
        assert.match(text,/没有可读取的完整提示词记录/);
        overlay.remove();
    });
});

test('error log uses the same expanded, scrollable modal', () => {
    withDocument(700, document => {
        const overlay = openImageDiagnostics(null,{document,errors:true,items:[
            {time:Date.now(),stage:'第 3 张图片',errorType:'DRAW_IMAGE_REJECTED',message:'story anchor failed'},
        ]});
        assert.equal(overlay.firstElementChild.lastElementChild.style.overflowY, 'auto');
        assert.match(overlay.textContent,/story anchor failed/);
        overlay.remove();
    });
});

test('card prompt log recovery never substitutes a different image history record', async () => {
    const source = fs.readFileSync(new URL('../../providers/comfyui/comfy-draw.js',import.meta.url),'utf8');
    const start = source.indexOf("    if (action === 'view-prompt-log') {");
    const end = source.indexOf("    if (action === 'open-gallery') {",start);
    assert.ok(start>=0 && end>start);
    const code = source.slice(start,end);
    const opened=[], bySlot=[{imgId:'other-image',positive:'incorrect'},{imgId:'correct-image',positive:'correct'}];
    const env = {
        action:'view-prompt-log',
        container:{dataset:{imgId:'correct-image',slotId:'slot-x',positive:''},querySelector:()=>null},
        getPreview:async()=>null,
        getPreviewsBySlot:async()=>bySlot,
        openImageDiagnostics:record=>opened.push(record),
        Date
    };
    vm.runInNewContext('this.run = async function run(){'+code+'}',env);
    await env.run();
    assert.equal(opened[0].positive,'correct');
    env.container.dataset.imgId='missing-id';
    await env.run();
    assert.equal(opened[1].imgId,'missing-id');
    assert.notEqual(opened[1].positive,'incorrect');
});

test('identical 900/901 conditioning text is not shown twice, CFG=1 is labeled accurately', () => {
    withDocument(660, document => {
        const positive = 'one single woman, solo';
        const negative = 'duplicate person, twins';
        const overlay = openImageDiagnostics({
            imgId:'solo-img', positive, negativePrompt:negative,
            promptTrace:{ cfg:1, positive, negative, nodes:[
                {id:'900',type:'CLIPTextEncode',text:positive},
                {id:'901',type:'CLIPTextEncode',text:negative},
            ] },
        }, {document});
        const body = overlay.lastElementChild;
        assert.equal(body.textContent.split(positive).length - 1, 1);
        assert.equal(body.textContent.split(negative).length - 1, 1);
        assert.ok(body.textContent.includes('CFG=1：此轮不参与采样'));
        assert.ok(!body.textContent.includes('工作流节点 900'));
        assert.ok(!body.textContent.includes('工作流节点 901'));
        overlay.remove();
    });
});
