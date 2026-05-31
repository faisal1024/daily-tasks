import { describe, expect, it } from "vitest";

import {
  autoLockEligibleTaskCount,
  shouldAutoLockToday,
} from "../lib/daily-tasks/locking";
import { DEFAULT_AUTO_LOCK } from "../lib/daily-tasks/types";

describe("autoLockEligibleTaskCount", () => {
  // Lock time is noon (DEFAULT_AUTO_LOCK).
  // Local-time strings (no Z) so the comparison is timezone-robust.
  it("does not count tasks created after the lock time (the first-task bug)", () => {
    // A first task added at 3pm must NOT be eligible — so it can't instant-lock.
    const tasks = [{ createdAt: "2026-04-18T15:00:00" }];
    expect(autoLockEligibleTaskCount(tasks, "2026-04-18", DEFAULT_AUTO_LOCK)).toBe(0);
  });

  it("counts tasks created at or before the lock time", () => {
    const tasks = [
      { createdAt: "2026-04-18T08:00:00" }, // morning — eligible
      { createdAt: "2026-04-18T15:00:00" }, // afternoon — not eligible
    ];
    expect(autoLockEligibleTaskCount(tasks, "2026-04-18", DEFAULT_AUTO_LOCK)).toBe(1);
  });

  it("handles the real stored UTC format for a clearly-after-noon task", () => {
    // toISOString() format. 23:30 UTC is after local noon in every real timezone.
    const tasks = [{ createdAt: "2026-04-18T23:30:00.000Z" }];
    expect(autoLockEligibleTaskCount(tasks, "2026-04-18", DEFAULT_AUTO_LOCK)).toBe(0);
  });

  it("counts tasks with an unparseable createdAt defensively", () => {
    expect(
      autoLockEligibleTaskCount([{ createdAt: "nonsense" }], "2026-04-18", DEFAULT_AUTO_LOCK),
    ).toBe(1);
  });
});

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
