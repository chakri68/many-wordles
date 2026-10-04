// Dev-only content review (#/review). The "human review" gate from spec §9:
// nothing reaches players until someone approves it here and runs
//   node scripts/content.ts freeze <pool>
import type { ClueItem, EventItem, PoolId, Status } from '../content/types';
import { CATS } from '../content/types';
import { validate, BLANK } from '../content/validate';
import { loadVocab } from '../engine/semantic';
import { h } from './dom';
import { ICONS } from './icons';
import { toast } from './toast';
import { confirmButton } from './word-input';

type Item = (ClueItem | EventItem) & { status?: Status; note?: string };
const POOLS: PoolId[] = ['missing', 'define', 'events'];
const FILTERS = ['draft', 'approved', 'rejected', 'all'] as const;

export async function mountReview(app: HTMLElement, go: (hash: string) => void) {
  const vocab = await loadVocab();
  let pool: PoolId = 'missing';
  let filter: (typeof FILTERS)[number] = 'draft';
  let items: Item[] = [];
  let saveTimer = 0;

  const tabs = h('div', { class: 'seg rv-tabs' });
  const filters = h('div', { class: 'seg' });
  const summary = h('p', { class: 'muted rv-summary' });
  const list = h('div', { class: 'rv-list' });
  const bulk = h('div', { class: 'rv-bulk' });

  const back = h('button', { class: 'icon-btn', 'aria-label': 'All games', html: ICONS.back });
  back.addEventListener('click', () => go('#/'));
  app.replaceChildren(
    h(
      'div',
      { class: 'page review' },
      h('header', { class: 'topbar' }, back, h('div', { class: 'title' }, h('h1', {}, 'review')), h('div', { class: 'actions' })),
      h('div', { class: 'rv-body' }, tabs, filters, summary, bulk, list),
    ),
  );

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const r = await fetch(`/__content/${pool}`, { method: 'POST', body: JSON.stringify(items) });
      if (!r.ok) toast(`Save failed: ${await r.text()}`, { kind: 'error' });
    }, 350);
  };

  const count = (s: Status) => items.filter((x) => (x.status ?? 'draft') === s).length;

  function paintChrome() {
    tabs.replaceChildren(
      ...POOLS.map((p) => {
        const b = h('button', { class: `chip ${p === pool ? 'on' : ''}`, 'data-haptic': 'tick' }, p);
        b.addEventListener('click', () => load(p));
        return b;
      }),
    );
    filters.replaceChildren(
      ...FILTERS.map((f) => {
        const b = h('button', { class: `chip ${f === filter ? 'on' : ''}` }, f === 'all' ? 'all' : `${f} ${count(f)}`);
        b.addEventListener('click', () => {
          filter = f;
          paint();
        });
        return b;
      }),
    );
    const problems = validate(pool, items, vocab);
    summary.textContent = `${items.length} items · ${count('approved')} approved · ${problems.length} problem${problems.length === 1 ? '' : 's'}. When you're happy: node scripts/content.ts freeze ${pool}`;
    const shown = visible().filter(({ it }) => (it.status ?? 'draft') === 'draft');
    bulk.replaceChildren(
      shown.length
        ? confirmButton(`approve all ${shown.length} shown drafts`, 'tap again to approve them all', () => {
            for (const { it } of shown) it.status = 'approved';
            save();
            paint();
          })
        : '',
    );
  }

  const visible = () => items.map((it, i) => ({ it, i })).filter(({ it }) => filter === 'all' || (it.status ?? 'draft') === filter);

  function statusButtons(it: Item, card: HTMLElement) {
    const mk = (s: Status, label: string) => {
      const b = h('button', { class: `chip ${it.status === s ? 'on' : ''}`, 'data-haptic': 'tick' }, label);
      b.addEventListener('click', () => {
        it.status = it.status === s ? 'draft' : s;
        save();
        card.dataset.status = it.status;
        paintChrome();
        b.parentElement!.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
        if (it.status === s) b.classList.add('on');
      });
      return b;
    };
    const note = h('input', { class: 'rv-note', placeholder: 'note (optional)', value: it.note ?? '' });
    note.addEventListener('input', () => {
      it.note = note.value || undefined;
      save();
    });
    return h('div', { class: 'rv-actions' }, mk('approved', '✓ approve'), mk('rejected', '✗ reject'), note);
  }

  function clueCard(it: ClueItem, i: number, problems: string[]) {
    const card = h('article', { class: 'rv-card', 'data-status': it.status ?? 'draft' });
    const answer = h('input', { class: 'rv-answer', value: it.answer, 'aria-label': 'answer' });
    answer.addEventListener('change', () => {
      it.answer = answer.value.trim().toLowerCase();
      save();
      paint();
    });
    const clues = it.clues.map((c, k) => {
      const ta = h('textarea', { rows: 2, 'aria-label': `clue ${k + 1}` });
      ta.value = c;
      ta.addEventListener('change', () => {
        it.clues[k] = ta.value.trim();
        save();
        paint();
      });
      return h('li', {}, ta);
    });
    card.append(
      h('header', {}, h('span', { class: 'muted' }, `#${i + 1}`), answer),
      h('ol', { class: 'rv-clues' }, ...clues),
      problems.length ? h('ul', { class: 'rv-problems' }, ...problems.map((p) => h('li', {}, p))) : '',
      pool === 'missing' ? h('p', { class: 'muted rv-tip' }, `vague → specific, one ${BLANK} per sentence`) : '',
      statusButtons(it, card),
    );
    return card;
  }

  function eventCard(it: EventItem, i: number, problems: string[]) {
    const card = h('article', { class: 'rv-card rv-event', 'data-status': it.status ?? 'draft' });
    const year = h('input', { class: 'rv-year', type: 'number', value: String(it.year), 'aria-label': 'year (negative = BC)' });
    year.addEventListener('change', () => {
      it.year = Number(year.value);
      save();
    });
    const name = h('input', { class: 'rv-name', value: it.name, 'aria-label': 'event name' });
    name.addEventListener('change', () => {
      it.name = name.value.trim();
      save();
      paint();
    });
    const cat = h('select', { 'aria-label': 'theme' }, ...CATS.map((c) => h('option', { value: c, selected: c === it.cat }, c)));
    cat.addEventListener('change', () => {
      it.cat = cat.value as EventItem['cat'];
      save();
    });
    card.append(
      h('div', { class: 'rv-event-row' }, h('span', { class: 'muted' }, `#${i + 1}`), year, cat),
      name,
      problems.length ? h('ul', { class: 'rv-problems' }, ...problems.map((p) => h('li', {}, p))) : '',
      statusButtons(it, card),
    );
    return card;
  }

  function paint() {
    paintChrome();
    const byIndex = new Map<number, string[]>();
    for (const p of validate(pool, items, vocab)) byIndex.set(p.index, [...(byIndex.get(p.index) ?? []), p.message]);
    const vis = visible();
    // events are many: render the first 120 and say so
    const cap = pool === 'events' ? 120 : Infinity;
    list.replaceChildren(
      ...vis
        .slice(0, cap)
        .map(({ it, i }) =>
          pool === 'events' ? eventCard(it as EventItem, i, byIndex.get(i) ?? []) : clueCard(it as ClueItem, i, byIndex.get(i) ?? []),
        ),
      vis.length > cap ? h('p', { class: 'muted' }, `showing ${cap} of ${vis.length}; approve or reject some to see more`) : '',
    );
  }

  async function load(p: PoolId) {
    pool = p;
    items = await fetch(`/__content/${p}`).then((r) => r.json());
    paint();
  }

  await load(pool);
}
