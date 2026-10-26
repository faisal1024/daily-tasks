// 1.5 D: two weeks of morning nudges; the one a week after the last sync asks
// "Your Day count is waiting. Three small things?"; the first six days read
// exactly as before; the whole plan fits iOS's 64 pending with room to spare.
// Local-time fixtures (months with DST changes included).
import { describe, expect, it } from "vitest";

import {
  LAPSED_MORNING_COPY,
  LAPSED_MORNING_DAY,
  UPCOMING_MORNING_DAYS,
  planUpcomingMornings,
} from "../lib/daily-tasks/reminders";
import {
  IOS_PENDING_NOTIFICATION_LIMIT,
  fitPlanToLimit,
  taskAwareStrategy,
  type ReminderContext,
} from "../lib/daily-tasks/reminder-plan";
import { toDateKey } from "../lib/daily-tasks/date";
import { DEFAULT_NOTIFICATIONS } from "../lib/daily-tasks/types";

const settings = DEFAULT_NOTIFICATIONS;
const mornings = (now: Date, over: Partial<Parameters<typeof planUpcomingMornings>[0]> = {}) =>
  planUpcomingMornings({ now, settings, permissionState: "granted", ...over });

describe("two weeks of mornings", () => {
  it("plans 14, one per day, at local 8:00 on weekdays and 10:00 at weekends, across DST changes", () => {
    expect(UPCOMING_MORNING_DAYS).toBe(14);
    // Evenings just before US/EU clock changes and a year end.
    for (const now of [
      new Date(2026, 2, 5, 21),
      new Date(2026, 2, 25, 21),
      new Date(2026, 9, 22, 21),
      new Date(2026, 10, 1, 21),
      new Date(2026, 11, 28, 21),
    ]) {
      const plan = mornings(now);
      expect(plan).toHaveLength(14);
      plan.forEach((slot, index) => {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index + 1);
        const weekend = day.getDay() === 0 || day.getDay() === 6;
        expect(toDateKey(slot.at)).toBe(toDateKey(day));
        expect([slot.at.getHours(), slot.at.getMinutes()]).toEqual([weekend ? 10 : 8, 0]);
      });
      expect(new Set(plan.map((slot) => slot.identifier)).size).toBe(14);
    }
  });

  it("plans none with reminders, mornings or permission off", () => {
    const now = new Date(2026, 9, 26, 21);
    expect(mornings(now, { permissionState: "denied" })).toEqual([]);
    expect(mornings(now, { settings: { ...settings, morning: false } })).toEqual([]);
    expect(mornings(now, { settings: { ...settings, enabled: false } })).toEqual([]);
  });
});

describe("the morning a week on", () => {
  const now = new Date(2026, 9, 26, 21); // Monday evening
  const plan = mornings(now);

  it("says the Day count line on exactly the 7th day ahead, with the morning title", () => {
    expect(LAPSED_MORNING_DAY).toBe(7);
    expect(LAPSED_MORNING_COPY.body).toBe("Your Day count is waiting. Three small things?");
    const seventh = plan[LAPSED_MORNING_DAY - 1];
    expect(toDateKey(seventh.at)).toBe("2026-11-02");
    expect(seventh.body).toBe("Your Day count is waiting. Three small things?");
    expect(seventh.title).toBe(plan[0].title);
    expect(plan.filter((slot) => slot.body === LAPSED_MORNING_COPY.body)).toHaveLength(1);
  });

  it("the first six days are exactly what a six-day plan said (byte for byte), with or without drafts and tasks", () => {
    const copy = {
      dayKey: "2026-10-26",
      tasks: [{ id: "t1", text: "Call the dentist", done: false }],
      locked: false,
      hideNames: false,
      yesterdayOpen: [] as string[],
    };
    for (const over of [{}, { copy }, { copy: { ...copy, hideNames: true } }]) {
      const six = mornings(now, { ...over, days: 6 });
      const fourteen = mornings(now, over);
      expect(fourteen.slice(0, 6)).toEqual(six);
      expect(six.map((s) => s.body)).not.toContain(LAPSED_MORNING_COPY.body);
    }
  });

  it("never says anything about tasks, names or counts (safe with Hide task names)", () => {
    expect(LAPSED_MORNING_COPY.body).not.toMatch(/\d/);
    const hidden = mornings(now, { settings: { ...settings, hideTaskNames: true } });
    expect(hidden[6].body).toBe(LAPSED_MORNING_COPY.body);
  });

  it("when the tasks' own day falls on the 7th day (flown west), it names them instead", () => {
    const seventhDay = "2026-11-02";
    const withCopy = mornings(now, {
      copy: { dayKey: seventhDay, tasks: [{ id: "t1", text: "Call the dentist", done: false }], locked: false, hideNames: false, yesterdayOpen: [] },
    });
    expect(withCopy[6].body).not.toBe(LAPSED_MORNING_COPY.body);
  });

  it("is on the 7th day from any starting weekday, including a weekend 10:00 slot", () => {
    for (const day of [26, 27, 28, 29, 30, 31, 1]) {
      const from = new Date(2026, day === 1 ? 10 : 9, day, 21);
      const seventh = mornings(from)[6];
      expect(seventh.body).toBe(LAPSED_MORNING_COPY.body);
      expect(toDateKey(seventh.at)).toBe(toDateKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7)));
    }
  });
});

describe("the full plan fits under iOS's limit", () => {
  function context(now: Date): ReminderContext {
    return {
      now,
      today: toDateKey(now),
      settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
      permissionState: "granted",
      tasks: [{ id: "t1", text: "Walk", done: false }],
      locked: false,
      yesterdayOpen: [],
      draft: null,
      pending: [],
      lastDeliveredAt: null,
    };
  }

  it("keeps all 14 mornings beside 36 other pending notifications (64 minus the 28 we may own)", () => {
    const now = new Date(2026, 9, 26, 0, 30);
    const plan = taskAwareStrategy(context(now));
    const morningsInPlan = plan.filter((item) => item.id.includes(":morning:"));
    expect(morningsInPlan.length).toBeGreaterThanOrEqual(14);
    expect(plan.length).toBeLessThanOrEqual(28);
    expect(IOS_PENDING_NOTIFICATION_LIMIT - 28).toBe(36);
    expect(fitPlanToLimit(plan, { now, otherPending: 36 })).toHaveLength(plan.length);
  });

  it("with many others pending, drops the latest mornings first and keeps the soonest ones", () => {
    const now = new Date(2026, 9, 26, 0, 30);
    const plan = taskAwareStrategy(context(now));
    const kept = fitPlanToLimit(plan, { now, otherPending: 64 - 20 });
    expect(kept).toHaveLength(20);
    const lastKept = kept[kept.length - 1].fireAt.getTime();
    const dropped = plan.filter((item) => !kept.some((k) => k.id === item.id));
    for (const item of dropped) expect(item.fireAt.getTime()).toBeGreaterThanOrEqual(lastKept);
  });
});
