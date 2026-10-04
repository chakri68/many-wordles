// Mechanical checks for content. Humans judge quality and ordering; this
// catches the things a human shouldn't have to (leaks, counts, duplicates).
// No imports with runtime deps: scripts/content.ts runs this under plain node.
import type { ClueItem, EventItem, PoolId } from './types.ts';
import { CATS } from './types.ts';

export const CLUE_COUNT = 6;
export const BLANK = '___';

export interface Problem {
  index: number;
  message: string;
}

/** Leaks: the answer itself, or a long-enough stem of it (pian- for piano). */
function leaks(text: string, answer: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(answer)) return true;
  const stem = answer.slice(0, Math.max(4, answer.length - 2));
  return answer.length >= 5 && new RegExp(`\\b${stem}`).test(t);
}

export function validateClues(pool: 'missing' | 'define', items: ClueItem[], vocab?: Set<string>): Problem[] {
  const out: Problem[] = [];
  const seen = new Map<string, number>();
  items.forEach((it, index) => {
    const p = (message: string) => out.push({ index, message });
    if (!/^[a-z]+$/.test(it.answer ?? '')) p(`answer "${it.answer}" must be lowercase letters`);
    else if (vocab && !vocab.has(it.answer)) p(`answer "${it.answer}" is not in the guess vocabulary`);
    if (seen.has(it.answer)) p(`duplicate answer (also #${seen.get(it.answer)! + 1})`);
    seen.set(it.answer, index);
    if (!Array.isArray(it.clues) || it.clues.length !== CLUE_COUNT) p(`needs exactly ${CLUE_COUNT} clues`);
    (it.clues ?? []).forEach((c, k) => {
      const blanks = c.split(BLANK).length - 1;
      if (pool === 'missing' && blanks !== 1) p(`clue ${k + 1} needs exactly one ${BLANK}`);
      if (pool === 'define' && blanks !== 0) p(`clue ${k + 1} shouldn't contain ${BLANK}`);
      if (it.answer && leaks(c.replaceAll(BLANK, ''), it.answer)) p(`clue ${k + 1} leaks the answer`);
      if (c.trim().length < 3) p(`clue ${k + 1} is empty`);
    });
  });
  return out;
}

export function validateEvents(items: EventItem[]): Problem[] {
  const out: Problem[] = [];
  const seen = new Map<string, number>();
  items.forEach((e, index) => {
    const p = (message: string) => out.push({ index, message });
    const key = (e.name ?? '').trim().toLowerCase();
    if (key.length < 4) p('name too short');
    if (seen.has(key)) p(`duplicate name (also #${seen.get(key)! + 1})`);
    seen.set(key, index);
    if (!Number.isInteger(e.year) || e.year < -3000 || e.year > 2100) p(`bad year ${e.year}`);
    if (!(CATS as readonly string[]).includes(e.cat)) p(`unknown category "${e.cat}"`);
  });
  return out;
}

export function validate(pool: PoolId, items: unknown[], vocab?: Set<string>): Problem[] {
  return pool === 'events' ? validateEvents(items as EventItem[]) : validateClues(pool, items as ClueItem[], vocab);
}
