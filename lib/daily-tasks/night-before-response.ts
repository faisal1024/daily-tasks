// A tap on the night-before reminder (1.7) opens the night-before sheet.
// The shared tap handling is kind-tap-response.ts.
import type * as Notifications from "expo-notifications";

import { isKindTapResponse, subscribeKindTapResponses } from "./kind-tap-response";
import { NIGHT_BEFORE_KIND } from "./night-before";

/** Whether a notification response is a tap on the night-before reminder. */
export function isNightBeforeResponse(response: Notifications.NotificationResponse | null | undefined): boolean {
  return isKindTapResponse(response, NIGHT_BEFORE_KIND);
}

export function subscribeNightBeforeResponses(listener: () => void): () => void {
  return subscribeKindTapResponses(NIGHT_BEFORE_KIND, listener);
}
