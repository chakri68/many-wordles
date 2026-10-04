// "Path" chart: rank per guess on a log axis, #1 at the top. One series, so no
// legend; the heading names it. Crosshair + tooltip on hover/tap.
import type { Sem } from '../../engine/semantic';
import { h } from '../../ui/dom';
import { fmt } from '../../ui/word-input';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export function pathPlot(guesses: { w: number; rank: number; hint?: boolean }[], sem: Sem): HTMLElement {
  const W = 320;
  const H = 132;
  const L = 40; // room for y labels
  const R = 8;
  const T = 8;
  const B = 18;
  const n = guesses.length;
  const x = (i: number) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (rank: number) => T + (Math.log(rank) / Math.log(sem.n)) * (H - T - B);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img' });
  svg.setAttribute('aria-label', `Rank of each guess, from #${fmt(guesses[0].rank)} to #${fmt(guesses[n - 1].rank)}`);

  for (const r of [1, 10, 100, 1000, 10000]) {
    if (r > sem.n) continue;
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(r), y2: y(r), class: 'grid' }));
    const t = svgEl('text', { x: L - 6, y: y(r) + 3, class: 'tick', 'text-anchor': 'end' });
    t.textContent = r === 1 ? '★' : `#${r >= 1000 ? `${r / 1000}k` : r}`;
    svg.append(t);
  }
  const xl = svgEl('text', { x: W - R, y: H - 4, class: 'tick', 'text-anchor': 'end' });
  xl.textContent = `guess ${n}`;
  const x0 = svgEl('text', { x: L, y: H - 4, class: 'tick' });
  x0.textContent = '1';
  svg.append(xl, x0);

  const d = guesses.map((g, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(g.rank).toFixed(1)}`).join('');
  svg.append(svgEl('path', { d, class: 'line' }));

  // only the best guess gets a marker: selective, not a dot on every point
  let bi = 0;
  guesses.forEach((g, i) => g.rank < guesses[bi].rank && (bi = i));
  svg.append(svgEl('circle', { cx: x(bi), cy: y(guesses[bi].rank), r: 4.5, class: 'best' }));

  const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross' });
  const dot = svgEl('circle', { r: 4, class: 'hover' });
  svg.append(cross, dot);

  const tip = h('div', { class: 'plot-tip', role: 'status' });
  const wrap = h('div', { class: 'plot-wrap' }, svg, tip);

  const show = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - L) / (W - L - R)) * (n - 1))));
    const g = guesses[i];
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    dot.setAttribute('cx', String(x(i)));
    dot.setAttribute('cy', String(y(g.rank)));
    wrap.classList.add('active');
    tip.textContent = `${i + 1}. ${sem.vocab[g.w].toUpperCase()}  ${g.rank === 1 ? '★' : `#${fmt(g.rank)}`}${g.hint ? ' (hint)' : ''}`;
    const px = (x(i) / W) * box.width;
    tip.style.left = `${Math.max(60, Math.min(box.width - 60, px))}px`;
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', () => wrap.classList.remove('active'));

  return h('div', {}, h('h4', { class: 'section-h' }, 'your path'), wrap);
}
