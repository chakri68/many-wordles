import { dayIndex, isoOf, nextRollover } from '../engine/seed';

// Spec §11.1 rules out "Wordle" (NYT trademark); the owner chose this name anyway.
// One constant, so a rename is one line (plus index.html, manifest, OG cards).
export const APP_NAME = 'Many Wordles';

/** Public link to a game's own page (it carries that game's social card). */
export const gameUrl = (id: string) => new URL(`./${id}/`, new URL('./', document.baseURI)).href;

/** Today's puzzle. Clamped so a clock set to 1999 still gets #1. */
export const today = () => Math.max(1, dayIndex(new Date()));

/** Where a given day of a game lives. Today is the bare path. */
export const hashFor = (id: string, day: number) => (day === today() ? `#/${id}` : `#/${id}?date=${isoOf(day)}`);

export function untilNext(): string {
  const now = new Date();
  const ms = Math.max(0, nextRollover(now).getTime() - now.getTime());
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Ticks an element's text every second while it's connected. */
export function liveCountdown(el: HTMLElement) {
  const tick = () => {
    if (!el.isConnected) return clearInterval(id);
    el.textContent = untilNext();
  };
  const id = setInterval(tick, 1000);
  el.textContent = untilNext();
}
