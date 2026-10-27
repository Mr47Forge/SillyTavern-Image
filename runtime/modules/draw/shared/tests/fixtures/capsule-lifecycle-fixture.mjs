import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Keep the panel, job registry, activity bus and durable cancellation real.
// The host/model boundary never submits a real image or chat request.
export async function buildCapsuleFixture(platform = 'node') {
    const stubs = {
        'extensions.js': 'export const getContext=()=>globalThis.__capsule.ctx;',
        'script.js': 'export const getRequestHeaders=()=>({});',
        'user.js': 'export const getCurrentUserHandle=()=>"capsule-fixture";',
        'comfy-draw.js': `export const openSettings=()=>{globalThis.__capsule.settings++;};
            export const generateAndInsertImages=(...args)=>globalThis.__capsule.draw(...args);
            export const getSettings=()=>({showFloorButton:true,showFloatingButton:true});
            export const updateSettingsPersistent=()=>{};
            export const findLastAIMessageId=()=>globalThis.__capsule.ctx.chat.length-1;
            export const getGenerationState=id=>globalThis.__capsule.api.getFloorImageState(
                globalThis.__capsule.jobs,globalThis.__capsule.ctx,id);
            export const abortGeneration=(...args)=>globalThis.__capsule.abort(...args);`,
        'message-toolbar.js': `export const registerToToolbar=(_id,node)=>{document.querySelector('.mes').append(node);return true;};
            export const removeFromToolbar=(_id,node)=>node.remove();`,
        'draw-common.js': 'export const formatScenePlannerProgress=()=>"分析中";',
        'draw-run-production.js': 'export const isDrawRunPendingError=()=>false;',
    };
    const result = await build({
        stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), contents: `
            export * from '../providers/comfyui/floating-panel.js';
            export * from './draw-run-controls.js';
            export * from './draw-run-activity.js';
            export * from './floor-image-job.js';
            export * from './prepared-slot-executor.js';
            export * from './recoverable-image-jobs.js';
            export * from './confirmable-chat-save.js';
            export * from './image-job-reattach.js';
            export * from './image-job-recovery-executor.js';
            export * from './pending-image-jobs.js';
            export * from './draw-cancellation-journal.js';` },
        bundle: true, write: false, format: 'esm', platform,
        plugins: [{ name: 'host-boundary', setup(builder) {
            builder.onResolve({ filter: /\.js$/ }, ({ path }) => {
                const key = path.split('/').at(-1);
                return stubs[key] ? { path: key, namespace: 'host' } : null;
            });
            builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: stubs[path] }));
        } }],
    });
    return result.outputFiles[0].text;
}
