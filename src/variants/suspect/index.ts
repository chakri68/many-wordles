import { dayLabel } from '../../engine/seed';
import { loadLists, answerFor, type Lists } from '../../engine/words';
import { score, type Mark } from '../../engine/score';
import { EMOJI, RANK } from '../../engine/pattern';
import type { Variant, Flash } from '../types';
import type { RowModel, TileKind } from '../../ui/board';
import { WordleView } from '../wordle-view';
import { corrupt } from './corrupt';
import { haptic } from '../../engine/haptics';

export const MAX_GUESSES = 8;

export interface SuspectRow {
  guess: string;
  shown: Mark[];
  truth: Mark[];
  /** index of the lying tile, -1 on the (honest) winning row */
  lie: number;
}

export interface SuspectState {
  day: number;
  seed: number;
  answer: string;
  lists: Lists;
  rows: SuspectRow[];
  accused: (number | null)[];
  current: string;
  status: 'playing' | 'won' | 'lost';
  flash?: Flash;
}

export type SuspectAction =
  | { t: 'type'; ch: string }
  | { t: 'back' }
  | { t: 'enter' }
  | { t: 'accuse'; row: number; col: number };

const flash = (s: SuspectState, text: string, kind: Flash['kind'] = 'error'): SuspectState => ({
  ...s,
  flash: { id: (s.flash?.id ?? 0) + 1, text, kind },
});

export function reduce(s: SuspectState, a: SuspectAction): SuspectState {
  if (s.status !== 'playing') return s;
  switch (a.t) {
    case 'type':
      if (s.current.length >= 5 || !/^[a-z]$/.test(a.ch)) return s;
      return { ...s, current: s.current + a.ch };
    case 'back':
      return s.current ? { ...s, current: s.current.slice(0, -1) } : s;
    case 'accuse': {
      const row = s.rows[a.row];
      if (!row || row.lie < 0 || a.col < 0 || a.col > 4) return s;
      const accused = s.accused.slice();
      accused[a.row] = accused[a.row] === a.col ? null : a.col;
      return { ...s, accused };
    }
    case 'enter': {
      const g = s.current;
      if (g.length < 5) return flash(s, 'Not enough letters');
      if (!s.lists.allowed.has(g)) return flash(s, 'Not in word list');
      const truth = score(g, s.answer);
      const won = g === s.answer;
      const r = s.rows.length;
      const row: SuspectRow = won
        ? { guess: g, shown: truth, truth, lie: -1 }
        : (() => {
            const c = corrupt(g, truth, s.seed, r, s.lists.allowedList);
            return { guess: g, shown: c.shown, truth, lie: c.pos };
          })();
      const rows = [...s.rows, row];
      const status = won ? 'won' : rows.length >= MAX_GUESSES ? 'lost' : 'playing';
      return { ...s, rows, accused: [...s.accused, null], current: '', status };
    }
  }
}

export function liarsCaught(s: SuspectState) {
  let caught = 0;
  let total = 0;
  s.rows.forEach((r, i) => {
    if (r.lie < 0) return;
    total++;
    if (s.accused[i] === r.lie) caught++;
  });
  return { caught, total };
}

const views = new WeakMap<HTMLElement, WordleView>();

const suspect: Variant<SuspectState, SuspectAction> = {
  id: 'suspect',
  name: 'Suspect',
  tagline: 'One tile in every row is lying. Solve it, then catch the liars.',
  rulesHtml: `
    <p>Guess the word in <b>8</b> tries. Feedback looks classic:</p>
    <ul class="legend">
      <li><span class="mini" data-k="G">A</span> right letter, right spot</li>
      <li><span class="mini" data-k="Y">B</span> in the word, wrong spot</li>
      <li><span class="mini" data-k="B">C</span> not in the word</li>
    </ul>
    <p><b>The catch:</b> exactly <b>one tile in every row lies</b>, showing one of the two wrong colours.
    A lying row is never all-green. When you solve it, the winning row tells the truth.</p>
    <p><b>Accuse</b> a tile by <b>holding</b> it (or right-click). One suspect per row, change your mind any time.</p>
    <ul class="legend"><li><span class="mini suspected" data-k="Y">E</span> accused</li></ul>
    <p>At the end every liar is unmasked. Solving is the score; catching them all is bragging rights.
    The keyboard shows the best colour it's <i>been told</i>, hence the <b>?</b>.</p>`,

  async init(day, seed) {
    const lists = await loadLists();
    return {
      day,
      seed,
      answer: answerFor(lists, 'suspect', day),
      lists,
      rows: [],
      accused: [],
      current: '',
      status: 'playing',
    };
  },
  reduce,

  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) {
      v = new WordleView(
        root,
        MAX_GUESSES,
        (k) => {
          if (k === 'enter') dispatch({ t: 'enter' });
          else if (k === 'back') dispatch({ t: 'back' });
          else dispatch({ t: 'type', ch: k });
        },
        {
          longPress: true,
          onTile(row, col, how) {
            if (how === 'tap') return; // a plain tap does nothing; holding accuses
            haptic('tick');
            dispatch({ t: 'accuse', row, col });
          },
        },
      );
      views.set(root, v);
    }
    const over = s.status !== 'playing';
    const rows: RowModel[] = Array.from({ length: MAX_GUESSES }, (_, r) => {
      const row = s.rows[r];
      if (row) {
        const accused = s.accused[r];
        return {
          verdict: over && row.lie >= 0 ? (accused === row.lie ? 'caught' : 'missed') : undefined,
          tiles: row.shown.map((m, c) => {
            const isLie = over && c === row.lie;
            return {
              letter: row.guess[c],
              kind: (isLie ? row.truth[c] : m) as TileKind,
              suspected: accused === c,
              lie: isLie,
              truth: isLie ? (m as TileKind) : undefined,
              interactive: !over && row.lie >= 0,
            };
          }),
        };
      }
      if (r === s.rows.length && !over)
        return {
          current: true,
          tiles: Array.from({ length: 5 }, (_, c) => ({
            letter: s.current[c] ?? '',
            kind: (s.current[c] ? 'tbd' : 'empty') as TileKind,
          })),
        };
      return { tiles: Array.from({ length: 5 }, () => ({ letter: '', kind: 'empty' as TileKind })) };
    });

    // best DISPLAYED colour per key; it might be a lie, hence "?"
    const keys = new Map<string, { state: Mark; unsure: boolean }>();
    for (const row of s.rows)
      row.shown.forEach((m, c) => {
        const ch = row.guess[c];
        const prev = keys.get(ch);
        if (!prev || RANK[m] > RANK[prev.state]) keys.set(ch, { state: m, unsure: row.lie >= 0 });
      });

    const lyingRows = s.rows.filter((r) => r.lie >= 0).length;
    const accusedN = s.accused.filter((a) => a != null).length;
    const { caught, total } = liarsCaught(s);
    const hint = over
      ? `🕵️ ${caught}/${total} liars caught`
      : lyingRows
        ? `hold a tile to accuse · ${accusedN}/${lyingRows} rows accused`
        : '';

    return v.update(rows, keys, s.flash, ctx.live, {
      submitted: s.rows.length,
      won: s.status === 'won',
      lost: s.status === 'lost',
      lostText: s.answer.toUpperCase(),
      endReveal: over ? s.rows.map((r, i) => (r.lie >= 0 ? i : -1)).filter((i) => i >= 0) : undefined,
      hint,
    });
  },

  isOver: (s) => s.status !== 'playing',
  result: (s) => ({
    won: s.status === 'won',
    score: s.rows.length,
    label: s.status === 'won' ? `${s.rows.length}/8` : 'X/8',
  }),
  buckets: ['1', '2', '3', '4', '5', '6', '7', '8', 'X'],
  bucketOf: (s) => (s.status === 'won' ? String(s.rows.length) : 'X'),
  summary(s) {
    const { caught, total } = liarsCaught(s);
    const liars = total ? ` Caught ${caught}/${total} liars.` : '';
    if (s.status === 'won')
      return {
        title: caught === total ? 'Case closed.' : 'Solved. Mostly.',
        detail: `Cracked it in ${s.rows.length}/8.${liars}`,
      };
    return { title: 'They got away.', detail: `The word was ${s.answer.toUpperCase()}.${liars}` };
  },

  shareText(s, day) {
    const { caught, total } = liarsCaught(s);
    const head = `Suspect ${dayLabel(day)} ${s.status === 'won' ? s.rows.length : 'X'}/8 · 🕵️ ${caught}/${total} liars caught`;
    const lines = s.rows.map(
      (r, i) => r.shown.map((m) => EMOJI[m]).join('') + (r.lie >= 0 && s.accused[i] === r.lie ? ' ✓' : ''),
    );
    return [head, ...lines].join('\n');
  },

  destroy(root) {
    views.get(root)?.destroy();
    views.delete(root);
  },
};

export default suspect;
