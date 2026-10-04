import { describe, expect, it } from 'vitest';
import chrono, { reduce, candidates, feedback, MAX_GUESSES } from './index';
import { seedFor } from '../../engine/seed';
import { cases } from '../../test/gen';

const fresh = (day: number) => chrono.init(day, seedFor('chrono', day));

describe('before/after', () => {
  it('feedback bands and directions', () => {
    const t = { name: 't', year: 1947, cat: 'politics' as const };
    expect(feedback(t, { name: 'a', year: 1950, cat: 'politics' })).toEqual({ dir: 'earlier', band: 1, sameCat: true });
    expect(feedback(t, { name: 'b', year: 1900, cat: 'sport' })).toEqual({ dir: 'later', band: 3, sameCat: false });
    expect(feedback(t, { name: 'c', year: 1947, cat: 'sport' }).band).toBe(0);
    expect(feedback(t, { name: 'd', year: 1700, cat: 'sport' }).band).toBe(4);
  });

  it('the target always stays among the candidates, and they only shrink', async () => {
    for (const { pick, i } of cases(30, 21)) {
      let s = await fresh(1 + i);
      let prev = candidates(s).length;
      expect(candidates(s)).toContain(s.target);
      while (s.status === 'playing') {
        s = reduce(s, { t: 'guess', name: pick(s.events).name });
        if (s.status !== 'playing') break;
        const c = candidates(s);
        expect(c).toContain(s.target);
        expect(c.length).toBeLessThanOrEqual(prev);
        prev = c.length;
      }
      expect(s.guesses.length).toBeLessThanOrEqual(MAX_GUESSES);
    }
  });

  it('never picks a fuzzy "(approx.)" event as the answer', async () => {
    for (let d = 1; d <= 60; d++) {
      const s = await fresh(d);
      expect(s.events[s.target].name).not.toMatch(/approx|traditional/i);
    }
  });

  it('unknown names are free; winning ends it; share shows arrows', async () => {
    let s = await fresh(4);
    s = reduce(s, { t: 'guess', name: 'the invention of pizza' });
    expect(s.guesses).toHaveLength(0);
    const other = s.events.findIndex((_, i) => i !== s.target);
    s = reduce(s, { t: 'guess', name: s.events[other].name });
    s = reduce(s, { t: 'guess', name: s.events[s.target].name.toUpperCase() });
    expect(s.status).toBe('won');
    expect(chrono.shareText(s, 4)).toMatch(/^Before\/After #4 2\/7\n(⬅️|➡️|⏺️)(🟩|🟨|🟧|🟥|⬛) 🎯$/);
  });
});
