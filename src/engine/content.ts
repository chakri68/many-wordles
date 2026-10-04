// Versioned content pools. Same contract as the word lists: frozen files, a
// switch day per version, and the date picks an index by keyed permutation.
import FROZEN_JSON from '../content/frozen.json';
import type { FrozenManifest, PoolId } from '../content/types';

const FROZEN = FROZEN_JSON as FrozenManifest;

/** In production a pool exists only once something has been approved + frozen. */
export const poolReady = (id: PoolId) => FROZEN[id].length > 0 || import.meta.env.DEV;

/** Usable while developing: unreviewed drafts, rejected ones filtered out. */
async function drafts<T>(id: PoolId): Promise<T[]> {
  let mod: { default: unknown };
  if (id === 'missing') mod = await import('../../content/drafts/missing.json');
  else if (id === 'define') mod = await import('../../content/drafts/define.json');
  else mod = await import('../../content/drafts/events.json');
  return (mod.default as (T & { status?: string })[]).filter((x) => x.status !== 'rejected');
}

const cache = new Map<string, Promise<unknown[]>>();

export function loadPool<T>(id: PoolId, day: number): Promise<T[]> {
  const versions = FROZEN[id];
  if (!versions.length) {
    if (import.meta.env.DEV) return drafts<T>(id);
    return Promise.reject(new Error(`no frozen ${id} pool`));
  }
  // latest version whose switch day has arrived; day < first.from uses v1
  const v = [...versions].reverse().find((x) => day >= x.from) ?? versions[0];
  let p = cache.get(v.file);
  if (!p) {
    const base = import.meta.env?.BASE_URL ?? './';
    p = fetch(new URL(base + v.file, location.href)).then((r) => {
      if (!r.ok) throw new Error(`${v.file}: ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(v.file));
    cache.set(v.file, p);
  }
  return p as Promise<T[]>;
}
