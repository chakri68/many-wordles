import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validate, validateClues } from './validate';
import type { FrozenManifest, PoolId } from './types';
import frozen from './frozen.json';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const vocab = new Set([...read('public/semantic/vocab.v1.txt').split('\n'), ...read('public/words/extra.v1.txt').split('\n')].filter(Boolean));

describe('content validation', () => {
  it('catches leaks, blank counts and duplicates', () => {
    const bad = validateClues('missing', [
      { answer: 'piano', clues: ['a ___', 'the piano ___', 'two ___ ___', 'no blank', 'pianist ___', 'ok ___'] },
      { answer: 'piano', clues: Array(6).fill('x ___') },
    ]);
    const msgs = bad.map((p) => p.message).join('\n');
    expect(msgs).toMatch(/clue 2 leaks/);
    expect(msgs).toMatch(/clue 3 needs exactly one/);
    expect(msgs).toMatch(/clue 4 needs exactly one/);
    expect(msgs).toMatch(/clue 5 leaks/); // "pianist" shares the stem
    expect(msgs).toMatch(/duplicate answer/);
  });

  it.each(['missing', 'define', 'events'] as PoolId[])('every %s draft is mechanically valid', (pool) => {
    const items = JSON.parse(read(`content/drafts/${pool}.json`));
    expect(validate(pool, items, vocab)).toEqual([]);
  });

  it('frozen pools are byte-identical to what was frozen', () => {
    const m = frozen as FrozenManifest;
    for (const versions of Object.values(m))
      for (const v of versions) {
        const path = new URL(`public/${v.file}`, root);
        expect(existsSync(path)).toBe(true);
        expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(v.sha256);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(v.count);
      }
  });
});
