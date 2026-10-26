// A one-line tip in Saved for later (1.6): a day in the words brings a saved
// item back on that day. Shown until the user has saved a dated item once
// (it worked, so they know) or closed the tip. The flag is saved state,
// `savedDateTipDone`, like the reorder hint's `reorderHintSeen`.
import type { AppState } from "./types";

export const SAVED_DATE_TIP = "Tip: add a day, like “dentist Friday”, and it comes back then.";
export const SAVED_DATE_TIP_DISMISS = "Dismiss tip";

type TipState = Pick<AppState, "parkedTasks" | "savedDateTipDone">;

/** The tip shows: never closed, and nothing saved with a day yet. */
export function showSavedDateTip(state: TipState): boolean {
  return state.savedDateTipDone !== true && !state.parkedTasks.some((item) => item.when);
}

/**
 * After any change to the state: once a dated item has been saved (a brain
 * dump, a capture, a day picked by hand), the tip is done for good, also
 * once that item has gone. Same object when nothing changes.
 */
export function withSavedDateTip<S extends TipState>(state: S): S {
  if (state.savedDateTipDone === true || !state.parkedTasks.some((item) => item.when)) return state;
  return { ...state, savedDateTipDone: true };
}
