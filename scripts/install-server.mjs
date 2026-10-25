import { access, cp, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('请提供酒馆安装目录');
await access(resolve(root,'package.json'));
await access(resolve(root,'plugins'));
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../server-plugin');
const target=resolve(root,'plugins/sillytavern-image-server');
let exists=true;try{await access(target);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
if(exists){
 const backup=resolve(root,'backups','sillytavern-image-server-'+Date.now());
 await mkdir(dirname(backup),{recursive:true});
 await rename(target,backup);
 console.log('旧后端已完整保留到备份目录：'+backup);
}
await cp(source,target,{recursive:true,errorOnExist:true,force:false});
console.log('当前后端已安装，请重新启动酒馆。未修改设置或其他插件。');
