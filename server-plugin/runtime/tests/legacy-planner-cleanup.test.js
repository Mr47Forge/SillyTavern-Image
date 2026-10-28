'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerDrawRunRoutes}=require('../draw-runs/routes.js');
test('current backend initializes without loading removed model engines and closes cleanly',async()=>{
 const runtime=require('../index.js');
 const routes=new Map();const router=Object.fromEntries(['get','post','delete'].map(method=>[method,(path,fn)=>routes.set(method+' '+path,fn)]));
 try{
  await runtime.init(router);
  let status;routes.get('get /status')({}, {status(){return this;},send(body){status=body;}});
  assert.ok(status.capabilities.includes('image-batch-jobs-v1'));
  assert.ok(status.capabilities.includes('draw-runs-v1'));
  assert.ok(!status.capabilities.includes('draw-run-runtime-v4'));
  assert.ok(!Object.keys(require.cache).some(path=>/agent-core-node\.cjs|draw-run-runtime\.cjs/.test(path)));
 }finally{await runtime.exit();}
});
test('legacy route compatibility requires no planner manager or model runtime',()=>{
 const routes=new Map();const router=Object.fromEntries(['get','post','delete'].map(method=>[method,(path,fn)=>routes.set(method+' '+path,fn)]));
 registerDrawRunRoutes(router);
 for(const [route,fn] of routes){
  const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},send(body){this.body=body;return this;}};
  fn({user:{profile:{handle:'fixture'}},params:{runId:'old'}},res);
  assert.equal(res.statusCode,route==='post /v1/draw-runs'?410:route==='get /v1/draw-runs'?200:404);
  if(route==='get /v1/draw-runs')assert.deepEqual(res.body.runs,[]);
  fn({params:{}},res);assert.equal(res.statusCode,403);
 }
});
