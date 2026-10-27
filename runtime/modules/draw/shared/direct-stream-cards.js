import { scanDrawImageBlocks } from './image-marker-syntax.js';

// Display only: match the exact instruction grammar used for real job parsing.
export function scanStreamingImageBlocks(source) {
    return scanDrawImageBlocks(source, {allowIncomplete:true});
}

function textRangeFor(root, expected) {
    const target = String(expected || '').trim();
    if (!target) return null;
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    const runs = []; let text = '', node;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('.sti-nd-img, script, style, textarea')) continue;
        const part = node.nodeValue || '';
        runs.push({node, start: text.length, end: text.length + part.length});
        text += part;
    }
    const exact = text.indexOf(target);
    let from = exact, to = exact < 0 ? -1 : exact + target.length;
    if (from < 0) {
        // Markdown may render line breaks as separate elements with no text-node whitespace.
        const escaped = target.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
        const match = new RegExp(escaped).exec(text);
        if (!match) return null;
        from = match.index; to = match.index + match[0].length;
    }
    const first = runs.find(run => from >= run.start && from < run.end);
    const last = runs.find(run => to > run.start && to <= run.end);
    if (!first || !last) return null;
    return {
        first: first.node,
        replace(card) {
            const suffix = last.node.nodeValue.slice(to - last.start);
            first.node.nodeValue = first.node.nodeValue.slice(0, from - first.start);
            if (first === last) first.node.after(card, root.ownerDocument.createTextNode(suffix));
            else {
                last.node.nodeValue = suffix;
                for (const run of runs.slice(runs.indexOf(first) + 1, runs.indexOf(last))) run.node.nodeValue = '';
                first.node.after(card);
            }
        },
    };
}

function makeDraftCard(root, block, messageId, makeCard, total) {
    const card = makeCard({slotId: '', messageId, index: block.ordinal,
        total, label: '等待绘图'});
    card.dataset.stiDirectDraft = String(block.ordinal);
    // The source already lives in message.mes and later in saved directive metadata.
    // Do not duplicate private model instructions into visible DOM text or attributes.
    return card;
}

function bareImageTag(root) {
    return [...root.querySelectorAll('image, img')].filter(el => {
        if (el.closest('.sti-nd-img, pre, code, script, style')) return false;
        if (el.tagName.toLowerCase() === 'image') return true;
        return !el.hasAttribute('src') && !el.hasAttribute('alt')
            && !el.hasAttribute('data-slot-id') && el.attributes.length === 0;
    });
}
// The first visible byte is a card, even if the streaming model has only
// emitted <image> with no prompt yet. The raw directive stays in a template.
export function projectStreamingImageBlocks(root, source, messageId, makeCard, requestedCount = 0) {
    if (!root || typeof makeCard !== 'function') return 0;
    const blocks = scanStreamingImageBlocks(source);
    if (!blocks.length) return 0;
    const total = Number.isInteger(Number(requestedCount)) && Number(requestedCount) > 0
        ? Math.max(blocks.length, Math.min(20, Number(requestedCount))) : blocks.length;
    const elements = bareImageTag(root);
    let projected = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        const htmlIndex = blocks.slice(0, i + 1).filter(item => item.raw.startsWith('<')).length - 1;
        const opener = block.raw.startsWith('<') && elements[htmlIndex]?.isConnected ? elements[htmlIndex] : null;
        const card = makeDraftCard(root, block, messageId, makeCard, total);
        if (opener?.tagName.toLowerCase() === 'image') {
            const paragraph = opener.closest('p');
            if (paragraph && paragraph.textContent.trim() === opener.textContent.trim()) {
                paragraph.replaceWith(card);
            } else opener.replaceWith(card);
            projected++;
            continue;
        }
        // Host sanitizers may either preserve <image>, turn it into an empty
        // <img>, or escape both tags as text. Handle all three projections.
        const range = textRangeFor(root, block.raw) || textRangeFor(root, block.body);
        if (range) {
            // Replacing the whole isolated paragraph avoids invalid div-in-p.
            const paragraph = opener?.closest('p') || range.first.parentElement?.closest('p');
            if (paragraph && [block.body.trim(), block.raw.trim()].includes(paragraph.textContent.trim())) {
                paragraph.replaceWith(card);
            } else {
                range.replace(card);
                opener?.remove();
            }
            projected++;
        } else if (opener && !block.body.trim()) {
            const paragraph = opener.closest('p');
            if (paragraph && !paragraph.textContent.trim()) paragraph.replaceWith(card);
            else opener.replaceWith(card);
            projected++;
        }
    }
    return projected;
}
