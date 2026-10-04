import { describe, expect, it } from 'vitest';
import missing from './missing';
import define from './define';
import { reduceClue, shown, shareRow } from './engine';
import { seedFor } from '../../engine/seed';

describe('clue games', () => {
  it('a miss reveals the next clue; junk and repeats are free', async () => {
    let s = await missing.init(1, seedFor('missing', 1));
    expect(shown(s)).toBe(1);
    const wrong = s.item.answer === 'apple' ? 'house' : 'apple';
    s = reduceClue(s, { t: 'guess', word: wrong });
    expect(shown(s)).toBe(2);
    s = reduceClue(s, { t: 'guess', word: wrong });
    s = reduceClue(s, { t: 'guess', word: 'qzxqzx' });
    s = reduceClue(s, { t: 'guess', word: 'two words' });
    expect(s.misses).toHaveLength(1);
    s = reduceClue(s, { t: 'skip' });
    expect(shown(s)).toBe(3);
    s = reduceClue(s, { t: 'guess', word: s.item.answer.toUpperCase() });
    expect(s.status).toBe('won');
    expect(missing.result(s).label).toBe('3/6');
    expect(shareRow(s)).toBe('⬛⬛🟩▫️▫️▫️');
  });

  it('six misses and it is over', async () => {
    let s = await define.init(2, seedFor('define', 2));
    for (let k = 0; k < 8; k++) s = reduceClue(s, { t: 'skip' });
    expect(s.status).toBe('lost');
    expect(s.misses).toHaveLength(6);
    expect(define.shareText(s, 2)).toBe('Define #2 X/6\n⬛⬛⬛⬛⬛⬛');
  });

  it('accepts Indian words GloVe never learned', async () => {
    let s = await missing.init(3, seedFor('missing', 3));
    if (s.item.answer !== 'samosa') s = reduceClue(s, { t: 'guess', word: 'samosa' });
    expect(s.flash?.text ?? '').not.toMatch(/vocabulary/);
  });
});
