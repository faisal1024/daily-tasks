// A tap on the Sunday reset's notification (1.6) opens the reset itself.
// The shared tap handling is kind-tap-response.ts.
import type * as Notifications from "expo-notifications";

import { isKindTapResponse, subscribeKindTapResponses } from "./kind-tap-response";
import { SUNDAY_RESET_KIND } from "./sunday-reset";

/** Whether a notification response is a tap on the Sunday reset's notification. */
export function isSundayResetResponse(response: Notifications.NotificationResponse | null | undefined): boolean {
  return isKindTapResponse(response, SUNDAY_RESET_KIND);
}

export function subscribeSundayResetResponses(listener: () => void): () => void {
  return subscribeKindTapResponses(SUNDAY_RESET_KIND, listener);
}
