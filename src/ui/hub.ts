import { VARIANTS } from '../variants/registry';
import { loadGame, loadStats, liveStreak } from '../engine/storage';
import { h } from './dom';
import { ICONS } from './icons';
import { APP_NAME, liveCountdown, today } from './clock';
import type { TileKind } from './board';

const ART: Record<string, { word: string; kinds: TileKind[]; cls?: (string | null)[] }> = {
  decay: { word: 'decay', kinds: ['G', 'Y', 'G', 'B', 'G'], cls: [null, null, 'decaying', null, null] },
  reverse: { word: 'guess', kinds: ['B', 'Y', 'B', 'G', 'B'], cls: [null, null, 'cycling', null, null] },
  suspect: { word: 'liars', kinds: ['G', 'B', 'Y', 'B', 'G'], cls: [null, null, 'suspected', null, null] },
};

function art(id: string) {
  const a = ART[id];
  if (!a) return null;
  return h(
    'div',
    { class: 'card-art', 'aria-hidden': 'true' },
    ...[...a.word].map((ch, i) =>
      h('span', { class: `tile ${a.cls?.[i] ?? ''}`, 'data-k': a.kinds[i] }, h('span', { class: 'l' }, ch)),
    ),
  );
}

export function renderHub(opts: { enter: boolean; onSettings: () => void }): HTMLElement {
  const day = today();
  const cards = VARIANTS.map((v, i) => {
    const stats = loadStats(v.id);
    const done = stats.lastResult?.day === day ? stats.lastResult : null;
    const started = !done && loadGame(v.id, day).length > 0;
    const status = done
      ? h('span', { class: `chip status ${done.won ? 'done' : 'lost'}` }, done.won ? `✓ ${done.label}` : done.label)
      : started
        ? h('span', { class: 'chip status progress' }, 'in progress')
        : h('span', { class: 'chip status' }, 'unplayed');
    const streak = liveStreak(stats, day);
    return h(
      'a',
      { class: 'card', href: `#/${v.id}`, style: `--i:${i + 2}`, 'data-haptic': 'tick' },
      h(
        'div',
        { class: 'card-top' },
        h('h2', { class: 'card-name' }, h('span', { style: `view-transition-name: vt-title-${v.id}` }, v.name)),
        status,
      ),
      h('p', {}, v.tagline),
      art(v.id),
      h(
        'div',
        { class: 'card-foot' },
        h('span', {}, `${v.name} #${day}`),
        h('span', { class: 'streak' }, 'streak ', h('b', {}, String(streak))),
      ),
    );
  });

  const settingsBtn = h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear });
  settingsBtn.addEventListener('click', opts.onSettings);
  const cd = h('b');
  liveCountdown(cd);

  return h(
    'div',
    { class: `page hub ${opts.enter ? 'enter' : ''}` },
    h('div', { class: 'hub-top' }, settingsBtn),
    h(
      'header',
      { class: 'hub-head' },
      h('h1', { class: 'logo', style: '--i:0' }, APP_NAME, h('span', { class: 'cursor' }, '_')),
      h('p', { class: 'sub', style: '--i:1' }, 'three daily word games. one puzzle each, same for everyone.'),
    ),
    h('main', { class: 'cards' }, ...cards),
    h(
      'footer',
      { class: 'hub-foot', style: `--i:${cards.length + 2}` },
      h('span', {}, 'puzzle #', h('b', {}, String(day))),
      h('span', {}, 'next in ', cd),
    ),
  );
}
