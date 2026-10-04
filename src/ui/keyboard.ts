import { h } from './dom';
import { ICONS } from './icons';

export type KeyState = 'G' | 'Y' | 'B';
export interface KeyPaint {
  state: KeyState;
  unsure?: boolean; // Suspect: "?" badge
}

const ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];

/** On-screen QWERTY. Each variant decides what the colours mean. */
export class Keyboard {
  readonly el: HTMLElement;
  private keys = new Map<string, HTMLButtonElement>();
  private disabled = false;

  constructor(onKey: (k: string) => void) {
    this.el = h('div', { class: 'keyboard', role: 'group', 'aria-label': 'Keyboard' });
    for (const row of ROWS) {
      const r = h('div', { class: 'kb-row' });
      for (const ch of row) {
        let b: HTMLButtonElement;
        if (ch === '+') {
          b = h('button', { class: 'key wide', 'data-key': 'enter', 'data-haptic': 'press' }, 'enter');
        } else if (ch === '-') {
          b = h('button', {
            class: 'key wide',
            'data-key': 'back',
            'aria-label': 'Backspace',
            'data-haptic': 'tick',
            html: ICONS.backspace,
          });
        } else {
          b = h('button', { class: 'key', 'data-key': ch, 'data-haptic': 'tick' }, ch);
        }
        this.keys.set(b.dataset.key!, b);
        r.append(b);
      }
      this.el.append(r);
    }
    this.el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.key');
      if (!b || this.disabled) return;
      onKey(b.dataset.key!);
    });
    // keep focus off keys so physical Enter never re-clicks the last tapped key
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  paint(map: Map<string, KeyPaint>) {
    for (const [k, b] of this.keys) {
      if (k.length !== 1) continue;
      const p = map.get(k);
      b.dataset.k = p?.state ?? '';
      b.classList.toggle('unsure', !!p?.unsure);
      b.setAttribute(
        'aria-label',
        p ? `${k}, ${{ G: 'correct', Y: 'present', B: 'absent' }[p.state]}${p.unsure ? ', unconfirmed' : ''}` : k,
      );
    }
  }

  setDisabled(d: boolean) {
    this.disabled = d;
    this.el.classList.toggle('locked', d);
  }

  setEnterLabel(label: string) {
    this.keys.get('enter')!.textContent = label;
  }
}
