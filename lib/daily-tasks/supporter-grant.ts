// Whether this early supporter's install already claimed lifetime Plus in
// RevenueCat (its own key, so "Reset all data" doesn't ask again).

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "daily-tasks/supporter-grant";
export type SupporterGrant = "granted" | "closed";

export async function readSupporterGrant(): Promise<SupporterGrant | null> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    return value === "granted" || value === "closed" ? value : null;
  } catch {
    return null;
  }
}

export async function writeSupporterGrant(value: SupporterGrant): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value);
  } catch {
    // Asked again next launch: harmless.
  }
}
