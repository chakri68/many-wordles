// localStorage, but it's allowed to not exist. Every access is try/catch'd and
// the game keeps working (minus streaks) when storage is blocked.
const PREFIX = 'mw:v1:';

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode, quota, disabled: play on */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
}

// ---- game log -------------------------------------------------------------
// One log per (slot, day), so hopping between archive days doesn't wipe the
// one you left. Today's games and archive games live in separate slots: a
// future puzzle you played ahead starts fresh (and counts) once it's today.

export interface SavedGame<A> {
  day: number;
  actions: A[];
}

export function loadGame<A>(variant: string, day: number): A[] {
  const own = read<A[] | null>(`${variant}:game:${day}`, null);
  if (Array.isArray(own)) return own;
  // pre-per-day saves: a single slot holding whichever day was last played
  const g = read<SavedGame<A> | null>(`${variant}:game`, null);
  return g && g.day === day && Array.isArray(g.actions) ? g.actions : [];
}

export function saveGame<A>(variant: string, day: number, actions: A[]): void {
  write(`${variant}:game:${day}`, actions);
}

// ---- per-day results ------------------------------------------------------
// Every finished game, today's or archive, so the archive can mark what's done.

export type DayResult = { won: boolean; label: string };

export function loadResults(variant: string): Record<number, DayResult> {
  const r = read<Record<number, DayResult> | null>(`${variant}:results`, null);
  return r && typeof r === 'object' ? r : {};
}

export function saveResult(variant: string, day: number, r: DayResult): void {
  write(`${variant}:results`, { ...loadResults(variant), [day]: { won: r.won, label: r.label } });
}

// ---- stats ----------------------------------------------------------------

export interface Stats {
  played: number;
  won: number;
  streak: number;
  maxStreak: number;
  lastDay: number;
  histogram: Record<string, number>;
  /** last finished day + its summary, for the hub card */
  lastResult?: { day: number; label: string; won: boolean };
}

export const emptyStats = (): Stats => ({
  played: 0,
  won: 0,
  streak: 0,
  maxStreak: 0,
  lastDay: -Infinity,
  histogram: {},
});

export function loadStats(variant: string): Stats {
  const s = read<Stats | null>(`${variant}:stats`, null);
  if (!s) return emptyStats();
  // JSON turns -Infinity into null
  return { ...emptyStats(), ...s, lastDay: s.lastDay ?? -Infinity };
}

/** Pure: fold one finished game into stats. Idempotent per day. */
export function recordResult(
  s: Stats,
  day: number,
  r: { won: boolean; label: string },
  bucket: string,
): Stats {
  if (s.lastDay >= day) return s;
  const streak = r.won ? (s.lastDay === day - 1 ? s.streak + 1 : 1) : 0;
  return {
    played: s.played + 1,
    won: s.won + (r.won ? 1 : 0),
    streak,
    maxStreak: Math.max(s.maxStreak, streak),
    lastDay: day,
    histogram: { ...s.histogram, [bucket]: (s.histogram[bucket] ?? 0) + 1 },
    lastResult: { day, label: r.label, won: r.won },
  };
}

/** Streak shown on the hub: a streak is dead if yesterday was skipped. */
export function liveStreak(s: Stats, today: number): number {
  return s.lastDay >= today - 1 ? s.streak : 0;
}

export const saveStats = (variant: string, s: Stats) => write(`${variant}:stats`, s);
