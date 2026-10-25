// Keep the settings shell at its layout height. A keyboard only occludes the
// content; it must not move the bottom navigation to the top of the keyboard.
export function resolveSettingsViewport(previous, metrics) {
    const width = Math.max(1, Math.round(metrics.width || 1));
    const layoutHeight = Math.max(1, Math.round(metrics.layoutHeight || 1));
    const visibleHeight = Math.max(1, Math.round(metrics.visibleHeight || layoutHeight));
    const sameWidth = previous && Math.abs(previous.width - width) < 5;
    const baseline = sameWidth ? previous.height : layoutHeight;
    const keyboardOpen = Boolean(metrics.mobile
        && (metrics.editable || previous?.heightLocked)
        && baseline - Math.min(layoutHeight, visibleHeight) > Math.max(100, baseline * 0.18));
    // Legacy Android browsers shrink innerHeight gradually during animation.
    // Retain the pre-focus baseline from the very first shrink, not just after
    // the keyboard has crossed the detection threshold.
    const heightLocked = Boolean(metrics.mobile && sameWidth
        && (metrics.editable || previous.heightLocked)
        && (layoutHeight < baseline || keyboardOpen));
    const height = heightLocked ? baseline : layoutHeight;
    return {
        width,
        height,
        keyboardOpen,
        heightLocked,
        visibleHeight: Math.min(height, visibleHeight),
        offsetTop: Math.max(0, Math.round(metrics.offsetTop || 0)),
    };
}
