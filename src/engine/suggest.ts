// Spelling-fuzzy autocomplete over a word list. Letters, not meaning: this is
// the "did you mean" box, not a hint.

/** typos forgiven for a query this long */
const budget = (n: number) => (n < 3 ? 0 : n < 6 ? 1 : 2);

/**
 * Edit distance (with adjacent swaps) from `q` to the closest prefix of `w`,
 * or Infinity once it's clearly over `k`. Measuring against prefixes is what
 * lets half a misspelt word ("elephnt", "recie") still find its match.
 * Returned as a rank, 2d + (whole word is further off ? 1 : 0), so RECIEVE
 * offers RECEIVE before the commoner RECEIVED.
 */
function rank(q: string, w: string, k: number, prev2: Int32Array, prev: Int32Array, cur: Int32Array): number {
  const m = q.length;
  const rows = Math.min(w.length, m + k);
  if (rows < m - k) return Infinity;
  for (let j = 0; j <= m; j++) prev[j] = j;
  let best = prev[m];
  let lastMin = 0;
  let whole = Infinity;
  for (let i = 1; i <= rows; i++) {
    const c = w.charCodeAt(i - 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = c === q.charCodeAt(j - 1) ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && c === q.charCodeAt(j - 2) && w.charCodeAt(i - 2) === q.charCodeAt(j - 1)) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (cur[m] < best) best = cur[m];
    if (i === w.length) whole = cur[m];
    // a swap can reach back two rows, so bail only after two rows over budget
    if (rowMin > k && lastMin > k) break;
    lastMin = rowMin;
    prev2.set(prev);
    prev.set(cur);
  }
  return best > k ? Infinity : 2 * best + (whole > best ? 1 : 0);
}

/**
 * Up to `limit` words from `words` that look like `query`: exact hit first,
 * then by typo count (0 = plain prefix), whole-word matches before prefixes,
 * then list order. Lists here are frequency-ordered, so ties go to the
 * commoner word.
 */
export function suggestWords(words: readonly string[], query: string, limit = 5): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || !/^[a-z]+$/.test(q)) return [];
  const k = budget(q.length);
  const a = new Int32Array(q.length + 1);
  const b = new Int32Array(q.length + 1);
  const c = new Int32Array(q.length + 1);
  // bucket by rank (0 is the exact word); each fills in list order, so no sort needed
  const buckets: string[][] = Array.from({ length: 2 * k + 2 }, () => []);
  for (const w of words) {
    if (buckets[1].length >= limit) break; // a full bucket of plain prefixes: only the exact word could still win
    const r = rank(q, w, k, a, b, c);
    if (r !== Infinity && buckets[r].length < limit) buckets[r].push(w);
  }
  if (!buckets[0].length && words.includes(q)) buckets[0].push(q);
  return buckets.flat().slice(0, limit);
}
