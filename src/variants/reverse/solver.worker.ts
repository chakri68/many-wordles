// Off-main-thread minimax. The page never blocks while the bot thinks.
import { bestGuess, makeCtx, type SolverCtx } from './solver';

let ctx: SolverCtx | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'init') {
    ctx = makeCtx(m.answers, m.allowed);
    return;
  }
  if (m.t === 'solve' && ctx) {
    const t0 = performance.now();
    const guess = bestGuess(ctx, m.cands, m.seed, m.round);
    self.postMessage({ id: m.id, guess, ms: performance.now() - t0 });
  }
};
