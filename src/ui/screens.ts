// The shell's sheets: rules, stats / end-of-game, settings, archive.
import type { AnyVariant } from '../variants/types';
import { liveStreak, loadGame, loadResults, loadStats, type Stats } from '../engine/storage';
import { getSettings, setSettings, type Settings } from '../engine/settings';
import { shareText } from '../engine/share';
import { haptic } from '../engine/haptics';
import { h } from './dom';
import { ICONS } from './icons';
import { openModal } from './modal';
import { toast } from './toast';
import { dayIndex, dayLabel, dateOf, MONTHS } from '../engine/seed';
import { gameUrl, hashFor, liveCountdown, today } from './clock';

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
    h('div', { class: 'stat-row' }, stat(s.played, 'played'), stat(pct, 'win %'), stat(liveStreak(s, today()), 'streak'), stat(s.maxStreak, 'best')),
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
  if (archive)
    body.append(
      h(
        'p',
        { class: 'notice' },
        day > today()
          ? `${dayLabel(day)}, from the future. doesn't touch your stats, and it'll be a fresh game on the day.`
          : `${dayLabel(day)}, from the archive. doesn't touch your stats or streak.`,
      ),
    );

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
  const jump = (label: string, hash: string) => {
    const b = h('button', { class: 'btn' }, label);
    b.addEventListener('click', () => m.close().then(() => e.go(hash)));
    row2.append(b);
  };
  if (day > 1) jump(`‹ ${dayLabel(day - 1)}`, hashFor(v.id, day - 1));
  else if (archive) jump('today', `#/${v.id}`);
  jump(`${dayLabel(day + 1)} ›`, hashFor(v.id, day + 1));
  actions.append(row2);
  body.append(actions);

  const cd = h('b');
  liveCountdown(cd);
  body.append(h('p', { class: 'countdown' }, `next ${v.name} in `, cd));

  m = openModal(over ? `${v.name} · ${archive ? dayLabel(day) : 'today'}` : `${v.name} stats`, body);
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
    toggleRow('auto suggest', 'warmer & bridge: spelling matches from the vocab as you type. spelling, not meaning', 'autoSuggest'),
    h('p', { class: 'muted', style: 'margin-top:14px;font-size:12px' }, 'theme: amber phosphor. there is no light mode; the CRT is off.'),
  );
  openModal('settings', body);
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A month calendar. Every day since launch is open, and so is every day after today. */
export function archiveModal(v: AnyVariant, current: number, go: (hash: string) => void) {
  const t = today();
  const results = loadResults(v.id);
  // stats.lastResult predates the results map, so it still counts
  const last = loadStats(v.id).lastResult;
  if (last && !results[last.day]) results[last.day] = last;

  const first = dateOf(1);
  const at = dateOf(current);
  let y = at.getFullYear();
  let mo = at.getMonth();

  const title = h('span', { class: 'cal-title', 'aria-live': 'polite' });
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Previous month', 'data-haptic': 'tick' }, '‹');
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Next month', 'data-haptic': 'tick' }, '›');
  const grid = h('div', { class: 'cal', role: 'grid' });

  const cell = (d: number) => {
    const r = results[d];
    const started = !r && (loadGame(`${v.id}:archive`, d).length > 0 || loadGame(v.id, d).length > 0);
    const state = r ? (r.won ? 'done' : 'lost') : started ? 'progress' : '';
    const note = d === t ? ', today' : r ? (r.won ? ', solved' : ', missed') : started ? ', in progress' : '';
    return h(
      'a',
      {
        href: hashFor(v.id, d),
        class: `${d === current ? 'on' : ''} ${d === t ? 'today' : ''} ${d > t ? 'ahead' : ''} ${state}`,
        'aria-label': `${dayLabel(d)}${note}`,
        'data-haptic': 'tick',
      },
      String(dateOf(d).getDate()),
    );
  };

  const paint = () => {
    title.textContent = `${MONTHS[mo]} ${y}`;
    prev.disabled = y < first.getFullYear() || (y === first.getFullYear() && mo <= first.getMonth());
    const lead = new Date(y, mo, 1).getDay();
    const len = new Date(y, mo + 1, 0).getDate();
    grid.replaceChildren(
      ...WEEKDAYS.map((w) => h('span', { class: 'wd', 'aria-hidden': 'true' }, w)),
      ...Array.from({ length: lead }, () => h('span')),
      ...Array.from({ length: len }, (_, i) => {
        const d = dayIndex(new Date(y, mo, i + 1));
        // before launch there was nothing to play
        return d < 1 ? h('span', { class: 'off' }, String(i + 1)) : cell(d);
      }),
    );
  };
  const shift = (by: number) => {
    const d = new Date(y, mo + by, 1);
    y = d.getFullYear();
    mo = d.getMonth();
    paint();
  };
  prev.addEventListener('click', () => shift(-1));
  next.addEventListener('click', () => shift(1));
  paint();

  const todayBtn = h('a', { class: 'btn', href: `#/${v.id}`, 'data-haptic': 'press' }, 'back to today');
  const m = openModal(
    `${v.name} archive`,
    h(
      'div',
      {},
      h('p', { class: 'muted' }, 'any day, past or future. only today counts toward stats.'),
      h('div', { class: 'cal-head' }, prev, title, next),
      grid,
      current !== t && h('div', { class: 'end-actions' }, todayBtn),
    ),
  );
  const pick = (e: Event) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    haptic('tick');
    m.close().then(() => go(a.getAttribute('href')!));
  };
  grid.addEventListener('click', pick);
  todayBtn.addEventListener('click', pick);
}
