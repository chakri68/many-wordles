// The classic board + keyboard screen, shared by Decay and Suspect.
import { haptic } from '../engine/haptics';
import { Board, type RowModel, type TileHow } from '../ui/board';
import { Keyboard, type KeyPaint } from '../ui/keyboard';
import { h, onGameKey, sleep, motionMs } from '../ui/dom';
import { toast } from '../ui/toast';
import type { Flash } from './types';

export interface ViewInfo {
  submitted: number; // rows scored so far
  won: boolean;
  lost: boolean;
  lostText?: string;
  /** rows to flip at game end (Suspect's lie reveal) */
  endReveal?: number[];
  /** an "aside" line under the board */
  hint?: string;
}

export class WordleView {
  readonly board: Board;
  readonly keyboard: Keyboard;
  private hintEl: HTMLElement;
  private submitted = -1;
  private flashId = 0;
  private last: RowModel[] = [];
  private busy = false;
  private ended = false;
  private off: () => void;

  constructor(
    root: HTMLElement,
    rows: number,
    onKey: (k: string) => void,
    opts: { onTile?: (r: number, c: number, how: TileHow) => void; longPress?: boolean } = {},
  ) {
    this.board = new Board({ mode: 'fit', rows, onTile: opts.onTile, longPress: opts.longPress });
    const guarded = (k: string) => {
      if (!this.busy) onKey(k);
    };
    this.keyboard = new Keyboard(guarded);
    this.hintEl = h('p', { class: 'board-hint', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'well' }, this.board.el),
      this.hintEl,
      h('div', { class: 'kb-dock' }, this.keyboard.el),
    );
    this.off = onGameKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'enter') {
        if ((e.target as HTMLElement)?.closest?.('.tile.interactive')) return;
        e.preventDefault();
        haptic('press');
        guarded('enter');
      } else if (k === 'backspace') {
        e.preventDefault();
        guarded('back');
      } else if (/^[a-z]$/.test(k)) guarded(k);
    });
  }

  async update(rows: RowModel[], keys: Map<string, KeyPaint>, flash: Flash | undefined, live: boolean, info: ViewInfo) {
    const first = this.submitted < 0;
    const fresh = !first && live && info.submitted > this.submitted;
    const newRow = info.submitted - 1;
    this.submitted = info.submitted;

    this.hintEl.textContent = info.hint ?? '';
    this.hintEl.classList.toggle('show', !!info.hint);

    if (flash && flash.id !== this.flashId) {
      if (live && !first) {
        toast(flash.text, { kind: flash.kind });
        const cur = rows.findIndex((r) => r.current);
        if (flash.kind === 'error' && cur >= 0) this.board.shake(cur);
      }
      this.flashId = flash.id;
    }

    if (!fresh) {
      await this.board.update(rows, { live: live && !first });
      this.last = rows;
      this.keyboard.paint(keys);
      if (!this.busy) {
        this.ended = info.won || info.lost;
        this.keyboard.setDisabled(this.ended);
      }
      return;
    }

    // 1) flip the new row in while older rows hold still
    this.busy = true;
    this.keyboard.setDisabled(true);
    const interim = rows.map((m, i) => (i < newRow && this.last[i] ? this.last[i] : m));
    await this.board.update(interim, { live: true, reveal: newRow });
    // 2) then let the past decay / settle (CSS drives the 400ms drain)
    const sig = (m?: RowModel) => m?.tiles.map((t) => t.kind).join() ?? '';
    const changedPast = rows.some((m, i) => i < newRow && sig(m) !== sig(interim[i]));
    await this.board.update(rows, { live: true, revealRows: info.endReveal });
    if (changedPast) await sleep(motionMs(420));
    this.last = rows;
    this.keyboard.paint(keys);

    if (info.won) {
      haptic('success');
      await this.board.bounce(newRow);
    } else if (info.lost && info.lostText && !this.ended) {
      haptic('warn');
      toast(info.lostText, { ms: 3200 });
    }
    this.ended = info.won || info.lost;
    this.busy = false;
    this.keyboard.setDisabled(this.ended);
  }

  destroy() {
    this.off();
  }
}
