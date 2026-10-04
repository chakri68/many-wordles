// The plug-in contract (spec §3.4), plus a few optional hooks the shell uses.
export interface Flash {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export interface GameResult {
  won: boolean;
  score: number;
  label: string;
}

export interface RenderCtx {
  /** false on the first paint after a replay: no animations, no toasts */
  live: boolean;
}

export interface Variant<State, Action> {
  id: string;
  name: string;
  tagline: string;
  rulesHtml: string;
  init(day: number, seed: number): Promise<State>;
  reduce(state: State, action: Action): State; // pure
  /** Resolves once this update's animations have settled. */
  render(root: HTMLElement, state: State, dispatch: (a: Action) => void, ctx: RenderCtx): void | Promise<void>;
  isOver(state: State): boolean;
  result(state: State): GameResult;
  shareText(state: State, day: number): string;

  /** stats histogram buckets, in display order */
  buckets: string[];
  bucketOf(state: State): string;
  /** side effects (e.g. the Reverse solver), run after each render */
  effects?(state: State, dispatch: (a: Action) => void): void;
  /** tear down listeners/workers when leaving the route */
  destroy?(root: HTMLElement): void;
  /** the end-screen headline + detail */
  summary(state: State): { title: string; detail: string };
}

// eslint-friendly erased helper so the registry can hold heterogeneous variants
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyVariant = Variant<any, any>;
