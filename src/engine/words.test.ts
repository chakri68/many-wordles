import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPublic } from '../test/setup';
import { answerFor, makeLists } from './words';

// Frozen lists (spec §3.2). If this fails you edited a shipped list: don't.
const PINNED: Record<string, string> = {
  'words/answers.v1.txt': '04594103faeb9962defbc84525967600980d1abc4af60209673fff27b1279aae',
  'words/allowed.v1.txt': 'a05b9b9ba711f1bde6a093b4fb250ab679f133594f76729b9afdd0a780c467a7',
  'semantic/vocab.v1.txt': 'c36891c9ba71592697800b6d0a176675cde49d3e423bf00f55e72d9432e60e1d',
  'semantic/embed.v1.bin': '7745b32cd00797843eab14e49e6cbb6050f5ade327cf5e2d851e34a2c4e10baf',
  'semantic/answers.v1.txt': 'fead4bf2663885846db1383c2d0e975dcd1cbfce76af3d6ceadde3d2d307f3d1',
  'semantic/meta.v1.json': 'fcb2272c50775d6ca0332d6d8bcfbde4499f13e37e5af815534aa2b4f8bb8ee6',
  'semantic/vocab.v2.txt': '4e8b0493b5afac48ffaf58a95417c512c797e44a84d6dba98aa2c7a76b127c85',
  'semantic/embed.v2.bin': '1c2bc96a25310496a0ef775d9938ea7237e35eb86c173243acd65337023b861d',
  'semantic/answers.v2.txt': '5f48559a4a1e791393eea4ef9f82537d16b07884b608b2d814a3547fd0595a98',
  'semantic/meta.v2.json': '6c81c5bb2932db93233ff5dd627e4e8077030bbffd7087cdaac612c3f66dac62',
  'reverse/openers.v1.json': 'b646c2a05a68e55d8a662b68a8e7c7123e228d4b7913e4348c5b6ce7c253586e',
};

const lists = makeLists(readPublic('words/answers.v1.txt'), readPublic('words/allowed.v1.txt'), readPublic('words/denylist.txt'));

describe('word lists', () => {
  it.each(Object.entries(PINNED))('%s hash is pinned', (file, hash) => {
    expect(createHash('sha256').update(readFileSync(new URL(`../../public/${file}`, import.meta.url))).digest('hex')).toBe(hash);
  });

  it('answers ⊆ allowed, all 5 lowercase letters', () => {
    for (const a of lists.answers) {
      expect(a).toMatch(/^[a-z]{5}$/);
      expect(lists.allowed.has(a)).toBe(true);
    }
  });

  it('no repeats until the list is exhausted', () => {
    const N = lists.answers.length;
    const seen = new Set<string>();
    for (let d = 0; d < N; d++) seen.add(answerFor(lists, 'decay', d));
    expect(seen.size).toBe(N);
  });

  it('variants get different words on the same day', () => {
    let same = 0;
    for (let d = 1; d <= 100; d++) if (answerFor(lists, 'decay', d) === answerFor(lists, 'suspect', d)) same++;
    expect(same).toBeLessThan(3);
  });

  it('denylist skips deterministically', () => {
    const w = answerFor(lists, 'decay', 5);
    const denied = { ...lists, deny: new Set([w]) };
    const next = answerFor(denied, 'decay', 5);
    expect(next).not.toBe(w);
    expect(answerFor(denied, 'decay', 5)).toBe(next);
  });
});
