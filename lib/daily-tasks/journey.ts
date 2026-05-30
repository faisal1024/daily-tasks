// Journey: the gamification layer for Momentum.
//
// Pure, side-effect-free logic for XP, levels, a non-judgmental "showed up"
// streak, and cosmetic unlocks. Kept self-contained (no imports from other
// app modules) so it can be unit-tested in isolation and reused freely.
//
// Tone rules baked in here:
//   - The streak counts *engagement*, not perfection — a single missed day is
//     absorbed by a freeze instead of shaming the user back to zero.
//   - XP is only ever added, never subtracted, so un-checking a task never
//     feels like a punishment. Per-day, per-task award guards prevent farming.

export const XP_PER_TASK = 10;
export const XP_PERFECT_DAY = 25;
export const XP_PER_MILESTONE = 100;

export const MAX_SHOWED_UP_FREEZES = 2;
/** Earn one streak freeze for every N consecutive days shown up. */
export const FREEZE_EARN_EVERY = 7;

export interface JourneyCosmetic {
  id: string;
  label: string;
  unlockLevel: number;
  premium: boolean;
}

export interface Journey {
  /** Lifetime experience points. Monotonically non-decreasing. */
  xp: number;
  /** Consecutive days the user engaged (completed at least one task). */
  showedUpStreak: number;
  longestShowedUpStreak: number;
  /** Grace days that absorb a miss without resetting the streak. */
  showedUpFreezes: number;
  lastShowedUpDate: string | null;
  /** Highest level the UI has already celebrated (drives level-up moments). */
  lastCelebratedLevel: number;
  // Per-day award guards (reset when awardDate rolls over).
  awardDate: string | null;
  awardedTaskIds: string[];
  perfectAwarded: boolean;
  /** Currently equipped journey visual. */
  selectedCosmeticId: string;
}

export interface LevelProgress {
  level: number;
  /** XP earned since the start of the current level. */
  xpIntoLevel: number;
  /** Total XP between the current level's start and the next level's start. */
  xpSpanForLevel: number;
  /** XP still needed to reach the next level. */
  xpRemaining: number;
  ratio: number;
}

// Cosmetic journey visuals, unlocked by level. Surfaced and selected from the
// Journey tab UI; premium entries are gated behind the (future) entitlement.
// Labels are deliberately non-plant themes so they don't collide with the
// growth stages (Seed/Sprout/Sapling/Tree/Grove) shown on the same screen.
// Ids are stable (persisted in selectedCosmeticId) — only labels are cosmetic.
export const JOURNEY_COSMETICS: JourneyCosmetic[] = [
  { id: "sprout", label: "Meadow", unlockLevel: 1, premium: false },
  { id: "sapling", label: "Sky", unlockLevel: 2, premium: false },
  { id: "grove", label: "Forest", unlockLevel: 4, premium: false },
  { id: "dawn", label: "Dawn", unlockLevel: 3, premium: true },
  { id: "aurora", label: "Aurora", unlockLevel: 6, premium: true },
];

export const DEFAULT_JOURNEY: Journey = {
  xp: 0,
  showedUpStreak: 0,
  longestShowedUpStreak: 0,
  showedUpFreezes: 1,
  lastShowedUpDate: null,
  lastCelebratedLevel: 1,
  awardDate: null,
  awardedTaskIds: [],
  perfectAwarded: false,
  selectedCosmeticId: "sprout",
};

/** Level curve: each level costs progressively more XP (quadratic). */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
}

/** Total XP required to reach the start of a given level. */
export function xpForLevel(level: number): number {
  const steps = Math.max(1, Math.floor(level)) - 1;
  return steps * steps * 50;
}

export function levelProgress(xp: number): LevelProgress {
  const safe = Math.max(0, xp);
  const level = levelForXp(safe);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = safe - base;
  return {
    level,
    xpIntoLevel: into,
    xpSpanForLevel: span,
    xpRemaining: Math.max(0, span - into),
    ratio: span === 0 ? 0 : into / span,
  };
}

function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

function ensureDay(journey: Journey, today: string): Journey {
  if (journey.awardDate === today) return journey;
  return { ...journey, awardDate: today, awardedTaskIds: [], perfectAwarded: false };
}

/**
 * Record that the user engaged today. Grows the streak by one for a
 * consecutive day, absorbs short gaps with available freezes, and only resets
 * when the gap exceeds the freezes the user has banked.
 */
export function registerShowedUp(journey: Journey, today: string): Journey {
  if (journey.lastShowedUpDate === today) return journey;

  let streak: number;
  let freezes = journey.showedUpFreezes;

  if (!journey.lastShowedUpDate) {
    streak = 1;
  } else {
    const gap = daysBetween(journey.lastShowedUpDate, today);
    if (gap <= 0) return journey; // guard against clock skew / replays
    if (gap === 1) {
      streak = journey.showedUpStreak + 1;
    } else {
      const missed = gap - 1;
      if (missed <= freezes) {
        streak = journey.showedUpStreak + 1;
        freezes -= missed;
      } else {
        streak = 1;
      }
    }
  }

  if (streak > 0 && streak % FREEZE_EARN_EVERY === 0) {
    freezes = Math.min(MAX_SHOWED_UP_FREEZES, freezes + 1);
  }

  return {
    ...journey,
    showedUpStreak: streak,
    longestShowedUpStreak: Math.max(journey.longestShowedUpStreak, streak),
    showedUpFreezes: freezes,
    lastShowedUpDate: today,
  };
}

/** Award XP for completing a task (once per task per day) + register engagement. */
export function awardTaskCompletion(journey: Journey, taskId: string, today: string): Journey {
  const day = ensureDay(journey, today);
  if (day.awardedTaskIds.includes(taskId)) {
    return registerShowedUp(day, today);
  }
  const awarded: Journey = {
    ...day,
    xp: day.xp + XP_PER_TASK,
    awardedTaskIds: [...day.awardedTaskIds, taskId],
  };
  return registerShowedUp(awarded, today);
}

/** Award the perfect-day bonus once per day. */
export function awardPerfectDay(journey: Journey, today: string): Journey {
  const day = ensureDay(journey, today);
  if (day.perfectAwarded) return day;
  return { ...day, perfectAwarded: true, xp: day.xp + XP_PERFECT_DAY };
}

/** Award XP for completing a goal milestone. */
export function awardMilestone(journey: Journey): Journey {
  return { ...journey, xp: journey.xp + XP_PER_MILESTONE };
}

/** Returns the new level to celebrate, or null if nothing new to celebrate. */
export function pendingLevelUp(journey: Journey): number | null {
  const level = levelForXp(journey.xp);
  return level > journey.lastCelebratedLevel ? level : null;
}

export function acknowledgeLevel(journey: Journey): Journey {
  const level = levelForXp(journey.xp);
  if (level <= journey.lastCelebratedLevel) return journey;
  return { ...journey, lastCelebratedLevel: level };
}

export function unlockedCosmetics(
  journey: Journey,
  options: { premium?: boolean } = {},
): JourneyCosmetic[] {
  const level = levelForXp(journey.xp);
  const premium = options.premium ?? false;
  return JOURNEY_COSMETICS.filter(
    (cosmetic) => cosmetic.unlockLevel <= level && (premium || !cosmetic.premium),
  );
}

export interface JourneyStage {
  minLevel: number;
  label: string;
  glyph: string;
}

// The growth visual that advances as the user levels up.
export const JOURNEY_STAGES: JourneyStage[] = [
  { minLevel: 1, label: "Seed", glyph: "🌱" },
  { minLevel: 2, label: "Sprout", glyph: "🌿" },
  { minLevel: 4, label: "Sapling", glyph: "🪴" },
  { minLevel: 6, label: "Tree", glyph: "🌳" },
  { minLevel: 9, label: "Grove", glyph: "🌲" },
];

export function stageForLevel(level: number): JourneyStage {
  let stage = JOURNEY_STAGES[0];
  for (const candidate of JOURNEY_STAGES) {
    if (level >= candidate.minLevel) stage = candidate;
  }
  return stage;
}
