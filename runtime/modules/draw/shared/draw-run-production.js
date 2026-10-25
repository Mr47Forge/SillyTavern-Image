// Retained only to classify errors from historical task recovery.
export class DrawRunProductionError extends Error {
    constructor(message, code, { cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'DrawRunProductionError';
        this.code = code;
    }
}

const DRAW_RUN_PENDING_CODES = new Set([
    'DRAW_RUN_ALREADY_PENDING',
    'DRAW_RUN_IMAGE_JOB_PENDING',
]);
const DRAW_RUN_MAX_IMAGE_ITEMS = 20;

export function isDrawRunPendingError(error) {
    return DRAW_RUN_PENDING_CODES.has(String(error?.code || ''));
}

export function isDrawRunCancelledError(error) {
    return error?.name === 'AbortError'
        || error?.code === 'DRAW_RUN_CANCELLED'
        || error?.message === '已取消';
}

