// Preserve multimodal image parts on the SillyTavern host request.
//
// Other extensions may wrap the top-level window.fetch and rewrite model calls.
// Call the same-origin settings iframe's unmodified fetch for image-character
// imports ONLY; never modify window.fetch globally or other assistant tasks.
export function createIsolatedImageHostClient(client, isolatedFetch, trace = () => {}) {
    if (typeof client?.buildHostChatCompletionGenerateRequest !== 'function'
        || typeof isolatedFetch !== 'function') {
        throw new Error('Image import host transport is not initialized');
    }
    return {
        ...client,
        createHostChatCompletion: async (payload, options = {}) => {
            const request = await client.buildHostChatCompletionGenerateRequest(payload, false);
            options.onRequest?.(request);
            const body = JSON.stringify(request.body);
            const imageCount = (request.body?.messages || []).reduce((sum, message) =>
                sum + (Array.isArray(message?.content)
                    ? message.content.filter(part => part?.type === 'image_url'
                        && typeof part.image_url?.url === 'string').length : 0), 0);
            trace('isolated-host-request', {
                endpoint: String(request.url || '').split('?')[0],
                messageCount: request.body?.messages?.length || 0,
                imageCount,
                bodyChars: body.length,
            });
            if (imageCount < 1) throw new Error('The image has been lost before sending to the host');
            const response = await isolatedFetch(request.url, {
                method: request.method || 'POST',
                headers: request.rawHeaders || request.headers,
                body,
                signal: options.signal,
            });
            const text = await response.text();
            let parsed;
            try {
                parsed = text ? JSON.parse(text) : {};
            } catch {
                const error = new Error('The host returned a non-JSON response for image import');
                error.status = response.status;
                throw error;
            }
            trace('isolated-host-response', {
                httpStatus: response.status,
                errorCode: parsed?.error?.code || null,
                finishReason: parsed?.choices?.[0]?.finish_reason || '',
            });
            if (!response.ok || parsed?.error) {
                const message = typeof parsed?.error === 'object'
                    ? (parsed.error.message || JSON.stringify(parsed.error))
                    : (String(parsed?.error || '') || ('HTTP ' + response.status));
                const error = new Error('Image import host request failed: ' + String(message).slice(0, 320));
                error.status = response.status;
                throw error;
            }
            return parsed;
        },
    };
}
