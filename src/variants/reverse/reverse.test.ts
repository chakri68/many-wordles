import { describe, expect, it } from 'vitest';
import reverse, { reduce, MAX_ROUNDS, type ReverseState } from './index';
import { bestGuess, liveCodes } from './solver';
import { decode, encode } from '../../engine/pattern';
import { seedFor } from '../../engine/seed';
import { cases } from '../../test/gen';
import type { Mark } from '../../engine/score';

const fresh = (day = 1) => reverse.init(day, seedFor('reverse', day));

/** Drive the bot synchronously (no worker in tests). */
function botTurn(s: ReverseState): ReverseState {
  return reduce(s, { t: 'bot', guess: bestGuess(s.ctx, s.cands, s.seed, s.rounds.length) });
}
function give(s: ReverseState, marks: Mark[]): ReverseState {
  let x = s;
  marks.forEach((m, i) => {
    while (x.pending!.marks[i] !== m) x = reduce(x, { t: 'cycle', i });
  });
  return reduce(x, { t: 'submit' });
}

describe('reverse', () => {
  it('an inconsistent pattern is always rejected, a consistent one accepted', async () => {
    const s0 = await fresh(2);
    for (const { r } of cases(300, 11)) {
      const code = Math.floor(r() * 243);
      const live = liveCodes(s0.ctx, s0.cands, s0.pending!.guess);
      const after = give(s0, decode(code));
      if (live.has(code)) expect(after.rounds).toHaveLength(1);
      else {
        expect(after.rounds).toHaveLength(0);
        expect(after.flash?.text).toMatch(/No word fits/);
      }
    }
  });

  it('the bot always finishes within the cap against random consistent play', async () => {
    for (const { pick, i } of cases(25, 13)) {
      let s = await fresh(1 + i);
      let guard = 0;
      while (s.status !== 'done' && guard++ < 40) {
        if (s.status === 'thinking') s = botTurn(s);
        else {
          const codes = [...liveCodes(s.ctx, s.cands, s.pending!.guess)];
          s = give(s, decode(pick(codes)));
        }
        expect(s.cands.length).toBeGreaterThan(0);
      }
      expect(s.status).toBe('done');
      expect(s.rounds.length).toBeLessThanOrEqual(MAX_ROUNDS);
      // trail is consistent: each round shrinks or keeps C
      s.rounds.forEach((r, k) => {
        expect(r.after).toBeLessThanOrEqual(r.before);
        if (k) expect(r.before).toBe(s.rounds[k - 1].after);
      });
    }
  });

  it('forced all-green when C is the guess', async () => {
    let s = await fresh(3);
    // be maximally unhelpful: always pick the biggest bucket
    for (let k = 0; k < 20 && s.status !== 'done'; k++) {
      if (s.status === 'thinking') {
        s = botTurn(s);
        continue;
      }
      const g = s.pending!.guess;
      const sizes = new Map<number, number>();
      for (const c of s.cands) {
        const code = encode(decode(liveCodeOf(s, g, c)));
        sizes.set(code, (sizes.get(code) ?? 0) + 1);
      }
      const worst = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      s = give(s, decode(worst));
    }
    expect(s.status).toBe('done');
    expect(s.rounds.at(-1)!.marks.join('')).toBe('GGGGG');
  });

  it('share text shows the candidate trail', async () => {
    let s = await fresh(4);
    s = give(s, ['B', 'B', 'B', 'B', 'B']);
    s = botTurn(s);
    const lines = reverse.shareText({ ...s, status: 'done' }, 4).split('\n');
    expect(lines[1]).toMatch(/^⬛⬛⬛⬛⬛ {2}\d+→\d+$/);
  });
});

function liveCodeOf(s: ReverseState, guess: string, c: number) {
  return [...liveCodes(s.ctx, [c], guess)][0];
}
