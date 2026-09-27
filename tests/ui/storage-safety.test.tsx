// Saved-state safety (Phase 8): a known-good backup, corrupt data quarantined
// (never overwritten), and no writes in a session where storage couldn't be read.
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetStorageForTests,
  buildInitialState,
  clearState,
  loadState,
  refreshBackup,
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
  it("doesn't touch the backup on load; refreshBackup copies only a parseable main state", async () => {
    const raw = savedJson("Alex");
    await AsyncStorage.setItem(KEY, raw);
    expect((await loadState())?.momentumProfile.name).toBe("Alex");
    // A state that parses but crashes the app must not replace the good copy.
    expect(await AsyncStorage.getItem(BACKUP)).toBeNull();

    await refreshBackup();
    expect(await AsyncStorage.getItem(BACKUP)).toBe(raw);

    await AsyncStorage.setItem(KEY, "{broken json");
    await refreshBackup();
    expect(await AsyncStorage.getItem(BACKUP)).toBe(raw);
  });

  it("keeps at most one earlier quarantined copy", async () => {
    await AsyncStorage.setItem(`${KEY}:corrupt:1790000000000`, "oldest");
    await AsyncStorage.setItem(`${KEY}:corrupt:1790000001000`, "older");
    await AsyncStorage.setItem(KEY, "{newest broken");
    await loadState();
    const quarantined = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(`${KEY}:corrupt:`)).sort();
    expect(quarantined).toHaveLength(2);
    expect(quarantined[0]).toBe(`${KEY}:corrupt:1790000001000`);
    expect(await AsyncStorage.getItem(quarantined[1])).toBe("{newest broken");
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
    await refreshBackup();
    // The data we never saw is still there, and the backup wasn't replaced.
    expect(JSON.parse((await AsyncStorage.getItem(BACKUP)) as string).momentumProfile.name).toBe("Backup");
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

  it("Reset all data also removes quarantined copies (they hold task text), and nothing else", async () => {
    await AsyncStorage.setItem(KEY, savedJson("Main"));
    await AsyncStorage.setItem(BACKUP, savedJson("Backup"));
    await AsyncStorage.setItem(`${KEY}:corrupt:1790000000000`, "old broken");
    await AsyncStorage.setItem(`${KEY}:corrupt:1790000001000`, "newer broken");
    await AsyncStorage.setItem("daily-tasks/analytics-id", "anon_keep");

    await clearState();
    expect(await AsyncStorage.getAllKeys()).toEqual(["daily-tasks/analytics-id"]);
  });
});
