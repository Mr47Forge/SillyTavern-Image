// Image-only exclusion. This file must never edit story text, the after anchor,
// or a stored user preset. Negative tags remain in the ComfyUI negative prompt.
const male=/\b(?:\d*boys?|\d*men|male|men|man|boys?|guys?|masculine|bearded?|moustache|mustache|father|grandfather|husband|brother|uncle|son|boyfriend|gentlemen?|penis|testicles?|scrotum)\b|\u7537(?:\u6027|\u5b50|\u5b69|\u4eba|\u4e3b|\u89d2|\u58eb|\u7ae5)?|\u7236(?:\u4eb2|\u5b50)|\u7956\u7236|\u54e5\u54e5|\u5f1f\u5f1f|\u53d4\u53d4|\u8205\u8205|\u4f2f\u4f2f|\u4e08\u592b|\u8001\u516c|\u65b0\u90ce|\u4f34\u90ce|\u80e1\u987b|\u80e1\u5b50|\u9634\u830e|\u777e\u4e38/iu;
const female=/\b(?:female|females|woman|women|\d+girls?|girls?|ladies|lady|mother|sister|daughter|wife|girlfriend|aunts?|grandmother)\b|[\u5973\u6bcd\u59d0\u59b9\u59bb]\u6027?|\u5ae9\u5987|\u5ab3\u5987|\u719f\u5987|\u5c11\u5987|\u5987\u5973|\u5987\u4eba|\u592b\u4eba|\u592a\u592a|\u963f\u59e8|\u5988\u5988|\u5976\u5976|\u5a46\u5a46/iu;
const femaleTitles = new RegExp('寡妇|未亡人|人妻|人妻子|人母|主妇|家庭主妇|已婚妇女|已婚女人|媳妇|儿媳|儿媳妇|新娘|新妇|妻子|妻室|贤妻|良妻|爱妻|老婆|娘子|娘亲|娘娘|亲娘|后妈|继母|养母|丈母娘|岳母|伯母|叔母|姑母|舅母|姨母|祖母|曾祖母|外祖母|嫂子|嫂嫂|大嫂|表嫂|弟媳|弟妹|妯娌|婶婶|婶子|婶娘|大婶|舅妈|妗子|姑姑|姑妈|姑奶奶|姑姥姥|姨妈|姨娘|阿姨|姨婆|姥姥|姥娘|姨姥姥|大娘|大妈|姑婆|姨奶奶|熟妇|熟女|轻熟女|少妇|美妇|贵妇|阔太|富婆|名媛|夫人|太太|成熟女性|中年女人|成熟女子|女郎|女士|小姐|姑娘|淑女|美人|丽人|佳人|妇人|妇女|老妪|老媪|老妇|阿婆|女主人|女老板|老板娘|师娘|皇后|太后|太妃|皇太后|贵妃|妃嫔|嫔妃|妃子|王妃|侧妃|王后|皇妃|太子妃|王太妃|公主|郡主|县主|格格|帝姬|宫女|侍女|婢女|丫鬟|女官|女帝|女王', 'iu');
const femaleEnglish = /\b(?:widow(?:ed)?|housewife|homemaker|stepmother|mother[-_ ]in[-_ ]law|sister[-_ ]in[-_ ]law|matron|bride|newlywed|married[-_ ]woman|mature[-_ ]female|mature[-_ ]woman|adult[-_ ]female|female[-_ ]only|multiple[-_ ]girls|milf|gilf|queen|princess|empress|consort)\b/iu;
const maleTitle = /姐夫|妹夫|姑父|姑夫|姨父|姨夫|伯父|叔父|舅父|岳父|继父|养父|祖父|外祖父|父亲|夫君|相公|郎君|新郎|王爷|少爷|老爷|公子|皇帝|皇子|太子|驸马|太监|哥哥|弟弟|叔叔|舅舅|丈夫|老公/iu;
function femaleEvidence(value) { const v=normalized(value); return female.test(v)||femaleTitles.test(v)||femaleEnglish.test(v); }

function normalized(v){return String(v??'').trim();}
export function maleNegativeTerms(negative='') {
    return String(negative).split(/[,;\n\uff0c\uff1b]/).map(t=>t.trim())
        .filter(t=>t&&male.test(t)).slice(0,65);
}
export function buildMaleImageOnlyRule() {
    // Keep the Gemini instruction concise; ComfyUI retains its own negative tags.
    return '\u3010\u4ec5\u9650 <image> \u7ed8\u56fe\u3011\u6b63\u6587\u53ef\u6b63\u5e38\u51fa\u73b0\u7537\u6027\uff0c\u4e0d\u6539\u5267\u60c5\u3002'
        + '\u753b\u9762\u53ca\u6b63\u5411\u63d0\u793a\u8bcd\u7981\u6b62\u7537\u6027\u3001\u7537\u5a18\u3001\u4f2a\u5a18\u3001\u6276\u5979\u3001\u5047\u5c0f\u5b50\u53ca\u76f8\u5173\u7537\u6027\u5316\u5916\u8c8c\u3001\u8eab\u4f53\u548c\u751f\u6b96\u7279\u5f81\uff0c\u5305\u62ec\u4e3b\u89d2\u3001\u80cc\u666f\u548c\u526a\u5f71\u3002'
        + '\u82e5\u5f53\u524d\u8282\u70b9\u53ea\u6709\u7537\u6027\uff0c\u8bf7\u4ece\u672c\u6b21\u540c\u4e00\u6761\u5267\u60c5\u6b63\u6587\u91cc\u6539\u9009\u6700\u8fd1\u7684\u3001\u786e\u5b9e\u6709\u5973\u6027\u51fa\u955c\u7684\u4e0d\u540c\u5267\u60c5\u8282\u70b9\uff0c\u4e3a\u6bcf\u5f20\u56fe\u72ec\u7acb\u751f\u6210\u4e0d\u540c\u7684 prompt \u548c\u5bf9\u5e94 after \u539f\u6587\u5b9a\u4f4d\uff1b\u4e0d\u53ef\u6362\u968f\u673a\u79cd\u5b50\u590d\u5236\u753b\u9762\u3002\u4e0d\u5f97\u628a\u7537\u6027\u6539\u6210\u5973\u6027\uff0c\u4e0d\u5f97\u51ed\u7a7a\u6dfb\u52a0\u5973\u6027\uff0c\u4e0d\u5f97\u7528\u98ce\u666f\u6216\u7269\u54c1\u51d1\u56fe\u3002\u5982\u672c\u6b21\u6574\u6761\u5267\u60c5\u5747\u65e0\u5973\u6027\u51fa\u955c\uff0c\u5219\u4e0d\u80fd\u751f\u6210\u6709\u6548\u7ed8\u56fe\u6307\u4ee4\u3002'
        + '\u7279\u522b\u6ce8\u610f\uff1a\u5373\u4f7f\u753b\u9762\u6ca1\u6709\u7537\u4eba\uff0c\u4e5f\u7edd\u5bf9\u4e0d\u51c6\u51fa\u73b0\u9634\u830e\u3001\u9f9f\u5934\u3001\u5305\u76ae\u3001\u777e\u4e38\u3001\u9634\u56ca\u3001\u7cbe\u6db2\u7b49\u7537\u6027\u751f\u6b96\u5668\u5b98\u6216\u7279\u5f81\uff1b\u5973\u6027\u8eab\u4e0a\u3001\u5c40\u90e8\u7279\u5199\u3001\u753b\u5916\u4f38\u5165\u7684\u7537\u6027\u5668\u5b98\u4e5f\u4e0d\u4f8b\u5916\u3002'
        + ' Third-person external camera only; no POV, first-person or viewer body parts.'
        + ' after \u5f15\u7528\u539f\u6587\u4e0d\u53d7\u9650\u5236\uff0c\u4e0d\u8981\u628a\u7981\u6b62\u8bcd\u5199\u5165\u6b63\u5411\u63d0\u793a\u8bcd\u3002';
}
// Explicit anatomy/fluids, including detached parts with no visible male actor.
// Do not match broad words such as "balls", "shaft", or Chinese single characters.
const maleAnatomy=/\b(?:penis(?:es)?|penile|phall(?:us|i|ic)|dicks?|cocks?|cockhead|testicles?|testes|scrotum|foreskin|glans|sperm|semen|ejaculat(?:e|es|ed|ing|ion)|ballsack|male[-_ ]?(?:genitalia|genitals|anatomy|organ|bulge))\b|\u9634\u830e|\u9633\u5177|\u7537\u6839|\u9e21\u5df4|\u9e21\u9e21|\u8089\u68d2|\u9f9f\u5934|\u5305\u76ae|\u777e\u4e38|\u9634\u56ca|\u7cbe\u6db2|\u7cbe\u5b50|\u5c04\u7cbe|\u52c3\u8d77|\u7537\u6027\u751f\u6b96\u5668|\u7537\u6027\u5668\u5b98/iu;
export function containsMaleAnatomy(value=''){return maleAnatomy.test(normalized(value));}
const prohibited=/\b(?:femboys?|futanari|futa|tomboys?|crossdress(?:er|ing)|gender[- ]?bender)\b|\u7537\u5a18|\u4f2a\u5a18|\u6276\u5979|\u5047\u5c0f\u5b50/iu;

function roleMatch(character,known){
    const name=normalized(character?.name).toLowerCase();
    return (known||[]).find(r=>[r?.name,...(r?.aliases||[])].some(n=>normalized(n).toLowerCase()===name));
}
export function isMaleCharacter(character,known=[]) {
    const person=typeof character==='string'?{name:character}:character;
    if(typeof person!=='object'||!person)return false;
    const role=roleMatch(person,known);
    const declared=[person.gender,role?.gender,person.type,role?.type,
        person.danbooru,role?.danbooruTag].map(normalized).filter(Boolean);
    if ([...declared,person.appear,role?.appearanceZh].some(v=>prohibited.test(normalized(v)) || containsMaleAnatomy(v)))return true;
    if ([person.name,role?.name,...declared].some(v=>maleTitle.test(normalized(v))))return true;
    if(declared.some(v=>femaleEvidence(v)&&!male.test(v)))return false;
    const values=[...declared,person.appear,role?.appearanceZh].map(normalized).filter(Boolean);
    return values.some(v=>male.test(v));
}

export function isFemaleImageCharacter(character,known=[]) {
    if(isMaleCharacter(character,known))return false;
    const person=typeof character==='string'?{name:character}:character;
    if(!person||typeof person!=='object')return false;
    const role=roleMatch(person,known);
    return [person.gender,person.type,person.danbooru,person.appear,person.name,
        role?.gender,role?.type,role?.danbooruTag,role?.appearanceZh,role?.name]
        .some(femaleEvidence);
}
// Conservative evidence from this reply's real prose, not from the model's
// <image> characters (which could otherwise invent a new woman).
export function storyMentionsFemale(narrative,known=[]) {
    const story=normalized(narrative);
    if(!story)return false;
    if(/(?:\u5979\u4eec?|\u5973\u6027|\u5973\u4eba|\u5973\u751f|\u5973\u4e3b|\u59d0\u59d0|\u59b9\u59b9|\u6bcd\u4eb2|\u59bb\u5b50|\u59d1\u5a18|\b(?:she|her|hers|women|woman|female|ladies|lady)\b)/iu.test(story))return true;
    return (known||[]).filter(role=>isFemaleImageCharacter(role,known))
        .some(role=>[role.name,...(role.aliases||[])].some(name=>{
            const token=normalized(name);
            if(!token)return false;
            if(/[\u3400-\u9fff]/u.test(token))return story.includes(token);
            return story.split(/[^a-z0-9_]+/i).some(word=>word.toLowerCase()===token.toLowerCase());
        }));
}
// Only disqualify a chosen source beat when it positively identifies a man
// and has no evidence of a woman. Neutral continuation beats remain eligible.
export function anchorIsClearlyMaleOnly(narrativeBeat,known=[]) {
    const beat=normalized(narrativeBeat);
    if(!beat||storyMentionsFemale(beat,known))return false;
    if(/(?:\b(?:he|him|his|men|man|male|boys?|father|brother|husband)\b|\u4ed6|\u4ed6\u4eec|\u7537\u4eba|\u7537\u6027|\u7236\u4eb2|\u4e08\u592b)/iu.test(beat))return true;
    return (known||[]).filter(role=>isMaleCharacter(role,known))
        .some(role=>[role.name,...(role.aliases||[])].some(name=>{
            const token=normalized(name);
            if(!token)return false;
            if(/[\u3400-\u9fff]/u.test(token))return beat.includes(token);
            return beat.split(/[^a-z0-9_]+/i).some(word=>word.toLowerCase()===token.toLowerCase());
        }));
}
function mentionMaleName(segment,names){
    const s=String(segment).toLocaleLowerCase();
    return names.some(name=>{
        const value=String(name).trim().toLocaleLowerCase();
        if(!value)return false;
        if(/[\u3400-\u9fff]/.test(value))return s.includes(value);
        return s.split(/[^a-z0-9_]+/).includes(value);
    });
}
// CFG=1 does not guide away excluded objects; avoid first-person anatomy cues
// in the *positive* prompt while preserving the story and character identities.
export function normalizeImagePerspective(value=''){
    return String(value??'').split(/([,;\n\uff0c\uff1b]+)/).map(segment=>{
        if(/^[,;\n\uff0c\uff1b]+$/.test(segment))return segment;
        let next=segment
            .replace(/\b(?:male[-_ ]?pov|first[-_ ]person(?:\s+(?:view|perspective|camera))?|pov(?:\s+(?:shot|view|angle))?)\b/gi,'third-person camera')
            .replace(/\b(?:straddling|sitting|kneeling|leaning|riding)\s+(?:on|over|above|atop)\s+(?:the\s+)?viewer\b/gi,'facing camera')
            .replace(/\b(?:viewer(?:'s)?|observer(?:'s)?|camera[-_ ]holder(?:'s)?)\s+(?:legs?|thighs?|hands?|arms?|body|crotch|groin|genitals?|lap)\b/gi,'')
            .replace(/\b(?:from the (?:viewer|man's|male) perspective|visible viewer body parts)\b/gi,'third-person camera')
            .replace(/\b(looking|gazing|staring|glancing)\s+(up\s+|down\s+)?at\s+(?:the\s+)?viewer\b/gi,(_m,verb,dir='')=>verb+' '+dir+'at camera lens')
            .replace(/\b(?:toward|towards|facing)\s+(?:the\s+)?viewer\b/gi,'toward camera lens');
        return next.replace(/\s{2,}/g,' ');
    }).join('').replace(/,\s*,+/g,',').trim();
}
// Last-line sanitizer for the actual ComfyUI positive prompt. The preset
// prefix, manual overrides and fallback compilation may bypass scene cleanup.
export function sanitizeFinalImagePositive(value=''){
    return normalizeImagePerspective(value).split(/[,;\n\uff0c\uff1b]+/)
        .map(part=>part.trim())
        .filter(part=>part && !containsMaleAnatomy(part) && !prohibited.test(part) && !male.test(part))
        .join(', ');
}
function cleanPositive(value,names){
    return normalizeImagePerspective(normalized(value)).split(/[,;\n\uff0c\uff1b]+/).map(v=>v.trim())
        .filter(v=>v&&!male.test(v)&&!prohibited.test(v)&&!containsMaleAnatomy(v)&&!mentionMaleName(v,names)).join(', ');
}
export function filterMaleImageDirective(input,known=[],{requireFemale=false}={}) {
    const roles=Array.isArray(input.characters)?input.characters:[];
    const names=(known||[]).filter(role=>isMaleCharacter(role,known))
        .flatMap(role=>[role.name,...(role.aliases||[])]).filter(Boolean);
    const keep=roles.filter(person=>{
        const excluded=isMaleCharacter(person,known);
        if(excluded)names.push(typeof person==='string'?person:person?.name);
        return !excluded;
    }).map(person=>{
        if(typeof person!=='object'||!person)return person;
        const result={...person};
        for(const k of ['type','danbooru','appear','costume','state','action','interact']){
            if(typeof result[k]==='string')result[k]=cleanPositive(result[k],names);
        }
        return result;
    });
    if(requireFemale && keep.length === 0) {
        throw new Error('本张绘图没有可用人物（未提供角色，或人物被男性黑名单排除）；不会以空景、物品或编造女性凑数。');
    }
    const prompt=cleanPositive(input.prompt,names);
    if(!prompt && (male.test(normalized(input.prompt))||prohibited.test(normalized(input.prompt))||containsMaleAnatomy(input.prompt)||mentionMaleName(input.prompt,names))){
        throw new Error('\u7ed8\u56fe\u6b63\u5411\u63d0\u793a\u8bcd\u4ec5\u6709\u7537\u6027\u753b\u9762\uff0c\u8bf7\u5728\u540c\u6b21\u5267\u60c5\u56de\u590d\u91cc\u8f93\u51fa\u4e0d\u542b\u7537\u6027\u7684\u573a\u666f\u63cf\u8ff0\u3002');
    }
    return {...input,prompt,characters:keep,
        ...(typeof input.post_prompt==='string'?{post_prompt:cleanPositive(input.post_prompt,names)}:{})};
}
