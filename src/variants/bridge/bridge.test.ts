import { describe, expect, it } from 'vitest';
import bridge, { reduce, hops, parHops, links, MAX_CHAIN as MAX } from './index';
import { seedFor } from '../../engine/seed';
import { dot, linked, neighbours } from '../../engine/semantic';

const fresh = (day = 1) => bridge.init(day, seedFor('bridge', day));

describe('bridge', () => {
  it('every day has a valid par path of 3–4 hops', async () => {
    for (let d = 1; d <= 12; d++) {
      const s = await fresh(d);
      expect([3, 4]).toContain(parHops(s));
      expect(s.par[0]).toBe(s.start);
      expect(s.par.at(-1)).toBe(s.end);
      for (let i = 1; i < s.par.length; i++) expect(linked(s.sem, s.par[i - 1], s.par[i])).toBe(true);
      expect(linked(s.sem, s.start, s.end)).toBe(false);
    }
  });

  it('walking the bot path wins at par', async () => {
    let s = await fresh(6);
    for (const w of s.par.slice(1, -1)) s = reduce(s, { t: 'add', word: s.sem.vocab[w] });
    expect(s.status).toBe('won');
    expect(hops(s)).toBe(parHops(s));
    expect(bridge.bucketOf(s)).toBe('≤par');
    for (const [a, b] of links(s)) expect(dot(s.sem, a, b)).toBeGreaterThanOrEqual(s.sem.bridge);
  });

  it('rejects far, repeated and unknown words; undo works', async () => {
    let s = await fresh(7);
    const far = s.sem.vocab.findIndex((_, i) => !linked(s.sem, s.start, i) && i !== s.start);
    s = reduce(s, { t: 'add', word: s.sem.vocab[far] });
    expect(s.chain).toHaveLength(0);
    expect(s.flash?.text).toMatch(/not quite|stretch|nowhere/);
    const near = neighbours(s.sem, s.start).find((i) => i !== s.end && !linked(s.sem, i, s.end))!;
    s = reduce(s, { t: 'add', word: s.sem.vocab[near] });
    expect(s.chain).toEqual([near]);
    s = reduce(s, { t: 'add', word: s.sem.vocab[near] });
    expect(s.flash?.text).toMatch(/Already/);
    s = reduce(s, { t: 'undo' });
    expect(s.chain).toEqual([]);
  });

  it('share text has one block per hop', async () => {
    let s = await fresh(8);
    for (const w of s.par.slice(1, -1)) s = reduce(s, { t: 'add', word: s.sem.vocab[w] });
    const [head, blocks] = bridge.shareText(s, 8).split('\n');
    expect(head).toMatch(/^Bridge Oct 11 · [A-Z]+ → [A-Z]+ in \d hops \(par \d\)$/);
    expect([...blocks]).toHaveLength(hops(s));
  });
});

describe('bridge help', () => {
  it('hints always add a valid link and eventually finish', async () => {
    for (let d = 1; d <= 6; d++) {
      let s = await fresh(d);
      for (let k = 0; k < MAX && s.status === 'playing'; k++) {
        const before = s.chain.length;
        s = reduce(s, { t: 'hint' });
        if (s.chain.length === before) break;
        const w = s.chain.at(-1)!;
        expect(s.hinted).toContain(w);
        expect(linked(s.sem, s.chain.at(-2) ?? s.start, w)).toBe(true);
      }
      expect(s.status).toBe('won');
      expect(bridge.shareText(s, d)).toMatch(/hints?\n/);
    }
  });

  it('rejections say how far off the word was', async () => {
    let s = await fresh(1);
    const words = s.sem.vocab.map((_, i) => i).filter((i) => i !== s.start && !linked(s.sem, s.start, i));
    const msgs = new Set<string>();
    for (const i of words.slice(0, 4000)) {
      const t = reduce(s, { t: 'add', word: s.sem.vocab[i] });
      msgs.add(t.flash!.text.replace(/^[A-Z]+ /, '').replace(/ [A-Z]+(, but not quite)?$/, '$1'));
    }
    expect(msgs).toEqual(new Set(['is close to, but not quite', 'is a stretch from', 'is nowhere near']));
    s = reduce(s, { t: 'undo' });
  });
});

describe('bridge links', () => {
  it('link by meaning, not by shared sentences', async () => {
    const s = await fresh(1);
    const ix = (w: string) => s.sem.index.get(w)!;
    expect(linked(s.sem, ix('flee'), ix('escape'))).toBe(true);
    expect(linked(s.sem, ix('lose'), ix('afford'))).toBe(false);
    expect(linked(s.sem, ix('team'), ix('now'))).toBe(false);
  });
});
