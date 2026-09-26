// Thin wrapper over expo-store-review so the Today screen can ask for a rating
// without importing the native module directly (and tests can mock this file).
//
// The module is loaded lazily inside a try: if a binary ever ships without the
// native module (e.g. a mismatched build), the rating prompt quietly does
// nothing instead of crashing the app at launch.

type StoreReviewModule = typeof import("expo-store-review");

function loadStoreReview(): StoreReviewModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-store-review") as StoreReviewModule;
  } catch {
    return null;
  }
}

/** Ask iOS/Android for the native rating prompt. Returns true if it was requested. */
export async function requestAppReview(): Promise<boolean> {
  const StoreReview = loadStoreReview();
  if (!StoreReview) return false;
  try {
    if (!(await StoreReview.isAvailableAsync())) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
