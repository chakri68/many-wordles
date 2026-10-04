import { loadLists, type Lists } from '../../engine/words';
import { score, type Mark } from '../../engine/score';
import { encode, EMOJI, ALL_GREEN } from '../../engine/pattern';
import { rng, randInt } from '../../engine/rng';
import { haptic } from '../../engine/haptics';
import { getSettings, onSettings } from '../../engine/settings';
import type { Variant, Flash } from '../types';
import { Board, type RowModel, type TileKind } from '../../ui/board';
import { h, onGameKey, sleep, tweenNumber, motionMs } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { bestGuess, filterCands, liveCodes, makeCtx, type SolverCtx } from './solver';

export const MAX_ROUNDS = 12;
const CYCLE: Record<Mark, Mark> = { B: 'Y', Y: 'G', G: 'B' };

export interface Round {
  guess: string;
  marks: Mark[];
  before: number;
  after: number;
}

export interface ReverseState {
  day: number;
  seed: number;
  ctx: SolverCtx;
  total: number;
  cands: number[];
  rounds: Round[];
  pending: { guess: string; marks: Mark[] } | null;
  status: 'feedback' | 'thinking' | 'done';
  flash?: Flash;
}

export type ReverseAction = { t: 'cycle'; i: number } | { t: 'submit' } | { t: 'bot'; guess: string };

let opener: Promise<string[]> | null = null;
const loadOpeners = () =>
  (opener ??= fetch(new URL(import.meta.env.BASE_URL + 'reverse/openers.v1.json', location.href)).then((r) =>
    r.json(),
  ));

const ctxCache = new WeakMap<Lists, SolverCtx>();
export function ctxFor(lists: Lists): SolverCtx {
  let c = ctxCache.get(lists);
  if (!c) ctxCache.set(lists, (c = makeCtx(lists.answers, lists.allowedList)));
  return c;
}

export function initialState(ctx: SolverCtx, openers: string[], day: number, seed: number): ReverseState {
  const first = openers[randInt(rng(seed), openers.length)];
  return {
    day,
    seed,
    ctx,
    total: ctx.answers.length,
    cands: ctx.answers.map((_, i) => i),
    rounds: [],
    pending: { guess: first, marks: ['B', 'B', 'B', 'B', 'B'] },
    status: 'feedback',
  };
}

function hint(ctx: SolverCtx, cands: number[], guess: string, marks: Mark[]): string {
  const live = liveCodes(ctx, cands, guess);
  const fixes: number[] = [];
  marks.forEach((m, i) => {
    for (const alt of ['B', 'Y', 'G'] as Mark[]) {
      if (alt === m) continue;
      const p = marks.slice();
      p[i] = alt;
      if (live.has(encode(p))) {
        fixes.push(i + 1);
        return;
      }
    }
  });
  if (!fixes.length) return 'No word fits that. Try again';
  if (fixes.length <= 2) return `No word fits that. Look at tile ${fixes.join(' or ')}`;
  return 'No word fits that. Try again';
}

export function reduce(s: ReverseState, a: ReverseAction): ReverseState {
  switch (a.t) {
    case 'cycle': {
      if (s.status !== 'feedback' || !s.pending || a.i < 0 || a.i > 4) return s;
      const marks = s.pending.marks.slice();
      marks[a.i] = CYCLE[marks[a.i]];
      return { ...s, pending: { ...s.pending, marks } };
    }
    case 'submit': {
      if (s.status !== 'feedback' || !s.pending) return s;
      const { guess, marks } = s.pending;
      const code = encode(marks);
      const next = filterCands(s.ctx, s.cands, guess, code);
      if (!next.length)
        return { ...s, flash: { id: (s.flash?.id ?? 0) + 1, text: hint(s.ctx, s.cands, guess, marks), kind: 'error' } };
      const rounds = [...s.rounds, { guess, marks, before: s.cands.length, after: next.length }];
      const done = code === ALL_GREEN || rounds.length >= MAX_ROUNDS;
      return { ...s, cands: next, rounds, pending: null, status: done ? 'done' : 'thinking' };
    }
    case 'bot': {
      if (s.status !== 'thinking') return s;
      // C is just the bot's guess: the player has no honest move but all-green
      if (s.cands.length === 1 && s.ctx.answers[s.cands[0]] === a.guess) {
        const rounds = [...s.rounds, { guess: a.guess, marks: score(a.guess, a.guess), before: 1, after: 1 }];
        return { ...s, rounds, pending: null, status: 'done' };
      }
      return { ...s, pending: { guess: a.guess, marks: ['B', 'B', 'B', 'B', 'B'] }, status: 'feedback' };
    }
  }
}

const solved = (s: ReverseState) => s.rounds.at(-1)?.marks.every((m) => m === 'G') ?? false;
const perfect = (s: ReverseState) => s.status === 'done' && !solved(s);

// ---- solver bridge (worker, with an inline fallback) -----------------------

let worker: Worker | null = null;
let workerFor: SolverCtx | null = null;
let inflight: string | null = null;
let reqId = 0;

function solve(s: ReverseState): Promise<string> {
  const round = s.rounds.length;
  if (typeof Worker === 'undefined') return Promise.resolve(bestGuess(s.ctx, s.cands, s.seed, round));
  if (!worker) worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  if (workerFor !== s.ctx) {
    worker.postMessage({ t: 'init', answers: s.ctx.answers, allowed: s.ctx.extra });
    workerFor = s.ctx;
  }
  const id = ++reqId;
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      worker!.removeEventListener('message', onMsg);
      if (import.meta.env.DEV) console.debug(`[reverse] solver ${e.data.ms.toFixed(1)}ms`);
      resolve(e.data.guess);
    };
    worker!.addEventListener('message', onMsg);
    worker!.postMessage({ t: 'solve', id, cands: s.cands, seed: s.seed, round });
  });
}

// ---- view ------------------------------------------------------------------

class ReverseView {
  board = new Board({ mode: 'grow', onTile: (r, c) => this.onTile(r, c) });
  counter: HTMLButtonElement;
  countNum: HTMLElement;
  examples: HTMLElement;
  examplesWrap: HTMLElement;
  roundEl: HTMLElement;
  submit: HTMLButtonElement;
  legend: HTMLElement;
  well: HTMLElement;
  s!: ReverseState;
  flashId = 0;
  first = true;
  busy = false;
  offKeys: () => void;
  offSettings: () => void;

  dispatch: (a: ReverseAction) => void;

  constructor(root: HTMLElement, dispatch: (a: ReverseAction) => void) {
    this.dispatch = dispatch;
    this.countNum = h('b', { class: 'num' });
    this.counter = h(
      'button',
      { class: 'chip counter', 'aria-expanded': 'false', 'data-haptic': 'tick' },
      this.countNum,
      h('span', {}, ' words still possible'),
    );
    this.examples = h('div', { class: 'examples' });
    this.examplesWrap = h('div', { class: 'collapse' }, h('div', { class: 'collapse-inner' }, this.examples));
    this.counter.addEventListener('click', () => {
      const open = this.examplesWrap.classList.toggle('open');
      this.counter.setAttribute('aria-expanded', String(open));
      this.counter.classList.toggle('on', open);
    });
    this.roundEl = h('span', { class: 'round' });
    this.well = h('div', { class: 'well grow' }, this.board.el);
    this.submit = h('button', { class: 'btn primary big', 'data-haptic': 'press' }, 'submit feedback');
    this.submit.addEventListener('click', () => this.dispatch({ t: 'submit' }));
    this.legend = h('p', { class: 'legend-line' }, 'tap tiles to set feedback: ○ → ◐ → ●');
    root.append(
      h('div', { class: 'rev-top' }, h('div', { class: 'rev-status' }, this.roundEl, this.counter), this.examplesWrap),
      this.well,
      h('div', { class: 'rev-dock' }, this.legend, this.submit),
    );
    this.applyAids();
    this.offSettings = onSettings(() => this.applyAids());
    this.offKeys = onGameKey((e) => {
      if (/^[1-5]$/.test(e.key)) this.onTile(this.s.rounds.length, Number(e.key) - 1);
      else if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) {
        e.preventDefault();
        haptic('press');
        this.dispatch({ t: 'submit' });
      }
    });
  }

  applyAids() {
    const on = getSettings().reverseAids;
    this.counter.hidden = !on;
    if (!on) this.examplesWrap.classList.remove('open');
  }

  onTile(r: number, c: number) {
    if (this.busy || this.s.status !== 'feedback' || r !== this.s.rounds.length) return;
    haptic('tick');
    this.dispatch({ t: 'cycle', i: c });
  }

  rows(s: ReverseState): RowModel[] {
    const rows: RowModel[] = s.rounds.map((r) => ({
      tiles: r.marks.map((m, c) => ({ letter: r.guess[c], kind: m as TileKind })),
      meta: r.marks.every((m) => m === 'G') ? 'solved' : `${r.before.toLocaleString('en-US')}→${r.after.toLocaleString('en-US')}`,
    }));
    if (s.pending)
      rows.push({
        current: true,
        tiles: s.pending.marks.map((m, c) => ({ letter: s.pending!.guess[c], kind: m as TileKind, interactive: true })),
      });
    else if (s.status === 'thinking')
      rows.push({
        thinking: true,
        meta: 'thinking…',
        tiles: Array.from({ length: 5 }, () => ({ letter: '', kind: 'empty' as TileKind })),
      });
    return rows;
  }

  async update(s: ReverseState, live: boolean) {
    const prev = this.s;
    this.s = s;
    const first = this.first;
    this.first = false;
    const anim = live && !first;

    if (s.flash && s.flash.id !== this.flashId) {
      if (anim) {
        toast(s.flash.text, { kind: 'error', ms: 2200 });
        this.board.shake(s.rounds.length);
      }
      this.flashId = s.flash.id;
    }

    // a cycled tile: quick flip of just that tile
    if (anim && prev?.pending && s.pending && prev.pending.guess === s.pending.guess) {
      const i = s.pending.marks.findIndex((m, k) => m !== prev.pending!.marks[k]);
      if (i >= 0) {
        const row = this.rows(s);
        this.board.flipTo(s.rounds.length, i, row[s.rounds.length].tiles[i]);
        await this.board.update(row, { live: false });
        return;
      }
    }

    const roundsGrew = anim && prev && s.rounds.length > prev.rounds.length;
    const forced = roundsGrew && prev.status === 'thinking' && s.status === 'done';
    await this.board.update(this.rows(s), { live: anim, reveal: forced ? s.rounds.length - 1 : undefined });
    this.board.scrollToRow(this.board.rowCount - 1);

    this.roundEl.textContent =
      s.status === 'done' ? `${s.rounds.length} round${s.rounds.length === 1 ? '' : 's'}` : `round ${Math.min(s.rounds.length + 1, MAX_ROUNDS)}/${MAX_ROUNDS}`;
    if (anim) tweenNumber(this.countNum, s.cands.length);
    else {
      this.countNum.dataset.n = String(s.cands.length);
      this.countNum.textContent = s.cands.length.toLocaleString('en-US');
    }
    this.examples.replaceChildren(
      ...sample(s.cands, 20).map((i) => h('span', { class: 'ex' }, s.ctx.answers[i])),
      ...(s.cands.length > 20 ? [h('span', { class: 'ex more' }, `+${(s.cands.length - 20).toLocaleString('en-US')}`)] : []),
    );

    this.submit.disabled = s.status !== 'feedback';
    this.submit.textContent = s.status === 'thinking' ? 'bot is thinking…' : s.status === 'done' ? 'game over' : 'submit feedback';
    this.legend.textContent =
      s.status === 'done'
        ? perfect(s)
          ? 'twelve rounds. the bot is filing a complaint.'
          : `got it: ${s.rounds.at(-1)!.guess.toUpperCase()}`
        : 'tap tiles to set feedback: ○ → ◐ → ●';

    if (forced) {
      haptic('warn');
      await this.board.bounce(s.rounds.length - 1);
    } else if (anim && s.status === 'done' && prev?.status !== 'done') {
      haptic(perfect(s) ? 'success' : 'warn');
      if (solved(s)) await this.board.bounce(s.rounds.length - 1);
    }
  }

  destroy() {
    this.offKeys();
    this.offSettings();
  }
}

/** Evenly spaced, alphabetical, deterministic: no flicker between renders. */
function sample(cands: number[], n: number): number[] {
  if (cands.length <= n) return cands;
  const step = cands.length / n;
  return Array.from({ length: n }, (_, k) => cands[Math.floor(k * step)]);
}

const views = new WeakMap<HTMLElement, ReverseView>();

const reverse: Variant<ReverseState, ReverseAction> = {
  id: 'reverse',
  name: 'Reverse',
  tagline: 'The bot is solving. You give the feedback. Lie, but stay consistent.',
  rulesHtml: `
    <p>Roles swapped: <b>the bot guesses</b>, you score it. Tap each tile to cycle its colour:</p>
    <ul class="legend">
      <li><span class="mini" data-k="B">A</span> → <span class="mini" data-k="Y">A</span> → <span class="mini" data-k="G">A</span></li>
    </ul>
    <p>There's no secret word. Lie as much as you like, but every answer you give must still fit
    <b>at least one real word</b>. Paint yourself into a corner and it won't let you submit.</p>
    <p>The bot plays minimax: it assumes you're a menace. When only one word is left and it guesses it,
    you're forced to give all green. Keep it guessing as long as you can. Survive <b>12</b> rounds for a perfect game.</p>
    <p class="muted">Desktop: keys <b>1–5</b> cycle tiles, <b>Enter</b> submits.</p>`,

  async init(day, seed) {
    const [lists, openers] = await Promise.all([loadLists(), loadOpeners()]);
    return initialState(ctxFor(lists), openers, day, seed);
  },
  reduce,
  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) views.set(root, (v = new ReverseView(root, dispatch)));
    return v.update(s, ctx.live);
  },
  effects(s, dispatch) {
    if (s.status !== 'thinking') return;
    const key = `${s.day}:${s.rounds.length}`;
    if (inflight === key) return;
    inflight = key;
    const t0 = performance.now();
    solve(s).then(async (guess) => {
      // a beat of "thinking" even when the solver is instant; it reads better
      await sleep(Math.max(0, motionMs(650) - (performance.now() - t0)));
      if (inflight !== key) return;
      inflight = null;
      dispatch({ t: 'bot', guess });
    });
  },
  isOver: (s) => s.status === 'done',
  result: (s) => ({
    won: true,
    score: s.rounds.length,
    label: perfect(s) ? '12 🏆' : `${s.rounds.length} rounds`,
  }),
  buckets: ['≤3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  bucketOf: (s) => (s.rounds.length <= 3 ? '≤3' : String(s.rounds.length)),
  summary(s) {
    if (perfect(s)) return { title: 'Unbeatable.', detail: 'Twelve rounds and the bot still has no idea.' };
    const n = s.rounds.length;
    return {
      title: n >= 8 ? 'Menace.' : n >= 6 ? 'Slippery.' : n >= 4 ? 'Not bad.' : 'Caught out.',
      detail: `You kept the bot guessing for ${n} round${n === 1 ? '' : 's'}. It landed on ${s.rounds.at(-1)!.guess.toUpperCase()}.`,
    };
  },
  shareText(s, day) {
    const n = s.rounds.length;
    const head = perfect(s)
      ? `Reverse #${day}: survived all ${MAX_ROUNDS} rounds, the bot gave up 🏆`
      : `Reverse #${day}: kept the bot guessing for ${n} round${n === 1 ? '' : 's'} 🤖`;
    const lines = s.rounds.map((r) => {
      const e = r.marks.map((m) => EMOJI[m]).join('');
      return r.marks.every((m) => m === 'G') ? e : `${e}  ${r.before}→${r.after}`;
    });
    return [head, ...lines].join('\n');
  },
  destroy(root) {
    views.get(root)?.destroy();
    views.delete(root);
    inflight = null;
  },
};

export default reverse;
