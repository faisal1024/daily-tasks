import { describe, expect, it } from "vitest";

import { shouldAutoLockToday } from "../lib/daily-tasks/locking";

describe("shouldAutoLockToday", () => {
  it("locks after noon when there is at least one task", () => {
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 12, 0), 1, false)).toBe(true);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 15, 30), 2, false)).toBe(true);
  });

  it("does not lock before noon, when already locked, or with zero tasks", () => {
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 11, 59), 1, false)).toBe(false);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 12, 0), 0, false)).toBe(false);
    expect(shouldAutoLockToday(new Date(2026, 3, 18, 13, 0), 2, true)).toBe(false);
  });
});
