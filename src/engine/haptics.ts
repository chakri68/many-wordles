// Single haptics module (ui_theme §8). Never call navigator.vibrate directly.
import { getSettings } from './settings';

export type Pattern = 'tick' | 'press' | 'detent' | 'warn' | 'error' | 'success';

// Sub-~15ms pulses don't spin up a lot of Android motors (ERM, cheaper LRAs):
// the tap was "haptic" on paper and silent in the hand. 20ms is the floor.
const PATTERNS: Record<Pattern, number | number[]> = {
  tick: 20,
  press: 30,
  detent: 12,
  warn: [20, 40, 20],
  error: [40, 60, 40],
  success: [20, 50, 30],
};

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
let last = 0;

// iOS 18+: toggling a native switch emits a system haptic. Best-effort tick.
let iosSwitch: HTMLLabelElement | null = null;
function iosTick() {
  if (!iosSwitch) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = '__haptic';
    input.tabIndex = -1;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-99px;';
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(p: Pattern = 'tick') {
  if (!getSettings().haptics) return;
  const now = performance.now();
  if (now - last < 50) return;
  last = now;
  try {
    if (canVibrate) navigator.vibrate(PATTERNS[p]);
    else iosTick();
  } catch {
    /* enhancement only */
  }
}

export function wireDeclarativeHaptics() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-haptic]');
    if (el && !el.matches(':disabled')) haptic(el.dataset.haptic as Pattern);
  });
}
