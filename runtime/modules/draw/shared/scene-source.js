import { hashStableValue } from './generation-fingerprint.js';
import { stripDrawImageSlots } from './image-marker-syntax.js';

const IMAGE_MARKER_REGEX = /\[(?:image|ebook-image|tavern-image)\s*:\s*[a-z0-9_-]+\]/gi;
const SCENE_POINT_MARKER_REGEX = /【插图点\s+\d+】/g;
const USER_SCENE_POINT_MARKER_REGEX = /【插图点\s+(\d+)】/g;
const SENTENCE_END_REGEX = /[。！？!?…]/;
const SENTENCE_CLOSER_REGEX = /[”’」』】）》〉〕\]})"'*_~～]/;
const ATTRIBUTION_CLOSER_REGEX = /[”’」』】）》〉〕\]})"']/;
const COMMON_PERIOD_ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'no', 'fig',
    'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
    'sep', 'sept', 'oct', 'nov', 'dec', 'e.g', 'i.e',
]);

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMappedText(sourceText) {
    return Array.from({ length: sourceText.length }, (_value, offset) => ({
        char: sourceText[offset],
        offset,
    }));
}

function getMappedText(mapped) {
    return mapped.map((item) => item.char).join('');
}

function removeMappedMatches(mapped, regex) {
    const text = getMappedText(mapped);
    const ranges = [];
    for (const match of text.matchAll(regex)) {
        if (!match[0]) continue;
        ranges.push([match.index, match.index + match[0].length]);
    }
    if (!ranges.length) return mapped;

    const kept = [];
    let rangeIndex = 0;
    for (let index = 0; index < mapped.length; index += 1) {
        while (rangeIndex < ranges.length && index >= ranges[rangeIndex][1]) rangeIndex += 1;
        const range = ranges[rangeIndex];
        if (!range || index < range[0] || index >= range[1]) kept.push(mapped[index]);
    }
    return kept;
}

function applyMappedFilterRules(mapped, rules = []) {
    let result = mapped;
    for (const rule of Array.isArray(rules) ? rules : []) {
        const start = String(rule?.start || '').trim();
        const end = String(rule?.end || '').trim();
        if (!start && !end) continue;
        if (start && end) {
            result = removeMappedMatches(
                result,
                new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`, 'gi'),
            );
            continue;
        }

        const text = getMappedText(result);
        if (start) {
            const index = text.toLocaleLowerCase().indexOf(start.toLocaleLowerCase());
            if (index >= 0) result = result.slice(0, index);
        } else {
            const index = text.toLocaleLowerCase().indexOf(end.toLocaleLowerCase());
            if (index >= 0) result = result.slice(index + end.length);
        }
    }
    return result;
}

// Source-only exclusion: never edit the user's actual message or preset tags.
// Image slot placement must be limited to visible narrative beats, not status.
function restrictToNarrativeBody(mapped) {
    const text=getMappedText(mapped);
    // Presets may wrap visible story in <content><hidden>...</hidden></content>.
    // The <hidden> keyword alone is not evidence that this *content* is hidden.
    for(const name of ['maintext','content']) {
        const opening=new RegExp('<'+name+'\\b[^>]*>','i').exec(text);
        if(!opening)continue;
        const start=opening.index+opening[0].length;
        const closing=new RegExp('</'+name+'\\s*>','i').exec(text.slice(start));
        if(closing)return {mapped:mapped.slice(start,start+closing.index),explicitBody:true};
    }
    // Without an explicit narrative container, exclude state metadata.
    const status=/<status_block\b[^>]*>/i.exec(text);
    return {mapped:status?mapped.slice(0,status.index):mapped,explicitBody:false};
}

function removeHiddenMappedRegions(mapped,{explicitBody=false}={}) {
    const text=getMappedText(mapped);
    if(explicitBody) {
        // A whole-body <hidden> wrapper is used by some presets *around visible
        // narrative*. Strip only the wrappers for source mapping, never drop
        // the user's prose or alter message.mes.
        const opening=/^\s*<hidden\b[^>]*>/i.exec(text);
        const closing=/<\/hidden\s*>\s*$/i.exec(text);
        if(opening && closing && closing.index>=opening[0].length){
            const first=opening[0].indexOf('<');
            const last=closing.index;
            const result=mapped.filter((item,index)=>!((index>=first&&index<opening[0].length)
                ||(index>=last&&index<last+closing[0].trimStart().length)));
            return removeHiddenMappedRegions(result);
        }
    }
    // Hidden sub-sections not enclosing the entire story remain non-narrative.
    const tags=/<\/?(?:hidden|status_block)\b[^>]*>/gi;
    let hiddenDepth=0,statusDepth=0,opening=null;
    const ranges=[];
    for(const match of text.matchAll(tags)){
        const tag=match[0].toLowerCase(),close=tag.startsWith('</');
        const status=tag.includes('status_block');
        const before=hiddenDepth+statusDepth;
        if(!close&&before===0)opening=match.index;
        if(status)statusDepth=Math.max(0,statusDepth+(close?-1:1));
        else hiddenDepth=Math.max(0,hiddenDepth+(close?-1:1));
        if(close&&before>0&&hiddenDepth+statusDepth===0&&opening!==null){
            ranges.push([opening,match.index+match[0].length]);opening=null;
        }
    }
    if(hiddenDepth+statusDepth>0&&opening!==null)ranges.push([opening,text.length]);
    return ranges.length?mapped.filter((item,index)=>!ranges.some(([start,end])=>index>=start&&index<end)):mapped;
}

function trimMappedText(mapped) {
    const text = getMappedText(mapped);
    if (!text) return [];
    const start = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    return mapped.slice(start, end);
}

function isAsciiLetterOrDigit(char = '') {
    return /[A-Za-z0-9]/.test(char);
}

function isSentencePeriod(mapped, index) {
    if (mapped[index]?.char !== '.') return false;
    const previous = mapped[index - 1]?.char || '';
    const next = mapped[index + 1]?.char || '';
    if (isAsciiLetterOrDigit(previous) && isAsciiLetterOrDigit(next)) return false;

    let token = '';
    for (let cursor = index - 1; cursor >= 0 && token.length < 24; cursor -= 1) {
        const char = mapped[cursor]?.char || '';
        if (/\s/.test(char)) break;
        token = char + token;
    }
    const normalizedWord = token.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, '').toLowerCase();
    if (COMMON_PERIOD_ABBREVIATIONS.has(normalizedWord) || /^[A-Za-z]$/.test(normalizedWord)) return false;
    return true;
}

function isSentenceEnd(mapped, index) {
    const char = mapped[index]?.char || '';
    return char === '.' ? isSentencePeriod(mapped, index) : SENTENCE_END_REGEX.test(char);
}

function hasSameLineQuoteContinuation(mapped, closerEnd) {
    let cursor = closerEnd;
    while (cursor < mapped.length && /[ \t\u00a0]/.test(mapped[cursor].char)) cursor += 1;
    if (cursor >= mapped.length || /[\r\n]/.test(mapped[cursor].char)) return false;

    // A new quoted or Markdown-emphasized span is a separate narrative beat,
    // not an attribution such as `”她问。` that belongs to the quotation.
    return !/[*_~“‘「『《〈（(【[]/.test(mapped[cursor].char);
}

function skipHorizontalWhitespace(mapped, start) {
    let cursor = start;
    while (cursor < mapped.length && /[ \t\u00a0]/.test(mapped[cursor].char)) cursor += 1;
    return cursor;
}

function collectScenePoints(mapped) {
    const points = [];
    let hasContent = false;
    const addPoint = (contentOffset) => {
        const previous = mapped[contentOffset - 1];
        if (!previous || points.at(-1)?.contentOffset === contentOffset) return;
        points.push({
            number: points.length + 1,
            contentOffset,
            offset: previous.offset + 1,
        });
        hasContent = false;
    };

    for (let index = 0; index < mapped.length; index += 1) {
        const char = mapped[index].char;
        if (char === '\r' || char === '\n') {
            let end = index + 1;
            while (end < mapped.length && (mapped[end].char === '\r' || mapped[end].char === '\n')) end += 1;
            if (hasContent) addPoint(end);
            index = end - 1;
            continue;
        }
        if (isSentenceEnd(mapped, index)) {
            let end = index + 1;
            while (end < mapped.length && isSentenceEnd(mapped, end)) end += 1;
            const punctuationEnd = end;
            let hasAttributionCloser = false;
            while (end < mapped.length && SENTENCE_CLOSER_REGEX.test(mapped[end].char)) {
                if (ATTRIBUTION_CLOSER_REGEX.test(mapped[end].char)) hasAttributionCloser = true;
                end += 1;
            }
            const pointEnd = skipHorizontalWhitespace(mapped, end);
            const closedQuotedSentence = end > punctuationEnd && hasAttributionCloser;
            if (hasContent && !(closedQuotedSentence && hasSameLineQuoteContinuation(mapped, end))) {
                addPoint(pointEnd);
            }
            index = (closedQuotedSentence ? end : pointEnd) - 1;
            continue;
        }
        if (!/\s/.test(char)) hasContent = true;
    }

    if (hasContent) addPoint(mapped.length);
    return points;
}

function escapeUserScenePointMarkers(content) {
    return String(content || '').replace(
        USER_SCENE_POINT_MARKER_REGEX,
        (_match, number) => `【原文中的“插图点 ${number}”字样】`,
    );
}

function restoreUserScenePointMarkers(content) {
    return String(content || '').replace(
        /【原文中的“插图点\s+(\d+)”字样】/g,
        (_match, number) => `【插图点 ${number}】`,
    );
}

function buildNumberedContent(content, points) {
    let cursor = 0;
    let result = '';
    for (const point of points) {
        result += escapeUserScenePointMarkers(content.slice(cursor, point.contentOffset));
        result += `【插图点 ${point.number}】`;
        cursor = point.contentOffset;
    }
    return result + escapeUserScenePointMarkers(content.slice(cursor));
}

export function hashSceneSource(sourceText) {
    return hashStableValue(String(sourceText ?? ''), 'scene-source');
}

export function normalizeMessageSceneSourceText(sourceText) {
    return stripDrawImageSlots(sourceText);
}

export function stripScenePointMarkers(text) {
    return restoreUserScenePointMarkers(String(text || '').replace(SCENE_POINT_MARKER_REGEX, ''));
}

export function createSceneSource(sourceText, options = {}) {
    const original = String(sourceText ?? '');
    let mapped = createMappedText(original);
    mapped = removeMappedMatches(mapped, new RegExp(IMAGE_MARKER_REGEX.source, 'gi'));
    if(options.restrictToNarrativeBody === true) {
        const body=restrictToNarrativeBody(mapped);
        mapped=removeHiddenMappedRegions(body.mapped,{explicitBody:body.explicitBody});
    }
    mapped = applyMappedFilterRules(mapped, options.filterRules);
    mapped = trimMappedText(mapped);

    const content = getMappedText(mapped);
    const internalPoints = collectScenePoints(mapped);
    return {
        sourceText: original,
        sourceHash: hashSceneSource(original),
        content,
        numberedContent: buildNumberedContent(content, internalPoints),
        points: internalPoints.map(({ number, offset }) => ({ number, offset })),
        anchors: internalPoints.map((point,index)=>({offset:point.offset,
            text:content.slice(internalPoints[index-1]?.contentOffset||0,point.contentOffset)
                .replace(/<[^>]*>/g,'').trim()})),
    };
}

// One validated source boundary is shared by first placement and DOM recovery.
export function resolveSceneAnchor(source,after){
    const narrative=source.sourceText;
    const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s\u200B-\u200F\uFEFF]/gu,'');
    const exact=narrative.indexOf(after);
    let offset=null;
    if(after&&exact>=0&&narrative.indexOf(after,exact+1)<0&&source.content.includes(after)){
        const end=exact+after.length;
        if(source.points.some(p=>p.offset===end))offset=end;
    }
    if(offset===null){
        const needle=normalize(after);
        if(needle.length<8||!normalize(source.content).includes(needle))return null;
        let text='',cursor=0;const ends=[];
        for(const character of narrative){
            cursor+=character.length;const part=normalize(character);text+=part;
            for(let i=0;i<part.length;i++)ends.push(cursor);
        }
        const at=text.indexOf(needle);
        if(at<0||text.indexOf(needle,at+1)>=0)return null;
        offset=source.points.find(p=>p.offset>=ends[at+needle.length-1])?.offset??null;
    }
    const anchor=source.anchors?.find(p=>p.offset===offset);
    return anchor?.text?{offset,after:anchor.text}:null;
}
