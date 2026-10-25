import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const output = 'server-plugin/runtime/draw-runs/vendor/draw-run-runtime.cjs';
const result = await build({ entryPoints: ['runtime/modules/draw/node-entry.js'], bundle: true,
  platform: 'node', format: 'cjs', target: 'node20', outfile: output,
  write: false, minify: true, legalComments: 'inline', tsconfigRaw: {} });
const text = result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('后端运行包与当前源码不一致');
} else await writeFile(output, text);
console.log('后端运行包与当前源码一致');
