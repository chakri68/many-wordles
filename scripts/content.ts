// Content pipeline: draft -> human review -> freeze.
//
//   node scripts/content.ts check               validate every draft pool
//   node scripts/content.ts freeze <pool> [--from <day>]
//
// Freezing writes public/content/<pool>.v<N>.json from APPROVED items only,
// in a stable order, and records it (with its sha256) in src/content/frozen.json.
// A frozen file is never edited; new content means v<N+1> with a later --from,
// so past puzzle numbers keep replaying (spec §3.1 rule 1, §9 phase 3).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validate } from '../src/content/validate.ts';
import type { FrozenManifest, PoolId } from '../src/content/types.ts';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const POOLS: PoolId[] = ['missing', 'define', 'events'];
const vocab = new Set([...read('public/semantic/vocab.v1.txt').split('\n'), ...read('public/words/extra.v1.txt').split('\n')].filter(Boolean));

type Item = { status?: string; note?: string } & Record<string, unknown>;
const drafts = (pool: PoolId): Item[] => JSON.parse(read(`content/drafts/${pool}.json`));

function check(pool: PoolId): number {
  const items = drafts(pool);
  const problems = validate(pool, items, vocab);
  const by = (s: string) => items.filter((x) => (x.status ?? 'draft') === s).length;
  console.log(`${pool.padEnd(8)} ${items.length} items · ${by('approved')} approved · ${by('draft')} draft · ${by('rejected')} rejected`);
  for (const p of problems) console.log(`  #${p.index + 1}: ${p.message}`);
  return problems.length;
}

function freeze(pool: PoolId, from: number | null) {
  const approved = drafts(pool)
    .filter((x) => x.status === 'approved')
    .map(({ status: _s, note: _n, ...rest }) => rest);
  if (!approved.length) throw new Error(`no approved ${pool} items; review them first (npm run dev -> #/review)`);
  const problems = validate(pool, approved, vocab);
  if (problems.length) throw new Error(`approved ${pool} items have problems:\n${problems.map((p) => `  ${p.message}`).join('\n')}`);

  const manifest: FrozenManifest = JSON.parse(read('src/content/frozen.json'));
  const versions = manifest[pool];
  const last = versions.at(-1);
  const v = versions.length + 1;
  const start = from ?? (last ? null : 1);
  if (start == null) throw new Error(`${pool} already has v${v - 1}; pass --from <day> (> ${last!.from}) for v${v}`);
  if (last && start <= last.from) throw new Error(`--from must be after v${v - 1}'s ${last.from}`);

  const file = `content/${pool}.v${v}.json`;
  if (existsSync(new URL(`public/${file}`, root))) throw new Error(`${file} already exists; frozen files are never overwritten`);
  const body = JSON.stringify(approved) + '\n';
  writeFileSync(new URL(`public/${file}`, root), body);
  versions.push({ from: start, file, sha256: createHash('sha256').update(body).digest('hex'), count: approved.length });
  writeFileSync(new URL('src/content/frozen.json', root), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`froze ${approved.length} ${pool} items -> public/${file} (from day ${start})`);
}

const [cmd, pool, ...rest] = process.argv.slice(2);
if (cmd === 'check') {
  const n = POOLS.reduce((acc, p) => acc + check(p), 0);
  process.exitCode = n ? 1 : 0;
} else if (cmd === 'freeze' && POOLS.includes(pool as PoolId)) {
  const i = rest.indexOf('--from');
  freeze(pool as PoolId, i >= 0 ? Number(rest[i + 1]) : null);
} else {
  console.log('usage: node scripts/content.ts check | freeze <missing|define|events> [--from <day>]');
  process.exitCode = 1;
}
