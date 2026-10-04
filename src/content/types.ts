// Curated content (spec §9, phase 3). Drafts live in content/drafts/*.json,
// get human review, and only APPROVED items are frozen into public/content.

export type Status = 'draft' | 'approved' | 'rejected';
export type PoolId = 'missing' | 'define' | 'events';

export interface Reviewable {
  status?: Status;
  note?: string;
}

/** Missing: 6 sentences, vague -> specific, each with the answer as "___". */
export interface ClueItem extends Reviewable {
  answer: string;
  clues: string[];
}

export const CATS = ['conflict', 'politics', 'science', 'tech', 'space', 'exploration', 'culture', 'sport', 'disaster'] as const;
export type Cat = (typeof CATS)[number];

/** Before/After: one historical event. Year < 0 is BCE. */
export interface EventItem extends Reviewable {
  name: string;
  year: number;
  cat: Cat;
}

export interface FrozenPool {
  /** first puzzle day this version is used for */
  from: number;
  /** path under public/ */
  file: string;
  sha256: string;
  count: number;
}

export type FrozenManifest = Record<PoolId, FrozenPool[]>;
