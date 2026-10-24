import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedImageHostClient } from '../image-character-transport.js';

const dataUrl = 'data:image/jpeg;base64,/9j/AA==';
const message = [{role:'user',content:[
  {type:'text',text:'Describe the photo'},
  {type:'image_url',image_url:{url:dataUrl}},
]}];

function stubClient() {
 return {
   buildHostChatCompletionGenerateRequest: async(payload,stream) => ({
     url:'/api/backends/chat-completions/generate',
     method:'POST',
     body:{...payload,stream},
     rawHeaders:{'X-CSRF-Token':'mock'},
     headers:{'X-CSRF-Token':'[redacted]'},
   }),
   streamHostChatCompletion: async()=>{throw new Error('stream not expected');},
 };
}

test('image import bypass transport carries a real image_url without rewriting',async()=>{
 let captured={};
 const client=stubClient(),trace=[];
 const isolated=createIsolatedImageHostClient(client,async(url,options)=>{
   captured={url,headers:options.headers,payload:JSON.parse(options.body)};
   return {ok:true,status:200,text:async()=>JSON.stringify({
     choices:[{finish_reason:'stop',message:{content:'{"appearanceZh":"black hair","appearance":"black hair"}'}}],
   })};
 },(phase,data)=>trace.push({phase,data}));
 let inspection;
 const result=await isolated.createHostChatCompletion({model:'cn:deepseek-v4.1-flash',messages:message},{onRequest:r=>{inspection=r;}});
 assert.equal(result.choices[0].finish_reason,'stop');
 assert.equal(captured.url,'/api/backends/chat-completions/generate');
 assert.equal(captured.headers['X-CSRF-Token'],'mock');
 assert.equal(captured.payload.messages[0].content[1].image_url.url,dataUrl);
 assert.equal(inspection.body.messages[0].content[1].image_url.url,dataUrl);
 assert.equal(trace[0].phase,'isolated-host-request');
 assert.equal(trace[0].data.imageCount,1);
 assert.equal(trace[1].phase,'isolated-host-response');
 assert.equal(trace[1].data.httpStatus,200);
 assert.equal(client.createHostChatCompletion,undefined);
});
test('image import isolated transport fails before network if picture was dropped',async()=>{
 let called=false;
 const isolated=createIsolatedImageHostClient(stubClient(),async()=>{
   called=true;throw new Error('must never send');
 });
 await assert.rejects(isolated.createHostChatCompletion({messages:[{role:'user',content:'text only'}]}),/image has been lost/i);
 assert.equal(called,false);
});
test('image transport propagates a host error without hiding its reason',async()=>{
 const isolated=createIsolatedImageHostClient(stubClient(),async()=>({
   ok:false,status:422,text:async()=>JSON.stringify({error:{message:'invalid image input',code:'invalid_image'}}),
 }));
 await assert.rejects(isolated.createHostChatCompletion({messages:message}),e=>
   e.status===422 && e.message.includes('invalid image input'));
});
