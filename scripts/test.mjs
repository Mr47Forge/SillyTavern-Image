import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const shared='runtime/modules/draw/shared/tests/';
const files=[
 'scripts/install-server.test.mjs',
 ...['audit-followup','audit-regressions','direct-draw','wardrobe-continuity','scene-placement',
 'prepared-slot-executor','image-card-redraw-provider','removed-settings-pages'].map(name=>shared+name+'.test.js'),
 ...readdirSync('runtime/modules/draw/providers/comfyui/tests').filter(name=>name.endsWith('.test.js'))
  .map(name=>'runtime/modules/draw/providers/comfyui/tests/'+name),
 'server-plugin/tests/integration.test.cjs',
 ...['cancellation','job-manager','job-routes','provider-adapters'].map(name=>'server-plugin/runtime/tests/'+name+'.test.js'),
];
const result=spawnSync(process.execPath,['--test','--test-timeout=15000',...files],{stdio:'inherit'});
process.exit(result.status??1);
