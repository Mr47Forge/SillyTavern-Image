import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPresentCharacters } from '../present-characters.js';
const person=(name,extra={})=>({name,enabled:true,appearance:name+'-looks',aliases:[],...extra});
const names=(text,lib)=>detectPresentCharacters(text,lib).map(c=>c.name);
test('single Han name versus common word',()=>{
 assert.deepEqual(names('月光洒在窗台',[person('月')]),[]);
 assert.deepEqual(names('林子里起风了',[person('林')]),[]);
 assert.deepEqual(names('月说她要离开',[person('月')]),['月']);
 assert.deepEqual(names('看向月。',[person('月')]),['月']);
 assert.deepEqual(names('月和星在院子里',[person('月'),person('星')]),['月','星']);
});
test('longest registered name wins an overlap, independent occurrences survive',()=>{
 assert.deepEqual(names('小月走过来',[person('月'),person('小月')]),['小月']);
 assert.deepEqual(names('林希雅笑了',[person('林'),person('林希'),person('林希雅')]),['林希雅']);
 assert.deepEqual(names('林希雅看向林，林点了头',[person('林'),person('林希雅')]),['林','林希雅']);
 assert.deepEqual(names('月光散去，月坐下了',[person('月'),person('月光')]),['月','月光']);
});
test('Chinese two-character names need complete segmented boundaries',()=>{
 assert.deepEqual(names('小猫咪在睡觉',[person('小猫')]),[]);
 assert.deepEqual(names('阿璃和小猫在房间里',[person('阿璃'),person('小猫')]),['阿璃','小猫']);
 assert.deepEqual(names('希雅走了',[person('希雅')]),['希雅']);
});
test('Latin full name and adjacency to Chinese',()=>{
 assert.deepEqual(names('Maybe later',[person('May')]),[]);
 assert.deepEqual(names('May来了',[person('May')]),['May']);
 assert.deepEqual(names('May_12',[person('May')]),[]);
 assert.deepEqual(names('may, come here!',[person('May')]),['May']);
});
test('aliases and group switches remain effective',()=>{
 const a=person('阿璃',{aliases:['小芙']});
 const b=person('小猫',{groupId:'closed'});
 const library={characters:[a,b,person('无名',{enabled:false})],groups:[{id:'closed',enabled:false}]};
 assert.deepEqual(names('小芙与小猫、无名都在',[a,b]),['阿璃','小猫']);
 assert.deepEqual(names('小芙与小猫、无名都在',library),['阿璃']);
});
test('nonmatching cards absent and metadata preserved',()=>{
 const lib=[person('小猫',{outfits:[{name:'常服',tags:'coat'}],dynamicStates:[{name:'injured',tags:'bandage'}]}),person('小鸟')];
 assert.deepEqual(names('下雨了',lib),[]);
 const hits=detectPresentCharacters('小猫来了',lib);
 assert.equal(hits.length,1);
 assert.deepEqual(hits[0].outfits,[{name:'常服',tags:'coat'}]);
 assert.deepEqual(hits[0].dynamicStates,[{name:'injured',tags:'bandage'}]);
});
