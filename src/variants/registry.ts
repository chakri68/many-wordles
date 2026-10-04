import decay from './decay';
import reverse from './reverse';
import suspect from './suspect';
import type { AnyVariant } from './types';

// Adding a variant = write a module, add one line here.
export const VARIANTS: AnyVariant[] = [decay, reverse, suspect];
export const byId = (id: string) => VARIANTS.find((v) => v.id === id);
