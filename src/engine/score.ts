// The reference Wordle scoring (two-pass, duplicate-safe).
export type Mark = 'G' | 'Y' | 'B';

export function score(guess: string, answer: string): Mark[] {
  const out: Mark[] = ['B', 'B', 'B', 'B', 'B'];
  const counts = new Int8Array(26);
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = 'G';
    else counts[answer.charCodeAt(i) - 97]++;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'G') continue;
    const c = guess.charCodeAt(i) - 97;
    if (counts[c] > 0) {
      out[i] = 'Y';
      counts[c]--;
    }
  }
  return out;
}

/**
 * Same algorithm on pre-encoded words (Uint8Array of 0..25), returning the
 * base-3 pattern code directly. This is the solver's hot loop.
 */
const scratch = new Int8Array(26);
export function scoreCode(g: Uint8Array, go: number, a: Uint8Array, ao: number): number {
  let green = 0;
  for (let i = 0; i < 5; i++) {
    if (g[go + i] === a[ao + i]) green |= 1 << i;
    else scratch[a[ao + i]]++;
  }
  let code = 0;
  let mul = 1;
  for (let i = 0; i < 5; i++) {
    if (green & (1 << i)) code += 2 * mul;
    else {
      const c = g[go + i];
      if (scratch[c] > 0) {
        code += mul;
        scratch[c]--;
      }
    }
    mul *= 3;
  }
  for (let i = 0; i < 5; i++) scratch[a[ao + i]] = 0;
  return code;
}
