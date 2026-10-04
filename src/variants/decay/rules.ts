import type { Mark } from '../../engine/score';
import { mixSeed } from '../../engine/seed';
import { rng, weightedSample } from '../../engine/rng';
import { RANK } from '../../engine/pattern';

export const MAX_GUESSES = 6;
/** d(k): tiles that fade after guess k. Index = k. Tunable (spec §11.3). */
export const DECAY_CURVE = [0, 0, 1, 1, 2, 2, 2];
const WEIGHT: Record<Mark, number> = { G: 3, Y: 2, B: 1 };

export interface DecayRow {
  guess: string;
  marks: Mark[];
  decayed: boolean[];
}

/**
 * After guess k (1-based, k ≥ 2) is scored, fade d(k) tiles from rows 1..k-1.
 * Seeded by (day seed, k, guess) so a replay matches, but different guesses
 * see different decay. Returns new rows; never mutates.
 */
export function applyDecay(rows: DecayRow[], seed: number, k: number, guess: string): DecayRow[] {
  const d = DECAY_CURVE[k] ?? 0;
  if (d === 0) return rows;
  const cands: [number, number][] = [];
  const weights: number[] = [];
  for (let r = 0; r < k - 1; r++) {
    rows[r].marks.forEach((m, c) => {
      if (!rows[r].decayed[c]) {
        cands.push([r, c]);
        weights.push(WEIGHT[m]);
      }
    });
  }
  const picks = weightedSample(rng(mixSeed(seed, k, guess)), weights, Math.min(d, cands.length));
  const out = rows.map((row) => ({ ...row, decayed: row.decayed.slice() }));
  for (const p of picks) {
    const [r, c] = cands[p];
    out[r].decayed[c] = true;
  }
  return out;
}

/** Keyboard colours from VISIBLE tiles only. Faded info doesn't leak. */
export function keyboardState(rows: DecayRow[]): Map<string, Mark> {
  const best = new Map<string, Mark>();
  for (const row of rows) {
    row.marks.forEach((m, c) => {
      if (row.decayed[c]) return;
      const ch = row.guess[c];
      const prev = best.get(ch);
      if (!prev || RANK[m] > RANK[prev]) best.set(ch, m);
    });
  }
  return best;
}
