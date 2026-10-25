import { compile as compileComfy } from '../providers/comfyui/compiler.js';

import { workflowPromptTrace } from './image-diagnostics.js';

const compilers = { comfyui: compileComfy };

// Provider preparation is local and deterministic for the captured recipe.
// The existing provider batch runners consume these exact compiled requests;
// cards and message adoption share the same saved, editable input.
export function prepareImageInput(provider, tasks, recipe) {
    const compiledBatch = compilers[provider](tasks, recipe);
    const requests = compiledBatch.artifacts.map(({ promptData }) => ({
        prompt: promptData.positive,
        characterPrompts: promptData.characterPrompts,
        negativePrompt: promptData.negative,
        params: recipe.params,
    }));
    const metadata = compiledBatch.artifacts.map(({ task, promptData }, index) => ({
        tags: task.scene || '',
        positive: promptData.positive,
        characterPrompts: promptData.characterPrompts,
        negativePrompt: promptData.negative,
        postPrompt: task.post_prompt || '',
        ...(provider === 'comfyui' ? { promptTrace: workflowPromptTrace(
            compiledBatch.items?.[index]?.request,
            { positive: promptData.positive, negative: promptData.negative },
        ) } : {}),
    }));
    return { compiledBatch, requests, metadata };
}
