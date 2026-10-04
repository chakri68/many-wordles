import { dayIndex, nextRollover } from '../engine/seed';

export const APP_NAME = 'wordshift'; // placeholder brand, spec §11.1. Not "Wordle".

/** Today's puzzle. Before launch everyone gets a preview of #1. */
export const today = () => Math.max(1, dayIndex(new Date()));

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
