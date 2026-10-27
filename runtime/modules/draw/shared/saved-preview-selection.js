// Portable H28K file refs must win over an expired local IndexedDB selection.
// A genuine selected preview or explicit failed selection still has priority.
export function shouldUsePortableSavedImage(savedEntry, display = {}) {
    if(!savedEntry?.savedUrl)return false;
    if(!display.selectedImgId || display.selectedImgId===savedEntry.imgId)return true;
    if(display.isFailed&&Number(savedEntry.updatedAt)>0&&Number(display.preview?.timestamp)>0
        &&savedEntry.updatedAt>display.preview.timestamp)return true;
    return !display.hasData && !display.isFailed;
}
