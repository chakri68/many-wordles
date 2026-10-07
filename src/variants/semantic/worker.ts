// Off-main-thread ranking and path search for Warmer + Bridge.
import { makeSem, pickBridge, rankFrom, type Sem, type SemVersion } from '../../engine/semantic';

const sems = new Map<SemVersion, Sem>();

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'init') {
    sems.set(m.v, makeSem(m.v, m.vocab, m.emb, m.meta, m.answers));
    return;
  }
  const sem = sems.get(m.v);
  if (!sem) return;
  const t0 = performance.now();
  if (m.t === 'rank') {
    const r = rankFrom(sem, m.target);
    (self as unknown as Worker).postMessage({ id: m.id, rank: r.rank, order: r.order, ms: performance.now() - t0 }, [
      r.rank.buffer,
      r.order.buffer,
    ]);
  } else if (m.t === 'bridge') {
    const p = pickBridge(sem, m.seed);
    self.postMessage({ id: m.id, ...p, ms: performance.now() - t0 });
  }
};
