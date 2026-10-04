// The shell's sheets: rules, stats / end-of-game, settings, archive.
import type { AnyVariant } from '../variants/types';
import { loadStats, type Stats } from '../engine/storage';
import { getSettings, setSettings, type Settings } from '../engine/settings';
import { shareText } from '../engine/share';
import { haptic } from '../engine/haptics';
import { h } from './dom';
import { ICONS } from './icons';
import { openModal } from './modal';
import { toast } from './toast';
import { gameUrl, liveCountdown, today } from './clock';

export function rulesModal(v: AnyVariant, onClose?: () => void) {
  const body = h('div', { class: 'rules', html: v.rulesHtml });
  const ok = h('button', { class: 'btn primary big', 'data-haptic': 'press' }, 'got it');
  body.append(h('div', { class: 'end-actions' }, ok));
  const m = openModal(`how to play ${v.name}`, body, { onClose });
  ok.addEventListener('click', () => m.close());
}

function statBlock(s: Stats, buckets: string[], hi?: string) {
  const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
  const stat = (n: number | string, label: string) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', {}, label));
  const max = Math.max(1, ...buckets.map((b) => s.histogram[b] ?? 0));
  return [
    h('div', { class: 'stat-row' }, stat(s.played, 'played'), stat(pct, 'win %'), stat(s.streak, 'streak'), stat(s.maxStreak, 'best')),
    h('h4', { class: 'section-h' }, 'distribution'),
    h(
      'div',
      { class: 'histo' },
      ...buckets.map((b, i) => {
        const n = s.histogram[b] ?? 0;
        return h(
          'div',
          { class: 'histo-row' },
          h('span', {}, b),
          h('div', { class: `bar ${b === hi ? 'hi' : ''}`, style: `--w:${(n / max) * 100};--i:${i}` }, String(n)),
        );
      }),
    ),
  ];
}

export interface EndInfo {
  v: AnyVariant;
  state: unknown;
  day: number;
  archive: boolean;
  over: boolean;
  go: (hash: string) => void;
}

/** Stats sheet. When the game is over it doubles as the end screen. */
export function statsModal(e: EndInfo) {
  const { v, state, day, archive, over } = e;
  const s = loadStats(v.id);
  const body = h('div', {});

  if (over) {
    const sum = v.summary(state);
    body.append(
      h('div', { class: 'result-head' }, h('p', { class: 'result-title' }, sum.title), h('p', { class: 'result-detail' }, sum.detail)),
    );
    const extra = v.endExtra?.(state);
    if (extra) body.append(extra);
  }
  if (archive) body.append(h('p', { class: 'notice' }, `archive puzzle #${day}. it doesn't touch your stats or streak.`));

  body.append(h('h4', { class: 'section-h' }, `${v.name} stats`), ...statBlock(s, v.buckets, over && !archive && s.lastDay === day ? v.bucketOf(state) : undefined));

  const actions = h('div', { class: 'end-actions' });
  let m: ReturnType<typeof openModal>;
  if (over) {
    const share = h('button', { class: 'btn primary big', 'data-haptic': 'press', html: `${ICONS.share}<span>share result</span>` });
    share.addEventListener('click', async () => {
      const r = await shareText(`${v.shareText(state, day)}\n${gameUrl(v.id)}`);
      if (r === 'copied') toast('Copied!');
      else if (r === 'failed') toast('Copy failed', { kind: 'error' });
    });
    actions.append(share);
  }
  const hub = h('button', { class: 'btn' }, '‹ all games');
  hub.addEventListener('click', () => m.close().then(() => e.go('#/')));
  const row2 = h('div', { class: 'row2' }, hub);
  if (day > 1) {
    const prev = h('button', { class: 'btn' }, `play #${day - 1}`);
    prev.addEventListener('click', () => m.close().then(() => e.go(`#/${v.id}?day=${day - 1}`)));
    row2.append(prev);
  } else if (archive) {
    const t = h('button', { class: 'btn' }, 'today');
    t.addEventListener('click', () => m.close().then(() => e.go(`#/${v.id}`)));
    row2.append(t);
  }
  actions.append(row2);
  body.append(actions);

  const cd = h('b');
  liveCountdown(cd);
  body.append(h('p', { class: 'countdown' }, `next ${v.name} in `, cd));

  m = openModal(over ? `${v.name} #${day}` : `${v.name} stats`, body);
  return m;
}

function toggleRow(label: string, desc: string, key: keyof Settings) {
  const btn = h('button', {
    class: 'switch',
    role: 'switch',
    'aria-checked': String(!!getSettings()[key]),
    'aria-label': label,
    'data-haptic': 'tick',
  });
  btn.addEventListener('click', () => {
    const next = !getSettings()[key];
    setSettings({ [key]: next } as Partial<Settings>);
    btn.setAttribute('aria-checked', String(next));
  });
  return h('div', { class: 'setting' }, h('label', {}, label), btn, h('small', {}, desc));
}

export function settingsModal() {
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Reduce motion' });
  const opts: Settings['reducedMotion'][] = ['system', 'on', 'off'];
  const paint = () =>
    seg.querySelectorAll<HTMLButtonElement>('.chip').forEach((c) => {
      const on = c.dataset.v === getSettings().reducedMotion;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
    });
  for (const o of opts) {
    const c = h('button', { class: 'chip', role: 'radio', 'data-v': o, 'data-haptic': 'tick' }, o);
    c.addEventListener('click', () => {
      setSettings({ reducedMotion: o });
      paint();
    });
    seg.append(c);
  }
  paint();
  const body = h(
    'div',
    {},
    toggleRow('high contrast', 'patterned tiles + bigger corner glyphs (● ◐ ○)', 'highContrast'),
    h('div', { class: 'setting' }, h('label', {}, 'reduce motion'), seg, h('small', {}, 'instant swaps instead of flips & drains')),
    toggleRow('haptics', 'tiny ticks on taps. android only; iOS gets a best effort', 'haptics'),
    toggleRow('reverse: word counter', '"N words still possible", tap it for examples', 'reverseAids'),
    h('p', { class: 'muted', style: 'margin-top:14px;font-size:12px' }, 'theme: amber phosphor. there is no light mode; the CRT is off.'),
  );
  openModal('settings', body);
}

export function archiveModal(v: AnyVariant, current: number, go: (hash: string) => void) {
  const t = today();
  const s = loadStats(v.id);
  const grid = h('div', { class: 'days' });
  for (let d = t; d >= 1; d--) {
    const a = h('a', {
      href: d === t ? `#/${v.id}` : `#/${v.id}?day=${d}`,
      class: `${d === current ? 'on' : ''} ${d === s.lastResult?.day ? 'done' : ''}`,
      'data-haptic': 'tick',
    }, `#${d}`);
    grid.append(a);
  }
  const m = openModal(`${v.name} archive`, h('div', {}, h('p', { class: 'muted' }, 'every past puzzle, regenerated on the spot. archive games are just for fun.'), grid));
  grid.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    haptic('tick');
    m.close().then(() => go(a.getAttribute('href')!));
  });
}
