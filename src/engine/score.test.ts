import { describe, expect, it } from 'vitest';
import { score, scoreCode } from './score';
import { encode, decode, ALL_GREEN } from './pattern';
import { encodeWords } from '../variants/reverse/solver';
import { cases } from '../test/gen';

// [guess, answer, expected]. Duplicates in guess, answer and both.
const VECTORS: [string, string, string][] = [
  ['crane', 'crane', 'GGGGG'],
  ['kayak', 'kayak', 'GGGGG'],
  ['abcde', 'fghij', 'BBBBB'],
  ['speed', 'abide', 'BBYBY'],
  ['speed', 'erase', 'YBYYB'],
  ['alley', 'llama', 'YGYBB'],
  ['llama', 'alley', 'YGYBB'],
  ['robot', 'floor', 'YYBGB'],
  ['floor', 'robot', 'BBYGY'],
  ['geese', 'these', 'BBGGG'],
  ['eeeee', 'theme', 'BBGBG'],
  ['abbey', 'babes', 'YYGGB'],
  ['bobby', 'abbot', 'YYGBB'],
  ['mamma', 'maxim', 'GGYBB'],
  ['paper', 'apple', 'YYGYB'],
  ['apple', 'paper', 'YYGBY'],
  ['level', 'hello', 'YGBBY'],
  ['hello', 'level', 'BGYYB'],
  ['tatty', 'treat', 'GYYBB'],
  ['sassy', 'asset', 'YYGBB'],
  ['crane', 'nacre', 'YYYYG'],
  ['zzzzz', 'pizza', 'BBGGB'],
  ['aaaaa', 'abaca', 'GBGBG'],
  ['abaca', 'aaaaa', 'GBGBG'],
  ['baaaa', 'aaaab', 'YGGGY'],
  ['eerie', 'elder', 'GYYBB'],
  ['elder', 'eerie', 'GBBYY'],
  ['otter', 'totem', 'YYGGB'],
  ['totem', 'otter', 'YYGGB'],
  ['mommy', 'mummy', 'GBGGG'],
  ['error', 'robot', 'BYBGB'],
  ['robot', 'error', 'YBBGB'],
];

describe('score', () => {
  it.each(VECTORS)('%s vs %s -> %s', (g, a, want) => {
    expect(score(g, a).join('')).toBe(want);
  });

  it('scoreCode agrees with score on random pairs', () => {
    const L = 'aabcdeeeilmnoorst';
    for (const { pick } of cases(4000)) {
      const w = () => Array.from({ length: 5 }, () => pick([...L])).join('');
      const g = w();
      const a = w();
      const ge = encodeWords([g]);
      const ae = encodeWords([a]);
      expect(scoreCode(ge, 0, ae, 0)).toBe(encode(score(g, a)));
    }
  });

  it('pattern codes round-trip', () => {
    for (let c = 0; c < 243; c++) expect(encode(decode(c))).toBe(c);
    expect(encode(['G', 'G', 'G', 'G', 'G'])).toBe(ALL_GREEN);
  });
});
