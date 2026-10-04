import type { Mark } from './score';

// Base-3, tile 0 is the least-significant digit. B=0, Y=1, G=2.
export const ALL_GREEN = 242;
const VAL: Record<Mark, number> = { B: 0, Y: 1, G: 2 };
const MARKS: Mark[] = ['B', 'Y', 'G'];

export function encode(p: Mark[]): number {
  let code = 0;
  for (let i = 4; i >= 0; i--) code = code * 3 + VAL[p[i]];
  return code;
}

export function decode(code: number): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(MARKS[code % 3]);
    code = Math.floor(code / 3);
  }
  return out;
}

export const EMOJI: Record<Mark, string> = { G: '🟩', Y: '🟨', B: '⬛' };
export const toEmoji = (p: Mark[]) => p.map((m) => EMOJI[m]).join('');

export const RANK: Record<Mark, number> = { B: 1, Y: 2, G: 3 };
