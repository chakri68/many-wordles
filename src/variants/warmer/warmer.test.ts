import { describe, expect, it } from 'vitest';
import warmer, { reduce, best, pathLine } from './index';
import { seedFor } from '../../engine/seed';
import { rankFrom } from '../../engine/semantic';

const fresh = (day = 1) => warmer.init(day, seedFor('warmer', day));

describe('warmer', () => {
  it('ranking is a permutation with the answer at #1 and alphabetical ties', async () => {
    const s = await fresh(2);
    expect(s.r.rank[s.answer]).toBe(1);
    const seen = new Uint8Array(s.sem.n);
    s.r.order.forEach((w, i) => {
      expect(s.r.rank[w]).toBe(i + 1);
      seen[w] = 1;
    });
    expect(seen.every((x) => x === 1)).toBe(true);
    // recomputing gives the identical order
    expect(rankFrom(s.sem, s.answer).order).toEqual(s.r.order);
  });

  it('guesses rank, repeats and unknowns are free', async () => {
    let s = await fresh(3);
    s = reduce(s, { t: 'guess', word: 'ocean' });
    s = reduce(s, { t: 'guess', word: 'OCEAN ' });
    s = reduce(s, { t: 'guess', word: 'zzzzqx' });
    expect(s.guesses).toHaveLength(1);
    expect(s.flash?.text).toMatch(/vocabulary/);
    s = reduce(s, { t: 'guess', word: s.sem.vocab[s.answer] });
    expect(s.status).toBe('won');
    expect(warmer.shareText(s, 3)).toMatch(/^Warmer Oct 6 · got it in 2\n[▁-█]{2}$/);
  });

  it('hints halve the distance and never give the answer away', async () => {
    let s = await fresh(4);
    s = reduce(s, { t: 'guess', word: 'banana' });
    let prev = best(s);
    for (let k = 0; k < 40 && s.status === 'playing'; k++) {
      const next = reduce(s, { t: 'hint' });
      if (next.guesses.length === s.guesses.length) break;
      s = next;
      const h = s.guesses.at(-1)!;
      expect(h.hint).toBe(true);
      expect(h.rank).toBeGreaterThan(1);
      expect(h.rank).toBeLessThanOrEqual(Math.max(2, Math.floor(prev / 2)));
      prev = best(s);
    }
    expect(s.status).toBe('playing');
    expect(best(s)).toBe(2);
  });

  it('long games squeeze the path line to 24 chars', async () => {
    let s = await fresh(5);
    for (const w of s.sem.vocab.slice(500, 560)) s = reduce(s, { t: 'guess', word: w });
    expect([...pathLine(s)]).toHaveLength(24);
  });
});
