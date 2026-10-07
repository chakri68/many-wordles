// The frozen embedding table (spec §9, phase 2) and everything computed from it.
// Pure integer maths: int8 vectors, Int32 dot products. Bit-identical everywhere.
import { parseList } from './words';
import { rng, randInt } from './rng';

export type SemVersion = 'v1' | 'v2';

export const semFiles = (v: SemVersion) =>
  ({
    vocab: `semantic/vocab.${v}.txt`,
    embed: `semantic/embed.${v}.bin`,
    answers: `semantic/answers.${v}.txt`,
    meta: `semantic/meta.${v}.json`,
  }) as const;

/**
 * v1 = GloVe, v2 = ConceptNet Numberbatch (scripts/build-embeddings-v2.py).
 * GloVe linked words that share sentences, not meaning (lose -> afford), so
 * Warmer + Bridge switched on 2026-10-08. Earlier days keep v1: their secret,
 * their par and every saved game replay exactly as they were.
 */
export const SEM_V2_FROM = 5; // 2026-10-08
export const semVersion = (day: number): SemVersion => (day >= SEM_V2_FROM ? 'v2' : 'v1');

export interface SemMeta {
  n: number;
  dims: number;
  /** the first `common` vocab entries (by frequency) form Bridge's search graph */
  common: number;
  scale2: number;
  /** Bridge: a hop needs dot >= this (≈ cosine 0.5 in v1, 0.35 in v2) */
  bridge: number;
}

export interface Sem extends SemMeta {
  v: SemVersion;
  vocab: string[];
  index: Map<string, number>;
  emb: Int8Array;
  answers: string[];
}

export function makeSem(
  v: SemVersion,
  vocabTxt: string,
  embed: ArrayBuffer | Int8Array,
  meta: SemMeta,
  answersTxt: string,
): Sem {
  const vocab = parseList(vocabTxt);
  const emb = embed instanceof Int8Array ? embed : new Int8Array(embed);
  if (vocab.length !== meta.n || emb.length !== meta.n * meta.dims) throw new Error('semantic table size mismatch');
  return { ...meta, v, vocab, index: new Map(vocab.map((w, i) => [w, i])), emb, answers: parseList(answersTxt) };
}

let vocabLoading: Promise<Set<string>> | null = null;
/**
 * Words accepted as free-text guesses in the clue games: the semantic vocab
 * plus a frozen supplement of words GloVe-2014 never learned (chai, diwali,
 * biryani, emoji, …).
 */
export const EXTRA_WORDS = 'words/extra.v1.txt';
export function loadVocab(): Promise<Set<string>> {
  if (!vocabLoading) {
    const base = import.meta.env?.BASE_URL ?? './';
    const get = (p: string) =>
      fetch(new URL(base + p, location.href)).then((r) => {
        if (!r.ok) throw new Error(`${p}: ${r.status}`);
        return r.text();
      });
    vocabLoading = Promise.all([get(semFiles('v1').vocab), get(EXTRA_WORDS)])
      .then(([a, b]) => new Set([...parseList(a), ...parseList(b)]))
      .catch((e) => {
        vocabLoading = null;
        throw e;
      });
  }
  return vocabLoading;
}

const loading = new Map<SemVersion, Promise<Sem>>();
export function loadSemantic(v: SemVersion): Promise<Sem> {
  let p = loading.get(v);
  if (!p) {
    const base = import.meta.env?.BASE_URL ?? './';
    const f = semFiles(v);
    const get = (path: string) =>
      fetch(new URL(base + path, location.href)).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r;
      });
    p = Promise.all([
      get(f.vocab).then((r) => r.text()),
      get(f.embed).then((r) => r.arrayBuffer()),
      get(f.meta).then((r) => r.json() as Promise<SemMeta>),
      get(f.answers).then((r) => r.text()),
    ])
      .then(([vocab, e, m, a]) => makeSem(v, vocab, e, m, a))
      .catch((err) => {
        loading.delete(v);
        throw err;
      });
    loading.set(v, p);
  }
  return p;
}

export function dot(s: Sem, i: number, j: number): number {
  const d = s.dims;
  const e = s.emb;
  let acc = 0;
  for (let k = 0, a = i * d, b = j * d; k < d; k++) acc += e[a + k] * e[b + k];
  return acc;
}

/** cosine-ish 0..1 for display only; never used for decisions */
export const cos = (s: Sem, raw: number) => raw / s.scale2;

export function simsTo(s: Sem, t: number, limit = s.n): Int32Array {
  const out = new Int32Array(limit);
  for (let i = 0; i < limit; i++) out[i] = dot(s, i, t);
  return out;
}

export interface Ranking {
  /** rank[wordIdx] = 1..n, target is 1 */
  rank: Int32Array;
  /** order[rank-1] = wordIdx */
  order: Int32Array;
}

/** Rank the whole vocab by closeness to `t`. Ties break alphabetically. */
export function rankFrom(s: Sem, t: number): Ranking {
  const sims = simsTo(s, t);
  const idx = Array.from({ length: s.n }, (_, i) => i);
  idx.sort((a, b) => {
    if (a === t) return -1;
    if (b === t) return 1;
    return sims[b] - sims[a] || (s.vocab[a] < s.vocab[b] ? -1 : 1);
  });
  const order = Int32Array.from(idx);
  const rank = new Int32Array(s.n);
  order.forEach((w, r) => (rank[w] = r + 1));
  return { rank, order };
}

// ---- Bridge -------------------------------------------------------------

export const linked = (s: Sem, i: number, j: number) => i !== j && dot(s, i, j) >= s.bridge;

/** Neighbours of i inside the common sub-graph, ascending index. */
export function neighbours(s: Sem, i: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < s.common; j++) if (j !== i && dot(s, i, j) >= s.bridge) out.push(j);
  return out;
}

/**
 * Shortest path s→e (≤ 4 hops) in the common graph, meet-in-the-middle.
 * Fixed iteration order makes the returned path deterministic.
 */
export function shortestPath(sem: Sem, s: number, e: number): number[] | null {
  if (s === e) return [s];
  const A1 = neighbours(sem, s);
  if (A1.includes(e)) return [s, e];
  const B1 = neighbours(sem, e);
  const B1set = new Set(B1);
  for (const a of A1) if (B1set.has(a)) return [s, a, e];

  const parentA = new Map<number, number>();
  const A1set = new Set(A1);
  for (const a of A1)
    for (const x of neighbours(sem, a)) {
      if (x === s || A1set.has(x) || parentA.has(x)) continue;
      parentA.set(x, a);
      if (B1set.has(x)) return [s, a, x, e];
    }

  const parentB = new Map<number, number>();
  for (const b of B1)
    for (const y of neighbours(sem, b)) {
      if (y === e || B1set.has(y) || parentB.has(y)) continue;
      parentB.set(y, b);
      if (parentA.has(y)) return [s, parentA.get(y)!, y, b, e];
    }
  return null;
}

export interface BridgePuzzle {
  start: number;
  end: number;
  /** the bot's shortest path, endpoints included; hops = length - 1 */
  path: number[];
}

/**
 * The day's start/end, drawn by seed from the answer pool. Rejects pairs that
 * are too close (≤ 2 hops) or have no path within 4. Nothing stored per pair.
 */
export function pickBridge(sem: Sem, seed: number): BridgePuzzle {
  const pool = sem.answers.map((w) => sem.index.get(w)!).filter((i) => i != null && i < sem.common);
  const r = rng(seed);
  let fallback: BridgePuzzle | null = null;
  // Past 400 tries, settle for the first 2-hopper. Only a day that found
  // nothing in 400 ever gets that far, so the extra tries change no puzzle
  // that has ever existed; they just turn a crash into a puzzle.
  for (let attempt = 0; attempt < 4000; attempt++) {
    if (attempt >= 400 && fallback) return fallback;
    const a = pool[randInt(r, pool.length)];
    const b = pool[randInt(r, pool.length)];
    if (a === b) continue;
    const path = shortestPath(sem, a, b);
    if (!path) continue;
    const hops = path.length - 1;
    if (hops >= 3) return { start: a, end: b, path };
    if (hops === 2) fallback ??= { start: a, end: b, path };
  }
  if (fallback) return fallback;
  throw new Error(`bridge: no puzzle for seed ${seed}`);
}
