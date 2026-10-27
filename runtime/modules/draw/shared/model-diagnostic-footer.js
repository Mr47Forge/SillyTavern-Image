// A third-party model sometimes adds a synthetic diagnostic status at the end
// of story text. This is not an image marker, a drawing instruction or a user
// message. Only this exact, anchored footer is suppressed.
const DIAGNOSTIC_FOOTER = '[IDE Diagnostics Node: Viewport Stream Committed | Checksum Verified | Mode: PERSISTED]';
const END_OF_REPLY = /(?:[ \t]*\r?\n)*[ \t]*\[IDE Diagnostics Node:\s*Viewport Stream Committed\s*\|\s*Checksum Verified\s*\|\s*Mode:\s*PERSISTED\][ \t\r\n]*$/i;

export function stripModelDiagnosticFooter(source) {
    return String(source ?? '').replace(END_OF_REPLY, '');
}

// Old chat messages are immutable. Remove the visible artifact only from the
// mounted DOM; the original message, its slots and saved images stay untouched.
export function suppressRenderedModelDiagnosticFooter(root, originalSource) {
    if (!root || stripModelDiagnosticFooter(originalSource) === String(originalSource ?? '')) return false;
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    let node, changed = false;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script, style, textarea, code, pre, .sti-nd-img')) continue;
        const current = node.nodeValue || '';
        if (!current.includes(DIAGNOSTIC_FOOTER)) continue;
        node.nodeValue = current.replace(DIAGNOSTIC_FOOTER, '');
        changed = true;
    }
    return changed;
}
