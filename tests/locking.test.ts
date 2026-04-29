import { describe, expect, it } from "vitest";

import { shouldAutoLockToday } from "../lib/daily-tasks/locking";
import { DEFAULT_AUTO_LOCK } from "../lib/daily-tasks/types";

describe("shouldAutoLockToday", () => {
  it("locks after noon when there is at least one task", () => {
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 12, 0), 1, false, DEFAULT_AUTO_LOCK)).toBe(true);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 15, 30), 2, false, DEFAULT_AUTO_LOCK)).toBe(true);
  });

  it("does not lock before noon, when already locked, or with zero tasks", () => {
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 11, 59), 1, false, DEFAULT_AUTO_LOCK)).toBe(false);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 12, 0), 0, false, DEFAULT_AUTO_LOCK)).toBe(false);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 13, 0), 2, true, DEFAULT_AUTO_LOCK)).toBe(false);
  });

  it("respects disabled auto-lock", () => {
    expect(
      shouldAutoLockToday(new Date(2026, 3, 18, 15, 0), 2, false, {
        ...DEFAULT_AUTO_LOCK,
        enabled: false,
      }),
    ).toBe(false);
  });

  it("respects a custom lock time", () => {
    const settings = { enabled: true, hour: 15, minute: 30 };
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 15, 29), 1, false, settings)).toBe(false);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 15, 30), 1, false, settings)).toBe(true);
  });
});
