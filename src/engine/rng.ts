// mulberry32: tiny, fast, and identical on every JS engine (integer maths only).
export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). */
export function randInt(r: Rng, n: number): number {
  return Math.floor(r() * n);
}

/** Seeded Fisher–Yates over 0..n-1. */
export function shuffledIndices(n: number, seed: number): Uint32Array {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  const r = rng(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(r, i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/** Pick k distinct indices, weighted, without replacement. Integer weights keep it engine-stable. */
export function weightedSample(r: Rng, weights: number[], k: number): number[] {
  const w = weights.slice();
  const picked: number[] = [];
  for (let n = 0; n < k; n++) {
    let total = 0;
    for (const x of w) total += x;
    if (total <= 0) break;
    let target = r() * total;
    let i = 0;
    for (; i < w.length; i++) {
      target -= w[i];
      if (target < 0 && w[i] > 0) break;
    }
    if (i >= w.length) i = w.findLastIndex((x) => x > 0);
    picked.push(i);
    w[i] = 0;
  }
  return picked;
}
