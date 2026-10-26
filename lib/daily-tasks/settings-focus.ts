// A place in Settings to bring into view (1.6 What's new): "Write your lines"
// and "See what it remembers" ask for it, then switch to the Settings tab,
// which takes the request (on mounting, or while it is already mounted)
// and scrolls there with VoiceOver on its header. The same queue shape as
// capture.ts and focus-link.ts: nothing waits for Settings to be ready.

export type SettingsFocusTarget = "nag-own-lines" | "coach-memory";

let pending: SettingsFocusTarget | null = null;
const listeners = new Set<() => void>();

export function requestSettingsFocus(target: SettingsFocusTarget): void {
  pending = target;
  listeners.forEach((listener) => listener());
}

/** The waiting request, once: it's cleared as it's read. */
export function takeSettingsFocus(): SettingsFocusTarget | null {
  const target = pending;
  pending = null;
  return target;
}

export function subscribeSettingsFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Where a section starts in Settings' scroll content, from the onLayout y's
 * Settings keeps (each is in its parent): coach memory sits in the content
 * itself; the own lines are in the Nag card, in the Reminders section. Null
 * until all of its parts have been laid out.
 */
export function settingsSectionOffset(
  target: SettingsFocusTarget,
  y: { reminders?: number; nagCard?: number; ownLines?: number; coachMemory?: number },
): number | null {
  if (target === "coach-memory") return y.coachMemory ?? null;
  if (y.reminders === undefined || y.nagCard === undefined || y.ownLines === undefined) return null;
  return y.reminders + y.nagCard + y.ownLines;
}
