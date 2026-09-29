// Moving between screens from outside a screen (e.g. a notification tap
// handled by the store). Best-effort: before navigation is ready it does nothing.
import { router } from "expo-router";

/** Shows Today (the focus session's timer pill and check-in live on its task row). */
export function navigateToToday(): void {
  try {
    router.navigate("/");
  } catch {
    // Not mounted yet: the app opens on Today anyway.
  }
}
