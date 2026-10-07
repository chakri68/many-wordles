// Before/After: name the secret historical event. Every guess tells you if the
// target is earlier or later, roughly how far, and whether it shares a theme.
// Pure binary search over ~650 events needs ~10 guesses; you get 7, so you
// have to actually know some history (spec §9, phase 3).
import { dayLabel } from '../../engine/seed';
import type { EventItem, Cat } from '../../content/types';
import { loadPool, poolReady } from '../../engine/content';
import { pickIndex } from '../../engine/words';
import { haptic } from '../../engine/haptics';
import type { Variant, Flash } from '../types';
import { h, flip, animate, tweenNumber } from '../../ui/dom';
import { toast } from '../../ui/toast';

export const MAX_GUESSES = 7;

export type Dir = 'earlier' | 'later' | 'same';
/** 0 same year · 1 within 5 · 2 within 25 · 3 within 100 · 4 further */
export type Band = 0 | 1 | 2 | 3 | 4;
export interface Feedback {
  dir: Dir;
  band: Band;
  sameCat: boolean;
}

export function feedback(target: EventItem, g: EventItem): Feedback {
  const d = Math.abs(target.year - g.year);
  return {
    dir: target.year < g.year ? 'earlier' : target.year > g.year ? 'later' : 'same',
    band: d === 0 ? 0 : d <= 5 ? 1 : d <= 25 ? 2 : d <= 100 ? 3 : 4,
    sameCat: target.cat === g.cat,
  };
}

const sameFb = (a: Feedback, b: Feedback) => a.dir === b.dir && a.band === b.band && a.sameCat === b.sameCat;

export interface ChronoState {
  day: number;
  events: EventItem[];
  target: number;
  guesses: number[];
  status: 'playing' | 'won' | 'lost';
  flash?: Flash;
}

export type ChronoAction = { t: 'guess'; name: string };

/** Events still consistent with every clue so far (the target included). */
export function candidates(s: ChronoState): number[] {
  const t = s.events[s.target];
  const fbs = s.guesses.map((g) => [s.events[g], feedback(t, s.events[g])] as const);
  const out: number[] = [];
  s.events.forEach((e, i) => {
    if (s.guesses.includes(i)) return;
    if (fbs.every(([g, f]) => sameFb(feedback(e, g), f))) out.push(i);
  });
  return out;
}

export function reduce(s: ChronoState, a: ChronoAction): ChronoState {
  if (s.status !== 'playing') return s;
  const key = a.name.trim().toLowerCase();
  const i = s.events.findIndex((e) => e.name.toLowerCase() === key);
  if (i < 0) return { ...s, flash: { id: (s.flash?.id ?? 0) + 1, text: 'Pick an event from the list', kind: 'error' } };
  if (s.guesses.includes(i)) return { ...s, flash: { id: (s.flash?.id ?? 0) + 1, text: 'Already guessed', kind: 'info' } };
  const guesses = [...s.guesses, i];
  const status = i === s.target ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
  return { ...s, guesses, status };
}

export const yearText = (y: number) => (y < 0 ? `${-y} BC` : String(y));
const BAND_TEXT = ['same year', 'within 5 years', 'within 25 years', 'within a century', 'over a century apart'];
const BAND_EMOJI = ['🟩', '🟨', '🟧', '🟥', '⬛'];
const CAT_TEXT: Record<Cat, string> = {
  conflict: 'conflict',
  politics: 'politics',
  science: 'science',
  tech: 'technology',
  space: 'spaceflight',
  exploration: 'exploration',
  culture: 'culture',
  sport: 'sport',
  disaster: 'disaster',
};

// ---- view -----------------------------------------------------------------

class ChronoView {
  s!: ChronoState;
  rows = new Map<number, HTMLElement>();
  marker: HTMLElement;
  markerText: HTMLElement;
  timeline: HTMLElement;
  input: HTMLInputElement;
  sugg: HTMLElement;
  leftEl: HTMLElement;
  fitNum: HTMLElement;
  fitBtn: HTMLButtonElement;
  fitList: HTMLElement;
  fitWrap: HTMLElement;
  active = 0;
  flashId = 0;
  first = true;
  dispatch: (a: ChronoAction) => void;

  constructor(root: HTMLElement, dispatch: (a: ChronoAction) => void) {
    this.dispatch = dispatch;
    this.leftEl = h('b', {}, String(MAX_GUESSES));
    this.fitNum = h('b', { class: 'num' });
    this.fitBtn = h('button', { class: 'chip counter', 'aria-expanded': 'false', 'data-haptic': 'tick' }, this.fitNum, h('span', {}, ' events still fit'));
    this.fitList = h('div', { class: 'examples' });
    this.fitWrap = h('div', { class: 'collapse' }, h('div', { class: 'collapse-inner' }, this.fitList));
    this.fitBtn.addEventListener('click', () => {
      const open = this.fitWrap.classList.toggle('open');
      this.fitBtn.setAttribute('aria-expanded', String(open));
      this.fitBtn.classList.toggle('on', open);
    });
    this.markerText = h('span');
    this.marker = h('div', { class: 'twin', role: 'listitem' }, h('span', { class: 'twin-k' }, 'target'), this.markerText);
    this.timeline = h('div', { class: 'timeline', role: 'list', 'aria-label': 'Your guesses in date order' });

    this.input = h('input', {
      class: 'word-field plain',
      type: 'text',
      placeholder: 'search events…',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      enterkeyhint: 'go',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': 'chrono-sugg',
    });
    this.sugg = h('ul', { class: 'sugg', id: 'chrono-sugg', role: 'listbox' });
    this.input.addEventListener('input', () => this.suggest());
    this.input.addEventListener('focus', () => this.suggest());
    this.input.addEventListener('blur', () => setTimeout(() => this.closeSugg(), 120));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.sugg.addEventListener('mousedown', (e) => e.preventDefault());
    this.sugg.addEventListener('click', (e) => {
      const li = (e.target as Element).closest<HTMLElement>('[data-name]');
      if (li) this.pick(li.dataset.name!);
    });

    root.append(
      h(
        'div',
        { class: 'sem-top' },
        h('div', { class: 'sem-stats' }, h('span', {}, 'guesses left ', this.leftEl), this.fitBtn),
        this.fitWrap,
      ),
      h('div', { class: 'timeline-wrap' }, this.timeline),
      h('div', { class: 'word-dock combo' }, this.sugg, this.input),
    );
  }

  pick(name: string) {
    haptic('press');
    this.input.value = '';
    this.closeSugg();
    this.dispatch({ t: 'guess', name });
  }

  closeSugg() {
    this.sugg.replaceChildren();
    this.input.setAttribute('aria-expanded', 'false');
  }

  /** match every typed word anywhere in the name; events that still fit float up */
  suggest() {
    const s = this.s;
    const q = this.input.value.trim().toLowerCase();
    if (!q || s.status !== 'playing') return this.closeSugg();
    const terms = q.split(/\s+/);
    const fit = new Set(candidates(s));
    const hits = s.events
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => !s.guesses.includes(i) && terms.every((t) => e.name.toLowerCase().includes(t)))
      .sort((a, b) => Number(fit.has(b.i)) - Number(fit.has(a.i)) || a.e.name.localeCompare(b.e.name))
      .slice(0, 6);
    this.active = 0;
    this.sugg.replaceChildren(
      ...hits.map(({ e, i }, k) =>
        h(
          'li',
          { role: 'option', 'data-name': e.name, class: `${k === 0 ? 'active' : ''} ${fit.has(i) ? '' : 'nofit'}`, 'aria-selected': String(k === 0) },
          e.name,
        ),
      ),
      ...(hits.length ? [] : [h('li', { class: 'empty' }, 'no matching event')]),
    );
    this.input.setAttribute('aria-expanded', String(hits.length > 0));
  }

  onKey(e: KeyboardEvent) {
    const items = [...this.sugg.querySelectorAll<HTMLElement>('[data-name]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, k) => {
        li.classList.toggle('active', k === this.active);
        li.setAttribute('aria-selected', String(k === this.active));
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const li = items[this.active];
      if (li) this.pick(li.dataset.name!);
      else if (this.input.value.trim()) this.dispatch({ t: 'guess', name: this.input.value });
    } else if (e.key === 'Escape') this.closeSugg();
  }

  row(i: number, isTarget: boolean) {
    const s = this.s;
    const e = s.events[i];
    const fb = feedback(s.events[s.target], e);
    const detail = isTarget
      ? h('span', { class: 'tfb' }, s.status === 'won' ? '🎯 got it' : 'the answer')
      : h(
          'span',
          { class: 'tfb' },
          h('b', { class: `dir ${fb.dir}` }, fb.dir === 'same' ? 'same year' : `target is ${fb.dir}`),
          fb.dir === 'same' ? '' : ` · ${BAND_TEXT[fb.band]}`,
          ' · ',
          h('span', { class: fb.sameCat ? 'cat on' : 'cat' }, fb.sameCat ? `same theme: ${CAT_TEXT[e.cat]}` : `not ${CAT_TEXT[e.cat]}`),
        );
    return h(
      'div',
      { class: `trow ${isTarget ? `target ${s.status}` : ''}`, role: 'listitem' },
      h('span', { class: 'ty' }, yearText(e.year)),
      h('div', { class: 'tbody' }, h('span', { class: 'tname' }, e.name), detail),
    );
  }

  update(s: ChronoState, live: boolean) {
    const prev = this.s;
    this.s = s;
    const anim = live && !this.first;
    this.first = false;

    if (s.flash && s.flash.id !== this.flashId) {
      if (anim) {
        toast(s.flash.text, { kind: s.flash.kind });
        if (s.flash.kind === 'error') haptic('error');
      }
      this.flashId = s.flash.id;
    }

    const over = s.status !== 'playing';
    const fits = candidates(s);
    const shown = [...s.guesses];
    if (s.status === 'lost') shown.push(s.target);

    const fresh = shown.filter((i) => !this.rows.has(i));
    for (const i of fresh) this.rows.set(i, this.row(i, i === s.target));
    // the target row on a win replaces the guess row's styling
    if (s.status === 'won' && prev?.status === 'playing') this.rows.set(s.target, this.row(s.target, true));

    // chronological order, with the "somewhere here" window slotted in
    const ordered = [...shown].sort((a, b) => s.events[a].year - s.events[b].year || a - b);
    const lo = Math.min(...fits.map((i) => s.events[i].year));
    const hi = Math.max(...fits.map((i) => s.events[i].year));
    const seq: HTMLElement[] = [];
    let placed = over;
    for (const i of ordered) {
      if (!placed && s.events[i].year > hi) {
        seq.push(this.marker);
        placed = true;
      }
      seq.push(this.rows.get(i)!);
    }
    if (!placed) seq.push(this.marker);

    const knownCat = s.guesses.map((g) => s.events[g]).find((g) => feedback(s.events[s.target], g).sameCat)?.cat;
    this.markerText.replaceChildren(
      fits.length
        ? lo === hi
          ? `${yearText(lo)}`
          : `somewhere between ${yearText(lo)} and ${yearText(hi)}`
        : '',
      knownCat ? h('span', { class: 'cat on' }, ` · ${CAT_TEXT[knownCat]}`) : '',
    );

    flip([...this.rows.values(), this.marker], () => this.timeline.replaceChildren(...seq), 300);
    if (anim)
      for (const i of fresh)
        animate(this.rows.get(i)!, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], {
          duration: 300,
          easing: 'cubic-bezier(.2,.9,.2,1)',
        });
    if (anim && fresh.length) this.rows.get(fresh.at(-1)!)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    this.leftEl.textContent = String(MAX_GUESSES - s.guesses.length);
    if (anim) tweenNumber(this.fitNum, fits.length);
    else {
      this.fitNum.dataset.n = String(fits.length);
      this.fitNum.textContent = String(fits.length);
    }
    const sample = fits.length <= 24 ? fits : fits.filter((_, k) => k % Math.ceil(fits.length / 24) === 0);
    this.fitList.replaceChildren(
      ...sample.map((i) => h('button', { class: 'ex', type: 'button', 'data-name': s.events[i].name }, s.events[i].name)),
      ...(fits.length > sample.length ? [h('span', { class: 'ex more' }, `+${fits.length - sample.length}`)] : []),
    );
    this.fitList.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-name]');
      if (b && this.s.status === 'playing') this.pick(b.dataset.name!);
    };
    this.fitBtn.hidden = over;
    this.input.disabled = over;
    this.input.placeholder = over ? (s.status === 'won' ? 'solved!' : 'out of guesses') : 'search events…';
    if (over) this.closeSugg();
    if (anim && over && prev?.status === 'playing') haptic(s.status === 'won' ? 'success' : 'warn');
  }
}

const views = new WeakMap<HTMLElement, ChronoView>();

/** "(approx.)" dates are fine to guess, too fuzzy to be the answer */
const targetable = (events: EventItem[]) => events.map((e, i) => (/approx|traditional/i.test(e.name) ? -1 : i)).filter((i) => i >= 0);

const chrono: Variant<ChronoState, ChronoAction> & { available: () => boolean } = {
  id: 'chrono',
  name: 'Before/After',
  tagline: 'Name the secret moment in history. Each guess says before or after.',
  rulesHtml: `
    <p>There's a secret <b>historical event</b>. Search and pick any event as a guess;
    you'll see its year and learn three things about the target:</p>
    <ul class="legend plain">
      <li><b>before or after</b> your guess</li>
      <li><b>how far</b>: same year, within 5, 25 or 100 years, or further</li>
      <li>whether it shares your guess's <b>theme</b> (science, sport, conflict…)</li>
    </ul>
    <p>Narrowing the dates isn't enough: you have to <b>name the event</b> within <b>7</b> guesses.
    Tap "events still fit" for a peek at what's left.</p>`,
  available: () => poolReady('events'),

  async init(day) {
    const events = await loadPool<EventItem>('events', day);
    const t = targetable(events);
    return { day, events, target: t[pickIndex(t.length, 'chrono', day)], guesses: [], status: 'playing' };
  },
  reduce,
  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) views.set(root, (v = new ChronoView(root, dispatch)));
    v.update(s, ctx.live);
  },
  isOver: (s) => s.status !== 'playing',
  result: (s) => ({
    won: s.status === 'won',
    score: s.guesses.length,
    label: s.status === 'won' ? `${s.guesses.length}/7` : 'X/7',
  }),
  buckets: ['1', '2', '3', '4', '5', '6', '7', 'X'],
  bucketOf: (s) => (s.status === 'won' ? String(s.guesses.length) : 'X'),
  summary(s) {
    const t = s.events[s.target];
    const what = `${t.name} (${yearText(t.year)})`;
    if (s.status === 'won')
      return { title: s.guesses.length <= 3 ? 'Historian.' : s.guesses.length <= 5 ? 'Well read.' : 'Just in time.', detail: `${what} in ${s.guesses.length}/7.` };
    return { title: 'Lost in time.', detail: `It was ${what}.` };
  },
  shareText(s, day) {
    const t = s.events[s.target];
    const marks = s.guesses.map((g) => {
      if (g === s.target) return '🎯';
      const f = feedback(t, s.events[g]);
      return (f.dir === 'earlier' ? '⬅️' : f.dir === 'later' ? '➡️' : '⏺️') + BAND_EMOJI[f.band];
    });
    return `Before/After ${dayLabel(day)} ${s.status === 'won' ? s.guesses.length : 'X'}/7\n${marks.join(' ')}`;
  },
};

export default chrono;
