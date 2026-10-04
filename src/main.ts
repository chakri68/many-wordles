import './ui/theme.css';
import { apply, reducedMotion } from './engine/settings';
import { wireDeclarativeHaptics } from './engine/haptics';
import { seedFor } from './engine/seed';
import { loadGame, saveGame, loadStats, recordResult, saveStats, read, write } from './engine/storage';
import { loadLists } from './engine/words';
import { byId } from './variants/registry';
import type { AnyVariant } from './variants/types';
import { h, motionMs, sleep } from './ui/dom';
import { ICONS } from './ui/icons';
import { closeAllModals } from './ui/modal';
import { toast } from './ui/toast';
import { renderHub } from './ui/hub';
import { today } from './ui/clock';
import { archiveModal, rulesModal, settingsModal, statsModal } from './ui/screens';

apply();
wireDeclarativeHaptics();

const app = document.getElementById('app')!;
let session: { destroy(): void } | null = null;
let booted = false;
let routeToken = 0;
let hubDay = 0;

function parse() {
  const raw = location.hash.slice(1) || '/';
  const [path, q] = raw.split('?');
  const id = path.replace(/^\/+|\/+$/g, '');
  const d = new URLSearchParams(q ?? '').get('day');
  return { id: id || null, day: d == null ? null : Number(d) };
}

export function go(hash: string) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

/** Swap screens inside a view transition so layout morphs instead of jumping. */
function swap(render: () => void, dir: 'forward' | 'back') {
  const run = () => {
    session?.destroy();
    session = null;
    render();
  };
  document.documentElement.dataset.nav = dir;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!booted || !doc.startViewTransition || reducedMotion()) return run();
  doc.startViewTransition(run);
}

async function route() {
  const token = ++routeToken;
  const { id, day } = parse();
  const v = id ? byId(id) : undefined;
  closeAllModals();
  if (!v) {
    if (id) history.replaceState(null, '', '#/');
    swap(mountHub, 'back');
    return;
  }
  const t = today();
  let d = day ?? t;
  if (!Number.isInteger(d) || d < 1 || (!import.meta.env.DEV && d > t)) d = t;
  try {
    const mount = await prepareGame(v, d, t);
    if (token !== routeToken) return;
    swap(mount, 'forward');
  } catch (err) {
    console.error(err);
    if (token === routeToken) toast("Couldn't load the word lists. Offline?", { kind: 'error', ms: 3000 });
  }
}

function mountHub() {
  hubDay = today();
  const enter = !booted;
  const page = renderHub({ enter: false, onSettings: settingsModal });
  app.replaceChildren(page);
  if (enter && !reducedMotion() && document.getElementById('boot')) {
    // cards rise as the splash title flies off
    setTimeout(() => page.classList.add('enter'), 700);
  }
  // warm the word lists so the first tap into a game is instant
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300));
  idle(() => loadLists().catch(() => {}));
}

async function prepareGame(v: AnyVariant, day: number, t: number) {
  const archive = day !== t;
  const key = archive ? `${v.id}:archive` : v.id;
  let state = await v.init(day, seedFor(v.id, day));
  const log: unknown[] = [];
  for (const a of loadGame(key, day)) {
    const next = v.reduce(state, a);
    if (next !== state) {
      state = next;
      log.push(a);
    }
  }

  return () => {
    const back = h('button', { class: 'icon-btn', 'aria-label': 'All games', html: ICONS.back });
    back.addEventListener('click', () => go('#/'));
    const dayBtn = h(
      'button',
      { class: `daychip ${archive ? 'archive' : ''}`, 'aria-label': `Puzzle ${day}. Open archive`, 'data-haptic': 'tick' },
      `#${day}`,
    );
    dayBtn.addEventListener('click', () => archiveModal(v, day, go));
    const btn = (icon: string, label: string, fn: () => void) => {
      const b = h('button', { class: 'icon-btn', 'aria-label': label, html: icon });
      b.addEventListener('click', fn);
      return b;
    };
    const openEnd = () => statsModal({ v, state, day, archive, over: v.isOver(state), go });

    const main = h('main', { class: 'game-main' });
    const page = h(
      'div',
      { class: 'page game', 'data-variant': v.id },
      h(
        'header',
        { class: 'topbar' },
        back,
        h('div', { class: 'title' }, h('h1', {}, h('span', { style: `view-transition-name: vt-title-${v.id}` }, v.name)), dayBtn),
        h(
          'div',
          { class: 'actions' },
          btn(ICONS.help, 'How to play', () => rulesModal(v)),
          btn(ICONS.stats, 'Statistics', openEnd),
          btn(ICONS.gear, 'Settings', settingsModal),
        ),
      ),
      main,
    );
    app.replaceChildren(page);

    let alive = true;
    const finish = async (settled: Promise<void>) => {
      if (!archive) saveStats(v.id, recordResult(loadStats(v.id), day, v.result(state), v.bucketOf(state)));
      await settled;
      await sleep(motionMs(450));
      if (alive) openEnd();
    };
    const dispatch = (a: unknown) => {
      if (!alive) return;
      const next = v.reduce(state, a);
      if (next === state) return;
      const wasOver = v.isOver(state);
      state = next;
      log.push(a);
      saveGame(key, day, log);
      const settled = Promise.resolve(v.render(main, state, dispatch, { live: true }));
      v.effects?.(state, dispatch);
      if (!wasOver && v.isOver(state)) finish(settled);
    };

    v.render(main, state, dispatch, { live: false });
    v.effects?.(state, dispatch);

    if (!read(`${v.id}:seenRules`, false)) {
      write(`${v.id}:seenRules`, true);
      setTimeout(() => alive && rulesModal(v), motionMs(380));
    } else if (v.isOver(state)) {
      setTimeout(() => alive && openEnd(), motionMs(500));
    }

    session = {
      destroy() {
        alive = false;
        v.destroy?.(main);
      },
    };
  };
}

async function boot() {
  const { id } = parse();
  const splash = document.getElementById('boot');
  const html = document.documentElement;
  if (!id && splash && !reducedMotion()) {
    // the pixel font must never flash a fallback, so wait for it (briefly)
    await Promise.race([document.fonts?.load('20px "Press Start 2P"'), sleep(1200)]).catch(() => {});
    html.classList.replace('booting', 'booted');
    setTimeout(() => splash.remove(), 1200);
  } else {
    splash?.remove();
    html.classList.remove('booting');
  }
  await route();
  booted = true;
}

window.addEventListener('hashchange', () => route());
document.addEventListener('visibilitychange', () => {
  // the day rolled over while the tab slept
  if (document.visibilityState === 'visible' && !parse().id && hubDay && hubDay !== today()) route();
});

boot();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
