import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readHostVisibleNarrative, isHostVisibleAnchor, hostVisibleSourcePoints } from '../host-visible-scene.js';
import { readDirectDrawDirectives, buildDirectDrawTasks, buildDirectDrawInstruction } from '../direct-draw.js';
import { insertScenePlacementsPreservingSlots } from '../scene-placement.js';

const makeRoot = html => {
    const {document} = parseHTML('<div class="mes_text">'+html+'</div>');
    return document.querySelector('.mes_text');
};
const directive = (after,prompt,imageIndex)=>({imageIndex,after,prompt,characters:[]});

test('host renderer owns visible text: computed CSS, hidden nodes, comments and image cards are excluded',()=>{
    const root=makeRoot('<p class="hidden-by-regex">不可见剧情。</p><p>可见场景一。</p>'
        +'<p style="display:none">内联隐藏剧情。</p><p>可见场景二。</p>'
        +'<pre>思维过程。</pre><!-- 不应展示 --><div class="sti-nd-img">已生成图片</div>');
    const content=readHostVisibleNarrative(root,{getStyle:el=>({display:el.classList?.contains('hidden-by-regex')?'none':el.style?.display||''})});
    assert.equal(content,'可见场景一。 可见场景二。');
    assert.equal(isHostVisibleAnchor(content,'可见场景二。'),true);
    assert.equal(isHostVisibleAnchor(content,'不可见剧情。'),false);
});

test('host-visible anchors are matched against original immutable offsets rather than preset-specific tags',()=>{
    const raw='[状态: PRIVATE]\n隐藏剧情甲。\n\n可见场景一。\n\n可见场景二。\n\n[status]DONE';
    const visible='可见场景一。 可见场景二。';
    const tasks=buildDirectDrawTasks([
        directive('隐藏剧情甲。','unique hidden moment',0),
        directive('可见场景一。','unique first visible moment',1),
        directive('可见场景二。','unique second visible moment',2),
    ],{maxImages:3},{sourceText:raw,hostVisibleText:visible});
    assert.equal(tasks.length,3);
    const first=raw.indexOf('可见场景一。')+'可见场景一。'.length;
    const second=raw.indexOf('可见场景二。')+'可见场景二。'.length;
    assert.equal(tasks[1].placement.offset,first);
    assert.equal(tasks[2].placement.offset,second);
    assert.notEqual(tasks[0].placement.offset,raw.indexOf('隐藏剧情甲。')+'隐藏剧情甲。'.length);
    assert.ok(tasks[0].placement.offset<=first);
    const ids=['slot-a','slot-b','slot-c'].map(slotId=>({slotId}));
    const stored=insertScenePlacementsPreservingSlots(raw,tasks.map((task,i)=>({
        placement:task.placement,content:`[image:${ids[i].slotId}]`,
    })),{block:true});
    assert.equal((stored.match(/\[image:slot-/g)||[]).length,3);
    assert.equal(stored.includes('可见场景一。'),true);
    assert.equal(stored.includes('可见场景二。'),true);
    assert.equal(stored.includes('[状态: PRIVATE]'),true,'we never rewrite host/preset source data');
});

test('a hidden status has no eligible narrative anchor despite being present in raw source',()=>{
    const raw='[PRIVATE] 仅原文可见。\n\n读者看得到这一句。\n\n[AFTER] done';
    const tasks=buildDirectDrawTasks([directive('仅原文可见。','rendered reader portrait',0)],
        {maxImages:1},{sourceText:raw,hostVisibleText:'读者看得到这一句。'});
    assert.equal(tasks[0].placement.mode,'source');
    assert.equal(tasks[0].placement.offset,raw.indexOf('读者看得到这一句。')+'读者看得到这一句。'.length);
});

test('bracket/XML/mixed grammar all parse; if truly absent, the error names both supported forms',()=>{
    const blocks=['<image>\nprompt: one\nafter: A scene.\n</image>',
        '[image]\nprompt: two\nafter: A scene.\n[/image]',
        '[image]\nprompt: three\nafter: A scene.\n[/image]',
        '<image>\nprompt: four\nafter: A scene.\n</image>'];
    assert.deepEqual(readDirectDrawDirectives({mes:'A scene.\n'+blocks.join('\n')}).map(p=>p.prompt),['one','two','three','four']);
    const instructions=buildDirectDrawInstruction({preset:{maxImages:4}});
    assert.match(instructions, /\[image\]\.\.\.\[\/image\]/);
    assert.match(instructions, /<image>\.\.\.<\/image>/);
    assert.throws(()=>buildDirectDrawTasks([],{},{}),error=>
        error.code==='DRAW_DIRECTIVES_MISSING' && error.message.includes('[image]...[/image]')
        && error.message.includes('<image>...</image>'));
});

test('Markdown-emphasized visible sentence falls back to a source boundary outside formatting syntax',()=>{
    const raw='[internal status] hidden text.\\n\\n*画面中可以看到她走进庭院。*\\n\\n[status] hidden end';
    const tasks=buildDirectDrawTasks([directive('模型引用了不存在的句子。','different garden portrait',0)],
        {maxImages:1},{sourceText:raw,hostVisibleText:'画面中可以看到她走进庭院。'});
    const offset=tasks[0].placement.offset;
    assert.equal(tasks[0].placement.mode,'source');
    assert.ok(offset>=raw.indexOf('庭院。')+'庭院。'.length);
    assert.ok(offset<=raw.indexOf('庭院。')+'庭院。'.length+1);
});

test('missing browser message leaves existing pure source mapping available without a DOM dependency',()=>{
    assert.equal(readHostVisibleNarrative(null),null);
    const raw='可见段落。';
    assert.equal(buildDirectDrawTasks([directive('可见段落。','real portrait',0)],{maxImages:1},{sourceText:raw})[0].placement.offset,raw.length);
});
