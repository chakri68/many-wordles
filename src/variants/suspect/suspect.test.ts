import { describe, expect, it } from 'vitest';
import suspect, { reduce, liarsCaught, type SuspectAction, type SuspectState } from './index';
import { corrupt } from './corrupt';
import { score } from '../../engine/score';
import { seedFor } from '../../engine/seed';
import { cases } from '../../test/gen';

const typeWord = (w: string): SuspectAction[] => [...[...w].map((ch) => ({ t: 'type', ch }) as SuspectAction), { t: 'enter' }];
const play = (s: SuspectState, words: string[]) => words.flatMap(typeWord).reduce(reduce, s);
const fresh = (day = 4) => suspect.init(day, seedFor('suspect', day));

describe('suspect', () => {
  it('every non-winning row lies about exactly one tile, never all-green', async () => {
    for (const { pick, i } of cases(80, 3)) {
      let s = await fresh(1 + (i % 30));
      s = play(s, Array.from({ length: 8 }, () => pick(s.lists.answers)));
      for (const r of s.rows) {
        const diff = r.shown.filter((m, c) => m !== r.truth[c]).length;
        if (r.lie < 0) {
          expect(diff).toBe(0);
          expect(r.guess).toBe(s.answer);
        } else {
          expect(diff).toBe(1);
          expect(r.shown[r.lie]).not.toBe(r.truth[r.lie]);
          expect(r.shown.every((m) => m === 'G')).toBe(false);
        }
      }
    }
  });

  it('corruption is deterministic for (day, row, guess)', async () => {
    const s = await fresh();
    for (const { pick, i } of cases(50, 5)) {
      const g = pick(s.lists.answers);
      const t = score(g, s.answer);
      if (t.every((m) => m === 'G')) continue;
      expect(corrupt(g, t, s.seed, i % 8, s.lists.allowedList)).toEqual(corrupt(g, t, s.seed, i % 8, s.lists.allowedList));
    }
  });

  it('near-misses never lie their way to all-green', async () => {
    const s = await fresh();
    // four greens + one miss: corrupting the miss to G would be all-green
    const near: ('G' | 'B')[] = ['G', 'G', 'G', 'G', 'B'];
    for (let row = 0; row < 40; row++) {
      const out = corrupt(s.answer.slice(0, 4) + 'q', near, s.seed, row, s.lists.allowedList);
      expect(out.shown.every((m) => m === 'G')).toBe(false);
    }
  });

  it('accusations toggle, score at the end, and show in the share card', async () => {
    let s = await fresh(9);
    const wrong = s.lists.answers.filter((w) => w !== s.answer).slice(0, 3);
    s = play(s, wrong);
    s = reduce(s, { t: 'accuse', row: 0, col: s.rows[0].lie });
    s = reduce(s, { t: 'accuse', row: 1, col: (s.rows[1].lie + 1) % 5 });
    s = reduce(s, { t: 'accuse', row: 2, col: 0 });
    s = reduce(s, { t: 'accuse', row: 2, col: 0 }); // un-accuse
    expect(s.accused).toEqual([s.rows[0].lie, (s.rows[1].lie + 1) % 5, null]);
    s = play(s, [s.answer]);
    expect(s.status).toBe('won');
    expect(liarsCaught(s)).toEqual({ caught: 1, total: 3 });
    const lines = suspect.shareText(s, 9).split('\n');
    expect(lines[0]).toBe('Suspect Oct 12 4/8 · 🕵️ 1/3 liars caught');
    expect(lines[1].endsWith(' ✓')).toBe(true);
    expect(lines[2].endsWith(' ✓')).toBe(false);
    // locked after the game
    expect(reduce(s, { t: 'accuse', row: 0, col: 0 })).toBe(s);
  });
});
