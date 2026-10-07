// Off-main-thread ranking and path search for Warmer + Bridge.
import { makeSem, pickBridge, rankFrom, type Sem } from '../../engine/semantic';

let sem: Sem | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'init') {
    sem = makeSem(m.vocab, m.emb, m.meta, m.answers);
    return;
  }
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
