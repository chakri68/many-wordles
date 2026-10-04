import { loadSemantic, type Ranking, type Sem } from '../../engine/semantic';
import { pickFromPool } from '../../engine/words';
import type { Variant, Flash } from '../types';
import { ranking } from '../semantic/client';
import { h, flip, animate, tweenNumber } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { haptic } from '../../engine/haptics';
import { WordInput, confirmButton, closeness, heat, temperature, fmt, block } from '../../ui/word-input';
import { pathPlot } from './plot';

const NO_DENY = new Set<string>();

export interface Guess {
  w: number; // vocab index
  rank: number;
  hint?: boolean;
}

export interface WarmerState {
  day: number;
  sem: Sem;
  answer: number;
  r: Ranking;
  guesses: Guess[];
  /** the word to highlight (latest, or a repeat) */
  focus: number | null;
  status: 'playing' | 'won' | 'gaveup';
  flash?: Flash;
}

export type WarmerAction = { t: 'guess'; word: string } | { t: 'hint' } | { t: 'giveup' };

const flash = (s: WarmerState, text: string, kind: Flash['kind'] = 'error', focus = s.focus): WarmerState => ({
  ...s,
  focus,
  flash: { id: (s.flash?.id ?? 0) + 1, text, kind },
});

export const best = (s: WarmerState) => s.guesses.reduce((m, g) => Math.min(m, g.rank), Infinity);

export function reduce(s: WarmerState, a: WarmerAction): WarmerState {
  if (s.status !== 'playing') return s;
  switch (a.t) {
    case 'guess': {
      const word = a.word.trim().toLowerCase();
      const w = s.sem.index.get(word);
      if (w == null) return flash(s, /^[a-z]+$/.test(word) ? `${word.toUpperCase()} isn't in my vocabulary` : 'Letters only');
      const prev = s.guesses.find((g) => g.w === w);
      if (prev) return flash(s, `Already guessed: #${fmt(prev.rank)}`, 'info', w);
      const g = { w, rank: s.r.rank[w] };
      return { ...s, guesses: [...s.guesses, g], focus: w, status: g.rank === 1 ? 'won' : 'playing' };
    }
    case 'hint': {
      // Contexto-style: halfway between your best and the answer
      const b = Math.min(best(s), s.sem.n);
      if (b <= 2) return flash(s, 'No hints left. You’re right next to it', 'info');
      const taken = new Set(s.guesses.map((g) => g.w));
      let r = Math.max(2, Math.floor(b / 2));
      while (r > 1 && taken.has(s.r.order[r - 1])) r--;
      if (r <= 1) return flash(s, 'No hints left', 'info');
      const w = s.r.order[r - 1];
      return { ...s, guesses: [...s.guesses, { w, rank: r, hint: true }], focus: w };
    }
    case 'giveup':
      return { ...s, status: 'gaveup', focus: s.answer };
  }
}

// ---- view -----------------------------------------------------------------

class WarmerView {
  s!: WarmerState;
  rows = new Map<number, HTMLElement>();
  list: HTMLElement;
  lastCard: HTMLElement;
  lastWord: HTMLElement;
  lastRank: HTMLElement;
  lastBar: HTMLElement;
  lastTemp: HTMLElement;
  intro: HTMLElement;
  listHead: HTMLElement;
  countEl: HTMLElement;
  bestEl: HTMLElement;
  input: WordInput;
  hintBtn: HTMLButtonElement;
  flashId = 0;
  first = true;

  constructor(root: HTMLElement, dispatch: (a: WarmerAction) => void) {
    this.countEl = h('b', {}, '0');
    this.bestEl = h('b', {}, '–');
    this.lastWord = h('span', { class: 'lw' }, '');
    this.lastRank = h('span', { class: 'lr' });
    this.lastBar = h('i');
    this.lastTemp = h('span', { class: 'temp' });
    this.lastCard = h(
      'div',
      { class: 'wlast empty' },
      h('span', { class: 'cap' }, 'latest guess'),
      h('div', { class: 'wlast-row' }, this.lastWord, this.lastRank),
      h('span', { class: 'heatbar', 'aria-hidden': 'true' }, this.lastBar),
      h('div', { class: 'wlast-foot' }, this.lastTemp, h('span', {}, 'closer in meaning →')),
    );
    this.intro = h(
      'div',
      { class: 'wintro' },
      h('p', {}, 'Guess any word. You\u2019ll see its rank out of the whole dictionary, by how close it is in ', h('b', {}, 'meaning'), '.'),
      h('p', { class: 'muted' }, '#1 is the secret word. Smaller number = warmer.'),
    );
    this.listHead = h('div', { class: 'wlist-head' }, h('span', {}, 'your guesses, closest first'), h('span', {}, 'rank'));
    this.list = h('div', { class: 'wlist', role: 'list', 'aria-label': 'Guesses, closest first' });
    this.input = new WordInput((w) => dispatch({ t: 'guess', word: w }), { placeholder: 'type any word', label: 'guess' });
    this.hintBtn = h('button', { class: 'btn ghost', type: 'button', 'data-haptic': 'tick' }, 'hint');
    this.hintBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.hintBtn.addEventListener('click', () => dispatch({ t: 'hint' }));
    this.input.extras.append(this.hintBtn, confirmButton('give up', 'tap again to give up', () => dispatch({ t: 'giveup' })));
    root.append(
      h(
        'div',
        { class: 'sem-top' },
        h('div', { class: 'sem-stats' }, h('span', {}, 'guesses ', this.countEl), h('span', {}, 'best ', this.bestEl)),
        this.intro,
        this.lastCard,
      ),
      h('div', { class: 'wlist-wrap' }, this.listHead, this.list),
      this.input.el,
    );
  }

  row(g: Guess): HTMLElement {
    const s = this.s;
    const word = s.sem.vocab[g.w];
    return h(
      'div',
      { class: `wrow ${heat(g.rank)}`, role: 'listitem', 'data-w': String(g.w) },
      h('span', { class: 'ww' }, word, g.hint ? h('span', { class: 'chip tag' }, 'hint') : null),
      h('span', { class: 'heatbar' }, h('i', { style: `--c:${closeness(g.rank, s.sem.n).toFixed(3)}` })),
      h('span', { class: 'wr' }, g.rank === 1 ? '★' : `#${fmt(g.rank)}`),
    );
  }

  update(s: WarmerState, live: boolean) {
    const prev = this.s;
    this.s = s;
    const anim = live && !this.first;
    this.first = false;

    if (s.flash && s.flash.id !== this.flashId) {
      if (anim) {
        toast(s.flash.text, { kind: s.flash.kind });
        if (s.flash.kind === 'error') this.input.reject();
      }
      this.flashId = s.flash.id;
    }

    // revealed answer on give-up joins the list
    const all: Guess[] = [...s.guesses];
    if (s.status === 'gaveup' && !all.some((g) => g.w === s.answer)) all.push({ w: s.answer, rank: 1 });

    const sorted = [...all].sort((a, b) => a.rank - b.rank);
    const fresh = all.filter((g) => !this.rows.has(g.w));
    const existing = [...this.rows.values()];
    flip(
      existing,
      () => {
        for (const g of fresh) this.rows.set(g.w, this.row(g));
        this.list.replaceChildren(...sorted.map((g) => this.rows.get(g.w)!));
      },
      280,
    );
    if (anim)
      for (const g of fresh)
        animate(
          this.rows.get(g.w)!,
          [
            { opacity: 0, transform: 'translateX(-10px)', background: 'var(--y-fill)' },
            { opacity: 1, transform: 'none', background: 'transparent' },
          ],
          { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );

    for (const [w, el] of this.rows) el.classList.toggle('focus', w === s.focus);
    if (s.focus != null) this.rows.get(s.focus)?.scrollIntoView({ block: 'nearest', behavior: anim ? 'smooth' : 'auto' });

    // latest-guess card
    const focusG = all.find((g) => g.w === s.focus);
    if (focusG && (!prev || prev.focus !== s.focus || !anim)) {
      this.lastCard.classList.remove('empty');
      this.lastCard.className = `wlast ${heat(focusG.rank)}`;
      this.lastWord.textContent = s.sem.vocab[focusG.w];
      this.lastRank.replaceChildren(
        focusG.rank === 1 ? 'got it ★' : `#${fmt(focusG.rank)}`,
        focusG.rank === 1 ? '' : h('small', {}, ` of ${fmt(s.sem.n)}`),
      );
      this.lastTemp.textContent = temperature(focusG.rank);
      this.lastBar.style.setProperty('--c', closeness(focusG.rank, s.sem.n).toFixed(3));
      if (anim)
        animate(this.lastCard, [{ transform: 'scale(.97)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], {
          duration: 260,
          easing: 'cubic-bezier(.2,.9,.2,1)',
        });
    }

    const any = all.length > 0;
    this.intro.hidden = any;
    this.listHead.hidden = !any;

    tweenNumber(this.countEl, s.guesses.length, anim ? 300 : 0);
    const b = best(s);
    this.bestEl.textContent = Number.isFinite(b) ? (b === 1 ? '★' : `#${fmt(b)}`) : '–';

    const over = s.status !== 'playing';
    this.input.setDisabled(over);
    this.hintBtn.disabled = over;
    if (!over && anim && prev && s.guesses.length > prev.guesses.length) this.input.clear();
    if (anim && over && prev?.status === 'playing') {
      haptic(s.status === 'won' ? 'success' : 'warn');
      if (s.status === 'won') {
        const el = this.rows.get(s.answer);
        if (el) animate(el, [{ boxShadow: '0 0 0 0 var(--glow)' }, { boxShadow: '0 0 0 10px transparent' }], { duration: 700 });
      }
    }
  }
}

const views = new WeakMap<HTMLElement, WarmerView>();

function bucketOf(s: WarmerState) {
  if (s.status !== 'won') return 'X';
  const n = s.guesses.length;
  return n <= 10 ? '≤10' : n <= 20 ? '11–20' : n <= 35 ? '21–35' : n <= 60 ? '36–60' : n <= 100 ? '61–100' : '100+';
}

/** Sparkline of warmth per guess, squeezed to ≤ 24 chars (warmest wins each bucket). */
export function pathLine(s: WarmerState): string {
  const c = s.guesses.map((g) => closeness(g.rank, s.sem.n));
  const W = 24;
  if (c.length <= W) return c.map(block).join('');
  return Array.from({ length: W }, (_, k) => {
    const lo = Math.floor((k * c.length) / W);
    const hi = Math.floor(((k + 1) * c.length) / W);
    return block(Math.max(...c.slice(lo, Math.max(hi, lo + 1))));
  }).join('');
}

const warmer: Variant<WarmerState, WarmerAction> = {
  id: 'warmer',
  name: 'Warmer',
  tagline: 'Guess any word. Get told how close it is in meaning.',
  rulesHtml: `
    <p>There's a secret word. Guess <b>any</b> word and you'll see where it ranks among
    all ~30,000 words in the dictionary, sorted by how close they are in <i>meaning</i>.</p>
    <ul class="legend">
      <li><span class="mini" data-k="G">★</span> #1 is the secret word</li>
      <li><span class="mini" data-k="Y">#</span> #2–100: very warm</li>
      <li><span class="mini" data-k="B">#</span> #1,000+: cold</li>
    </ul>
    <p>Closeness comes from how words are used, not how they're spelled.
    <b>ocean</b> is near <b>sea</b>, nowhere near <b>octane</b>.</p>
    <p>Stuck? <b>Hint</b> drops a word halfway between your best guess and the answer.
    Hints count as guesses.</p>`,

  async init(day) {
    const sem = await loadSemantic();
    const answer = sem.index.get(pickFromPool(sem.answers, NO_DENY, 'warmer', day))!;
    const r = await ranking(sem, answer);
    return { day, sem, answer, r, guesses: [], focus: null, status: 'playing' };
  },
  reduce,
  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) views.set(root, (v = new WarmerView(root, dispatch)));
    v.update(s, ctx.live);
  },
  isOver: (s) => s.status !== 'playing',
  result: (s) => ({
    won: s.status === 'won',
    score: s.guesses.length,
    label: s.status === 'won' ? `${s.guesses.length} guesses` : 'gave up',
  }),
  buckets: ['≤10', '11–20', '21–35', '36–60', '61–100', '100+', 'X'],
  bucketOf,
  summary(s) {
    const word = s.sem.vocab[s.answer].toUpperCase();
    const hints = s.guesses.filter((g) => g.hint).length;
    if (s.status === 'won')
      return {
        title: s.guesses.length <= 10 ? 'Mind reader.' : s.guesses.length <= 30 ? 'Warm.' : 'Got there.',
        detail: `${word} in ${s.guesses.length} guesses${hints ? `, ${hints} hint${hints > 1 ? 's' : ''}` : ''}.`,
      };
    const b = best(s);
    return {
      title: 'Cold case.',
      detail: Number.isFinite(b) ? `It was ${word}. Your best was #${fmt(b)}.` : `It was ${word}. No guesses this time.`,
    };
  },
  endExtra(s) {
    const near = Array.from(s.r.order.slice(1, 11), (w) => s.sem.vocab[w]);
    return h(
      'div',
      {},
      s.guesses.length > 1 ? pathPlot(s.guesses, s.sem) : null,
      h('h4', { class: 'section-h' }, `closest to ${s.sem.vocab[s.answer]}`),
      h('div', { class: 'examples' }, ...near.map((w) => h('span', { class: 'ex' }, w))),
    );
  },
  shareText(s, day) {
    const hints = s.guesses.filter((g) => g.hint).length;
    const tail = hints ? ` (${hints} hint${hints > 1 ? 's' : ''})` : '';
    const b = best(s);
    const head =
      s.status === 'won'
        ? `Warmer #${day} · got it in ${s.guesses.length}${tail}`
        : `Warmer #${day} · gave up after ${s.guesses.length}, best #${Number.isFinite(b) ? b : '–'}`;
    return `${head}\n${pathLine(s)}`;
  },
};

export default warmer;
