// Free-text guess dock for the semantic variants. Sits above the native
// keyboard (viewport uses interactive-widget=resizes-content).
import { haptic } from '../engine/haptics';
import { animate, h } from './dom';

export class WordInput {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly extras: HTMLElement;
  private btn: HTMLButtonElement;

  constructor(onSubmit: (word: string) => void, opts: { placeholder: string; label: string }) {
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
    });
    this.btn = h('button', { class: 'btn primary', type: 'submit', 'data-haptic': 'press' }, opts.label);
    // keep the soft keyboard up when tapping the button
    this.btn.addEventListener('mousedown', (e) => e.preventDefault());
    const form = h('form', { class: 'word-form' }, this.input, this.btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = this.input.value.trim().toLowerCase();
      if (!w) return;
      onSubmit(w);
    });
    this.extras = h('div', { class: 'word-extras' });
    this.el = h('div', { class: 'word-dock' }, form, this.extras);
    if (matchMedia('(pointer: fine)').matches) queueMicrotask(() => this.input.focus({ preventScroll: true }));
  }

  clear() {
    this.input.value = '';
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
    if (d) this.input.blur();
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
