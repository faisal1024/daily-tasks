// A plain tap on one of our reminders of a given `kind` (the Sunday reset's,
// the night before's): while the app runs, and once for the tap that
// launched it; each tap is passed on once. Like subscribeNagResponses.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { MANAGED_REMINDER_PREFIX } from "./reminders";

/** Whether a notification response is a plain tap on our reminder of `kind`. */
export function isKindTapResponse(
  response: Notifications.NotificationResponse | null | undefined,
  kind: string,
): boolean {
  const request = response?.notification?.request;
  if (!request || typeof request.identifier !== "string" || !request.identifier.startsWith(MANAGED_REMINDER_PREFIX)) {
    return false;
  }
  // A plain tap (a nag's button or a focus action is someone else's).
  const plainTap = Notifications.DEFAULT_ACTION_IDENTIFIER ?? "expo.modules.notifications.actions.DEFAULT";
  if (response?.actionIdentifier && response.actionIdentifier !== plainTap) return false;
  const dataKind = (request.content?.data as Record<string, unknown> | undefined)?.kind;
  const [, idKind] = request.identifier.slice(MANAGED_REMINDER_PREFIX.length).split(":");
  return dataKind === kind || idKind === kind;
}

export function subscribeKindTapResponses(kind: string, listener: () => void): () => void {
  if (Platform.OS === "web") return () => {};
  const seen = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null | undefined) => {
    if (!response || !isKindTapResponse(response, kind)) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    listener();
    try {
      Notifications.clearLastNotificationResponse?.();
    } catch {
      // A replay only opens it again.
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
