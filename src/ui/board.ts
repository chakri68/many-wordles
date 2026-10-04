import { haptic } from '../engine/haptics';
import { animate, h, motionMs, sleep } from './dom';

export type TileKind = 'empty' | 'tbd' | 'G' | 'Y' | 'B' | 'decayed';

export interface TileModel {
  letter: string;
  kind: TileKind;
  suspected?: boolean; // Suspect: player accused this tile
  lie?: boolean; // Suspect: revealed at game end
  truth?: TileKind; // Suspect: the real colour, shown on lie reveal
  interactive?: boolean;
}

export interface RowModel {
  tiles: TileModel[];
  meta?: string;
  current?: boolean;
  /** Reverse: the bot is mid-thought on this row */
  thinking?: boolean;
  /** Suspect: show ✓/✗ after the row once lies are revealed */
  verdict?: 'caught' | 'missed';
}

export type TileHow = 'tap' | 'accuse' | 'key';

interface TileView {
  el: HTMLElement;
  letter: HTMLElement;
  glyph: HTMLElement;
  m: TileModel;
}
interface RowView {
  el: HTMLElement;
  tiles: TileView[];
  meta: HTMLElement;
}

const GLYPH: Record<TileKind, string> = { G: '●', Y: '◐', B: '○', decayed: '', empty: '', tbd: '' };
const SAY: Record<TileKind, string> = {
  G: 'correct spot',
  Y: 'in the word',
  B: 'not in the word',
  decayed: 'faded',
  empty: 'empty',
  tbd: '',
};

const FLIP_HALF = 190;
const FLIP_STAGGER = 230;
export const revealMs = () => motionMs(FLIP_STAGGER * 4 + FLIP_HALF * 2);

interface BoardOpts {
  mode: 'fit' | 'grow';
  rows?: number;
  onTile?: (row: number, col: number, how: TileHow) => void;
  longPress?: boolean;
}

export class Board {
  readonly el: HTMLElement;
  private rows: RowView[] = [];
  private opts: BoardOpts;

  constructor(opts: BoardOpts) {
    this.opts = opts;
    this.el = h('div', { class: `board ${opts.mode}`, role: 'grid', 'aria-label': 'Guesses' });
    if (opts.rows) this.el.style.setProperty('--rows', String(opts.rows));
  }

  private makeRow(r: number): RowView {
    const tiles: TileView[] = [];
    const el = h('div', { class: 'row', role: 'row' });
    for (let c = 0; c < 5; c++) {
      const letter = h('span', { class: 'l' });
      const glyph = h('span', { class: 'g', 'aria-hidden': 'true' });
      const t = h('div', { class: 'tile', 'data-k': 'empty', role: 'gridcell' }, letter, glyph);
      this.wireTile(t, r, c);
      el.append(t);
      tiles.push({ el: t, letter, glyph, m: { letter: '', kind: 'empty' } });
    }
    const meta = h('div', { class: 'row-meta' });
    el.append(meta);
    return { el, tiles, meta };
  }

  private wireTile(t: HTMLElement, r: number, c: number) {
    // pointer users never focus tiles; physical Enter must keep submitting guesses
    t.addEventListener('mousedown', (e) => e.preventDefault());
    const fire = (how: TileHow) => {
      if (t.classList.contains('interactive')) this.opts.onTile?.(r, c, how);
    };
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        fire('key');
      }
    });
    if (!this.opts.longPress) {
      t.addEventListener('click', () => fire('tap'));
      return;
    }
    // long-press / right-click to accuse
    let timer = 0;
    let sx = 0;
    let sy = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
      t.classList.remove('pressing');
    };
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (timer || (e as PointerEvent).pointerType === 'touch') return;
      cancel();
      fire('accuse');
    });
    t.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !t.classList.contains('interactive')) return;
      sx = e.clientX;
      sy = e.clientY;
      t.classList.add('pressing');
      timer = window.setTimeout(() => {
        timer = 0;
        t.classList.remove('pressing');
        fire('accuse');
      }, 420);
    });
    t.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    });
    t.addEventListener('pointerup', () => {
      if (timer) {
        cancel();
        fire('tap');
      }
    });
    t.addEventListener('pointercancel', cancel);
    t.addEventListener('pointerleave', cancel);
  }

  private paint(tv: TileView, m: TileModel) {
    const { el } = tv;
    if (tv.letter.textContent !== m.letter) tv.letter.textContent = m.letter;
    el.dataset.k = m.kind;
    tv.glyph.textContent = m.lie ? '!' : GLYPH[m.kind];
    el.classList.toggle('suspected', !!m.suspected);
    el.classList.toggle('lie', !!m.lie);
    el.classList.toggle('interactive', !!m.interactive);
    if (m.truth) el.dataset.truth = m.truth;
    else delete el.dataset.truth;
    el.tabIndex = m.interactive ? 0 : -1;
    if (m.interactive) el.setAttribute('role', 'button');
    else el.setAttribute('role', 'gridcell');
    const parts = [m.letter || 'blank', SAY[m.kind]];
    if (m.suspected) parts.push('accused');
    if (m.lie) parts.push(`lie, really ${SAY[m.truth ?? 'B']}`);
    el.setAttribute('aria-label', parts.filter(Boolean).join(', '));
    tv.m = m;
  }

  get rowCount() {
    return this.rows.length;
  }

  rowEl(r: number): HTMLElement | undefined {
    return this.rows[r]?.el;
  }

  /**
   * Diff models onto the DOM. `reveal` flips that row tile-by-tile (colour
   * swaps at the edge-on midpoint). Resolves when every animation is done.
   */
  async update(models: RowModel[], o: { live: boolean; reveal?: number; revealRows?: number[] }) {
    const work: Promise<unknown>[] = [];
    const reveal = new Set(o.revealRows ?? (o.reveal != null ? [o.reveal] : []));

    while (this.rows.length < models.length) {
      const r = this.rows.length;
      const rv = this.makeRow(r);
      this.rows.push(rv);
      this.el.append(rv.el);
      if (o.live && this.opts.mode === 'grow') {
        work.push(
          animate(
            rv.el,
            [
              { opacity: 0, transform: 'translateY(12px)', clipPath: 'inset(0 0 100% 0)' },
              { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
            ],
            { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' },
          ),
        );
      }
    }
    while (this.rows.length > models.length) this.rows.pop()!.el.remove();

    models.forEach((row, r) => {
      const rv = this.rows[r];
      rv.el.classList.toggle('current', !!row.current);
      rv.el.classList.toggle('thinking', !!row.thinking);
      rv.el.dataset.verdict = row.verdict ?? '';
      const metaChanged = rv.meta.textContent !== (row.meta ?? '');
      if (metaChanged) {
        rv.meta.textContent = row.meta ?? '';
        rv.el.classList.toggle('has-meta', !!row.meta);
        if (o.live && row.meta)
          work.push(
            animate(rv.meta, [{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }], {
              duration: 240,
              delay: reveal.has(r) ? revealMs() : 0,
              easing: 'ease-out',
              fill: 'backwards',
            }),
          );
      }
      let typedN = 0;
      row.tiles.forEach((m, c) => {
        const tv = rv.tiles[c];
        const prev = tv.m;
        if (o.live && reveal.has(r) && m.kind !== prev.kind) {
          work.push(this.flipTile(tv, m, c * FLIP_STAGGER));
          return;
        }
        const typed = o.live && !prev.letter && m.letter;
        this.paint(tv, m);
        if (typed) {
          animate(tv.el, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], {
            duration: 110,
            delay: typedN++ * 70,
            easing: 'ease-out',
          });
        }
      });
    });
    await Promise.all(work);
  }

  private async flipTile(tv: TileView, m: TileModel, delay: number) {
    if (!motionMs(1)) return this.paint(tv, m);
    await sleep(delay);
    await animate(tv.el, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(-90deg)' }], {
      duration: FLIP_HALF,
      easing: 'ease-in',
      fill: 'forwards',
    });
    this.paint(tv, m);
    await animate(tv.el, [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0)' }], {
      duration: FLIP_HALF,
      easing: 'ease-out',
    });
    tv.el.getAnimations().forEach((a) => a.cancel());
  }

  /** Quick single-tile flip, for cycling Reverse feedback. */
  async flipTo(r: number, c: number, m: TileModel) {
    const tv = this.rows[r]?.tiles[c];
    if (!tv) return;
    if (!motionMs(1)) return this.paint(tv, m);
    await animate(tv.el, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(-90deg)' }], {
      duration: 70,
      easing: 'ease-in',
      fill: 'forwards',
    });
    this.paint(tv, m);
    await animate(tv.el, [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0)' }], {
      duration: 90,
      easing: 'ease-out',
    });
    tv.el.getAnimations().forEach((a) => a.cancel());
  }

  shake(r: number) {
    const el = this.rows[r]?.el;
    if (!el) return;
    haptic('error');
    animate(
      el,
      [0, -8, 7, -6, 5, -3, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 380, easing: 'ease-out' },
    );
  }

  async bounce(r: number) {
    const rv = this.rows[r];
    if (!rv) return;
    await Promise.all(
      rv.tiles.map((t, i) =>
        animate(
          t.el,
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(-38%)', offset: 0.4 },
            { transform: 'translateY(4%)', offset: 0.7 },
            { transform: 'translateY(0)' },
          ],
          { duration: 420, delay: i * 90, easing: 'cubic-bezier(.3,.7,.4,1)' },
        ),
      ),
    );
  }

  scrollToRow(r: number) {
    const el = this.rows[r]?.el;
    el?.scrollIntoView({ block: 'nearest', behavior: motionMs(1) ? 'smooth' : 'auto' });
  }
}
