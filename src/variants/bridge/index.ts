import { dot, linked, loadSemantic, neighbours, type Ranking, type Sem } from '../../engine/semantic';
import type { Variant, Flash } from '../types';
import { bridgePuzzle, ranking } from '../semantic/client';
import { h, flip, animate, sleep, motionMs } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { haptic } from '../../engine/haptics';
import { WordInput, confirmButton, heat, fmt, block } from '../../ui/word-input';

const linkWord = (x: number) => (x >= 0.66 ? 'strong link' : x >= 0.33 ? 'solid link' : 'just close enough');

export const MAX_CHAIN = 10;

export interface BridgeState {
  day: number;
  sem: Sem;
  start: number;
  end: number;
  /** the bot's shortest path (endpoints included) */
  par: number[];
  /** closeness of every word to the END word, as guidance */
  toEnd: Ranking;
  chain: number[];
  /** chain words that came from the hint button */
  hinted: number[];
  status: 'playing' | 'won' | 'gaveup';
  flash?: Flash;
}

export type BridgeAction = { t: 'add'; word: string } | { t: 'undo' } | { t: 'hint' } | { t: 'giveup' };

const flash = (s: BridgeState, text: string, kind: Flash['kind'] = 'error'): BridgeState => ({
  ...s,
  flash: { id: (s.flash?.id ?? 0) + 1, text, kind },
});

export const prevOf = (s: BridgeState) => s.chain.at(-1) ?? s.start;
export const hops = (s: BridgeState) => s.chain.length + 1;
export const parHops = (s: BridgeState) => s.par.length - 1;
const W = (s: BridgeState, i: number) => s.sem.vocab[i].toUpperCase();

export function reduce(s: BridgeState, a: BridgeAction): BridgeState {
  if (s.status !== 'playing') return s;
  switch (a.t) {
    case 'add': {
      const word = a.word.trim().toLowerCase();
      const w = s.sem.index.get(word);
      if (w == null) return flash(s, /^[a-z]+$/.test(word) ? `${word.toUpperCase()} isn't in my vocabulary` : 'Letters only');
      const prev = prevOf(s);
      if (w === s.start) return flash(s, "That's where you started");
      if (s.chain.includes(w)) return flash(s, 'Already in your chain');
      if (!linked(s.sem, prev, w)) return flash(s, miss(s, prev, w));
      if (w === s.end) return { ...s, status: 'won' };
      if (s.chain.length >= MAX_CHAIN) return flash(s, 'Chain is full. Undo a link');
      const chain = [...s.chain, w];
      return { ...s, chain, status: linked(s.sem, w, s.end) ? 'won' : 'playing' };
    }
    case 'hint': {
      if (s.chain.length >= MAX_CHAIN) return flash(s, 'Chain is full. Undo a link');
      const w = suggest(s);
      if (w == null) return flash(s, `Nothing links onward from ${W(s, prevOf(s))}. Try undo`, 'info');
      const chain = [...s.chain, w];
      return { ...s, chain, hinted: [...s.hinted, w], status: linked(s.sem, w, s.end) ? 'won' : 'playing' };
    }
    case 'undo': {
      if (!s.chain.length) return s;
      const gone = s.chain.at(-1)!;
      return { ...s, chain: s.chain.slice(0, -1), hinted: s.hinted.filter((w) => w !== gone) };
    }
    case 'giveup':
      return { ...s, status: 'gaveup' };
  }
}

/** Rejections say HOW far, so a miss teaches you what "close" means here. */
function miss(s: BridgeState, prev: number, w: number): string {
  const c = dot(s.sem, prev, w) / s.sem.bridge; // 1.0 would have linked
  const a = W(s, w);
  const b = W(s, prev);
  if (c >= 0.8) return `${a} is close to ${b}, but not quite`;
  if (c >= 0.5) return `${a} is a stretch from ${b}`;
  return `${a} is nowhere near ${b}`;
}

/**
 * Hint: of the common words that link from the current one, the one ranked
 * closest to END. Greedy, cheap (one scan), deterministic.
 */
export function suggest(s: BridgeState): number | null {
  const prev = prevOf(s);
  let best: number | null = null;
  for (const j of neighbours(s.sem, prev)) {
    if (j === s.start || s.chain.includes(j)) continue;
    if (best == null || s.toEnd.rank[j] < s.toEnd.rank[best]) best = j;
  }
  return best;
}

/** 0..1 link strength above the threshold, for meters and share blocks */
export function strength(s: BridgeState, a: number, b: number) {
  const top = s.sem.scale2 * 0.92;
  return Math.max(0, Math.min(1, (dot(s.sem, a, b) - s.sem.bridge) / (top - s.sem.bridge)));
}

/** every link in the finished chain, END included */
export function links(s: BridgeState): [number, number][] {
  const nodes = [s.start, ...s.chain, ...(s.status === 'won' ? [s.end] : [])];
  return nodes.slice(1).map((n, i) => [nodes[i], n]);
}

// ---- view -----------------------------------------------------------------

class BridgeView {
  s!: BridgeState;
  chainEl: HTMLElement;
  startNode: HTMLElement;
  endNode: HTMLElement;
  endLink: HTMLElement;
  ghost: HTMLElement;
  nodes = new Map<number, HTMLElement>();
  hopsEl: HTMLElement;
  legend!: HTMLElement;
  parEl: HTMLElement;
  input: WordInput;
  undoBtn: HTMLButtonElement;
  hintBtn: HTMLButtonElement;
  flashId = 0;
  first = true;
  dispatch: (a: BridgeAction) => void;

  constructor(root: HTMLElement, dispatch: (a: BridgeAction) => void) {
    this.dispatch = dispatch;
    this.hopsEl = h('b', {}, '0');
    this.parEl = h('b', {}, '?');
    this.startNode = h('div', { class: 'bnode end-cap start' });
    this.endNode = h('div', { class: 'bnode end-cap finish' });
    this.endLink = h('div', { class: 'bline pending' });
    this.ghost = h('div', { class: 'bnode ghost', 'aria-hidden': 'true' }, '?');
    this.chainEl = h('div', { class: 'bchain', role: 'list' });
    this.input = new WordInput((w) => dispatch({ t: 'add', word: w }), {
      placeholder: 'next link',
      label: 'link',
      words: () => this.s?.sem.vocab,
    });
    this.hintBtn = h('button', { class: 'btn ghost', type: 'button', 'data-haptic': 'tick' }, 'hint');
    this.hintBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.hintBtn.addEventListener('click', () => dispatch({ t: 'hint' }));
    this.undoBtn = h('button', { class: 'btn ghost', type: 'button', 'data-haptic': 'tick' }, 'undo');
    this.undoBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.undoBtn.addEventListener('click', () => dispatch({ t: 'undo' }));
    this.input.extras.append(this.undoBtn, this.hintBtn, confirmButton('give up', 'tap again to give up', () => dispatch({ t: 'giveup' })));
    root.append(
      h(
        'div',
        { class: 'sem-top' },
        h('div', { class: 'sem-stats' }, h('span', {}, 'hops ', this.hopsEl), h('span', {}, 'par ', this.parEl)),
        (this.legend = h('p', { class: 'sem-legend' })),
      ),
      h('div', { class: 'bchain-wrap' }, this.chainEl),
      this.input.el,
    );
  }

  meter(a: number, b: number) {
    const x = strength(this.s, a, b);
    return h(
      'div',
      { class: 'bline', role: 'presentation' },
      h(
        'span',
        { class: 'meter', 'aria-label': linkWord(x) },
        h('span', { class: 'segs', 'aria-hidden': 'true' }, ...[0, 1, 2, 3, 4].map((k) => h('i', { class: x * 5 > k ? 'on' : '' }))),
        h('span', { class: 'mlabel' }, linkWord(x)),
      ),
    );
  }

  node(w: number, last: boolean) {
    const s = this.s;
    const r = s.toEnd.rank[w];
    const el = h(
      'div',
      { class: `bnode word ${heat(r)}`, role: 'listitem', 'data-w': String(w) },
      h('span', { class: 'bw' }, s.sem.vocab[w], s.hinted.includes(w) ? h('span', { class: 'chip tag' }, 'hint') : null),
      h('span', { class: 'br', title: `rank by closeness to ${W(s, s.end)}; 1 is closest` }, `#${fmt(r)}`),
    );
    if (last) el.classList.add('last');
    return el;
  }

  update(s: BridgeState, live: boolean) {
    const prev = this.s;
    this.s = s;
    const anim = live && !this.first;
    this.first = false;

    if (s.flash && s.flash.id !== this.flashId) {
      if (anim) {
        toast(s.flash.text, { kind: s.flash.kind, ms: 2000 });
        this.input.reject();
      }
      this.flashId = s.flash.id;
    }

    this.startNode.replaceChildren(h('span', { class: 'cap' }, 'start'), h('span', { class: 'bw' }, s.sem.vocab[s.start]));
    this.endNode.replaceChildren(h('span', { class: 'cap' }, 'end'), h('span', { class: 'bw' }, s.sem.vocab[s.end]));

    // build the sequence: start, (link, word)*, [link, ghost], link, end
    const seq: HTMLElement[] = [this.startNode];
    const keep = new Map<number, HTMLElement>();
    let p = s.start;
    s.chain.forEach((w, i) => {
      const el = this.nodes.get(w) ?? this.node(w, false);
      el.classList.toggle('last', i === s.chain.length - 1 && s.status === 'playing');
      keep.set(w, el);
      const link = (el as HTMLElement & { _link?: HTMLElement })._link ?? this.meter(p, w);
      (el as HTMLElement & { _link?: HTMLElement })._link = link;
      seq.push(link, el);
      p = w;
    });
    const fresh = s.chain.filter((w) => !this.nodes.has(w));
    const removed = [...this.nodes.keys()].filter((w) => !keep.has(w));
    this.nodes = keep;

    const won = s.status === 'won';
    if (s.status === 'playing') seq.push(h('div', { class: 'bline pending' }), this.ghost);
    if (won) {
      this.endLink.className = 'bline';
      this.endLink.replaceChildren(this.meter(p, s.end).firstChild!);
    } else {
      this.endLink.className = 'bline pending';
      this.endLink.replaceChildren();
    }
    seq.push(this.endLink, this.endNode);

    const persistent = [this.endNode, this.ghost, this.endLink, ...keep.values()];
    flip(persistent, () => this.chainEl.replaceChildren(...seq), 300);

    if (anim) {
      for (const w of fresh) {
        const el = keep.get(w)!;
        animate(el, [{ opacity: 0, transform: 'scale(.92) translateY(8px)' }, { opacity: 1, transform: 'none' }], {
          duration: 300,
          easing: 'cubic-bezier(.2,.9,.2,1)',
        });
        const link = (el as HTMLElement & { _link?: HTMLElement })._link!;
        animate(link, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], {
          duration: 260,
          easing: 'ease-out',
        });
      }
      if (removed.length) haptic('tick');
      if (fresh.length) this.ghost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    this.hopsEl.textContent = String(s.status === 'won' ? hops(s) : s.chain.length);
    this.parEl.replaceChildren(...(s.status === 'playing' ? ['?', h('small', {}, ' revealed at the end')] : [String(parHops(s))]));
    this.legend.replaceChildren(
      'each word must be close in meaning to the one above it. ',
      h('b', {}, '#'),
      ` = how close a word is to ${W(s, s.end)} (1 is closest).`,
    );
    const over = s.status !== 'playing';
    this.input.setDisabled(over);
    this.undoBtn.disabled = over || !s.chain.length;
    this.hintBtn.disabled = over;
    if (anim && fresh.some((w) => !s.hinted.includes(w))) this.input.clear();
    if (anim && over && prev?.status === 'playing') this.celebrate(won);
  }

  async celebrate(won: boolean) {
    haptic(won ? 'success' : 'warn');
    if (!won) return;
    const all = [this.startNode, ...this.nodes.values(), this.endNode];
    for (const el of all) {
      animate(el, [{ boxShadow: '0 0 0 0 var(--glow)' }, { boxShadow: '0 0 18px 2px var(--glow-soft)' }, { boxShadow: '0 0 0 0 transparent' }], {
        duration: 520,
      });
      await sleep(motionMs(90));
    }
  }
}

const views = new WeakMap<HTMLElement, BridgeView>();

const bridge: Variant<BridgeState, BridgeAction> = {
  id: 'bridge',
  name: 'Bridge',
  tagline: 'Get from one word to another in as few close hops as you can.',
  rulesHtml: `
    <p>You get a <b>start</b> and an <b>end</b> word. Build a chain between them where every
    word is <b>close in meaning</b> to the one before it.</p>
    <p class="muted" style="font-size:13px">TREE → PINE → FOREST → … → SPACE</p>
    <p>A word that's too far from the previous link gets bounced. As soon as your latest word is
    close enough to the end, the bridge completes.</p>
    <p>"Close" means the words show up in similar contexts: <b>flee</b> links to <b>escape</b>, not <b>thief</b>.
    A rejected word tells you how far off it was. Stuck? <b>Hint</b> adds a link for you (it's counted).</p>
    <p>Each word shows its rank <b>to the end word</b>: watch it drop as you get closer.
    Fewer hops is better; par is the shortest bridge the bot could find.</p>`,

  async init(day, seed) {
    const sem = await loadSemantic();
    const p = await bridgePuzzle(sem, seed);
    const toEnd = await ranking(sem, p.end);
    return { day, sem, start: p.start, end: p.end, par: p.path, toEnd, chain: [], hinted: [], status: 'playing' };
  },
  reduce,
  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) views.set(root, (v = new BridgeView(root, dispatch)));
    v.update(s, ctx.live);
  },
  isOver: (s) => s.status !== 'playing',
  result: (s) => ({
    won: s.status === 'won',
    score: hops(s),
    label: s.status === 'won' ? `${hops(s)} hops` : 'gave up',
  }),
  buckets: ['≤par', '+1', '+2', '+3', '+4+', 'X'],
  bucketOf(s) {
    if (s.status !== 'won') return 'X';
    const d = hops(s) - parHops(s);
    return d <= 0 ? '≤par' : d >= 4 ? '+4+' : `+${d}`;
  },
  summary(s) {
    const route = `${W(s, s.start)} → ${W(s, s.end)}`;
    if (s.status !== 'won') return { title: 'Bridge out.', detail: `${route}. The bot's route is below.` };
    const d = hops(s) - parHops(s);
    return {
      title: d < 0 ? 'Shortcut!' : d === 0 ? 'Par. Clean.' : d === 1 ? 'Close.' : 'Made it.',
      detail: `${route} in ${hops(s)} hops (par ${parHops(s)}).`,
    };
  },
  endExtra(s) {
    const row = (label: string, words: number[]) =>
      h('div', { class: 'route' }, h('span', { class: 'route-k' }, label), h('span', {}, words.map((w) => W(s, w)).join(' → ')));
    return h(
      'div',
      {},
      h('h4', { class: 'section-h' }, 'routes'),
      s.status === 'won' ? row('you', [s.start, ...s.chain, s.end]) : null,
      row('bot', s.par),
    );
  },
  shareText(s, day) {
    const route = `${W(s, s.start)} → ${W(s, s.end)}`;
    if (s.status !== 'won') return `Bridge #${day} · ${route} · gave up after ${s.chain.length} links`;
    const blocks = links(s).map(([a, b]) => block(strength(s, a, b))).join('');
    const n = s.hinted.length;
    const hints = n ? ` · ${n} hint${n > 1 ? 's' : ''}` : '';
    return `Bridge #${day} · ${route} in ${hops(s)} hops (par ${parHops(s)})${hints}\n${blocks}`;
  },
};

export default bridge;
