// Read SillyTavern's already-rendered message, after its regex, Markdown,
// formatter extensions and sanitization. This module never rewrites host DOM.
const SKIP = 'script, style, textarea, template, pre, code, button, select, input, .sti-nd-img, .sti-nd-failed, [hidden], [aria-hidden="true"]';
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s\u200b-\u200f\ufeff]/gu, '');

export function readHostVisibleNarrative(root, {getStyle} = {}) {
    if (!root?.ownerDocument?.createTreeWalker) return null;
    const style = getStyle ?? root.ownerDocument.defaultView?.getComputedStyle?.bind(root.ownerDocument.defaultView)
        ?? globalThis.getComputedStyle;
    const hidden = new Map();
    const isHidden = element => {
        if (!element || element === root.parentElement) return false;
        if (hidden.has(element)) return hidden.get(element);
        let value = element.matches?.(SKIP) === true || element.hasAttribute?.('inert') === true;
        if (!value && typeof style === 'function') {
            try {
                const css = style(element);
                value = css?.display === 'none' || css?.visibility === 'hidden' || css?.visibility === 'collapse';
            } catch { /* An unmounted or test document can lack computed style. */ }
        }
        if (!value && element.parentElement && element !== root) value = isHidden(element.parentElement);
        hidden.set(element, value);
        return value;
    };
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
        if (isHidden(node.parentElement)) continue;
        const text = node.nodeValue?.trim();
        if (text) parts.push(text);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Only the host-visible text can authorize a source anchor. The byte offset
// is still resolved against the immutable original, so saved markers and
// existing swipe / refresh recovery continue to work.
export function isHostVisibleAnchor(visibleText, after) {
    const needle = normalize(after);
    if (!needle || !visibleText?.trim()) return false;
    return normalize(visibleText).includes(needle);
}

export function hostVisibleSourcePoints(sceneSource, visibleText) {
    if (!visibleText?.trim() || !sceneSource?.points?.length) return [];
    const visible = normalize(visibleText);
    // Exclude source-only protocol/status/hidden sections even if they have
    // syntactically valid sentence endings. Avoid matching tiny fragments.
    return sceneSource.points.filter(point => {
        const anchor = sceneSource.anchors?.find(value => value.offset === point.offset)?.text || '';
        const clean = normalize(anchor.replace(/<[^>]+>/g, ''));
        return clean.length >= 7 && !/[\[\]]/.test(clean) && visible.includes(clean);
    });
}

export function visibleFallbackOffset(sceneSource, visibleText) {
    const matched=hostVisibleSourcePoints(sceneSource,visibleText).at(-1)?.offset;
    if (matched !== undefined) return matched;
    // Markdown can add emphasis markers around a sentence. The complete
    // source-point text then differs from the DOM text, even though the actual
    // visible sentence still has one unambiguous location in the raw reply.
    const raw=String(sceneSource?.sourceText || '');
    const sentences=String(visibleText || '').match(/[^。！？.!?\\n]+[。！？.!?]?/gu)||[];
    for (const part of sentences.reverse()) {
        const sentence=part.trim();
        if (sentence.length < 8) continue;
        const at=raw.indexOf(sentence);
        if (at < 0 || raw.indexOf(sentence,at+1)>=0) continue;
        const end=at+sentence.length;
        // Never split Markdown/HTML syntax with a marker: require a nearby
        // parser-confirmed source sentence boundary, not an arbitrary index.
        const point=sceneSource?.points?.find(p=>p.offset>=end && p.offset-end<=16);
        if(point)return point.offset;
    }
    return null;
}
