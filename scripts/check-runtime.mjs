import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const host = /^(?:\/script\.js|\/scripts\/[^?]+\.js|(?:\.\.\/)+(?:script|extensions|utils|user|variables|scripts\/world-info)\.js)$/;
await build({ entryPoints: ['extension/entry.js'], bundle: true, platform: 'browser', format:'esm', write:false,
  external:['node:*','undici'], logLevel:'warning', plugins:[{name:'sillytavern-host',setup(ctx){
    ctx.onResolve({filter:host},args=>({path:args.path,external:true}));
  }}] });
async function checkAssets(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const p=resolve(directory,entry.name);
    if(entry.isDirectory() && entry.name !== 'tests') await checkAssets(p);
    else if(entry.name.endsWith('.html')) {
      const text=await readFile(p,'utf8');
      for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        if(!match[1].startsWith('.') || match[1].includes('${')) continue;
        await readFile(resolve(directory,match[1]));
      }
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      const text=await readFile(p,'utf8');
      for(const match of text.matchAll(/new URL\(["']([^"']+\.(?:css|html|md|dat))["'],\s*import\.meta\.url\)/g)) {
        if (match[1].startsWith('.')) await readFile(resolve(directory,match[1]));
      }
    }
  }
}
await checkAssets('runtime');
console.log('独立绘图模块引用与界面资源检查通过');
