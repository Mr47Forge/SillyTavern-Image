const DAY = 86400000;
export function isGeneratedSavedImage(url = '') {
    try {
        const decoded = decodeURIComponent(String(url));
        return /^\/user\/images\/(?:[^/]+\/)?(?:comfy_auto|draw)_img-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpe?g|webp)$/i.test(decoded);
    } catch { return false; }
}
export function isExpiredSavedImage(entry, days, now = Date.now()) {
    const timestamp = Number(entry?.updatedAt || entry?.timestamp);
    return isGeneratedSavedImage(entry?.savedUrl) && timestamp > 0
        && timestamp < now - days * DAY;
}
