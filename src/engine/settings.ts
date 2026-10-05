import { read, write } from './storage';

export interface Settings {
  highContrast: boolean;
  /** 'system' follows prefers-reduced-motion */
  reducedMotion: 'system' | 'on' | 'off';
  haptics: boolean;
  /** Reverse: "N words still possible" counter */
  reverseAids: boolean;
  /** Warmer/Bridge: spelling suggestions above the guess box */
  autoSuggest: boolean;
}

const DEFAULTS: Settings = {
  highContrast: false,
  reducedMotion: 'system',
  haptics: true,
  reverseAids: true,
  autoSuggest: false,
};

let current: Settings = { ...DEFAULTS, ...read<Partial<Settings>>('settings', {}) };
const listeners = new Set<(s: Settings) => void>();

export const getSettings = () => current;

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  write('settings', current);
  apply();
  listeners.forEach((f) => f(current));
}

export function onSettings(f: (s: Settings) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
mq?.addEventListener?.('change', () => apply());

export function reducedMotion(): boolean {
  if (current.reducedMotion === 'on') return true;
  if (current.reducedMotion === 'off') return false;
  return !!mq?.matches;
}

/** Reflect settings on <html> so CSS can react. */
export function apply() {
  const el = document.documentElement;
  el.toggleAttribute('data-hc', current.highContrast);
  el.toggleAttribute('data-rm', reducedMotion());
}
