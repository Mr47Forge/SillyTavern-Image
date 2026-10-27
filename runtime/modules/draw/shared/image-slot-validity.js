// Only slots with server records, live activity, pending transport or an
// actual gallery state are owned by this plugin. Unclaimed source markers are
// never allowed to masquerade as a generated image or a failed image.
export function isUnclaimedImageSlot({ savedEntry, activity, pendingSlot, displayData, slotIdentity } = {}) {
    return !savedEntry && !activity && !pendingSlot && !slotIdentity
        && !displayData?.hasData && !displayData?.isFailed;
}
