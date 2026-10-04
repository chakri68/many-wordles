// One engine, two games. Missing and Define are the same loop: a clue list
// ordered vague -> specific, one more clue per miss, six misses and you're out.
import type { ClueItem, PoolId } from '../../content/types';
import { CLUE_COUNT, BLANK } from '../../content/validate';
import { loadPool, poolReady } from '../../engine/content';
import { pickIndex } from '../../engine/words';
import { loadVocab } from '../../engine/semantic';
import { haptic } from '../../engine/haptics';
import type { Variant, Flash } from '../types';
import { h, animate, sleep, motionMs } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { WordInput } from '../../ui/word-input';

export interface ClueState {
  day: number;
  item: ClueItem;
  vocab: Set<string>;
  /** wrong guesses in order; '' = skipped */
  misses: string[];
  status: 'playing' | 'won' | 'lost';
  flash?: Flash;
}

export type ClueAction = { t: 'guess'; word: string } | { t: 'skip' };

const flash = (s: ClueState, text: string, kind: Flash['kind'] = 'error'): ClueState => ({
  ...s,
  flash: { id: (s.flash?.id ?? 0) + 1, text, kind },
});

export function reduceClue(s: ClueState, a: ClueAction): ClueState {
  if (s.status !== 'playing') return s;
  let misses: string[];
  if (a.t === 'skip') misses = [...s.misses, ''];
  else {
    const word = a.word.trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) return flash(s, 'Letters only');
    if (word === s.item.answer) return { ...s, status: 'won' };
    if (!s.vocab.has(word)) return flash(s, `${word.toUpperCase()} isn't in my vocabulary`);
    if (s.misses.includes(word)) return flash(s, `Already tried ${word.toUpperCase()}`, 'info');
    misses = [...s.misses, word];
  }
  return { ...s, misses, status: misses.length >= CLUE_COUNT ? 'lost' : 'playing' };
}

/** clues on screen: one per miss, plus the first; everything once it's over */
export const shown = (s: ClueState) => (s.status === 'playing' ? Math.min(s.misses.length + 1, CLUE_COUNT) : CLUE_COUNT);
export const cluesUsed = (s: ClueState) => s.misses.length + 1;

export function shareRow(s: ClueState): string {
  return Array.from({ length: CLUE_COUNT }, (_, k) =>
    k < s.misses.length ? '⬛' : k === s.misses.length && s.status === 'won' ? '🟩' : '▫️',
  ).join('');
}

// ---- view -----------------------------------------------------------------

/** "___" -> a slot with one cell per letter; filled once the game is over. */
function blankSlot(answer: string, reveal: 'none' | 'won' | 'lost') {
  return h(
    'span',
    { class: `slot ${reveal}`, 'aria-label': reveal === 'none' ? `${answer.length}-letter blank` : answer },
    ...[...answer].map((ch) => h('i', {}, reveal === 'none' ? '' : ch)),
  );
}

interface Cfg {
  id: string;
  pool: Exclude<PoolId, 'events'>;
  name: string;
  tagline: string;
  rulesHtml: string;
  /** how each clue reads: inline sentence with a blank, or a definition line */
  style: 'sentence' | 'definition';
  placeholder: string;
}

class ClueView {
  s!: ClueState;
  cards: HTMLElement[] = [];
  list: HTMLElement;
  head: HTMLElement;
  missRow: HTMLElement;
  leftEl: HTMLElement;
  clueEl: HTMLElement;
  input: WordInput;
  skipBtn: HTMLButtonElement;
  flashId = 0;
  first = true;
  revealed = 0;
  missCount = 0;
  ended = false;
  cfg: Cfg;

  constructor(root: HTMLElement, cfg: Cfg, dispatch: (a: ClueAction) => void) {
    this.cfg = cfg;
    this.leftEl = h('b', {}, '6');
    this.clueEl = h('b', {}, '1');
    this.head = h('div', { class: 'clue-head' });
    this.missRow = h('div', { class: 'miss-row', 'aria-label': 'Wrong guesses' });
    this.list = h('ol', { class: `clue-list ${cfg.style}` });
    this.input = new WordInput((w) => dispatch({ t: 'guess', word: w }), { placeholder: cfg.placeholder, label: 'guess' });
    this.skipBtn = h('button', { class: 'btn ghost', type: 'button', 'data-haptic': 'tick' }, 'skip → next clue');
    this.skipBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.skipBtn.addEventListener('click', () => dispatch({ t: 'skip' }));
    this.input.extras.append(this.skipBtn);
    root.append(
      h(
        'div',
        { class: 'sem-top' },
        h('div', { class: 'sem-stats' }, h('span', {}, 'clue ', this.clueEl, ' of 6'), h('span', {}, 'misses left ', this.leftEl)),
      ),
      h('div', { class: 'clue-wrap' }, this.head, this.list, this.missRow),
      this.input.el,
    );
  }

  reveal(s: ClueState): 'none' | 'won' | 'lost' {
    return s.status === 'won' ? 'won' : s.status === 'lost' ? 'lost' : 'none';
  }

  card(s: ClueState, k: number) {
    const text = s.item.clues[k];
    const body =
      this.cfg.style === 'sentence'
        ? text.split(BLANK).flatMap((part, i) => (i ? [blankSlot(s.item.answer, this.reveal(s)), part] : [part]))
        : [text];
    return h(
      'li',
      { class: 'collapse' },
      h('div', { class: 'collapse-inner' }, h('div', { class: 'clue' }, h('span', { class: 'clue-n' }, String(k + 1)), h('p', {}, ...body))),
    );
  }

  update(s: ClueState, live: boolean) {
    this.s = s;
    const anim = live && !this.first;
    const first = this.first;
    this.first = false;

    if (s.flash && s.flash.id !== this.flashId) {
      if (anim) {
        toast(s.flash.text, { kind: s.flash.kind });
        if (s.flash.kind === 'error') this.input.reject();
      }
      this.flashId = s.flash.id;
    }

    // the answer's shape, up top (Define has no sentence to hold it)
    if (first || s.status !== 'playing') {
      this.head.replaceChildren(
        this.cfg.style === 'definition'
          ? h('div', { class: 'define-word' }, blankSlot(s.item.answer, this.reveal(s)), h('span', { class: 'muted' }, `${s.item.answer.length} letters`))
          : h('p', { class: 'muted clue-hint' }, `the missing word has ${s.item.answer.length} letters`),
      );
    }

    // rebuild cards once the game ends so blanks fill in
    const ending = s.status !== 'playing' && !this.ended;
    if (ending) {
      this.ended = true;
      this.cards = [];
      this.list.replaceChildren();
      this.revealed = 0;
    }
    const want = shown(s);
    while (this.cards.length < want) {
      const k = this.cards.length;
      const c = this.card(s, k);
      this.cards.push(c);
      this.list.append(c);
      const open = () => c.classList.add('open');
      if (anim || ending) {
        // let the browser paint the closed state, then open: grid-rows animates height
        const delay = ending && k >= this.revealed ? (k - Math.min(k, s.misses.length)) * 90 : 0;
        requestAnimationFrame(() => setTimeout(open, motionMs(delay)));
      } else open();
    }
    this.revealed = Math.max(this.revealed, want);
    if (anim && !ending) this.cards.at(-1)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    this.missRow.replaceChildren(
      ...s.misses.map((m) => h('span', { class: `chip miss ${m ? '' : 'skipped'}` }, m ? m.toUpperCase() : 'skipped')),
    );
    if (anim && s.misses.length) {
      const last = this.missRow.lastElementChild;
      if (last && !ending) animate(last, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
    }

    this.clueEl.textContent = String(shown(s));
    this.leftEl.textContent = String(Math.max(0, CLUE_COUNT - s.misses.length));
    const over = s.status !== 'playing';
    this.input.setDisabled(over);
    this.skipBtn.disabled = over;
    if (anim && s.misses.length > this.missCount) this.input.clear();
    this.missCount = s.misses.length;
    if (anim && ending) this.celebrate(s.status === 'won');
  }

  async celebrate(won: boolean) {
    haptic(won ? 'success' : 'warn');
    await sleep(motionMs(60));
    const cells = this.list.querySelectorAll('.slot i');
    cells.forEach((c, i) =>
      animate(c, [{ transform: 'rotateX(90deg)' }, { transform: 'none' }], { duration: 260, delay: (i % 12) * 50, easing: 'ease-out', fill: 'backwards' }),
    );
  }
}

export function makeClueVariant(cfg: Cfg): Variant<ClueState, ClueAction> & { available: () => boolean } {
  const views = new WeakMap<HTMLElement, ClueView>();
  return {
    id: cfg.id,
    name: cfg.name,
    tagline: cfg.tagline,
    rulesHtml: cfg.rulesHtml,
    available: () => poolReady(cfg.pool),
    async init(day) {
      const [pool, vocab] = await Promise.all([loadPool<ClueItem>(cfg.pool, day), loadVocab()]);
      const item = pool[pickIndex(pool.length, cfg.id, day)];
      return { day, item, vocab, misses: [], status: 'playing' };
    },
    reduce: reduceClue,
    render(root, s, dispatch, ctx) {
      let v = views.get(root);
      if (!v) views.set(root, (v = new ClueView(root, cfg, dispatch)));
      v.update(s, ctx.live);
    },
    isOver: (s) => s.status !== 'playing',
    result: (s) => ({ won: s.status === 'won', score: cluesUsed(s), label: s.status === 'won' ? `${cluesUsed(s)}/6` : 'X/6' }),
    buckets: ['1', '2', '3', '4', '5', '6', 'X'],
    bucketOf: (s) => (s.status === 'won' ? String(cluesUsed(s)) : 'X'),
    summary(s) {
      const w = s.item.answer.toUpperCase();
      if (s.status === 'won') {
        const n = cluesUsed(s);
        return { title: n === 1 ? 'First clue!' : n <= 3 ? 'Sharp.' : n <= 5 ? 'Got it.' : 'Last gasp.', detail: `${w} with ${n} of 6 clues.` };
      }
      return { title: 'Stumped.', detail: `It was ${w}.` };
    },
    shareText(s, day) {
      return `${cfg.name} #${day} ${s.status === 'won' ? cluesUsed(s) : 'X'}/6\n${shareRow(s)}`;
    },
  };
}
