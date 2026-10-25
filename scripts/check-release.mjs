import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const host=/^(?:\/script\.js|\/scripts\/[^?]+\.js|(?:\.\.\/)+(?:script|extensions|utils|user|variables|scripts\/world-info)\.js)$/;
await build({entryPoints:['extension/entry.js'],bundle:true,platform:'browser',format:'esm',write:false,
 external:['node:*','undici'],plugins:[{name:'host-apis',setup(ctx){ctx.onResolve({filter:host},args=>({path:args.path,external:true}));}}]});
await build({entryPoints:['server-plugin/index.js'],bundle:true,platform:'node',format:'cjs',write:false,external:['undici']});
async function assets(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const p=resolve(directory,entry.name);
  if(entry.isDirectory()&&entry.name!=='tests')await assets(p);
  else if(entry.name.endsWith('.html')){
   for(const m of (await readFile(p,'utf8')).matchAll(/(?:src|href)=["']([^"']+)["']/g))
    if(m[1].startsWith('.')&&!m[1].includes('${'))await readFile(resolve(directory,m[1]));
  }else if(/\.(?:js|mjs)$/.test(entry.name)){
   for(const m of (await readFile(p,'utf8')).matchAll(/new URL\(["']([^"']+\.(?:css|html|md|dat))["'],\s*import\.meta\.url\)/g))
    if(m[1].startsWith('.'))await readFile(resolve(directory,m[1]));
  }
 }
}
await assets('runtime');
for(const file of ['settings/SillyTavernImage_ComfyDraw.json','settings/SillyTavernImage_NovelDraw.json']) JSON.parse(await readFile(file,'utf8'));
const result=spawnSync(process.execPath,['scripts/build-runtime.mjs','--check'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
console.log('前后端依赖、界面资源和设置格式检查通过');
