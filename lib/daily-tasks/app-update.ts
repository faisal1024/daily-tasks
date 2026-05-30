// Runtime "update available" check.
//
// Strategy (zero backend required):
//   - iOS: query the public iTunes Lookup API by bundle id for the latest
//     published App Store version + store URL.
//   - Any platform: if `extra.updateManifestUrl` is set in app config, fetch a
//     JSON manifest of shape { version, storeUrl } instead (works for Android
//     or a self-hosted source).
// The installed version comes from expo-constants. Dismissals are remembered
// per-version in AsyncStorage so the prompt never nags.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { evaluateUpdate, type LatestRelease, type UpdateInfo } from "./version";

export type { UpdateInfo };

const DISMISSED_KEY = "daily-tasks/update/dismissed-version";

export function getCurrentVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

function getBundleId(): string | null {
  return (
    Constants.expoConfig?.ios?.bundleIdentifier ??
    Constants.expoConfig?.android?.package ??
    null
  );
}

function getManifestUrl(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const url = extra?.updateManifestUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<LatestRelease | null> {
  try {
    const manifestUrl = getManifestUrl();
    if (manifestUrl) {
      const response = await fetchImpl(manifestUrl);
      if (!response.ok) return null;
      const data = (await response.json()) as { version?: unknown; storeUrl?: unknown };
      if (typeof data?.version !== "string") return null;
      return {
        version: data.version,
        storeUrl: typeof data.storeUrl === "string" ? data.storeUrl : null,
      };
    }

    if (Platform.OS === "ios") {
      const bundleId = getBundleId();
      if (!bundleId) return null;
      const response = await fetchImpl(
        `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`,
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { results?: { version?: unknown; trackViewUrl?: unknown }[] };
      const result = Array.isArray(data?.results) ? data.results[0] : null;
      if (!result || typeof result.version !== "string") return null;
      return {
        version: result.version,
        storeUrl: typeof result.trackViewUrl === "string" ? result.trackViewUrl : null,
      };
    }

    return null;
  } catch {
    // Network/parse failures must never break app open — just no prompt.
    return null;
  }
}

export async function getDismissedVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export async function dismissUpdate(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // best-effort; a failed write just means we may prompt again next launch
  }
}

export async function checkForUpdate(
  options: { fetchImpl?: typeof fetch; currentVersion?: string } = {},
): Promise<UpdateInfo | null> {
  if (Platform.OS === "web") return null;
  const [latest, dismissedVersion] = await Promise.all([
    fetchLatestRelease(options.fetchImpl ?? fetch),
    getDismissedVersion(),
  ]);
  return evaluateUpdate({
    currentVersion: options.currentVersion ?? getCurrentVersion(),
    latest,
    dismissedVersion,
  });
}
