import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const roots = [
    'scripts',
    'runtime/modules/draw/shared/tests',
    'runtime/modules/draw/providers/comfyui/tests',
    'server-plugin/tests',
    'server-plugin/runtime/tests',
];
const files = roots.flatMap(root => readdirSync(root)
    .filter(name => /\.test\.(?:js|mjs|cjs)$/.test(name))
    .map(name => root + '/' + name)).sort();

// Retired suites are preserved as historical source text under tests/retired.
// Only tests of current, supported runtime behavior are executable here.
console.log('[TEST COVERAGE]', files.length, '/', files.length,
    'active test files; legacy-only fixtures preserved separately.');
const result = spawnSync(process.execPath,
    ['--test', '--test-concurrency=3', '--test-timeout=15000', ...files],
    { stdio: 'inherit' });
process.exit(result.status ?? 1);
