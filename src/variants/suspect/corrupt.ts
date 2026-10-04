import type { Mark } from '../../engine/score';
import { score } from '../../engine/score';
import { encode } from '../../engine/pattern';
import { mixSeed } from '../../engine/seed';
import { rng, randInt } from '../../engine/rng';

const COLOURS: Mark[] = ['G', 'Y', 'B'];

/**
 * Corrupt exactly one tile of a non-winning pattern.
 *  - position + replacement colour come from seed(day, row, guess)
 *  - never all-green (that would be a free tell)
 *  - prefer lies that are still consistent with some real word, so an
 *    impossible pattern doesn't give the liar away
 * A fixed number of rng draws keeps this stable however the search goes.
 */
export function corrupt(
  guess: string,
  truth: Mark[],
  seed: number,
  row: number,
  allowed: readonly string[],
): { shown: Mark[]; pos: number } {
  const r = rng(mixSeed(seed, row, guess));
  const start = randInt(r, 5);
  const swap = Array.from({ length: 5 }, () => r() < 0.5);

  const primary: [number, Mark][] = [];
  const secondary: [number, Mark][] = [];
  for (let i = 0; i < 5; i++) {
    const pos = (start + i) % 5;
    const others = COLOURS.filter((c) => c !== truth[pos]);
    if (swap[pos]) others.reverse();
    primary.push([pos, others[0]]);
    secondary.push([pos, others[1]]);
  }

  let possible: Set<number> | null = null;
  const plausible = (p: Mark[]) => {
    possible ??= new Set(allowed.map((w) => encode(score(guess, w))));
    return possible.has(encode(p));
  };

  let fallback: { shown: Mark[]; pos: number } | null = null;
  for (const [pos, colour] of [...primary, ...secondary]) {
    const shown = truth.slice();
    shown[pos] = colour;
    if (shown.every((m) => m === 'G')) continue;
    fallback ??= { shown, pos };
    if (plausible(shown)) return { shown, pos };
  }
  return fallback!;
}
