// Pure, dependency-free version-comparison logic for the "update available"
// prompt. Kept separate from app-update.ts (which pulls in react-native /
// expo-constants / AsyncStorage) so it can be unit-tested in plain Node.

export interface LatestRelease {
  version: string;
  storeUrl: string | null;
}

export interface UpdateInfo {
  latestVersion: string;
  currentVersion: string;
  storeUrl: string | null;
}

/**
 * Only accept absolute https URLs as a store link. Rejects javascript:, file:,
 * http:, custom deep-link schemes, and anything with whitespace — the store URL
 * comes from untrusted remote data (iTunes / a manifest) and is opened with
 * Linking.openURL, so it must be sanitized before it ever reaches the UI.
 */
export function sanitizeStoreUrl(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\/\S+$/i.test(value) ? value : null;
}

/** Parse an iTunes Lookup API response into a release (storeUrl sanitized). */
export function parseItunesLookup(data: unknown): LatestRelease | null {
  if (!data || typeof data !== "object") return null;
  const results = (data as { results?: unknown }).results;
  const first = Array.isArray(results) ? results[0] : null;
  if (!first || typeof first.version !== "string") return null;
  return { version: first.version, storeUrl: sanitizeStoreUrl(first.trackViewUrl) };
}

/** Parse a self-hosted { version, storeUrl } manifest (storeUrl sanitized). */
export function parseManifest(data: unknown): LatestRelease | null {
  if (!data || typeof data !== "object") return null;
  const version = (data as { version?: unknown }).version;
  if (typeof version !== "string") return null;
  return { version, storeUrl: sanitizeStoreUrl((data as { storeUrl?: unknown }).storeUrl) };
}

/** Split a version string into numeric segments ("1.2.0+3" -> [1,2,0,3]). */
export function parseVersion(value: string): number[] {
  return String(value)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal (segment-wise numeric compare). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/**
 * Decide whether to surface an update prompt. Returns the update info only when
 * the latest release is strictly newer than both the installed version and any
 * version the user has already dismissed.
 */
export function evaluateUpdate(params: {
  currentVersion: string;
  latest: LatestRelease | null;
  dismissedVersion?: string | null;
}): UpdateInfo | null {
  const { currentVersion, latest, dismissedVersion } = params;
  if (!latest || !latest.version) return null;
  if (compareVersions(latest.version, currentVersion) <= 0) return null;
  if (dismissedVersion && compareVersions(latest.version, dismissedVersion) <= 0) {
    return null;
  }
  return {
    latestVersion: latest.version,
    currentVersion,
    storeUrl: latest.storeUrl,
  };
}
