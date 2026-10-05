// Free-text guess dock for the semantic variants. Sits above the native
// keyboard (viewport uses interactive-widget=resizes-content).
import { haptic } from '../engine/haptics';
import { getSettings, reducedMotion } from '../engine/settings';
import { suggestWords } from '../engine/suggest';
import { animate, flip, h } from './dom';

let uid = 0;
const SPRING = 'cubic-bezier(.2,.8,.2,1)';
const option = (w: string) => h('li', { role: 'option', 'data-word': w, 'aria-selected': 'false' }, w);

export class WordInput {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly extras: HTMLElement;
  private btn: HTMLButtonElement;
  private sugg: HTMLElement;
  /** highlighted suggestion; -1 = none, so Enter guesses what you typed */
  private active = -1;
  /** the fade-out in flight; rows stay in the DOM until it lands */
  private closing: Animation | null = null;

  private onSubmit: (word: string) => void;
  private words?: () => readonly string[] | undefined;

  /** `words`: the list to autocomplete from (frequency-ordered); omit for no suggestions */
  constructor(onSubmit: (word: string) => void, opts: { placeholder: string; label: string; words?: () => readonly string[] | undefined }) {
    this.onSubmit = onSubmit;
    this.words = opts.words;
    const id = `word-sugg-${++uid}`;
    this.input = h('input', {
      class: 'word-field',
      type: 'text',
      placeholder: opts.placeholder,
      autocomplete: 'off',
      autocapitalize: 'characters', // soft keyboard in caps, to match the display
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      maxlength: 20,
      'aria-label': opts.placeholder,
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': id,
    });
    this.sugg = h('ul', { class: 'sugg', id, role: 'listbox' });
    if (opts.words) {
      this.input.addEventListener('input', () => this.suggest());
      this.input.addEventListener('focus', () => this.suggest());
      this.input.addEventListener('blur', () => setTimeout(() => this.closeSugg(), 120));
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      // keep focus (and the soft keyboard) in the field when tapping a suggestion
      this.sugg.addEventListener('mousedown', (e) => e.preventDefault());
      this.sugg.addEventListener('click', (e) => {
        const li = (e.target as Element).closest<HTMLElement>('[data-word]');
        if (li && !this.closing) this.pick(li.dataset.word!);
      });
    }
    this.btn = h('button', { class: 'btn primary', type: 'submit', 'data-haptic': 'press' }, opts.label);
    // keep the soft keyboard up when tapping the button
    this.btn.addEventListener('mousedown', (e) => e.preventDefault());
    const form = h('form', { class: 'word-form' }, this.input, this.btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = this.input.value.trim().toLowerCase();
      if (!w) return;
      this.closeSugg();
      onSubmit(w);
    });
    this.extras = h('div', { class: 'word-extras' });
    this.el = h('div', { class: 'word-dock combo' }, this.sugg, form, this.extras);
    if (matchMedia('(pointer: fine)').matches) queueMicrotask(() => this.input.focus({ preventScroll: true }));
  }

  clear() {
    this.input.value = '';
    this.closeSugg();
  }

  private pick(word: string) {
    haptic('press');
    this.input.value = word;
    this.closeSugg();
    this.onSubmit(word);
  }

  private closeSugg() {
    this.active = -1;
    this.input.setAttribute('aria-expanded', 'false');
    if (!this.sugg.childElementCount || this.closing) return;
    if (reducedMotion()) return this.sugg.replaceChildren();
    const a = this.sugg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }], {
      duration: 140,
      easing: 'ease-in',
      fill: 'forwards',
    });
    this.closing = a;
    a.finished.then(
      () => {
        if (this.closing !== a) return;
        this.closing = null;
        this.sugg.replaceChildren(); // :empty hides it, so dropping the fill can't flash it back
        a.cancel();
      },
      () => {}, // cancelled by a reopen
    );
  }

  /** re-read the setting every keystroke, so flipping it mid-game just works */
  private suggest() {
    const words = getSettings().autoSuggest && !this.input.disabled ? this.words?.() : undefined;
    const hits = words ? suggestWords(words, this.input.value) : [];
    this.active = -1;
    if (!hits.length) return this.closeSugg();
    this.input.setAttribute('aria-expanded', 'true');

    // closed (or on its way out): fresh rows, rise up out of the field
    if (!this.sugg.childElementCount || this.closing) {
      this.closing?.cancel();
      this.closing = null;
      this.sugg.replaceChildren(...hits.map(option));
      if (!reducedMotion())
        this.sugg.animate([{ opacity: 0, transform: 'translateY(8px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
          duration: 200,
          easing: SPRING,
        });
      return;
    }

    // open: keep rows by word so survivors glide, newcomers fade in, the box resizes
    const rows = new Map([...this.sugg.querySelectorAll<HTMLElement>('[data-word]')].map((li) => [li.dataset.word!, li]));
    const h0 = this.sugg.offsetHeight; // mid-tween height if one's running, so it picks up from there
    const fresh: HTMLElement[] = [];
    flip(
      rows.values(),
      () =>
        this.sugg.replaceChildren(
          ...hits.map((w) => {
            const li = rows.get(w);
            if (!li) return fresh[fresh.push(option(w)) - 1];
            li.classList.remove('active');
            li.setAttribute('aria-selected', 'false');
            return li;
          }),
        ),
      200,
    );
    if (reducedMotion()) return;
    const h1 = this.sugg.offsetHeight;
    if (h0 !== h1) this.sugg.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 200, easing: SPRING });
    for (const li of fresh) li.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: SPRING });
  }

  private onKey(e: KeyboardEvent) {
    const items = [...this.sugg.querySelectorAll<HTMLElement>('[data-word]')];
    if (!items.length || this.closing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // it opens upward, so ArrowUp walks away from the field: start from the bottom
      const n = items.length;
      this.active = this.active < 0 ? (e.key === 'ArrowUp' ? n - 1 : 0) : (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      items.forEach((li, k) => {
        li.classList.toggle('active', k === this.active);
        li.setAttribute('aria-selected', String(k === this.active));
      });
    } else if (e.key === 'Enter' && this.active >= 0) {
      e.preventDefault();
      this.pick(items[this.active].dataset.word!);
    } else if (e.key === 'Escape') this.closeSugg();
  }

  reject() {
    haptic('error');
    animate(
      this.input,
      [0, -8, 7, -5, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 340, easing: 'ease-out' },
    );
    this.input.select();
  }

  setDisabled(d: boolean) {
    this.input.disabled = d;
    this.btn.disabled = d;
    if (d) {
      this.input.blur();
      this.closeSugg();
    }
  }
}

/** A button that needs a second tap within 3s. No dialogs. */
export function confirmButton(label: string, confirmLabel: string, onConfirm: () => void, cls = 'btn ghost') {
  const b = h('button', { class: cls, type: 'button' }, label);
  let armed = 0;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      armed = 0;
      b.textContent = label;
      b.classList.remove('armed');
      haptic('warn');
      onConfirm();
      return;
    }
    haptic('tick');
    b.textContent = confirmLabel;
    b.classList.add('armed');
    armed = window.setTimeout(() => {
      armed = 0;
      b.textContent = label;
      b.classList.remove('armed');
    }, 3000);
  });
  return b;
}

/** 1 at rank 1, 0 at the far end; log scale so the top ranks spread out. */
export const closeness = (rank: number, n: number) => Math.max(0, 1 - Math.log(rank) / Math.log(n));

/** plain-language temperature, so a rank never needs decoding */
export const temperature = (rank: number) =>
  rank === 1
    ? 'got it'
    : rank <= 10
      ? 'on fire'
      : rank <= 100
        ? 'hot'
        : rank <= 300
          ? 'warm'
          : rank <= 1000
            ? 'tepid'
            : rank <= 5000
              ? 'cold'
              : 'freezing';

export const heat = (rank: number) => (rank <= 10 ? 'hot' : rank <= 100 ? 'warm' : rank <= 1000 ? 'mild' : 'cold');

export const fmt = (n: number) => n.toLocaleString('en-US');

const BLOCKS = '▁▂▃▄▅▆▇█';
/** 0..1 -> one of eight block heights */
export const block = (x: number) => BLOCKS[Math.max(0, Math.min(7, Math.round(x * 7)))];
