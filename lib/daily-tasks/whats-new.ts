// "What's new" (1.4): a one-time sheet that introduces a release's headline
// feature to people who UPDATE into it. New installs never see it (first run
// already showed them the app as it is now).
//
// To announce the next release: add an entry to ANNOUNCEMENTS, give it a
// sheet, and show that sheet for its id where Today shows the Nag one
// (app/(tabs)/index.tsx). Who sees it, and that it shows once, is decided
// here. Pure, so it's unit-tested.

import { builtInNagLines, type NagLevel, type NagPersona } from "./nag";
import { NAG_LEVEL_COUNTS } from "./nag-plan";
import type { AppState } from "./types";

/** What the rule reads from the saved state. */
export type WhatsNewState = Pick<AppState, "hasSeenOnboarding" | "whatsNewSeen" | "notifications">;

export interface Announcement {
  /** Saved in `whatsNewSeen` and sent with the analytics events: letters, digits, dots and dashes. */
  id: string;
  /**
   * The feature is already in use, so there is nothing to introduce: the
   * announcement is marked seen without being shown.
   */
  alreadyUsing?: (state: WhatsNewState) => boolean;
}

export const NAG_ANNOUNCEMENT_ID = "1.4-nag";

const RELEASED: readonly Announcement[] = [
  {
    id: NAG_ANNOUNCEMENT_ID,
    // A saved Nag style, with or without Plus right now: they chose it once.
    alreadyUsing: (state) => state.notifications.style === "nag",
  },
];

let announcements: readonly Announcement[] = RELEASED;

/** Every announcement this build knows, oldest first. */
export function currentAnnouncements(): readonly Announcement[] {
  return announcements;
}

/** What a finished first run marks as seen: a new install is shown none of them. */
export function allAnnouncementIds(): string[] {
  return announcements.map((announcement) => announcement.id);
}

const MAX_SEEN = 100;

/** `whatsNewSeen` as saved: a list of ids. Anything else (a save from before 1.4) is an empty list. */
export function normalizeWhatsNewSeen(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !/^[a-z0-9_.-]{1,40}$/i.test(id) || seen.includes(id)) continue;
    seen.push(id);
    if (seen.length >= MAX_SEEN) break;
  }
  return seen;
}

/** `seen` with `ids` added (the same list when nothing is new). */
export function withWhatsNewSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const added = ids.filter((id, index) => !seen.includes(id) && ids.indexOf(id) === index);
  return added.length === 0 ? (seen as string[]) : [...seen, ...added];
}

export interface WhatsNewDecision {
  /** The one to show now (the oldest not yet seen), or null. */
  show: Announcement | null;
  /** Not seen, and not needed (the feature is in use): mark these seen quietly. */
  skip: string[];
}

/**
 * Who sees what. Nothing before first run has finished (it marks every
 * current announcement seen when it does, so a new install has none left).
 * After that: each announcement not in `whatsNewSeen`, oldest first, unless
 * its feature is already in use.
 */
export function whatsNewDecision(
  state: WhatsNewState,
  list: readonly Announcement[] = announcements,
): WhatsNewDecision {
  if (!state.hasSeenOnboarding) return { show: null, skip: [] };
  const skip: string[] = [];
  let show: Announcement | null = null;
  for (const announcement of list) {
    if (state.whatsNewSeen.includes(announcement.id)) continue;
    if (announcement.alreadyUsing?.(state)) skip.push(announcement.id);
    else if (!show) show = announcement;
  }
  return { show, skip };
}

/** After Today goes idle, so the sheet doesn't flash up on launch. */
export const WHATS_NEW_DELAY_MS = 600;
/** Asked again this much later when the moment wasn't right after all (a rating ask, a field in use). */
export const WHATS_NEW_RETRY_MS = 2000;

// ---------------------------------------------------------------------------
// The Nag mode announcement
// ---------------------------------------------------------------------------

/** The sheet's words. Plain, no em dashes; nothing about the AI beyond the turn-on question. */
export const NAG_INTRO_COPY = {
  label: "New in 1.4",
  title: "Meet Nag mode",
  lede: "Reminders with a personality. Pick who nags you and how hard.",
  voice: "Voice",
  level: "Level",
  another: "Show another",
  points: [
    { icon: "shuffle-outline", text: "Random times, at most one an hour." },
    { icon: "trending-up-outline", text: "Gets pushier while your tasks stay open." },
    { icon: "moon-outline", text: "One tap stops it for the day. It never breaks through a Focus." },
  ],
  plus: "Nag mode is part of Plus. Calm reminders stay free.",
  primary: "Try Nag mode",
  secondary: "Not now",
  footer: "Also new: drag to reorder your three, reminders that name your tasks, and ideas for your next milestone.",
  close: "Close",
} as const;

/** On Today once Nag mode was turned on from the sheet. */
export const NAG_ON_TOAST = "Nag mode is on. Change it in Settings › Reminders.";
/** The row in Settings › Reminders that opens the sheet again. */
export const NAG_INTRO_SETTINGS_ROW = "What is Nag mode?";

/**
 * The preview's lines for a voice and level: the built-in lines of that
 * level's own day (nothing is sent anywhere), pushiest first so the level
 * shows, and, with a task to name, the lines that name it before the general
 * ones. `taskText` null (no open task, or names hidden): general lines only.
 */
export function nagIntroSamples({
  persona,
  level,
  taskText,
}: {
  persona: NagPersona;
  level: NagLevel;
  taskText: string | null;
}): string[] {
  const lines = builtInNagLines({
    persona,
    level,
    tasks: taskText ? [{ text: taskText }] : [],
    count: NAG_LEVEL_COUNTS[level],
    seed: "whats-new",
  }).reverse();
  return [...lines.filter((line) => line.taskIndex !== null), ...lines.filter((line) => line.taskIndex === null)].map(
    (line) => line.text,
  );
}

/** Test-only: the announcements in play (null: the released ones). */
export function __setAnnouncementsForTests(list: readonly Announcement[] | null): void {
  announcements = list ?? RELEASED;
}
