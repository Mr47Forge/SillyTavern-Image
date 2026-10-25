import { compile as compileComfyUi } from './providers/comfyui/compiler.js';
import {
    assertDrawRunId,
    createDrawRunId,
    deriveDrawRunChildJobId,
    deriveDrawRunItemIds,
} from './shared/draw-run-identifiers.js';
import { executePreparedScenePlanner } from './shared/scene-planner-executor.js';
import { assertSubmitScenePlanTool } from './shared/scene-plan-contract.js';
import { hashSceneSource } from './shared/scene-source.js';

const PROVIDER_COMPILERS = Object.freeze({
    comfyui: compileComfyUi,
});

export function compileDrawRunImages(provider, scenePlan, generationRecipe) {
    const compiler = PROVIDER_COMPILERS[String(provider || '')];
    if (!compiler) throw new TypeError('Draw Run 图片 Provider 无效');
    return compiler(scenePlan, generationRecipe);
}

export {
    assertDrawRunId,
    assertSubmitScenePlanTool,
    createDrawRunId,
    deriveDrawRunChildJobId,
    deriveDrawRunItemIds,
    executePreparedScenePlanner,
    hashSceneSource,
};
