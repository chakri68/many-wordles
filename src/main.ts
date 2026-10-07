import './ui/theme.css';
import { apply, reducedMotion } from './engine/settings';
import { wireDeclarativeHaptics } from './engine/haptics';
import { dayLabel, dayOfIso, seedFor } from './engine/seed';
import { loadGame, saveGame, loadStats, recordResult, saveStats, saveResult, read, write } from './engine/storage';
import { loadLists } from './engine/words';
import { byId } from './variants/registry';
import type { AnyVariant } from './variants/types';
import { h, motionMs, sleep, wireScrollbars } from './ui/dom';
import { ICONS } from './ui/icons';
import { closeAllModals } from './ui/modal';
import { toast } from './ui/toast';
import { renderHub } from './ui/hub';
import { today } from './ui/clock';
import { archiveModal, rulesModal, settingsModal, statsModal } from './ui/screens';

apply();
wireDeclarativeHaptics();
wireScrollbars();

const app = document.getElementById('app')!;
let session: { destroy(): void } | null = null;
let booted = false;
let routeToken = 0;
let hubDay = 0;

function parse() {
  const raw = location.hash.slice(1) || '/';
  const [path, q] = raw.split('?');
  const id = path.replace(/^\/+|\/+$/g, '');
  const p = new URLSearchParams(q ?? '');
  const date = p.get('date');
  const n = p.get('day'); // old links carried the puzzle number
  return { id: id || null, day: date != null ? (dayOfIso(date) ?? NaN) : n != null ? Number(n) : null };
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
  if (import.meta.env.DEV && id === 'review') {
    const { mountReview } = await import('./ui/review');
    swap(() => {}, 'forward');
    await mountReview(app, go);
    return;
  }
  if (!v) {
    if (id) history.replaceState(null, '', '#/');
    swap(mountHub, 'back');
    return;
  }
  const t = today();
  let d = day ?? t;
  // future days are fair game: every puzzle is a pure function of its number
  if (!Number.isInteger(d) || d < 1) d = t;
  const stop = loading(v.id);
  try {
    const mount = await prepareGame(v, d, t);
    if (token !== routeToken) return;
    stop(true);
    swap(mount, 'forward');
  } catch (err) {
    console.error(err);
    stop(false);
    if (token === routeToken) toast("Couldn't load the game data. Offline?", { kind: 'error', ms: 3000 });
  }
}

// ---- loading feedback --------------------------------------------------
// Warmer/Bridge pull a 2 MB table on first open; word lists are smaller but
// still a fetch. The tapped card says so at once; a top bar appears only if
// it takes longer than a blink, grows once and holds (no looping spinner).
const bar = h('div', { class: 'route-progress', role: 'progressbar', 'aria-label': 'Loading game', 'aria-hidden': 'true' });
document.body.append(bar);
let barTimer = 0;

function loading(id: string): (ok: boolean) => void {
  const card = app.querySelector<HTMLElement>(`.card[href="#/${id}"]`);
  card?.classList.add('pending');
  card?.setAttribute('aria-busy', 'true');
  clearTimeout(barTimer);
  bar.className = 'route-progress';
  barTimer = window.setTimeout(() => {
    bar.className = 'route-progress on';
    bar.setAttribute('aria-hidden', 'false');
  }, 120);
  return (ok) => {
    clearTimeout(barTimer);
    card?.classList.remove('pending');
    card?.removeAttribute('aria-busy');
    if (bar.classList.contains('on')) {
      bar.className = `route-progress on ${ok ? 'done' : 'failed'}`;
      setTimeout(() => {
        bar.className = 'route-progress';
        bar.setAttribute('aria-hidden', 'true');
      }, 260);
    }
  };
}

function mountHub() {
  hubDay = today();
  document.title = 'Many Wordles · daily word games';
  const enter = !booted;
  const page = renderHub({ enter: false, onSettings: settingsModal });
  app.replaceChildren(page);
  if (enter && !reducedMotion() && document.getElementById('boot')) {
    // cards rise as the splash fades
    setTimeout(() => page.classList.add('enter'), 60);
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
  // a past day you played as "today" opens where you left it
  let saved = loadGame<unknown>(key, day);
  if (archive && !saved.length) saved = loadGame(v.id, day);
  for (const a of saved) {
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
      { class: `daychip ${archive ? 'archive' : ''}`, 'aria-label': `${dayLabel(day)}. Pick another day`, 'data-haptic': 'tick' },
      archive ? dayLabel(day) : 'today',
    );
    dayBtn.addEventListener('click', () => archiveModal(v, day, go));
    const btn = (icon: string, label: string, fn: () => void) => {
      const b = h('button', { class: 'icon-btn', 'aria-label': label, html: icon });
      b.addEventListener('click', fn);
      return b;
    };
    const openEnd = () => statsModal({ v, state, day, archive, over: v.isOver(state), go });

    document.title = `${v.name}${archive ? ` · ${dayLabel(day)}` : ''} · Many Wordles`;
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
      const r = v.result(state);
      saveResult(v.id, day, r);
      if (!archive) saveStats(v.id, recordResult(loadStats(v.id), day, r, v.bucketOf(state)));
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
    setTimeout(() => splash.remove(), 400);
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
