import { describe, expect, it } from 'vitest';
import decay, { reduce, type DecayAction, type DecayState } from './index';
import { keyboardState, DECAY_CURVE } from './rules';
import { seedFor } from '../../engine/seed';
import { RANK } from '../../engine/pattern';
import { cases } from '../../test/gen';

const typeWord = (w: string): DecayAction[] => [...[...w].map((ch) => ({ t: 'type', ch }) as DecayAction), { t: 'enter' }];
const play = (s: DecayState, words: string[]) => words.flatMap(typeWord).reduce(reduce, s);

async function fresh(day = 3) {
  return decay.init(day, seedFor('decay', day));
}

describe('decay', () => {
  it('rejects junk without consuming a guess', async () => {
    const s0 = await fresh();
    const s1 = play(s0, ['qqqqq']);
    expect(s1.rows).toHaveLength(0);
    expect(s1.flash?.text).toBe('Not in word list');
  });

  it('fades exactly d(k) tiles from earlier rows, never the newest', async () => {
    const s0 = await fresh();
    const guesses = ['crane', 'pilot', 'mushy', 'dwelt', 'fjord', 'gawky'].filter((g) => g !== s0.answer);
    let s = s0;
    let faded = 0;
    for (const g of guesses) {
      if (s.status !== 'playing') break;
      s = play(s, [g]);
      const k = s.rows.length;
      expect(s.rows[k - 1].decayed.every((d) => !d)).toBe(true);
      faded += DECAY_CURVE[k];
      const now = s.rows.flatMap((r) => r.decayed).filter(Boolean).length;
      expect(now).toBe(Math.min(faded, 5 * (k - 1)));
    }
  });

  it('replaying the action log reproduces the same decay', async () => {
    for (const { pick } of cases(30)) {
      const s0 = await fresh(1);
      const words = Array.from({ length: 6 }, () => pick(s0.lists.answers));
      const actions = words.flatMap(typeWord);
      const a = actions.reduce(reduce, s0);
      const b = actions.reduce(reduce, await fresh(1));
      expect(b.rows).toEqual(a.rows);
    }
  });

  it('keyboard only knows what is still visible', async () => {
    for (const { pick } of cases(60, 2)) {
      let s = await fresh(7);
      s = play(s, Array.from({ length: 6 }, () => pick(s.lists.answers)));
      const kb = keyboardState(s.rows);
      const expected = new Map<string, string>();
      s.rows.forEach((r) =>
        r.marks.forEach((m, c) => {
          if (r.decayed[c]) return;
          const prev = expected.get(r.guess[c]);
          if (!prev || RANK[m] > RANK[prev as 'G']) expected.set(r.guess[c], m);
        }),
      );
      expect(Object.fromEntries(kb)).toEqual(Object.fromEntries(expected));
    }
  });

  it('share text marks faded tiles', async () => {
    let s = await fresh(2);
    s = play(s, ['crane', 'pilot', 'mushy', s.answer]);
    const txt = decay.shareText(s, 2);
    expect(txt.split('\n')[0]).toBe(`Decay #2 ${s.rows.length}/6`);
    expect(txt).toContain('▫️');
  });
});
