const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

export function describeCharacterSaveError(error) {
    if (error?.code === 'STORAGE_VERSION_CONFLICT') return '资料已被其他设备更新，本次未覆盖。请保留输入，刷新后重试。';
    const message = String(error?.message || '');
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
        || Number(message.match(/\b(?:400|401|403|404|408|413|422|429|500|502|503|504)\b/)?.[0]);
    if (/\b(?:safety|content.filter|moderation|refusal|blocked|policy)\b/i.test(message)) {
        return 'AI 拒绝处理当前描述，请检查角色年龄与内容设置';
    }
    if (status === 401 || status === 403) return '酒馆登录或权限验证失败（HTTP ' + status + '）';
    if (status === 429) return '保存请求过多（HTTP 429），稍后再试';
    if (TRANSIENT_HTTP_STATUSES.has(status) || status === 500) return '服务暂时不可用（HTTP ' + status + '）';
    if (/超时|timed?\s*out|ETIMEDOUT/i.test(message)) return '请求超时';
    if (/network|fetch failed|ECONNRESET|Failed to fetch/i.test(message)) return '网络连接失败';
    if (/AI未返回|AI返回|角色英文外貌|英文外貌|英文提示词|英文外貌与中文角色|一次最多|保存期间|已不存在|请填写角色名|英文绘图词|中文外貌/i.test(message)) {
        // Only return application-authored validation messages. Do not expose provider URLs, keys or prompts.
        return /(?:https?:\/\/|Bearer|sk-\w+)/i.test(message) ? 'AI 返回内容不符合要求' : message.slice(0, 95);
    }
    return '角色保存失败，请查看浏览器控制台';
}
