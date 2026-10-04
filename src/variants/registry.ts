import decay from './decay';
import reverse from './reverse';
import suspect from './suspect';
import warmer from './warmer';
import bridge from './bridge';
import missing from './clue/missing';
import define from './clue/define';
import chrono from './chrono';
import type { AnyVariant } from './types';

// Adding a variant = write a module, add one line here.
const ALL: AnyVariant[] = [decay, reverse, suspect, warmer, bridge, missing, define, chrono];

/** Content variants stay hidden in production until a reviewed pool is frozen. */
export const VARIANTS = ALL.filter((v) => v.available?.() ?? true);
export const byId = (id: string) => VARIANTS.find((v) => v.id === id);
