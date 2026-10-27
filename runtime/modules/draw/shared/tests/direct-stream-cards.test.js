import test from 'node:test';
import assert from 'node:assert/strict';
import showdown from 'showdown';
import { parseHTML } from 'linkedom';
import { scanStreamingImageBlocks, projectStreamingImageBlocks } from '../direct-stream-cards.js';

const markdown = new showdown.Converter({ simpleLineBreaks: true });
function show(source, expectedCount = 4) {
    const {document} = parseHTML('<main><div id="msg">'+markdown.makeHtml(source)+'</div></main>');
    const root = document.querySelector('#msg');
    const build = ({index, total, label}) => {
        const card = document.createElement('div');
        card.className = 'sti-nd-img';
        card.textContent = label+' '+index+'/'+total;
        return card;
    };
    const found = projectStreamingImageBlocks(root, source, 1, build, expectedCount);
    return {root, found};
}
test('partial model directive becomes a card without exposing prompt text', () => {
    const source = 'Story before.\n\n<image>\nprompt: a red dress';
    const {root, found} = show(source);
    assert.equal(found, 1);
    assert.match(root.textContent, /Story before/);
    assert.match(root.textContent, /1\/4/);
    assert.doesNotMatch(root.textContent, /prompt:|red dress/);
    assert.equal(root.querySelectorAll('.sti-nd-img').length, 1);
    assert.equal(root.querySelector('template'), null);
    assert.match(source, /red dress/);
});
test('a tag opening alone occupies the correct position', () => {
    const {root, found} = show('Before.\n\n<image>');
    assert.equal(found, 1);
    assert.match(root.textContent, /Before/);
    assert.match(root.textContent, /1\/4/);
    assert.equal(root.querySelectorAll('.sti-nd-img').length, 1);
});
test('four completed instructions remain in order with narrative between', () => {
    let source = 'Opening.\n';
    for (let i = 1; i <= 4; i++) source += '\n<image>\nprompt: distinct scene '+i+'\n</image>\n\nSection '+i+'.\n';
    const {root, found} = show(source);
    assert.equal(found, 4);
    assert.deepEqual([...root.querySelectorAll('.sti-nd-img')].map(x => x.textContent.trim()),
        ['等待绘图 1/4','等待绘图 2/4','等待绘图 3/4','等待绘图 4/4']);
    assert.doesNotMatch(root.textContent, /prompt:|distinct scene/);
    assert.match(root.textContent, /Section 4/);
});
test('ordinary conversation and already committed slot markers are not changed', () => {
    const source = 'Story with [image:slot-xyz] but no raw instruction.';
    const {root, found} = show(source);
    assert.equal(found, 0);
    assert.match(root.textContent, /slot-xyz/);
});
test('scan recognizes incomplete final block without inventing a job', () => {
    const blocks = scanStreamingImageBlocks('<image>\nprompt: first\n</image>\n<image>\nprompt: second');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].complete, true);
    assert.equal(blocks[1].complete, false);
});
test('escaped model blocks are replaced, not left beside the frame', () => {
    const source = '<image>\nprompt: escaped text\n</image>';
    const {document} = parseHTML('<div id="msg"><p>&lt;image&gt;\nprompt: escaped text\n&lt;/image&gt;</p></div>');
    const root = document.querySelector('#msg');
    const found = projectStreamingImageBlocks(root, source, 0, () => {
        const card = document.createElement('div');
        card.className = 'sti-nd-img'; card.textContent = '等待绘图';
        return card;
    }, 4);
    assert.equal(found, 1);
    assert.equal(root.querySelectorAll('.sti-nd-img').length, 1);
    assert.doesNotMatch(root.textContent, /image>|prompt:/);
});
test('an HTML parser may turn an image tag into an empty img', () => {
    const source = '<image>\nprompt: alpha beta\n</image>';
    const {document} = parseHTML('<div id="msg"><p><img>\nprompt: alpha beta\n</p></div>');
    const root = document.querySelector('#msg');
    const found = projectStreamingImageBlocks(root, source, 0, () => {
        const card = document.createElement('div');
        card.className = 'sti-nd-img'; card.textContent = '等待绘图';
        return card;
    }, 4);
    assert.equal(found, 1);
    assert.equal(root.querySelectorAll('img:not([src])').length, 0);
    assert.doesNotMatch(root.textContent, /prompt:/);
});
