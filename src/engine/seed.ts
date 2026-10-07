// Date -> puzzle number -> seed. Everything downstream is a pure function of these.

export const EPOCH = '2026-10-04'; // first deploy = puzzle 1. Players see dates; numbers stay internal.
const [EY, EM, ED] = EPOCH.split('-').map(Number);
const EPOCH_UTC = Date.UTC(EY, EM - 1, ED);
const DAY_MS = 86_400_000;

/** Puzzle number for the player's LOCAL calendar date. EPOCH -> 1. */
export function dayIndex(date: Date): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((local - EPOCH_UTC) / DAY_MS) + 1;
}

/** Local midnight of a puzzle's day. Inverse of dayIndex. */
export function dateOf(day: number): Date {
  return new Date(EY, EM - 1, ED + day - 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Puzzle -> 'YYYY-MM-DD', the form URLs carry. */
export function isoOf(day: number): string {
  const d = dateOf(day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> puzzle, or null if it isn't a real date. */
export function dayOfIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Date happily rolls Feb 31 into March; refuse instead
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return dayIndex(date);
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 7'. Fixed English so share text reads the same for everyone. */
export function dayLabel(day: number): string {
  const d = dateOf(day);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
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
