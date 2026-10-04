// Date -> puzzle number -> seed. Everything downstream is a pure function of these.

export const EPOCH = '2026-11-01'; // launch day = puzzle #1
const [EY, EM, ED] = EPOCH.split('-').map(Number);
const EPOCH_UTC = Date.UTC(EY, EM - 1, ED);
const DAY_MS = 86_400_000;

/** Puzzle number for the player's LOCAL calendar date. EPOCH -> 1. */
export function dayIndex(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS) + 1;
}

/** Local midnight that starts the next puzzle. */
export function nextRollover(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedFor(variantId: string, day: number): number {
  return fnv1a(`${variantId}:${day}`);
}

/** Mix extra context (row, guess, …) into a seed. */
export function mixSeed(seed: number, ...parts: (string | number)[]): number {
  return fnv1a(`${seed}:${parts.join(':')}`);
}
