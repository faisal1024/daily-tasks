// "Share your day" (1.5 D, free): the finished day as a clean image for the
// iOS share sheet. What the image says is decided here (pure, so it's
// unit-tested); the sheet renders it and hands it to iOS. Nothing is sent
// anywhere by the app: the user picks where it goes.

import { dayChipText } from "./today-view";

export interface ShareCardTask {
  text: string;
  done: boolean;
}

export interface ShareCardModel {
  /** "Day 12": the Day chip's count, which never goes down. */
  dayLabel: string;
  /** e.g. "Monday, 26 October". */
  dateLabel: string;
  /** "3 of 3 done". */
  summary: string;
  /** The day's tasks in order, ticked or not; null when names are left out. */
  rows: ShareCardTask[] | null;
}

/** The brand purple the image is drawn on, the same in light and dark mode. */
export const SHARE_CARD_PURPLE = "#5B52E8";
export const SHARE_CARD_INK = "#FFFFFF";
/** The app's name at the foot of the image. */
export const SHARE_CARD_BRAND = "Three Today";

/** The longest task name shown, in characters (longer ones end in "…"). */
export const SHARE_CARD_TASK_CHARS = 60;

function clip(text: string): string {
  const chars = Array.from(text.trim().replace(/\s+/g, " "));
  if (chars.length <= SHARE_CARD_TASK_CHARS) return chars.join("");
  return `${chars
    .slice(0, SHARE_CARD_TASK_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * The image's words. `showNames` false (Settings' "Hide task names", or the
 * sheet's own switch): no titles at all, only "3 of 3 done".
 */
export function shareCardModel(input: {
  tasks: ShareCardTask[];
  daysShowedUp: number;
  dateLabel: string;
  showNames: boolean;
}): ShareCardModel {
  const done = input.tasks.filter((task) => task.done).length;
  return {
    dayLabel: dayChipText(input.daysShowedUp),
    dateLabel: input.dateLabel,
    summary: `${done} of ${input.tasks.length} done`,
    rows: input.showNames ? input.tasks.map((task) => ({ text: clip(task.text), done: task.done })) : null,
  };
}

/**
 * Task names start on unless Settings hides them; with Settings hiding them
 * the switch isn't offered (the setting is respected, never overridden here).
 */
export function shareNamesChoice(hideTaskNames: boolean): { initial: boolean; canShow: boolean } {
  return hideTaskNames ? { initial: false, canShow: false } : { initial: true, canShow: true };
}
