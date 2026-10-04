// Golden tests (spec §3.1 rule 5): days 1–30 of every variant are pinned.
// A diff here means a past puzzle changed. That's a bug, not a snapshot update.
import { describe, expect, it } from 'vitest';
import { seedFor } from '../engine/seed';
import decay, { reduce as decayReduce } from './decay';
import suspect, { reduce as suspectReduce } from './suspect';
import reverse, { reduce as reverseReduce } from './reverse';
import { bestGuess } from './reverse/solver';
import warmer from './warmer';
import bridge from './bridge';

const typed = (w: string) => [...[...w].map((ch) => ({ t: 'type' as const, ch })), { t: 'enter' as const }];
const PROBE = ['crane', 'pilot', 'mushy', 'dwelt', 'fjord'];

describe('golden: days 1–30', () => {
  it('decay', async () => {
    const out: string[] = [];
    for (let d = 1; d <= 30; d++) {
      let s = await decay.init(d, seedFor('decay', d));
      for (const a of PROBE.flatMap(typed)) s = decayReduce(s, a);
      out.push(`${d} ${s.answer} ${s.rows.map((r) => r.decayed.map((x) => +x).join('')).join(' ')}`);
    }
    expect(out).toMatchSnapshot();
  });

  it('suspect', async () => {
    const out: string[] = [];
    for (let d = 1; d <= 30; d++) {
      let s = await suspect.init(d, seedFor('suspect', d));
      for (const a of PROBE.flatMap(typed)) s = suspectReduce(s, a);
      out.push(`${d} ${s.answer} ${s.rows.map((r) => `${r.lie}${r.shown.join('')}`).join(' ')}`);
    }
    expect(out).toMatchSnapshot();
  });

  it('reverse', async () => {
    const out: string[] = [];
    for (let d = 1; d <= 30; d++) {
      let s = await reverse.init(d, seedFor('reverse', d));
      const opener = s.pending!.guess;
      s = reverseReduce(s, { t: 'submit' }); // all-black, if anything fits
      const next = s.status === 'thinking' ? bestGuess(s.ctx, s.cands, s.seed, 1) : '-';
      out.push(`${d} ${opener} ${s.cands.length} ${next}`);
    }
    expect(out).toMatchSnapshot();
  });

  it('warmer', async () => {
    const out: string[] = [];
    for (let d = 1; d <= 30; d++) {
      const s = await warmer.init(d, seedFor('warmer', d));
      out.push(`${d} ${s.sem.vocab[s.answer]} ${Array.from(s.r.order.slice(1, 4), (w) => s.sem.vocab[w]).join(',')}`);
    }
    expect(out).toMatchSnapshot();
  });

  it('bridge', async () => {
    const out: string[] = [];
    for (let d = 1; d <= 30; d++) {
      const s = await bridge.init(d, seedFor('bridge', d));
      out.push(`${d} ${s.par.map((w) => s.sem.vocab[w]).join('>')}`);
    }
    expect(out).toMatchSnapshot();
  });
});
