// Early supporters' one-off lifetime-Plus claim: remembered under its own key.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { readSupporterGrant, writeSupporterGrant } from "@/lib/daily-tasks/supporter-grant";

const KEY = "daily-tasks/supporter-grant";

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("supporter grant storage", () => {
  it("reads null until something is stored, then the stored result", async () => {
    expect(await readSupporterGrant()).toBeNull();
    await writeSupporterGrant("granted");
    expect(await AsyncStorage.getItem(KEY)).toBe("granted");
    expect(await readSupporterGrant()).toBe("granted");
    await writeSupporterGrant("closed");
    expect(await readSupporterGrant()).toBe("closed");
  });

  it("ignores unexpected stored values", async () => {
    await AsyncStorage.setItem(KEY, "retry");
    expect(await readSupporterGrant()).toBeNull();
  });

  it("never throws when storage fails", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk"));
    await expect(readSupporterGrant()).resolves.toBeNull();
    await expect(writeSupporterGrant("granted")).resolves.toBeUndefined();
  });
});
