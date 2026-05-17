import { describe, expect, it } from "vitest";

import { buildReminderIdentifier, planReminders } from "../lib/daily-tasks/reminders";
import { DEFAULT_NOTIFICATIONS } from "../lib/daily-tasks/types";

describe("planReminders", () => {
  it("schedules weekday empty-day reminders hourly from 8 AM through noon", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 7, 30),
      taskCount: 0,
      completedCount: 0,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
    });

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([8, 9, 10, 11, 12]);
    expect(reminders.every((reminder) => reminder.kind === "morning")).toBe(true);
  });

  it("schedules weekend empty-day reminders hourly from 10 AM through noon", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 19, 9, 15),
      taskCount: 0,
      completedCount: 0,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
    });

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([10, 11, 12]);
  });

  it("uses the selected hourly cadence once tasks exist", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 9, 5),
      taskCount: 2,
      completedCount: 1,
      settings: {
        ...DEFAULT_NOTIFICATIONS,
        evening: false,
      },
      permissionState: "granted",
    });

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(reminders.every((reminder) => reminder.kind === "progress")).toBe(true);
  });

  it("supports every-two-hour reminder cadence", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 9, 5),
      taskCount: 2,
      completedCount: 1,
      settings: {
        ...DEFAULT_NOTIFICATIONS,
        evening: false,
        frequencyHours: 2,
      },
      permissionState: "granted",
    });

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([10, 12, 14, 16]);
  });

  it("switches to hourly evening reminders after 5 PM until 10 PM", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 17, 15),
      taskCount: 3,
      completedCount: 1,
      settings: {
        ...DEFAULT_NOTIFICATIONS,
        progress: false,
      },
      permissionState: "granted",
    });

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([18, 19, 20, 21, 22]);
    expect(reminders.every((reminder) => reminder.kind === "evening")).toBe(true);
  });

  it("schedules nothing once all tasks are complete", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 11, 0),
      taskCount: 3,
      completedCount: 3,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
    });

    expect(reminders).toEqual([]);
  });

  it("schedules nothing when permission is denied", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 11, 0),
      taskCount: 0,
      completedCount: 0,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "denied",
    });

    expect(reminders).toEqual([]);
  });

  it("produces stable unique identifiers for planned reminders", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 9, 0),
      taskCount: 2,
      completedCount: 0,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
    });

    const identifiers = reminders.map((reminder) => reminder.identifier);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(buildReminderIdentifier("progress", new Date(2026, 3, 20, 10, 0))).toBe(
      "daily-tasks:2026-04-20:progress:1000",
    );
  });
});
