import { usesChineseAppearance } from '../../shared/character-prompts.js';
import { cleanCharacterAppearanceText } from './character-appearance-cleanup.js';

export function buildCharacterTestPrompt(character, { framing = 'full' } = {}) {
    const english = usesChineseAppearance(character) ? String(character.appearanceZh).trim() : cleanCharacterAppearanceText(character?.appearance, 'en');
    if (!english) throw new Error('请先填写并保存角色外貌，再使用角色预览');
    const name = String(character?.name || '').trim() || '当前角色';
    const outfit = (Array.isArray(character?.outfits) ? character.outfits : [])
        .find(item => String(item?.name || item?.tags || '').trim());
    const type = String(character?.type || '');
    const people = type === 'man' || type === 'boy' ? 'one male person, solo'
        : type === 'woman' || type === 'girl' ? 'one female person, solo' : 'one person, solo';
    const isFull = framing !== 'half';
    const framingText = isFull
        ? 'full length standing photograph, full body, head to toe, entire person visible including both feet, standing on the ground, centered in frame, generous space around whole body, natural perspective'
        : 'upper body portrait, waist-up framing, natural perspective';
    const defaultHair = /\b(?:hair|hairstyle|ponytail|bun|braid|bald)\b|发|髮/i.test(english)
        ? '' : 'natural black long hair worn down';
    // Keep the role's exact identity; avoid new features or prompts from story/worldbook.
    const positive = [
        'photorealistic candid photograph, one real human,', people,
        framingText,
        english,
        defaultHair,
        outfit?.tags || outfit?.name || 'simple modest everyday clothing',
        'neutral relaxed pose, clean simple background, natural daylight, realistic skin texture',
    ].filter(Boolean).join(', ');
    const negative = [
        String(character?.negativeTags || '').trim(),
        'multiple people, two people, duplicate person, extra face, extra limbs, cartoon, anime, illustration',
        isFull ? 'close-up, headshot, bust portrait, upper body only, half body crop, cut off legs, cropped feet, body out of frame' : '',
    ].filter(Boolean).join(', ');
    return { name, positive, negative, outfit: outfit?.name || '', framing: isFull ? 'full' : 'half' };
}
