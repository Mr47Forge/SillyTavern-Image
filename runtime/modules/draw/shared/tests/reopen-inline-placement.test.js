import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
const common=new URL('../draw-common.js',import.meta.url);
const source=fs.readFileSync(common,'utf8');
const begin=source.indexOf('function mountImageSlotShells(');
const end=source.indexOf('\nasync function persistChatSilently',begin);
const mount=source.slice(begin,end);
test('reload preserves in-paragraph rendered picture cards',()=>{
 assert.match(mount,/const needsRescue=!card \|\| actuallyHidden\(card\)/);
 assert.match(mount,/if\(needsRescue && !restored\)/);
 assert.doesNotMatch(mount,/invisible\.has\(slotId\)/);
 assert.doesNotMatch(mount,/outOfOrder/);
 assert.match(mount,/mountImageCardAtVisibleAnchor/);
 assert.match(mount,/compareDocumentPosition/);
});
test('picture slot recovery moves same card, never clone or change ID',()=>{
 assert.match(mount,/preceding\.after\(card\)/);
 assert.match(mount,/gallery\.append\(card\)/);
 assert.doesNotMatch(mount,/cloneNode|slotId\s*=\s*create|replaceWith/);
});
test('a raw hidden tag alone is not grounds to relocate a visible card',()=>{
 assert.doesNotMatch(mount,/findNonVisibleImageSlotIds/);
 assert.doesNotMatch(mount,/tagName\?\.toLowerCase\(\)===['"]hidden['"]/);
 assert.match(mount,/getComputedStyle/);
});
