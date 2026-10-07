import { dayLabel } from '../../engine/seed';
import { loadLists, answerFor, type Lists } from '../../engine/words';
import { score } from '../../engine/score';
import { EMOJI } from '../../engine/pattern';
import type { Variant, Flash } from '../types';
import { applyDecay, keyboardState, MAX_GUESSES, type DecayRow } from './rules';
import { WordleView } from '../wordle-view';

export interface DecayState {
  day: number;
  seed: number;
  answer: string;
  lists: Lists;
  rows: DecayRow[];
  current: string;
  status: 'playing' | 'won' | 'lost';
  flash?: Flash;
}

export type DecayAction = { t: 'type'; ch: string } | { t: 'back' } | { t: 'enter' };

const flash = (s: DecayState, text: string): DecayState => ({
  ...s,
  flash: { id: (s.flash?.id ?? 0) + 1, text, kind: 'error' },
});

export function reduce(s: DecayState, a: DecayAction): DecayState {
  if (s.status !== 'playing') return s;
  switch (a.t) {
    case 'type':
      if (s.current.length >= 5 || !/^[a-z]$/.test(a.ch)) return s;
      return { ...s, current: s.current + a.ch };
    case 'back':
      if (!s.current) return s;
      return { ...s, current: s.current.slice(0, -1) };
    case 'enter': {
      const g = s.current;
      if (g.length < 5) return flash(s, 'Not enough letters');
      if (!s.lists.allowed.has(g)) return flash(s, 'Not in word list');
      const marks = score(g, s.answer);
      let rows = [...s.rows, { guess: g, marks, decayed: [false, false, false, false, false] }];
      const won = g === s.answer;
      // the winning row ends the game; no point fading the past after that
      if (!won) rows = applyDecay(rows, s.seed, rows.length, g);
      const status = won ? 'won' : rows.length >= MAX_GUESSES ? 'lost' : 'playing';
      return { ...s, rows, current: '', status };
    }
  }
}

const views = new WeakMap<HTMLElement, WordleView>();

const decay: Variant<DecayState, DecayAction> = {
  id: 'decay',
  name: 'Decay',
  tagline: 'The board forgets. Old clues fade after every guess.',
  rulesHtml: `
    <p>Guess the word in <b>6</b> tries. Feedback is classic:</p>
    <ul class="legend">
      <li><span class="mini" data-k="G">A</span> right letter, right spot</li>
      <li><span class="mini" data-k="Y">B</span> in the word, wrong spot</li>
      <li><span class="mini" data-k="B">C</span> not in the word</li>
    </ul>
    <p><b>The catch:</b> after each guess, tiles from <i>earlier</i> rows lose their colour.
    One tile after guesses 2–3, two after 4–6. Greens fade first, more often than not.</p>
    <ul class="legend"><li><span class="mini" data-k="decayed">D</span> faded. The letter stays; the clue is gone.</li></ul>
    <p>The keyboard only remembers what's still visible on the board. Take notes in your head.</p>`,

  async init(day, seed) {
    const lists = await loadLists();
    return { day, seed, answer: answerFor(lists, 'decay', day), lists, rows: [], current: '', status: 'playing' };
  },
  reduce,

  render(root, s, dispatch, ctx) {
    let v = views.get(root);
    if (!v) {
      v = new WordleView(root, MAX_GUESSES, (k) => {
        if (k === 'enter') dispatch({ t: 'enter' });
        else if (k === 'back') dispatch({ t: 'back' });
        else dispatch({ t: 'type', ch: k });
      });
      views.set(root, v);
    }
    const rows = Array.from({ length: MAX_GUESSES }, (_, r) => {
      const row = s.rows[r];
      if (row)
        return {
          tiles: row.marks.map((m, c) => ({ letter: row.guess[c], kind: row.decayed[c] ? ('decayed' as const) : m })),
        };
      if (r === s.rows.length && s.status === 'playing')
        return {
          current: true,
          tiles: Array.from({ length: 5 }, (_, c) => ({
            letter: s.current[c] ?? '',
            kind: s.current[c] ? ('tbd' as const) : ('empty' as const),
          })),
        };
      return { tiles: Array.from({ length: 5 }, () => ({ letter: '', kind: 'empty' as const })) };
    });
    const keys = new Map([...keyboardState(s.rows)].map(([k, m]) => [k, { state: m }]));
    return v.update(rows, keys, s.flash, ctx.live, {
      submitted: s.rows.length,
      won: s.status === 'won',
      lost: s.status === 'lost',
      lostText: s.answer.toUpperCase(),
    });
  },

  isOver: (s) => s.status !== 'playing',
  result: (s) => ({
    won: s.status === 'won',
    score: s.rows.length,
    label: s.status === 'won' ? `${s.rows.length}/6` : 'X/6',
  }),
  buckets: ['1', '2', '3', '4', '5', '6', 'X'],
  bucketOf: (s) => (s.status === 'won' ? String(s.rows.length) : 'X'),
  summary(s) {
    if (s.status === 'won')
      return {
        title: ['Telepathic.', 'Clean.', 'Sharp.', 'Solid.', 'Close one.', 'Phew.'][s.rows.length - 1],
        detail: `Solved in ${s.rows.length}/6, memory intact.`,
      };
    return { title: 'Forgotten.', detail: `The word was ${s.answer.toUpperCase()}.` };
  },

  shareText(s, day) {
    const head = `Decay ${dayLabel(day)} ${s.status === 'won' ? s.rows.length : 'X'}/6`;
    const lines = s.rows.map((r) => r.marks.map((m, c) => (r.decayed[c] ? '▫️' : EMOJI[m])).join(''));
    return [head, ...lines].join('\n');
  },

  destroy(root) {
    views.get(root)?.destroy();
    views.delete(root);
  },
};

export default decay;
