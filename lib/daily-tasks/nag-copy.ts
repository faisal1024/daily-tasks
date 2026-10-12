// Words shared by the places Nag mode is turned on or shown: Settings ›
// Reminders, the turn-on flow (hooks/use-nag-turn-on.ts) and the "Meet Nag
// mode" sheet.

import { nagDrillGetsRude, type NagLevel, type NagPersona } from "./nag";
import { NAG_LEVEL_COUNTS } from "./nag-plan";

/** Asked the first time Nag is turned on. */
export const NAG_CONFIRM_TITLE = "Turn on Nag mode?";
export const NAG_CONFIRM_MESSAGE =
  "Up to twice a day, your open tasks are sent to our AI service so it can write reminders in the voice you pick. They arrive at random times, at most one an hour, and get pushier while tasks stay open.";

/** Nag can't be turned on: iOS won't deliver anything. */
export const NAG_NO_PERMISSION_TITLE = "Notifications unavailable";
export const NAG_NO_PERMISSION_MESSAGE =
  "Allow notifications in System Settings to get reminders for Today's Three.";

/** Under the Level chips: how many nags a day the chosen level means. */
export const NAG_LEVEL_COUNT_NOTE: Record<NagLevel, string> = {
  gentle: `About ${NAG_LEVEL_COUNTS.gentle} a day`,
  firm: `About ${NAG_LEVEL_COUNTS.firm} a day`,
  relentless: `About ${NAG_LEVEL_COUNTS.relentless} a day`,
};

/**
 * Under the count, in Settings and in "Meet Nag mode": said when the voice
 * is Drill sergeant and the level is Firm or Relentless, where some of its
 * lines insult the recruit's effort. Null otherwise (nothing is shown).
 */
export const NAG_DRILL_RUDE_NOTE = "Drill sergeant gets rude at this level.";
export function nagLevelRudeNote(persona: NagPersona, level: NagLevel): string | null {
  return nagDrillGetsRude(persona, level) ? NAG_DRILL_RUDE_NOTE : null;
}
