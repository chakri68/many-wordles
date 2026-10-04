// One-off: rank every allowed word as a minimax opener over the answers and
// freeze the best 20. The date only picks an index into this table.
// run: node scripts/openers.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { scoreCode } from '../src/engine/score.ts';

const read = (p: string) => readFileSync(new URL(`../public/words/${p}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
const answers = read('answers.v1.txt');
const allowed = [...new Set([...read('allowed.v1.txt'), ...answers])].sort();
const encodeWords = (ws: string[]) => {
  const out = new Uint8Array(ws.length * 5);
  ws.forEach((w, i) => { for (let j = 0; j < 5; j++) out[i * 5 + j] = w.charCodeAt(j) - 97; });
  return out;
};
const aEnc = encodeWords(answers);
const gEnc = encodeWords(allowed);
const counts = new Uint16Array(243);

const ranked = allowed.map((w, gi) => {
  counts.fill(0);
  let max = 0;
  for (let a = 0; a < answers.length; a++) {
    const n = ++counts[scoreCode(gEnc, gi * 5, aEnc, a * 5)];
    if (n > max) max = n;
  }
  return { w, max };
});
ranked.sort((a, b) => a.max - b.max || (a.w < b.w ? -1 : 1));
const top = ranked.slice(0, 20);
console.table(top);
writeFileSync(
  new URL('../public/reverse/openers.v1.json', import.meta.url),
  JSON.stringify(top.map((t) => t.w)) + '\n',
);
