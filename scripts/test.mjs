import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const shared='runtime/modules/draw/shared/tests/';
const files=[
 'scripts/install-server.test.mjs',
 ...['audit-followup','audit-regressions','direct-draw','direct-stream-cards','wardrobe-continuity','scene-placement','male-image-exclusion',
 'direct-failure-retry','drawing-chain-integration','codex-save-recovery','generated-image-owner','model-diagnostic-footer','draw-validation-diagnostics','host-visible-scene','image-diagnostics-layout','all-fixes-continuity','draw-run-client','scene-plan-contract',
 'prepared-slot-executor','image-card-redraw-provider','draw-preview-rendering','removed-settings-pages','removed-manual-gallery-actions'].map(name=>shared+name+'.test.js'),
 ...['storage-boundaries','capsule-lifecycle','cancel-capsule-unlock','cancellation-storage-timeout','draw-cancellation-ui',
 'draw-work-cancellation','backend-image-jobs','recoverable-image-jobs','confirmable-chat-save',
 'image-job-recovery-executor','image-job-reattach','image-job-recovery-runtime'].map(name=>shared+name+'.test.js'),
 ...readdirSync('runtime/modules/draw/providers/comfyui/tests').filter(name=>name.endsWith('.test.js'))
  .map(name=>'runtime/modules/draw/providers/comfyui/tests/'+name),
 'server-plugin/tests/integration.test.cjs',
 ...['legacy-planner-cleanup','cancellation','job-manager','job-routes','provider-adapters'].map(name=>'server-plugin/runtime/tests/'+name+'.test.js'),
];
const result=spawnSync(process.execPath,['--test','--test-timeout=15000',...files],{stdio:'inherit'});
process.exit(result.status??1);
