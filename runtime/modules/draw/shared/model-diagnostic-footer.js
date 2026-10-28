// The selected novel preset emits transport/IDE scaffolding around an actual
// <content> payload. Do not hardcode its changing chapter filenames or statuses.
const DIAGNOSTIC_FOOTER = '[IDE Diagnostics Node: Viewport Stream Committed | Checksum Verified | Mode: PERSISTED]';
const END_OF_REPLY = /(?:[ \t]*\r?\n)*[ \t]*\[IDE Diagnostics Node:\s*Viewport Stream Committed\s*\|\s*Checksum Verified\s*\|\s*Mode:\s*PERSISTED\][ \t\r\n]*$/i;
const OPEN_CONTENT = /<content\s*>/i;
const CLOSE_CONTENT = /<\/content\s*>/gi;
const IDE_HEADER = /\[(?:FastIO Node|Output Channel|Antigravity IDE Viewport):[^\r\n\]]+\]/i;
const VISIBLE_PROTOCOL_LINE = /\[(?:FastIO Node|Output Channel|Antigravity IDE Viewport):[^\r\n\]]+\]/gi;

export function locateModelContentEnvelope(source, {allowIncomplete=false}={}) {
    const text = String(source ?? '');
    const opening = OPEN_CONTENT.exec(text);
    if (!opening) return null;
    const prefix = text.slice(0, opening.index);
    // Ordinary story prose may contain <content>; isolate only a known protocol.
    if (!IDE_HEADER.test(prefix)) return null;
    const first = opening.index + opening[0].length;
    CLOSE_CONTENT.lastIndex = first;
    let closing, match;
    while ((match = CLOSE_CONTENT.exec(text))) closing = match;
    if (!closing && !allowIncomplete) return null;
    return {
        first, last: closing?.index ?? text.length,
        prefix, suffix: closing ? text.slice(closing.index + closing[0].length) : '',
        body: text.slice(first, closing?.index ?? text.length),complete: Boolean(closing)
    };
}

export function stripModelDiagnosticFooter(source) {
    const text = String(source ?? '');
    const envelope = locateModelContentEnvelope(text);
    if (envelope) {
        // Keep the entire narrative and every real [image:slot-*] inside the
        // payload. All external transport headers and trailer diagnostics are
        // control-plane material, not story text.
        return envelope.body.replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '');
    }
    return text.replace(END_OF_REPLY, '');
}

// Historical chats are read-only. SillyTavern's Markdown renderer can split
// <content> across paragraphs, so remove only synthetic UI outside the payload;
// never reassign the story element's innerHTML or touch actual image cards.
export function suppressRenderedModelDiagnosticFooter(root, originalSource) {
    if (!root) return false;
    const source = String(originalSource ?? '');
    const envelope = locateModelContentEnvelope(source, {allowIncomplete:true});
    if (!envelope && !source.includes(DIAGNOSTIC_FOOTER)) return false;
    let changed = false;
    if (envelope) {
        const payloadElements = [...root.querySelectorAll('content')];
        const payload = payloadElements[0];
        if (payload) {
            const parentOf = node => {
                let target = node;
                while (target.parentElement && target.parentElement !== root) target = target.parentElement;
                return target.parentElement === root ? target : null;
            };
            const opening = parentOf(payload);
            let reached = false;
            for (const child of [...root.childNodes]) {
                if (child === opening) {
                    reached = true;
                    // In Markdown <content> is sometimes a standalone empty <p>.
                    // Do not hide a real payload nested inside <content>.
                    if (!payload.textContent.trim() && !child.querySelector?.('.sti-nd-img')
                        && !child.textContent.trim() && child.style?.display !== 'none') {
                        child.style.display = 'none';changed = true;
                    }
                    continue;
                }
                if (!reached && child.nodeType === 1 && !child.querySelector?.('.sti-nd-img')) {
                    if (child.style.display !== 'none') { child.style.display = 'none'; changed = true; }
                }
                if (reached && envelope.complete && child.nodeType === 1
                    && !child.querySelector?.('.sti-nd-img')
                    && /^\[(?:Antigravity IDE Viewport|FastIO Node|Output Channel|IDE Diagnostics Node):/i.test(child.textContent.trim())) {
                    if (child.style.display !== 'none') { child.style.display = 'none'; changed = true; }
                }
            }
        }
        // Markdown may append the protocol suffix inside the last story paragraph.
        // Keep the narrative and remove the post-</content> metadata only.
        if (envelope.complete && /^\s*\[(?:Antigravity IDE Viewport|FastIO Node|Output Channel|IDE Diagnostics Node):/i.test(envelope.suffix)) {
            const marker = /\[(?:Antigravity IDE Viewport|FastIO Node|Output Channel|IDE Diagnostics Node):/i;
            const paragraphs = [...root.querySelectorAll('p')];
            for (const paragraph of paragraphs.reverse()) {
                if (paragraph.style.display === 'none' || paragraph.querySelector('.sti-nd-img')) continue;
                const walker = root.ownerDocument.createTreeWalker(paragraph, 4);
                let target, offset = -1, item;
                while ((item = walker.nextNode())) {
                    const match = marker.exec(item.nodeValue || '');
                    if (match) { target = item; offset = match.index; break; }
                }
                if (!target) continue;
                // The exact metadata suffix is allowed only after </content>.
                target.nodeValue = target.nodeValue.slice(0, offset);
                let cursor = target;
                while (cursor && cursor !== paragraph) {
                    while (cursor.nextSibling) cursor.nextSibling.remove();
                    cursor = cursor.parentNode;
                }
                changed = true;
                break;
            }
        }
        // Markdown may nest paragraphs under an unclosed custom <content>
        // element and split chapter_18 / STREAM_COMPLETE over <em> nodes.
        // Hide a whole protocol paragraph rather than matching its text nodes.
        for (const paragraph of root.querySelectorAll('p')) {
            const value = paragraph.textContent.trim();
            if (!/^\[(?:FastIO Node|Output Channel|Antigravity IDE Viewport|IDE Diagnostics Node):/i.test(value)
                || paragraph.querySelector('.sti-nd-img') || value.includes('[image:')) continue;
            if (paragraph.style.display !== 'none') { paragraph.style.display = 'none'; changed = true; }
        }
    }
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    let node;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script, style, textarea, code, pre, .sti-nd-img')) continue;
        const current = node.nodeValue || '';
        let next = current;
        // If the host escaped protocol tags instead of creating <content>,
        // remove only recognized control lines, not unrecognized story prose.
        if (envelope) next = next.replace(VISIBLE_PROTOCOL_LINE, '')
            .replace(/<\/?(?:content|ide_viewport_log)\s*>/gi, '');
        if (source.includes(DIAGNOSTIC_FOOTER)) next = next.replace(DIAGNOSTIC_FOOTER, '');
        if (next !== current) { node.nodeValue = next;changed = true; }
    }
    return changed;
}
