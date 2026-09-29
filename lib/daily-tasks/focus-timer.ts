// Focus mode's timer (1.2): its lengths and how they read, shared by the
// focus screen and the task rows. Pure, so it's safe to import anywhere.
import { formatTime } from "./date";

/** The preset lengths, in minutes. */
export const FOCUS_TIMER_PRESETS = [5, 10, 20] as const;
/** A custom length is 1 minute to 3 hours. */
export const FOCUS_TIMER_MIN_MINUTES = 1;
export const FOCUS_TIMER_MAX_MINUTES = 180;
/** The custom wheel's starting length when none has been used yet. */
export const FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES = 15;

/** Whole minutes within 1–180 (rounded; anything non-finite is the minimum). */
export function clampTimerMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return FOCUS_TIMER_MIN_MINUTES;
  return Math.min(FOCUS_TIMER_MAX_MINUTES, Math.max(FOCUS_TIMER_MIN_MINUTES, Math.round(minutes)));
}

/** A length in words: "1 minute", "20 minutes", "2 hours", "1 hour 15 minutes". */
export function durationWords(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  const h = hours === 1 ? "1 hour" : `${hours} hours`;
  const m = mins === 1 ? "1 minute" : `${mins} minutes`;
  if (hours === 0) return m;
  return mins === 0 ? h : `${h} ${m}`;
}

/** A length on a chip: "5 min", "1 hr", "1 hr 15 min". */
export function durationShort(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (hours === 0) return `${mins} min`;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

/**
 * Time left on the clock face, rounding up so it never shows 0:00 with time
 * still left: h:mm:ss from an hour up, m:ss below.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${minutes}:${seconds}`;
}

/** The clock time it ends, in the device's own format ("9:42 AM" / "09:42"). */
export function formatEndTime(at: Date): string {
  return formatTime(at.getHours(), at.getMinutes());
}

/**
 * A task's timer menu (1.3): the last-used length first, then the presets.
 * Custom… follows in the menu itself.
 */
export function timerMenuLengths(lastUsed: number | null): number[] {
  const presets: number[] = [...FOCUS_TIMER_PRESETS];
  if (lastUsed === null) return presets;
  return [lastUsed, ...presets.filter((minutes) => minutes !== lastUsed)];
}
