// Hand-rolled property-test generator: seeded, so failures reproduce.
import { rng, randInt } from '../engine/rng';

export function* cases(n: number, seed = 1) {
  for (let i = 0; i < n; i++) {
    const r = rng(seed * 7919 + i);
    yield { i, r, pick: <T>(xs: readonly T[]) => xs[randInt(r, xs.length)] };
  }
}
