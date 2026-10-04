import { animate, h } from './dom';

let host: HTMLElement | null = null;

function ensureHost() {
  if (!host || !host.isConnected) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/**
 * Toasts stack top-centre. Exits collapse their own height first so the
 * remaining toasts glide up instead of snapping.
 */
export function toast(text: string, opts: { kind?: 'info' | 'error'; ms?: number } = {}) {
  const root = ensureHost();
  const inner = h('div', { class: `toast ${opts.kind ?? 'info'}` }, text);
  const wrap = h('div', { class: 'toast-wrap' }, inner);
  root.prepend(wrap);
  animate(
    inner,
    [
      { opacity: 0, transform: 'translateY(-10px) scale(.96)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
  // cap the stack
  [...root.children].slice(3).forEach((n) => n.remove());
  setTimeout(async () => {
    await animate(inner, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], {
      duration: 160,
      easing: 'ease-in',
      fill: 'forwards',
    });
    wrap.classList.add('gone');
    await animate(wrap, [{ gridTemplateRows: '1fr' }, { gridTemplateRows: '0fr' }], {
      duration: 160,
      easing: 'ease-out',
      fill: 'forwards',
    });
    wrap.remove();
  }, opts.ms ?? 1600);
}
