// Saved-state safety (Phase 8): a known-good backup, corrupt data quarantined
// (never overwritten), and no writes in a session where storage couldn't be read.
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetStorageForTests,
  buildInitialState,
  clearState,
  loadState,
  saveState,
} from "@/lib/daily-tasks/storage";

const KEY = "daily-tasks/state/v1";
const BACKUP = `${KEY}:backup`;

function savedJson(name: string) {
  return JSON.stringify({
    ...buildInitialState(new Date(2026, 8, 26)),
    momentumProfile: { ...buildInitialState().momentumProfile, name },
  });
}

let warn: jest.SpyInstance;

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("loadState safety", () => {
  it("refreshes the backup from a good load", async () => {
    const raw = savedJson("Alex");
    await AsyncStorage.setItem(KEY, raw);
    expect((await loadState())?.momentumProfile.name).toBe("Alex");
    expect(await AsyncStorage.getItem(BACKUP)).toBe(raw);
  });

  it("quarantines corrupt data under its own key (original kept) and restores the backup", async () => {
    await AsyncStorage.setItem(BACKUP, savedJson("Backup"));
    await AsyncStorage.setItem(KEY, "{broken json");
    const before = Date.now();

    const state = await loadState();
    expect(state?.momentumProfile.name).toBe("Backup");

    const keys = await AsyncStorage.getAllKeys();
    const quarantined = keys.filter((key) => key.startsWith(`${KEY}:corrupt:`));
    expect(quarantined).toHaveLength(1);
    expect(Number(quarantined[0].split(":corrupt:")[1])).toBeGreaterThanOrEqual(before);
    expect(await AsyncStorage.getItem(quarantined[0])).toBe("{broken json");
    // The backup isn't replaced by the corrupt copy.
    expect(JSON.parse((await AsyncStorage.getItem(BACKUP)) as string).momentumProfile.name).toBe("Backup");
  });

  it("uses the backup when storage can't be read, and doesn't write for the rest of the session", async () => {
    await AsyncStorage.setItem(KEY, savedJson("Unreadable"));
    await AsyncStorage.setItem(BACKUP, savedJson("Backup"));
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("disk I/O");
    });

    expect((await loadState())?.momentumProfile.name).toBe("Backup");
    await saveState(buildInitialState());
    // The data we never saw is still there.
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string).momentumProfile.name).toBe("Unreadable");
  });

  it("Reset all data removes the backup and allows writes again", async () => {
    await AsyncStorage.setItem(KEY, savedJson("Old"));
    await AsyncStorage.setItem(BACKUP, savedJson("Old"));
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("disk I/O");
    });
    await loadState();

    await clearState();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await AsyncStorage.getItem(BACKUP)).toBeNull();
    await saveState({ ...buildInitialState(), hasSeenOnboarding: true });
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string).hasSeenOnboarding).toBe(true);
  });
});
