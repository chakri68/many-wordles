import { describe, expect, it } from 'vitest';
import { dateOf, dayIndex, dayLabel, dayOfIso, fnv1a, isoOf, seedFor, EPOCH } from './seed';
import { rng, shuffledIndices, weightedSample } from './rng';

describe('seed + rng', () => {
  it('fnv1a matches the reference', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('epoch is puzzle #1, by local calendar date', () => {
    const [y, m, d] = EPOCH.split('-').map(Number);
    expect(dayIndex(new Date(y, m - 1, d, 0, 0, 1))).toBe(1);
    expect(dayIndex(new Date(y, m - 1, d, 23, 59, 59))).toBe(1);
    expect(dayIndex(new Date(y, m - 1, d + 1, 0, 0))).toBe(2);
    expect(dayIndex(new Date(y, m - 1, d + 365))).toBe(366);
    // across a DST change in either hemisphere
    expect(dayIndex(new Date(2027, 2, 30, 12)) - dayIndex(new Date(2027, 2, 20, 12))).toBe(10);
  });

  it('dates round-trip through puzzle numbers', () => {
    expect(isoOf(1)).toBe(EPOCH);
    expect(dayOfIso(EPOCH)).toBe(1);
    for (const d of [1, 2, 31, 150, 400, 1000]) {
      expect(dayOfIso(isoOf(d))).toBe(d);
      expect(dayIndex(dateOf(d))).toBe(d);
    }
    expect(dayLabel(4)).toBe('Oct 7');
    expect(dayOfIso('2027-02-31')).toBeNull();
    expect(dayOfIso('yesterday')).toBeNull();
  });

  it('mulberry32 stream is pinned', () => {
    const r = rng(seedFor('decay', 1));
    const xs = Array.from({ length: 5 }, () => Math.floor(r() * 1e6));
    expect(xs).toMatchSnapshot();
  });

  it('shuffle is a permutation', () => {
    const p = shuffledIndices(500, 42);
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it('weighted sample never repeats', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const picks = weightedSample(r, [3, 2, 1, 3, 1, 2], 4);
      expect(new Set(picks).size).toBe(4);
    }
  });
});
