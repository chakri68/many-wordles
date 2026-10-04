// Minimax bot for Reverse. Pure + deterministic; runs in the worker and in tests.
import { scoreCode } from '../../engine/score';
import { mixSeed } from '../../engine/seed';
import { rng, randInt } from '../../engine/rng';

export function encodeWords(words: readonly string[]): Uint8Array {
  const out = new Uint8Array(words.length * 5);
  words.forEach((w, i) => {
    for (let j = 0; j < 5; j++) out[i * 5 + j] = w.charCodeAt(j) - 97;
  });
  return out;
}

/** Top-N allowed words by unique-letter frequency over the answers. Frozen inputs -> frozen output. */
export function topByLetterFreq(allowed: readonly string[], answers: readonly string[], n = 500): string[] {
  const freq = new Array(26).fill(0);
  for (const w of answers) for (const ch of new Set(w)) freq[ch.charCodeAt(0) - 97]++;
  const scored = allowed.map((w) => {
    let s = 0;
    for (const ch of new Set(w)) s += freq[ch.charCodeAt(0) - 97];
    return [s, w] as const;
  });
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  return scored.slice(0, n).map((x) => x[1]);
}

export interface SolverCtx {
  answers: readonly string[];
  enc: Uint8Array;
  extra: readonly string[];
  extraEnc: Uint8Array;
  index: Map<string, number>;
}

export function makeCtx(answers: readonly string[], allowed: readonly string[]): SolverCtx {
  const extra = topByLetterFreq(allowed, answers);
  return {
    answers,
    enc: encodeWords(answers),
    extra,
    extraEnc: encodeWords(extra),
    index: new Map(answers.map((w, i) => [w, i])),
  };
}

/** Indices of `cands` whose pattern against `guess` equals `code`. */
export function filterCands(ctx: SolverCtx, cands: readonly number[], guess: string, code: number): number[] {
  const g = encodeWords([guess]);
  return cands.filter((i) => scoreCode(g, 0, ctx.enc, i * 5) === code);
}

/** Patterns (codes) that would leave at least one candidate. */
export function liveCodes(ctx: SolverCtx, cands: readonly number[], guess: string): Set<number> {
  const g = encodeWords([guess]);
  return new Set(cands.map((i) => scoreCode(g, 0, ctx.enc, i * 5)));
}

/**
 * Minimax: pick the guess whose LARGEST bucket over C is smallest, since the
 * player is adversarial. Pool = C ∪ top-500 allowed.
 * Tiebreaks: (a) in C, (b) fewer singleton buckets, (c) seeded random.
 */
export function bestGuess(ctx: SolverCtx, cands: readonly number[], seed: number, round: number): string {
  if (cands.length === 1) return ctx.answers[cands[0]];
  const inC = new Set(cands);
  const counts = new Uint16Array(243);
  type Cand = { word: string; buf: Uint8Array; off: number; inC: boolean };
  const pool: Cand[] = cands.map((i) => ({ word: ctx.answers[i], buf: ctx.enc, off: i * 5, inC: true }));
  ctx.extra.forEach((w, j) => {
    const ai = ctx.index.get(w);
    if (ai == null || !inC.has(ai)) pool.push({ word: w, buf: ctx.extraEnc, off: j * 5, inC: false });
  });

  let bestMax = Infinity;
  let bestIn = false;
  let bestSingles = Infinity;
  let ties: string[] = [];
  outer: for (const g of pool) {
    counts.fill(0);
    let max = 0;
    for (const c of cands) {
      const n = ++counts[scoreCode(g.buf, g.off, ctx.enc, c * 5)];
      if (n > max) {
        max = n;
        if (max > bestMax) continue outer; // can't win; prune
      }
    }
    let singles = 0;
    for (let k = 0; k < 243; k++) if (counts[k] === 1) singles++;
    const better =
      max < bestMax ||
      (max === bestMax && g.inC && !bestIn) ||
      (max === bestMax && g.inC === bestIn && singles < bestSingles);
    const tie = max === bestMax && g.inC === bestIn && singles === bestSingles;
    if (better) {
      bestMax = max;
      bestIn = g.inC;
      bestSingles = singles;
      ties = [g.word];
    } else if (tie) ties.push(g.word);
  }
  return ties[randInt(rng(mixSeed(seed, 'bot', round)), ties.length)];
}
