// Character import and translation use SillyTavern's active model, never an
// unconfigured legacy AssistantStorage provider or a second hidden API key.
export function createHostCharacterAdapter(generateRaw) {
    if (typeof generateRaw !== 'function') throw new Error('SillyTavern model API unavailable');
    return {
        async chat({ systemPrompt = '', messages = [], maxTokens = 8192 }) {
            const prompt = (Array.isArray(messages) ? messages : [])
                .map(message => {
                    const content = typeof message?.content === 'string'
                        ? message.content : JSON.stringify(message?.content ?? '');
                    return String(message?.role || 'user') + ': ' + content;
                }).join('\n\n');
            const response = await generateRaw({
                prompt,
                systemPrompt: String(systemPrompt || ''),
                responseLength: Math.max(1, Math.min(8192, Number(maxTokens) || 8192)),
            });
            const text = typeof response === 'string' ? response : response?.text;
            if (!String(text || '').trim()) throw new Error('SillyTavern active model returned no text');
            return { text: String(text) };
        },
    };
}
export async function resolveCharacterHelperContext() {
    const { generateRaw } = await import('/script.js');
    const adapter = createHostCharacterAdapter(generateRaw);
    return {
        providerConfig: { maxTokens: 8192, reasoning: { mode: 'off', output: 'hide' } },
        agentCore: { createAgentAdapter: () => adapter },
    };
}
