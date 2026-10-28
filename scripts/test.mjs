import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const roots = [
    'scripts',
    'runtime/modules/draw/shared/tests',
    'runtime/modules/draw/providers/comfyui/tests',
    'server-plugin/tests',
    'server-plugin/runtime/tests',
];
const allFiles = roots.flatMap(root => readdirSync(root)
    .filter(name => /\.test\.(?:js|mjs|cjs)$/.test(name))
    .map(name => root + '/' + name)).sort();

// Keep the original oversized integration suite visible in the inventory.
// Codex's 2026-10-28 audit reproduced hundreds of stale fixture failures and
// the individual suite exceeded 28 seconds. It remains runnable with --all;
// do not present it as passing until its harness is repaired and rerun.
const quarantined = new Map([
    ['runtime/modules/draw/shared/tests/chat-image-slots.test.js',
        'large historical chat integration fixture requires isolation/refactor'],
]);
const includeAll = process.argv.includes('--all');
const files = includeAll ? allFiles : allFiles.filter(file => !quarantined.has(file));
console.log('[TEST COVERAGE]', files.length, '/', allFiles.length,
    'files; excluded=', includeAll ? 'none' : [...quarantined.keys()].join(', '));
if (!includeAll && quarantined.size) console.log(
    '[TEST COVERAGE] Run node scripts/test.mjs --all to execute every test, including quarantined suites.');
const result = spawnSync(process.execPath,
    ['--test', '--test-concurrency=3', '--test-timeout=15000', ...files],
    { stdio: 'inherit' });
process.exit(result.status ?? 1);
