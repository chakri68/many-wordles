// The frozen embedding table (spec §9, phase 2) and everything computed from it.
// Pure integer maths: int8 vectors, Int32 dot products. Bit-identical everywhere.
import { parseList } from './words';
import { rng, randInt } from './rng';

export const SEM_FILES = {
  vocab: 'semantic/vocab.v1.txt',
  embed: 'semantic/embed.v1.bin',
  answers: 'semantic/answers.v1.txt',
  meta: 'semantic/meta.v1.json',
} as const;

export interface SemMeta {
  n: number;
  dims: number;
  /** the first `common` vocab entries (by frequency) form Bridge's search graph */
  common: number;
  scale2: number;
  /** Bridge: a hop needs dot >= this (≈ cosine 0.5) */
  bridge: number;
}

export interface Sem extends SemMeta {
  vocab: string[];
  index: Map<string, number>;
  emb: Int8Array;
  answers: string[];
}

export function makeSem(vocabTxt: string, embed: ArrayBuffer | Int8Array, meta: SemMeta, answersTxt: string): Sem {
  const vocab = parseList(vocabTxt);
  const emb = embed instanceof Int8Array ? embed : new Int8Array(embed);
  if (vocab.length !== meta.n || emb.length !== meta.n * meta.dims) throw new Error('semantic table size mismatch');
  return { ...meta, vocab, index: new Map(vocab.map((w, i) => [w, i])), emb, answers: parseList(answersTxt) };
}

let loading: Promise<Sem> | null = null;
export function loadSemantic(): Promise<Sem> {
  if (!loading) {
    const base = import.meta.env?.BASE_URL ?? './';
    const get = (p: string) =>
      fetch(new URL(base + p, location.href)).then((r) => {
        if (!r.ok) throw new Error(`${p}: ${r.status}`);
        return r;
      });
    loading = Promise.all([
      get(SEM_FILES.vocab).then((r) => r.text()),
      get(SEM_FILES.embed).then((r) => r.arrayBuffer()),
      get(SEM_FILES.meta).then((r) => r.json() as Promise<SemMeta>),
      get(SEM_FILES.answers).then((r) => r.text()),
    ])
      .then(([v, e, m, a]) => makeSem(v, e, m, a))
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
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
  for (let attempt = 0; attempt < 400; attempt++) {
    const a = pool[randInt(r, pool.length)];
    const b = pool[randInt(r, pool.length)];
    if (a === b) continue;
    const path = shortestPath(sem, a, b);
    if (!path) continue;
    const hops = path.length - 1;
    if (hops >= 3) return { start: a, end: b, path };
    if (hops === 2) fallback ??= { start: a, end: b, path };
  }
  return fallback!;
}
