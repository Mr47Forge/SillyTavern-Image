'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

test('真实酒馆用户目录使用 userImages，兼容相对数据根目录',()=>{
  const {getCurrentUser}=require('../lib/user-context');
  const req={user:{profile:{handle:'alice'},directories:{root:'data/alice',userImages:'data/alice/user/images',files:'data/alice/user/files'}}};
  const current=getCurrentUser(req);
  assert.equal(current.directories.images,path.resolve('data/alice/user/images'));
  assert.equal(current.directories.files,path.resolve('data/alice/user/files'));
  assert.equal(req.user.directories.images,undefined);
  assert.equal(getCurrentUser({body:req.user}),null);
  assert.equal(getCurrentUser({user:{directories:req.user.directories}}),null);
});

test('独立后台接收真实酒馆用户字段，仍拒绝匿名请求',async()=>{
  const {mountRuntime,closeRuntime}=require('../lib/runtime');
  const methods=Object.fromEntries(['get','post','put','patch','delete','use'].map(m=>[m,()=>{}]));
  let middleware; methods.use=(route,handler)=>{if(route==='/runtime')middleware=handler;};
  try {
    await mountRuntime(methods);
    let next=0; middleware({user:{profile:{handle:'alice'},directories:{userImages:path.resolve('data/alice/user/images')}}},{},()=>next++);
    assert.equal(next,1);
    let status; middleware({},{status(n){status=n;return this;},json(){ }},()=>next++);
    assert.equal(status,403);assert.equal(next,1);
  }finally{await closeRuntime();}
});
