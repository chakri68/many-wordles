import { describe, expect, it } from 'vitest';
import { readPublic } from '../test/setup';
import { parseList } from './words';
import { suggestWords } from './suggest';

const vocab = parseList(readPublic('semantic/vocab.v1.txt'));

describe('suggestWords', () => {
  const list = ['the', 'cat', 'category', 'catch', 'receive', 'elephant', 'cab', 'scatter'];

  it('puts the exact word first, then prefixes in list order', () => {
    expect(suggestWords(list, 'cat')).toEqual(['cat', 'category', 'catch', 'cab', 'scatter']);
  });

  it('forgives typos, swaps included, against a prefix', () => {
    expect(suggestWords(['received', 'receive'], 'recieve')).toEqual(['receive', 'received']);
    expect(suggestWords(list, 'elephnt')).toEqual(['elephant']);
    expect(suggestWords(list, 'elphan')).toEqual(['elephant']);
  });

  it('caps at the limit and ignores junk', () => {
    expect(suggestWords(vocab, 'th')).toHaveLength(5);
    expect(suggestWords(list, 'c')).toEqual([]);
    expect(suggestWords(list, 'c4t')).toEqual([]);
    expect(suggestWords(list, 'zzzzzz')).toEqual([]);
  });

  it('finds an exact word even past a full bucket of prefixes', () => {
    const w = vocab.find((x) => x.length >= 3 && vocab.filter((y) => y.startsWith(x)).length > 6 && vocab.indexOf(x) > 5000)!;
    expect(suggestWords(vocab, w)[0]).toBe(w);
  });

  it('is quick enough per keystroke on the real vocab', () => {
    const t = performance.now();
    for (const q of ['qwertyui', 'xylophon', 'recieve', 'beautifull']) suggestWords(vocab, q);
    expect((performance.now() - t) / 4).toBeLessThan(50);
  });
});
