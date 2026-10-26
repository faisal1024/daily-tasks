// A tap on the Sunday reset's notification (1.6) opens the reset itself.
// Like subscribeNagResponses: while the app runs, and once for the tap that
// launched it; each tap is passed on once.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { MANAGED_REMINDER_PREFIX } from "./reminders";
import { SUNDAY_RESET_KIND } from "./sunday-reset";

/** Whether a notification response is a tap on the Sunday reset's notification. */
export function isSundayResetResponse(response: Notifications.NotificationResponse | null | undefined): boolean {
  const request = response?.notification?.request;
  if (!request || typeof request.identifier !== "string" || !request.identifier.startsWith(MANAGED_REMINDER_PREFIX)) {
    return false;
  }
  // A plain tap (a nag's button or a focus action is someone else's).
  const plainTap = Notifications.DEFAULT_ACTION_IDENTIFIER ?? "expo.modules.notifications.actions.DEFAULT";
  if (response?.actionIdentifier && response.actionIdentifier !== plainTap) return false;
  const kind = (request.content?.data as Record<string, unknown> | undefined)?.kind;
  const [, idKind] = request.identifier.slice(MANAGED_REMINDER_PREFIX.length).split(":");
  return kind === SUNDAY_RESET_KIND || idKind === SUNDAY_RESET_KIND;
}

export function subscribeSundayResetResponses(listener: () => void): () => void {
  if (Platform.OS === "web") return () => {};
  const seen = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null | undefined) => {
    if (!response || !isSundayResetResponse(response)) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    listener();
    try {
      Notifications.clearLastNotificationResponse?.();
    } catch {
      // A replay only opens the reset again.
    }
  };
  let subscription: { remove: () => void } | null = null;
  try {
    subscription = Notifications.addNotificationResponseReceivedListener(handle);
  } catch {
    subscription = null;
  }
  try {
    handle(Notifications.getLastNotificationResponse?.());
  } catch {
    // No launch tap to handle.
  }
  return () => subscription?.remove();
}
