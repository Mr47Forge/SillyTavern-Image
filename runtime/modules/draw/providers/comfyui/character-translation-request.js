const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

export function isRetryableCharacterTranslationError(error) {
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
    if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
    const code = String(error?.code || '').toUpperCase();
    if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) return true;
    const message = String(error?.message || '');
    return /\b(?:HTTP\s*)?(?:502|503|504)\b/i.test(message)
        || /\b(?:ECONNRESET|ETIMEDOUT|fetch failed|network error)\b/i.test(message);
}

export async function requestCharacterTranslation(adapter, task, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    try {
        return await adapter.chat(task);
    } catch (error) {
        if (!isRetryableCharacterTranslationError(error)) throw error;
        console.warn('[ComfyDraw] 翻译接口临时不可用，1 秒后仅重试一次', {
            httpStatus: Number(error?.status ?? error?.statusCode ?? error?.response?.status) || null,
            code: String(error?.code || '').slice(0, 36),
        });
        await wait(1000);
        return adapter.chat(task);
    }
}

export function describeCharacterSaveError(error) {
    const message = String(error?.message || '');
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
        || Number(message.match(/\b(?:400|401|403|404|408|413|422|429|500|502|503|504)\b/)?.[0]);
    if (/\b(?:safety|content.filter|moderation|refusal|blocked|policy)\b/i.test(message)) {
        return 'AI 拒绝处理当前描述，请检查角色年龄与内容设置';
    }
    if (status === 401 || status === 403) return 'AI 接口授权失败（HTTP ' + status + '）';
    if (status === 429) return 'AI 接口请求过多（HTTP 429），稍后再试';
    if (TRANSIENT_HTTP_STATUSES.has(status) || status === 500) return 'AI 上游暂时不可用（HTTP ' + status + '）';
    if (/超时|timed?\s*out|ETIMEDOUT/i.test(message)) return 'AI 请求超时';
    if (/network|fetch failed|ECONNRESET|Failed to fetch/i.test(message)) return 'AI 网络连接失败';
    if (/AI未返回|AI返回|角色英文外貌|英文外貌|英文提示词|英文外貌与中文角色|一次最多|保存期间|已不存在|请填写角色名|英文绘图词|中文外貌/i.test(message)) {
        // Only return application-authored validation messages. Do not expose provider URLs, keys or prompts.
        return /(?:https?:\/\/|Bearer|sk-\w+)/i.test(message) ? 'AI 返回内容不符合要求' : message.slice(0, 95);
    }
    return 'AI 翻译或角色存储失败，请查看浏览器控制台';
}
