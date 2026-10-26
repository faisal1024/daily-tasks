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
