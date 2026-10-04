import { seedFor } from './seed';
import { shuffledIndices } from './rng';

// Frozen lists (spec §3.1/3.2). Never edit a shipped file; add v2 + a switch day.
export const LIST_SWITCH_DAY = Infinity; // no v2 yet
export const WORD_FILES = {
  answers: 'words/answers.v1.txt',
  allowed: 'words/allowed.v1.txt',
  denylist: 'words/denylist.txt',
} as const;

export interface Lists {
  answers: string[];
  allowed: Set<string>;
  allowedList: string[];
  deny: Set<string>;
}

export const parseList = (text: string) =>
  text
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

let loading: Promise<Lists> | null = null;

/** Lazy, memoised. Works in the page and in workers. */
export function loadLists(): Promise<Lists> {
  if (!loading) {
    const base = import.meta.env?.BASE_URL ?? './';
    const get = (p: string) =>
      fetch(new URL(base + p, location.href)).then((r) => {
        if (!r.ok) throw new Error(`${p}: ${r.status}`);
        return r.text();
      });
    loading = Promise.all([get(WORD_FILES.answers), get(WORD_FILES.allowed), get(WORD_FILES.denylist)])
      .then(([a, b, d]) => makeLists(a, b, d))
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export function makeLists(answersTxt: string, allowedTxt: string, denyTxt: string): Lists {
  const answers = parseList(answersTxt);
  const allowedList = parseList(allowedTxt);
  const allowed = new Set(allowedList);
  for (const a of answers) allowed.add(a);
  return { answers, allowed, allowedList, deny: new Set(parseList(denyTxt)) };
}

const permCache = new Map<string, Uint32Array>();

/** Keyed permutation: no repeats until the list is exhausted, nothing stored. */
export function answerFor(lists: Lists, variant: string, day: number): string {
  const { answers, deny } = lists;
  const N = answers.length;
  const cycle = Math.floor(day / N);
  const key = `${variant}:${cycle}:${N}`;
  let perm = permCache.get(key);
  if (!perm) {
    perm = shuffledIndices(N, seedFor(variant, -1 - cycle));
    permCache.set(key, perm);
  }
  let i = perm[((day % N) + N) % N];
  for (let guard = 0; deny.has(answers[i]) && guard < N; guard++) i = (i + 1) % N;
  return answers[i];
}
