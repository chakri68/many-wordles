// Determinism rule 3 (spec §3.1): no ambient randomness in generators.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

it('no Math.random / Date.now / locale APIs in engine or variant logic', () => {
  const files = [...walk(join(SRC, 'engine')), ...walk(join(SRC, 'variants'))].filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const bad = files.filter((f) => /Math\.random|Date\.now\(/.test(readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
