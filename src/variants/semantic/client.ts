// Main-thread side of the semantic worker, with a synchronous fallback (tests,
// ancient browsers). Results are memoised: the same inputs always give the
// same outputs, so caching is free correctness-wise.
import { pickBridge, rankFrom, type BridgePuzzle, type Ranking, type Sem } from '../../engine/semantic';

let worker: Worker | null = null;
// the worker holds one table per version; v1 and v2 days can be open in one session
const sent = new WeakSet<Sem>();
let reqId = 0;
const rankCache = new Map<string, Promise<Ranking>>();
const bridgeCache = new Map<string, Promise<BridgePuzzle>>();

function call<T>(sem: Sem, msg: Record<string, unknown>): Promise<T> {
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  if (!sent.has(sem)) {
    worker.postMessage({
      t: 'init',
      v: sem.v,
      vocab: sem.vocab.join('\n'),
      emb: sem.emb,
      answers: sem.answers.join('\n'),
      meta: { n: sem.n, dims: sem.dims, common: sem.common, scale2: sem.scale2, bridge: sem.bridge },
    });
    sent.add(sem);
  }
  const id = ++reqId;
  return new Promise((resolve) => {
    const w = worker!;
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', on);
      if (import.meta.env.DEV) console.debug(`[semantic] ${msg.t} ${e.data.ms.toFixed(1)}ms`);
      resolve(e.data as T);
    };
    w.addEventListener('message', on);
    w.postMessage({ ...msg, v: sem.v, id });
  });
}

export function ranking(sem: Sem, target: number): Promise<Ranking> {
  const key = `${sem.v}:${target}`;
  let p = rankCache.get(key);
  if (!p) {
    p = typeof Worker === 'undefined' ? Promise.resolve(rankFrom(sem, target)) : call<Ranking>(sem, { t: 'rank', target });
    rankCache.set(key, p);
  }
  return p;
}

export function bridgePuzzle(sem: Sem, seed: number): Promise<BridgePuzzle> {
  const key = `${sem.v}:${seed}`;
  let p = bridgeCache.get(key);
  if (!p) {
    p =
      typeof Worker === 'undefined'
        ? Promise.resolve(pickBridge(sem, seed))
        : call<BridgePuzzle>(sem, { t: 'bridge', seed }).then(({ start, end, path }) => ({ start, end, path }));
    bridgeCache.set(key, p);
  }
  return p;
}
