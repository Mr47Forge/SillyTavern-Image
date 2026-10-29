import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectDrawInstruction,buildDirectDrawTasks} from '../direct-draw.js';
import {maleNegativeTerms,buildMaleImageOnlyRule,isMaleCharacter,isFemaleImageCharacter,filterMaleImageDirective,containsMaleAnatomy} from '../male-image-exclusion.js';
import {compile} from '../../providers/comfyui/compiler.js';

const known=[
    {name:'Alice',type:'1girl',appearance:'black hair',enabled:true},
    {name:'Bob',aliases:['Boss'],type:'adult man',appearance:'bearded man',enabled:true},
];
const narrative='Bob says hello to Alice.\n\nAlice stays beside the window.';
const preset={maxImages:1,negativePrefix:'male, men, man, boys, male face, beard, old woman, low quality',
    positivePrefix:'photo'};
test('adult Chinese female-role labels and Danbooru female tags are recognized',()=>{
    for(const type of ['\u719f\u5987','\u5c11\u5987','\u719f\u5973','\u5e74\u8f7b\u5973\u6027','\u5987\u4eba','\u592b\u4eba','\u592a\u592a','\u963f\u59e8','\u5988\u5988','1girl','2girls','adult woman']){
        const character={name:'Alice',type};
        assert.equal(isMaleCharacter(character,[]),false,type);
        assert.equal(isFemaleImageCharacter(character,[]),true,type);
        const item=filterMaleImageDirective({prompt:'1girl, adult female portrait',characters:[character]},[],{requireFemale:true});
        assert.equal(item.characters.length,1,type);
    }
});
test('real four-image pattern with two mature women and two young adult women is accepted',()=>{
    const characters=['\u719f\u5987','\u719f\u5987','\u5e74\u8f7b\u5973\u6027','\u5e74\u8f7b\u5973\u6027'];
    const directives=characters.map((type,i)=>({
        prompt:'1girl, natural interior, unique camera view '+i,
        characters:[{name:'Female'+i,type,appear:'adult East Asian woman'}],
        after:'Sentence '+i+'.'
    }));
    const tasks=buildDirectDrawTasks(directives,{maxImages:4},{knownCharacters:[],requireFemaleImage:true});
    assert.equal(tasks.length,4);
    assert.equal(new Set(tasks.map(x=>x.scene)).size,4);
    assert.ok(tasks.every(x=>x.chars.length===1));
});
test('negative male list is selected dynamically and does not treat woman as man',()=>{
    assert.deepEqual(maleNegativeTerms('male, bearded man, old woman, 1boy, low quality'),
        ['male','bearded man','1boy']);
    assert.doesNotMatch(buildMaleImageOnlyRule(preset.negativePrefix),/male face/);
    assert.match(buildMaleImageOnlyRule(preset.negativePrefix),/\u6b63\u6587/);
});
test('female martial-arts captions do not trigger male exclusion',()=>{
    const input='\u5973\u4fa0\u7ec3\u4e60\u529f\u592b, indoor gym, daylight';
    const result=filterMaleImageDirective({prompt:input,characters:[]},known);
    assert.ok(result.prompt.includes('\u529f\u592b'));
});
test('gender classification honors explicit female roles, known aliases and string names',()=>{
    assert.equal(isMaleCharacter({name:'Bob'},known),true);
    assert.equal(isMaleCharacter('Boss',known),true);
    assert.equal(isMaleCharacter({name:'Alice',type:'female',appear:"woman with men's jacket"},known),false);
    assert.equal(isMaleCharacter({name:'Unknown',type:'1boy'},known),true);
    assert.equal(isMaleCharacter({name:'Alice',type:'1girl'},known),false);
});
test('male is excluded only in image fields, original narrative and after anchor survive',()=>{
    const item={prompt:'Alice at the window, male figure in background, warm daylight',
        characters:[{name:'Bob',type:'male'}, {name:'Alice',type:'female',action:'looking at Bob'}],
        after:'Bob says hello to Alice.',negative:'low quality, male',post_prompt:'soft colors, bearded man'};
    const old=JSON.stringify(item);
    const filtered=filterMaleImageDirective(item,known);
    assert.equal(JSON.stringify(item),old);
    assert.equal(filtered.after,item.after);
    assert.equal(filtered.negative,item.negative);
    assert.deepEqual(filtered.characters.map(p=>p.name),['Alice']);
    assert.equal(filtered.characters[0].action,'');
    assert.match(filtered.prompt,/Alice at the window/);
    assert.match(filtered.prompt,/warm daylight/);
    assert.doesNotMatch(filtered.prompt,/\bmale\b/i);
    assert.equal(filtered.post_prompt,'soft colors');
});
test('male source narrative is not modified and no new women added',()=>{
    const directive={prompt:'1girl, outside the window, 1boy, sunny street',
        characters:[{name:'Bob',type:'adult man'},{name:'Alice',type:'1girl'}],
        after:'Bob says hello to Alice.'};
    const tasks=buildDirectDrawTasks([directive],preset,{sourceText:narrative,knownCharacters:known});
    assert.equal(tasks.length,1);
    assert.equal(tasks[0].chars.length,1);
    assert.equal(tasks[0].chars[0].name,'Alice');
    assert.match(tasks[0].scene,/1girl/);
    assert.doesNotMatch(tasks[0].scene,/\b1boy\b/);
    assert.equal(narrative,'Bob says hello to Alice.\n\nAlice stays beside the window.');
    assert.equal(directive.characters.length,2);
});
test('if image directive declares no humans, no extra woman appears',()=>{
    const item={prompt:'abandoned empty room, 1boy, green window',characters:[],after:'Bob says hello to Alice.'};
    const tasks=buildDirectDrawTasks([item],preset,{sourceText:narrative,knownCharacters:known});
    assert.deepEqual(tasks[0].chars,[]);
    assert.match(tasks[0].scene,/empty room/);
});
test('male-only positive prompt fails safe instead of making up a new female',()=>{
    assert.throws(()=>buildDirectDrawTasks([
        {prompt:'1boy',characters:[{name:'Bob',type:'male'}],after:'Bob says hello to Alice.'}
    ],preset,{sourceText:narrative,knownCharacters:known}),/\u7537\u6027/);
});
test('final ComfyUI positive excludes male while original negative config persists',()=>{
    const tasks=buildDirectDrawTasks([{prompt:'1girl, warm room, male silhouette',
        characters:[{name:'Bob',type:'male'},{name:'Alice',type:'female'}],
        after:'Bob says hello to Alice.'}],preset,{sourceText:narrative,knownCharacters:known});
    const compiled=compile(tasks,{knownCharacters:known,positivePrefix:preset.positivePrefix,
        negativePrefix:preset.negativePrefix,workflowMode:'simple',
        params:{model:'fixture',width:512,height:768,cfg:4,steps:8},timeout:1000,delayMs:0,seeds:[42]});
    const prompt=compiled.artifacts[0].promptData;
    assert.match(prompt.positive,/1girl/);
    assert.doesNotMatch(prompt.positive,/\bmale\b|\b1boy\b|\bman\b/i);
    assert.match(prompt.negative,/\bmale\b/);
    assert.match(prompt.negative,/low quality/);
});
test('single original LLM instruction bans male only in image outputs, preserving story',()=>{
    const text=buildDirectDrawInstruction({preset,characters:known});
    assert.match(text,/\u6b63\u6587\u53ef\u6b63\u5e38\u51fa\u73b0\u7537\u6027/);
    assert.match(text,/<image>/);
    assert.doesNotMatch(text,/male face/);
    assert.match(text,/EXACTLY 1/);
    assert.match(text,/\u7537\u6027/);
});

test('femboy, futanari, tomboy and specified Chinese descriptions are excluded',()=>{
    const names=['femboy','futanari','tomboy','\u7537\u5a18','\u4f2a\u5a18','\u6276\u5979','\u5047\u5c0f\u5b50'];
    for (const name of names) {
        const role={name:'Test',type:'female',appear:name};
        assert.equal(isMaleCharacter(role,known),true,name);
        const image=filterMaleImageDirective({prompt:'sunlit room, '+name,characters:[role]},known);
        assert.deepEqual(image.characters,[],name);
        assert.equal(image.prompt,'sunlit room',name);
    }
});
test('Gemini receives one concise gender rule rather than the whole negative preset',()=>{
    const huge=Array(90).fill('male person').join(', ');
    const rule=buildMaleImageOnlyRule(huge);
    assert.ok(rule.length<450,rule.length);
    assert.ok(!rule.includes(huge));
    assert.match(rule,/\u7537\u5a18/);
});

test('standalone genital organs are forbidden even without male actor',()=>{
    const forbidden=[
        'woman with penis', '1girl, cock', 'female with dick',
        'girl, phallus', 'penile anatomy', 'visible scrotum',
        'woman with testicles', 'male genitalia in close-up',
        '\u9634\u830e','\u9f9f\u5934','\u777e\u4e38','\u9634\u56ca',
        '\u9633\u5177','\u8089\u68d2','\u7cbe\u6db2','\u52c3\u8d77'
    ];
    for (const value of forbidden) assert.equal(containsMaleAnatomy(value),true,value);
    for(const allowed of ['female face','woman body','cocktail bar','balls of yarn','\u5973\u4fa0\u7ec3\u4e60\u529f\u592b']) {
        assert.equal(containsMaleAnatomy(allowed),false,allowed);
    }
});
test('male anatomy is removed from positive image tags, preserving story and negatives',()=>{
    const original={
        prompt:'1girl, sunny bedroom, visible penis, 35mm film',
        characters:[{name:'Alice',type:'1girl',action:'smiling near the window'}],
        negative:'lowres, penis, male genitalia',
        after:'Bob enters the room and talks to Alice.',
        post_prompt:'photorealistic, testicles, sharp detail'
    };
    const before=JSON.stringify(original);
    const clean=filterMaleImageDirective(original,known,{requireFemale:true});
    assert.equal(JSON.stringify(original),before);
    assert.equal(clean.after,original.after);
    assert.equal(clean.negative,original.negative);
    assert.deepEqual(clean.characters.map(p=>p.name),['Alice']);
    assert.equal(containsMaleAnatomy(clean.prompt),false);
    assert.equal(containsMaleAnatomy(clean.post_prompt),false);
    assert.match(clean.prompt,/sunny bedroom/);
    assert.match(clean.post_prompt,/sharp detail/);
});
test('female-labelled image role cannot contain male anatomy',()=>{
    const role={name:'New Role',type:'female',appear:'woman with penis'};
    assert.equal(isMaleCharacter(role,known),true);
    assert.throws(()=>filterMaleImageDirective(
        {prompt:'1girl, soft light',characters:[role]},
        known,{requireFemale:true}),/\u6ca1\u6709\u53ef\u7528\u4eba\u7269/);
    const library=[{name:'Alice',type:'1girl',appearanceZh:'黑发，男性生殖器'}];
    assert.equal(isMaleCharacter({name:'Alice',type:'1girl'},library),true);
});
test('same Gemini rule explicitly bans organ-only and off-screen genitalia',()=>{
    const rule=buildMaleImageOnlyRule();
    for(const phrase of ['\u9634\u830e','\u9f9f\u5934','\u777e\u4e38','\u753b\u5916\u4f38\u5165'])assert.ok(rule.includes(phrase),phrase);
    assert.ok(!rule.includes(Array(60).fill('male genitalia').join(',')));
});
test('final compiled prompt excludes male genital tags but negative retains exclusions',()=>{
    const tasks=buildDirectDrawTasks([{
        prompt:'1girl, warm room, cock, cinematic lighting',
        characters:[{name:'Alice',type:'1girl',action:'reading at table'}],
        negative:'penis, male body',after:'Alice stays beside the window.',
    }],preset,{sourceText:narrative,knownCharacters:known,requireFemaleImage:true});
    const rendered=compile(tasks,{knownCharacters:known,positivePrefix:preset.positivePrefix,
        negativePrefix:preset.negativePrefix,workflowMode:'simple',
        params:{model:'fixture',width:512,height:768,cfg:4,steps:8},
        timeout:1000,delayMs:0,seeds:[101]}).artifacts[0].promptData;
    assert.equal(containsMaleAnatomy(rendered.positive),false);
    assert.match(rendered.positive,/cinematic lighting/);
    assert.match(rendered.negative,/penis/);
});

test('female appellation survey coverage across marriage, kinship and honorifics',()=>{
    const titles=[
        '\u5be1\u5987','\u4eba\u59bb','\u672a\u4ea1\u4eba','\u5ac2\u5b50','\u5927\u5ac2','\u5f1f\u5ab3','\u5f1f\u59b9','妯娌',
        '\u8205\u5988','\u59d1\u59d1','\u59d1\u5988','\u5a76\u5a76','\u963f\u59e8','\u59e5\u59e5','\u5a46\u5a46','\u4e08\u6bcd\u5a18',
        '\u5ab3\u5987','\u513f\u5ab3','\u5df2\u5a5a\u5987\u5973','\u4e3b\u5987','\u5bb6\u5ead\u4e3b\u5987','\u4e3d\u4eba','\u7f8e\u5987',
        '\u8d35\u5987','\u9614\u592a','\u5bcc\u5a46','\u540d\u5a9b','\u5e08\u5a18','\u8001\u677f\u5a18','\u592b\u4eba',
        '\u738b\u5983','\u8d35\u5983','\u7687\u540e','\u592a\u540e','\u516c\u4e3b','\u90e1\u4e3b','\u5973\u738b',
        'widow','housewife','mother-in-law','mature_female','mature_woman',
        'milf','multiple_girls','adult_female',
    ];
    for(const type of titles) {
        const role={name:'W',type};
        assert.equal(isFemaleImageCharacter(role,[]),true,type);
        assert.equal(isMaleCharacter(role,[]),false,type);
    }
});
test('gender title from character name works when model leaves type vague',()=>{
    for(const name of ['\u6797\u5bb6\u5be1\u5987','\u738b\u5ac2\u5b50','\u674e\u738b\u5983','\u5f20\u8d35\u5987']){
        const role={name,type:'adult'};
        assert.equal(isFemaleImageCharacter(role,[]),true,name);
        assert.doesNotThrow(()=>filterMaleImageDirective({prompt:'1girl, adult woman',characters:[role]},[],{requireFemale:true}),name);
    }
});
test('gender-coded male kinship and gender-bending remain excluded',()=>{
    for(const type of ['\u59d0\u592b','\u59b9\u592b','\u8205\u7236','\u59d1\u7236','\u738b\u7237','\u592a\u76d1','\u7537\u5a18','\u6276\u5979','male','1boy']){
        const role={name:'R',type};
        assert.equal(isMaleCharacter(role,[]),true,type);
        assert.equal(isFemaleImageCharacter(role,[]),false,type);
    }
    const maleName={name:'\u674e\u59d0\u592b',type:'unknown'};
    assert.equal(isMaleCharacter(maleName,[]),true);
    assert.equal(isFemaleImageCharacter(maleName,[]),false);
});
test('female honorific does not override prohibited male anatomy',()=>{
    for(const type of ['\u5be1\u5987','\u4eba\u59bb','\u738b\u5983']){
        const role={name:'R',type,appear:'woman with penis'};
        assert.equal(isFemaleImageCharacter(role,[]),false,type);
        assert.equal(isMaleCharacter(role,[]),true,type);
    }
});
