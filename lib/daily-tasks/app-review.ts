// Thin wrapper over expo-store-review so the Today screen can ask for a rating
// without importing the native module directly (and tests can mock this file).

import * as StoreReview from "expo-store-review";

/** Ask iOS/Android for the native rating prompt. Returns true if it was requested. */
export async function requestAppReview(): Promise<boolean> {
  try {
    if (!(await StoreReview.isAvailableAsync())) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
