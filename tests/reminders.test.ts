import { describe, expect, it } from "vitest";

import {
  buildReminderIdentifier,
  planReminders,
  planUpcomingMornings,
  UPCOMING_MORNING_DAYS,
} from "../lib/daily-tasks/reminders";
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

  it("switches to every-two-hour progress reminders once tasks exist", () => {
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

    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([10, 12, 14, 16]);
    expect(reminders.every((reminder) => reminder.kind === "progress")).toBe(true);
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

  it("schedules an hourly nudge across the day when hourly mode is on", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 9, 30),
      taskCount: 3,
      completedCount: 1,
      settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
      permissionState: "granted",
    });

    // From 8-21 hourly, only future hours (>= 10) remain at 9:30.
    expect(reminders.map((reminder) => reminder.at.getHours())).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
  });

  it("schedules nothing in hourly mode once all tasks are complete", () => {
    const reminders = planReminders({
      now: new Date(2026, 3, 20, 11, 0),
      taskCount: 3,
      completedCount: 3,
      settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
      permissionState: "granted",
    });
    expect(reminders).toEqual([]);
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

describe("planUpcomingMornings (Phase 8)", () => {
  it("plans one morning nudge on each of the next 6 days: 8:00 on weekdays, 10:00 at weekends", () => {
    // Friday 25 Sep 2026, evening.
    const upcoming = planUpcomingMornings({
      now: new Date(2026, 8, 25, 21, 0),
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
    });
    expect(UPCOMING_MORNING_DAYS).toBe(6);
    expect(upcoming.map((r) => [r.at.getDate(), r.at.getHours(), r.at.getMinutes()])).toEqual([
      [26, 10, 0], // Sat
      [27, 10, 0], // Sun
      [28, 8, 0],
      [29, 8, 0],
      [30, 8, 0],
      [1, 8, 0],
    ]);
    expect(upcoming.every((r) => r.kind === "morning")).toBe(true);
    expect(upcoming[0].identifier).toBe(buildReminderIdentifier("morning", upcoming[0].at));
    expect(new Set(upcoming.map((r) => r.identifier)).size).toBe(6);
  });

  it("plans none when reminders, the morning nudge, or permission are off", () => {
    const now = new Date(2026, 8, 25, 21, 0);
    const base = { now, settings: DEFAULT_NOTIFICATIONS, permissionState: "granted" as const };
    expect(planUpcomingMornings({ ...base, settings: { ...DEFAULT_NOTIFICATIONS, enabled: false } })).toEqual([]);
    expect(planUpcomingMornings({ ...base, settings: { ...DEFAULT_NOTIFICATIONS, morning: false } })).toEqual([]);
    expect(planUpcomingMornings({ ...base, permissionState: "denied" })).toEqual([]);
    expect(planUpcomingMornings({ ...base, permissionState: "undetermined" })).toEqual([]);
  });
});
