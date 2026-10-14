// Protect image-position markers while SillyTavern's Markdown/HTML formatter
// transforms source text. This does not change the persisted chat message.
import { createDrawImageSlotRegex } from './image-marker-syntax.js';

export function protectDrawImageMarkers(source) {
    const original = String(source ?? '');
    let salt = 0;
    while (original.includes('XBIMAGESLOTANCHOR' + salt + 'END')) salt++;
    const markers = [];
    const text = original.replace(createDrawImageSlotRegex(), (match, id) => {
        const token = 'XBIMAGESLOTANCHOR' + salt + 'A' + markers.length + 'END';
        markers.push({ token, marker: match, id });
        return token;
    });
    return { text, markers };
}

export function restoreDrawImageMarkers(root, markers) {
    if (!root || !Array.isArray(markers) || markers.length === 0) return new Set();
    const restored = new Set();
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; never edit attributes or HTML.
    let node;
    while ((node = walker.nextNode())) {
        let value = node.nodeValue || '';
        for (const { token, marker, id } of markers) {
            if (!value.includes(token)) continue;
            value = value.split(token).join(marker);
            restored.add(id);
        }
        if (value !== node.nodeValue) node.nodeValue = value;
    }
    return restored;
}
