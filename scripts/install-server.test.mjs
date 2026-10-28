import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('后端安装完整保留旧目录，同时不将旧文件混入新版',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'stimage-install-'));
 try{
  await writeFile(join(temp,'package.json'),'{}');
  const target=join(temp,'plugins/sillytavern-image-server');
  await mkdir(target,{recursive:true});await writeFile(join(target,'obsolete-file.txt'),'old plugin');
  const run=spawnSync(process.execPath,['scripts/install-server.mjs',temp],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  await access(join(target,'index.js'));
  await assert.rejects(access(join(target,'sillytavern-image-server.zip')));
  await assert.rejects(access(join(target,'SHA256SUMS')));
  await assert.rejects(access(join(target,'obsolete-file.txt')));
  const backups=await readdir(join(temp,'backups'));
  assert.equal(backups.length,1);
  assert.equal(await readFile(join(temp,'backups',backups[0],'obsolete-file.txt'),'utf8'),'old plugin');
 }finally{
  if(!resolve(temp).startsWith(resolve(tmpdir())+'\\')&&!resolve(temp).startsWith(resolve(tmpdir())+'/'))throw Error('Unexpected temporary path');
  await rm(temp,{recursive:true,force:true});
 }
});
