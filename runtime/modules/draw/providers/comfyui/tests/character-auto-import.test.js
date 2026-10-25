import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedCharacters, mergeImportedCharacters } from '../character-import.js';

test('importer keeps two people separate and retains appearance details', () => {
    const list = parseImportedCharacters(JSON.stringify({ characters: [
        { name: 'Alice', type: 'woman', appearanceZh: '黑色长发，鹅蛋脸', appearance: 'long hair, oval face', outfits: [] },
        { name: 'Betty', type: 'woman', appearanceZh: '棕色短发，圆脸', appearance: 'short hair, round face', outfits: [] },
    ]}));
    assert.equal(list.length, 2);
    assert.notEqual(list[0].appearance, list[1].appearance);
    assert.notEqual(list[0].appearanceZh, list[1].appearanceZh);
});
test('importer ignores people without appearance', () => {
    assert.throws(() => parseImportedCharacters('{"characters":[{"name":"Alice","appearance":""}]}'));
});
test('importer does not overwrite existing appearance or old library', () => {
    const old = { characters: [{ id:'1',name:'Alice',type:'woman',appearance:'fixed',aliases:[] }], groups:[] };
    const incoming = [{ name:'Alice',type:'woman',appearance:'wrong',aliases:[],outfits:[] }, {name:'Betty',type:'woman',appearance:'brown hair',aliases:[],outfits:[]}];
    const merged = mergeImportedCharacters(old,incoming,()=> 'new2');
    assert.deepEqual(merged.created,['Betty']);
    assert.equal(merged.characters[0].appearance,'fixed');
    assert.equal(old.characters.length,1);
});
test('current-story collector reads dynamically created NPCs from chat, not card definitions', async () => {
    const { collectChatCharacterSource } = await import('../character-import.js');
    const chat = [
        { is_user:false, mes:'A shopkeeper introduces the newcomer Alice with a distinctive pixie haircut and a square face.' },
        { is_user:true, mes:'I ask the newcomer for her name and she replies it is Alice.' },
        { is_user:false, mes:'Alice greets Betty, whose wavy brown hair is strikingly different from Alice.' },
    ];
    const result=collectChatCharacterSource(chat,{maxMessages:12,maxChars:5000});
    assert.equal(result.messages.length,3);
    assert.match(result.messages[0].text,/Alice/);
    assert.match(result.messages[2].text,/Betty/);
    assert.equal(result.totalMessages,3);
    assert.equal(result.truncated,false);
});
test('current-story collector uses recent messages and caps input volume', async () => {
    const { collectChatCharacterSource } = await import('../character-import.js');
    const chat = Array.from({length:180},(_,i)=>({is_user:false,mes:'Narrator #'+i+' describes a named character and a specific hairstyle.'}));
    const result=collectChatCharacterSource(chat,{maxMessages:20,maxChars:1000});
    assert.equal(result.truncated,true);
    assert.ok(result.messages.length>0);
    assert.ok(result.messages.every(m=>m.index>=160));
    assert.ok(result.messages.reduce((sum,m)=>sum+m.text.length,0)<=1000);
});

test('Chinese description stays visible but never replaces the English drawing prompt', async () => {
    const { normalizeCharacter, exportCharacters, parseCharacterImport } = await import('../../../shared/character-library.js');
    const original = {
        id: 'alice-1', name: 'Alice', type: 'woman',
        appearance: 'short brown hair, softly rounded face',
        appearanceZh: '\u68d5\u8272\u77ed\u53d1\uff0c\u5706\u6da6\u7684\u8138\u578b',
        negativeTags: '', aliases: [], outfits: [], dynamicStates: [],
    };
    const normalized = normalizeCharacter(original);
    assert.equal(normalized.appearance, original.appearance);
    assert.equal(normalized.appearanceZh, original.appearanceZh);
    const exported = exportCharacters({characters:[normalized],groups:[]});
    const imported = parseCharacterImport(exported);
    assert.equal(imported.entries[0].character.appearance, original.appearance);
    assert.equal(imported.entries[0].character.appearanceZh, original.appearanceZh);
});
test('Existing English-only role can acquire Chinese without replacing the English', () => {
    const old = { characters:[{
        id:'alice-1',name:'Alice',type:'woman',
        appearance:'original english face description',aliases:[],
    }],groups:[] };
    const proposed = [{
        name:'Alice',type:'woman',appearance:'original english face description',
        appearanceZh:'\u9ed1\u8272\u53d1\u4e1d\uff0c\u9e45\u86cb\u8138',aliases:[],outfits:[],dynamicStates:[],
    }];
    const updated = mergeImportedCharacters(old, proposed);
    assert.equal(updated.changed,true);
    assert.deepEqual(updated.filled,['Alice']);
    assert.equal(updated.characters[0].appearance,'original english face description');
    assert.equal(updated.characters[0].appearanceZh,'\u9ed1\u8272\u53d1\u4e1d\uff0c\u9e45\u86cb\u8138');
    assert.equal(old.characters[0].appearanceZh,undefined);
});
test('Importer will not silently offer English descriptions as Chinese', () => {
    assert.throws(()=>parseImportedCharacters(JSON.stringify({characters:[{
        name:'Alice',type:'woman',appearance:'short hair',
        appearanceZh:'short hair',
    }]})),/\u4e2d\u6587/u);
});


test('Chinese cannot describe a different face than the already locked English identity', () => {
    const prior={characters:[{
        id:'a',name:'Alice',type:'woman',appearance:'existing fixed oval face',
        aliases:[],
    }],groups:[]};
    const proposed=[{
        name:'Alice',type:'woman',appearance:'new round face',
        appearanceZh:'\\u5168\\u65b0\\u7684\\u5706\\u8138',
        aliases:[],outfits:[],dynamicStates:[],
    }];
    const result=mergeImportedCharacters(prior,proposed);
    assert.equal(result.changed,false);
    assert.equal(result.characters[0].appearance,'existing fixed oval face');
    assert.equal(result.characters[0].appearanceZh,undefined);
});

test('story collector does not erase a character description from the middle of medium messages', async () => {
    const { collectChatCharacterSource } = await import('../character-import.js');
    const longText = '常规剧情，'.repeat(140) + '林雪眉眼细长，深棕色卷发扎成低马尾，脸颊有一颗小痣，身穿灰色格纹外套。' + '后续剧情，'.repeat(150);
    const content = collectChatCharacterSource([{is_user:false,mes:longText}],{maxMessages:5,maxChars:10000});
    assert.equal(content.messages.length,1);
    assert.match(content.messages[0].text,/低马尾/);
    assert.match(content.messages[0].text,/格纹外套/);
});
