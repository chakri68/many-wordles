import { reducedMotion } from '../engine/settings';

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

/** Tiny hyperscript. `on*` keys become listeners, `class`/`html` are special. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** WAAPI wrapper that respects reduced motion and always resolves. */
export function animate(
  el: Element,
  frames: Keyframe[] | PropertyIndexedKeyframes,
  opts: KeyframeAnimationOptions,
): Promise<void> {
  if (reducedMotion() || !el.animate) return Promise.resolve();
  const a = el.animate(frames, opts);
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

export const motionMs = (ms: number) => (reducedMotion() ? 0 : ms);

/**
 * FLIP: measure, mutate, then play the inverse so layout shifts glide instead
 * of jumping. Works on any set of elements that survive the mutation.
 */
export function flip(els: Iterable<Element>, mutate: () => void, ms = 260): void {
  const list = [...els];
  const before = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  mutate();
  if (reducedMotion()) return;
  for (const e of list) {
    if (!e.isConnected) continue;
    const a = before.get(e)!;
    const b = e.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    e.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
}

/** Animate a number from its current text to `to`. tabular-nums keeps it still. */
export function tweenNumber(el: HTMLElement, to: number, ms = 600) {
  const from = Number(el.dataset.n ?? to);
  el.dataset.n = String(to);
  if (reducedMotion() || from === to) {
    el.textContent = to.toLocaleString('en-US');
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString('en-US');
    if (p < 1 && el.dataset.n === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function modalOpen(): boolean {
  return !!document.querySelector('dialog[open]');
}

/** Physical keys for the active game, ignored while typing in inputs or a sheet is up. */
export function onGameKey(handler: (e: KeyboardEvent) => void): () => void {
  const fn = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return;
    const t = e.target as HTMLElement;
    if (t?.closest('input, textarea, select')) return;
    handler(e);
  };
  window.addEventListener('keydown', fn);
  return () => window.removeEventListener('keydown', fn);
}

/** Flags whichever pane is scrolling so its (otherwise hidden) scrollbar shows, then hides it again once idle. */
export function wireScrollbars(idleMs = 900) {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target instanceof Element ? e.target : document.documentElement;
      el.classList.add('scrolling');
      clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => el.classList.remove('scrolling'), idleMs));
    },
    { capture: true, passive: true },
  );
}
