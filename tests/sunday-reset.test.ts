// The Sunday reset (1.6 H, PR #110): the pure rules. Which Today card shows
// (and to whom), the Sunday 6 PM notification, the wins and their words, the
// week's sort (a reworded saved item maps back to the saved words; the simple
// split when the AI is off or fails), and the draft the reset leaves.
//
// Local-time fixtures only (day keys and Dates from local constructors, and
// history written by syncTodayHistory), so the suite reads the same in every
// time zone. 25 Oct 2026 is a Sunday; 1 Nov 2026 (US clocks go back) and
// 8 Mar 2026 (US clocks go forward) are Sundays too.
import { describe, expect, it, vi } from "vitest";

import { fromDateKey, toDateKey } from "../lib/daily-tasks/date";
import { MANAGED_REMINDER_PREFIX } from "../lib/daily-tasks/reminders";
import { fitPlanToLimit, type ReminderContext, type ReminderPlanItem } from "../lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "../lib/daily-tasks/rollover";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import {
  DEFAULT_SUNDAY_RESET,
  RESET_DRAFT_BECAUSE,
  SUNDAY_RESET_KIND,
  SUNDAY_RESET_REMINDER_COPY,
  localWeekSort,
  nextDayCandidates,
  normalizeSundayReset,
  resetDraft,
  resetTargetDay,
  savedMatch,
  sortWeek,
  sundayResetCard,
  sundayResetOf,
  sundayResetReminder,
  usedBeforeToday,
  weekKey,
  weekWins,
  winsCopy,
  withSundayReset,
} from "../lib/daily-tasks/sunday-reset";
import {
  DEFAULT_NOTIFICATIONS,
  type History,
  type SundayResetState,
  type Task,
} from "../lib/daily-tasks/types";

const SUNDAY = "2026-10-25";

/** History the way the store writes it: one real day record per entry, [planned, done]. */
function historyOf(days: Record<string, [number, number]>): History {
  let state = buildInitialState(fromDateKey(Object.keys(days).sort()[0]));
  for (const [date, [planned, done]] of Object.entries(days)) {
    const tasks: Task[] = Array.from({ length: planned }, (_, i) => ({
      id: `${date}-${i}`,
      text: `Task ${i}`,
      createdAt: fromDateKey(date).toISOString(),
      carriedOver: false,
    }));
    state = syncTodayHistory({ ...state, tasks, todayCompletions: tasks.slice(0, done).map((t) => t.id) }, date);
  }
  return state.history;
}

describe("weekKey", () => {
  it("is the Sunday on or before the day (weeks run Sunday to Saturday)", () => {
    expect(weekKey("2026-10-25")).toBe("2026-10-25");
    expect(weekKey("2026-10-26")).toBe("2026-10-25");
    expect(weekKey("2026-10-31")).toBe("2026-10-25");
    expect(weekKey("2026-11-01")).toBe("2026-11-01");
  });

  it("holds across the clocks changing and the year ending", () => {
    // US clocks go back on Sunday 1 Nov 2026 and forward on Sunday 8 Mar 2026.
    expect(weekKey("2026-11-01")).toBe("2026-11-01");
    expect(weekKey("2026-11-07")).toBe("2026-11-01");
    expect(weekKey("2026-03-09")).toBe("2026-03-08");
    expect(weekKey("2026-03-07")).toBe("2026-03-01");
    expect(weekKey("2027-01-02")).toBe("2026-12-27");
  });

  it("plans the next day, across a month, a year and the clocks changing", () => {
    expect(resetTargetDay("2026-10-25")).toBe("2026-10-26");
    expect(resetTargetDay("2026-10-31")).toBe("2026-11-01");
    expect(resetTargetDay("2026-12-31")).toBe("2027-01-01");
    expect(resetTargetDay("2026-03-07")).toBe("2026-03-08");
  });
});

describe("sundayResetCard: which Today card shows", () => {
  const base = {
    today: SUNDAY,
    hour: 17,
    reset: DEFAULT_SUNDAY_RESET as SundayResetState,
    plus: "yes" as "yes" | "no" | "unknown",
    paywallEnabled: true,
    usedBefore: true,
    firstRunActive: false,
  };
  const card = (over: Partial<typeof base> = {}) => sundayResetCard({ ...base, ...over });

  it("shows only on Sunday, from 5 PM", () => {
    expect(card()).toBe("plus");
    expect(card({ hour: 23 })).toBe("plus");
    expect(card({ hour: 16 })).toBeNull();
    expect(card({ hour: 0 })).toBeNull();
    expect(card({ today: "2026-10-24" })).toBeNull(); // Saturday evening
    expect(card({ today: "2026-10-26" })).toBeNull(); // Monday evening
    expect(card({ plus: "no", hour: 16 })).toBeNull();
  });

  it("never on the first-run day (nothing planned on an earlier day, or first run still going)", () => {
    expect(card({ usedBefore: false })).toBeNull();
    expect(card({ firstRunActive: true })).toBeNull();
    expect(card({ plus: "no", usedBefore: false })).toBeNull();
    expect(card({ plus: "no", firstRunActive: true })).toBeNull();
  });

  it("nothing while Plus is still being checked", () => {
    expect(card({ plus: "unknown" })).toBeNull();
    expect(card({ plus: "unknown", reset: { ...DEFAULT_SUNDAY_RESET, freeIntroWeek: null } })).toBeNull();
  });

  it("hidden once this week's reset is done or the card was closed, but back in the next week", () => {
    for (const plus of ["yes", "no"] as const) {
      expect(card({ plus, reset: { ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY } })).toBeNull();
      expect(card({ plus, reset: { ...DEFAULT_SUNDAY_RESET, dismissedWeek: SUNDAY } })).toBeNull();
    }
    // Done or closed last Sunday says nothing about this one.
    expect(card({ reset: { ...DEFAULT_SUNDAY_RESET, doneWeek: "2026-10-18", dismissedWeek: "2026-10-11" } })).toBe("plus");
    // ...and this Sunday's mark doesn't carry into the next week.
    expect(card({ today: "2026-11-01", reset: { ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY } })).toBe("plus");
    expect(card({ today: "2026-11-01", reset: { ...DEFAULT_SUNDAY_RESET, dismissedWeek: SUNDAY } })).toBe("plus");
  });

  it("a free user on a paywall build gets the Plus intro, in one week only", () => {
    expect(card({ plus: "no" })).toBe("free");
    // Seen this week (it stays up all evening, and after a relaunch)...
    expect(card({ plus: "no", reset: { ...DEFAULT_SUNDAY_RESET, freeIntroWeek: SUNDAY } })).toBe("free");
    // ...never in a later week.
    expect(card({ plus: "no", today: "2026-11-01", reset: { ...DEFAULT_SUNDAY_RESET, freeIntroWeek: SUNDAY } })).toBeNull();
    expect(card({ plus: "no", today: "2026-12-27", reset: { ...DEFAULT_SUNDAY_RESET, freeIntroWeek: SUNDAY } })).toBeNull();
  });

  it("a free user on a build without the paywall gets nothing", () => {
    expect(card({ plus: "no", paywallEnabled: false })).toBeNull();
  });

  it("someone who subscribes after seeing the intro still gets the reset in a later week", () => {
    expect(card({ plus: "yes", today: "2026-11-01", reset: { ...DEFAULT_SUNDAY_RESET, freeIntroWeek: SUNDAY } })).toBe("plus");
  });
});

describe("usedBeforeToday", () => {
  it("needs a day before today with something planned", () => {
    expect(usedBeforeToday({}, SUNDAY)).toBe(false);
    expect(usedBeforeToday(historyOf({ [SUNDAY]: [3, 1] }), SUNDAY)).toBe(false);
    expect(usedBeforeToday(historyOf({ "2026-10-24": [0, 0], [SUNDAY]: [3, 1] }), SUNDAY)).toBe(false);
    expect(usedBeforeToday(historyOf({ "2026-10-24": [3, 0], [SUNDAY]: [3, 1] }), SUNDAY)).toBe(true);
  });
});

describe("weekWins: the best day", () => {
  it("is the day with the most finished, when that is 2 or more and nobody ties", () => {
    const wins = weekWins(historyOf({ "2026-10-19": [3, 3], "2026-10-20": [3, 2], "2026-10-21": [3, 1] }), SUNDAY);
    expect(wins).toEqual({ completed: 6, showedUpDays: 3, bestDay: { weekday: "Monday", completed: 3 } });
  });

  it("is none on a tie for the most", () => {
    const wins = weekWins(historyOf({ "2026-10-19": [3, 2], "2026-10-22": [3, 2], "2026-10-23": [3, 1] }), SUNDAY);
    expect(wins.bestDay).toBeNull();
    expect(wins.completed).toBe(5);
  });

  it("is none when the most is a single task, or nothing", () => {
    expect(weekWins(historyOf({ "2026-10-19": [3, 1], "2026-10-20": [3, 0] }), SUNDAY).bestDay).toBeNull();
    expect(weekWins(historyOf({ "2026-10-19": [3, 0] }), SUNDAY).bestDay).toBeNull();
    expect(weekWins({}, SUNDAY)).toEqual({ completed: 0, showedUpDays: 0, bestDay: null });
  });

  it("calls today 'Today', and counts only the seven days ending today", () => {
    const wins = weekWins(
      historyOf({ "2026-10-18": [3, 3], "2026-10-23": [3, 1], [SUNDAY]: [3, 3] }),
      SUNDAY,
    );
    // The 18th is eight days back: left out.
    expect(wins).toEqual({ completed: 4, showedUpDays: 2, bestDay: { weekday: "Today", completed: 3 } });
  });

  it("counts seven calendar days across the clocks changing (never a day lost or doubled)", () => {
    // Ends Sunday 1 Nov 2026, the night US clocks go back; and Monday 9 Mar 2026, after they went forward.
    const fall = historyOf(Object.fromEntries(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => [d, [1, 1]])));
    expect(weekWins(fall, "2026-11-01")).toMatchObject({ completed: 7, showedUpDays: 7, bestDay: null });
    const spring = historyOf(Object.fromEntries(["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"].map((d) => [d, [2, 1]])));
    expect(weekWins(spring, "2026-03-09")).toMatchObject({ completed: 7, showedUpDays: 7, bestDay: null });
    // The eighth day back is out.
    const eight = historyOf({ "2026-03-02": [1, 1], "2026-03-08": [3, 3] });
    expect(weekWins(eight, "2026-03-09")).toMatchObject({ completed: 3, bestDay: { weekday: "Sunday", completed: 3 } });
  });
});

describe("winsCopy: only what went well", () => {
  const NEGATIVE = /miss|fail|behind|didn'?t|unfinished|left over|only|\bof\b|\d\s*\/\s*\d|%/i;

  it("reads calmly, with the best day and Day N", () => {
    const copy = winsCopy({ completed: 8, showedUpDays: 5, bestDay: { weekday: "Tuesday", completed: 3 } }, 12);
    expect(copy.headline).toBe("8 tasks finished this week.");
    expect(copy.lines).toEqual(["You showed up on 5 days.", "Day 12 so far.", "Tuesday went best: 3 done."]);
    expect(winsCopy({ completed: 3, showedUpDays: 1, bestDay: { weekday: "Today", completed: 3 } }, 1).lines).toEqual([
      "You showed up on 1 day.",
      "Day 1 so far.",
      "Today went best: 3 done.",
    ]);
  });

  it("says 'task' for one, and has a kind line for a quiet week", () => {
    expect(winsCopy({ completed: 1, showedUpDays: 1, bestDay: null }, 0)).toEqual({
      headline: "1 task finished this week.",
      lines: ["You showed up on 1 day."],
    });
    expect(winsCopy({ completed: 0, showedUpDays: 0, bestDay: null }, 0)).toEqual({
      headline: "A quiet week. A new one starts now.",
      lines: [],
    });
  });

  it("never carries a missed count, a fraction or a percentage, however the week went", () => {
    const histories: History[] = [
      historyOf({ "2026-10-19": [3, 0], "2026-10-20": [3, 0], "2026-10-21": [3, 0] }),
      historyOf({ "2026-10-19": [3, 1], "2026-10-20": [3, 2], "2026-10-24": [3, 3] }),
      historyOf({ "2026-10-19": [3, 3], "2026-10-20": [3, 3], [SUNDAY]: [3, 0] }),
      {},
    ];
    for (const history of histories) {
      for (const dayCount of [0, 1, 9]) {
        const copy = winsCopy(weekWins(history, SUNDAY), dayCount);
        const text = [copy.headline, ...copy.lines].join("\n");
        expect(text).not.toMatch(NEGATIVE);
      }
    }
  });
});

describe("savedMatch", () => {
  it("is the saved words for the same words in any case or spacing", () => {
    expect(savedMatch("  call   the DENTIST ", ["Buy milk", "Call the dentist"])).toBe("Call the dentist");
  });

  it("maps a reworded pick to the saved item it came from, and nothing for a new one", () => {
    expect(savedMatch("Call dentist book cleaning", ["Call the dentist to book a cleaning"])).toBe("Call the dentist to book a cleaning");
    expect(savedMatch("Mow the lawn", ["Call the dentist to book a cleaning"])).toBeNull();
  });

  it("leaves a pick that matches a line of this week's dump better than the saved item", () => {
    const saved = ["Pay the electric bill online"];
    const dump = "Pay the water bill online";
    expect(savedMatch("Pay the water bill online", saved, dump)).toBeNull();
    // Without that dump line it would have been taken for the saved one.
    expect(savedMatch("Pay the water bill online", saved)).toBe("Pay the electric bill online");
  });
});

describe("sortWeek", () => {
  const SAVED = ["Call the dentist to book a cleaning", "Renew passport"];
  const aiResult = (over: Record<string, unknown> = {}) => ({
    picks: ["Call dentist book cleaning", "Mow the lawn"],
    parked: ["Renew passport", "Wash the car"],
    reasons: ["Quick win", ""],
    source: "ai" as const,
    ...over,
  });
  const params = { dump: "mow lawn\nwash car", saved: SAVED, forDay: "Monday", goalTitle: "Run a 5K", useAi: true };

  it("maps a reworded saved item back to the saved words, keeps its reason, and never re-saves a saved item", async () => {
    const request = vi.fn(async () => aiResult());
    const sort = await sortWeek(params, request);
    expect(sort.source).toBe("ai");
    expect(sort.suggested).toEqual(["Call the dentist to book a cleaning", "Mow the lawn"]);
    expect(sort.reasons).toEqual({ "Call the dentist to book a cleaning": "Quick win" });
    // Only the new items from the dump are saved: not the reworded saved pick, not the saved parked one.
    expect(sort.dumpItems).toEqual(["Mow the lawn", "Wash the car"]);
  });

  // PR #110 review: the first 20 in the order given (resurfacing order, see
  // savedForReset), not the newest, so old items can come back.
  it("asks for the next day with the first 20 saved items (in the order given) beside the dump", async () => {
    const many = Array.from({ length: 25 }, (_, i) => `Saved thing number ${i}`);
    const request = vi.fn(async () => aiResult({ picks: ["Mow the lawn"], parked: [], reasons: [] }));
    await sortWeek({ ...params, saved: many }, request);
    expect(request).toHaveBeenCalledTimes(1);
    const call = (request.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call).toMatchObject({ text: "mow lawn\nwash car", openSlots: 3, forDay: "Monday", goalTitle: "Run a 5K" });
    expect(call.saved).toEqual(many.slice(0, 20));
    expect((call.saved as string[]).length).toBe(20);
  });

  it("with no new dump, the saved items are what there is to pick from (sent as the text, not twice)", async () => {
    const request = vi.fn(async () => aiResult({ picks: ["Renew passport"], parked: [], reasons: [] }));
    const sort = await sortWeek({ ...params, dump: "   " }, request);
    const call = (request.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call.text).toBe(SAVED.join("\n"));
    expect(call).not.toHaveProperty("saved");
    expect(sort.suggested).toEqual(["Renew passport"]);
    expect(sort.dumpItems).toEqual([]);
  });

  it("keeps a pick that is closer to a line of the dump than to a saved item as its own new item", async () => {
    const request = vi.fn(async () => aiResult({ picks: ["Pay the water bill online"], parked: [], reasons: [] }));
    const sort = await sortWeek(
      { ...params, dump: "Pay the water bill online", saved: ["Pay the electric bill online"] },
      request,
    );
    expect(sort.suggested).toEqual(["Pay the water bill online"]);
    expect(sort.dumpItems).toEqual(["Pay the water bill online"]);
  });

  it("falls back to the simple split offline (the call fails)", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    const sort = await sortWeek(params, request);
    expect(sort).toEqual(localWeekSort("mow lawn\nwash car", SAVED));
    expect(sort.source).toBe("local");
    expect(sort.suggested).toEqual(["Mow lawn", "Wash car", ...SAVED].slice(0, 3));
  });

  it("falls back when the answer isn't the AI's (an old Worker or no proxy answers with the on-device split)", async () => {
    const request = vi.fn(async () => ({ picks: ["Mow lawn"], parked: ["Wash car"], source: "local" as const }));
    const sort = await sortWeek(params, request);
    expect(sort.source).toBe("local");
    expect(sort).toEqual(localWeekSort("mow lawn\nwash car", SAVED));
  });

  it("makes no call when the AI is off, and none when there is nothing at all", async () => {
    const request = vi.fn(async () => aiResult());
    expect((await sortWeek({ ...params, useAi: false }, request)).source).toBe("local");
    expect(await sortWeek({ ...params, dump: "", saved: [] }, request)).toEqual({
      dumpItems: [],
      suggested: [],
      reasons: {},
      source: "local",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("the simple split saves only what is new, and suggests the dump first, then the saved", () => {
    const sort = localWeekSort("Book dentist\nFinish slides\ncall sam", ["book  DENTIST", "Renew passport"]);
    expect(sort.dumpItems).toEqual(["Finish slides", "Call sam"]);
    expect(sort.suggested).toEqual(["Book dentist", "Finish slides", "Call sam"]);
    expect(sort.reasons).toEqual({});
  });
});

describe("the next day's rows and draft", () => {
  it("lists the suggestion, the dump, the saved (newest first), then an existing draft, each once", () => {
    expect(
      nextDayCandidates({
        suggested: ["A", "b"],
        dumpItems: ["B", "C"],
        saved: ["old", "C", "new"],
        existingDraft: ["a", "D", "new"],
      }),
    ).toEqual(["A", "b", "C", "new", "old", "D"]);
  });

  it("the three become the next day's draft, marked as the reset's (cleaned, once each, at most three)", () => {
    expect(resetDraft([" walk ", "Walk", "read", "", "stretch", "fourth"], SUNDAY, "ai")).toEqual({
      forDate: "2026-10-26",
      tasks: ["Walk", "Read", "Stretch"],
      note: "",
      because: RESET_DRAFT_BECAUSE,
      source: "ai",
      from: "reset",
    });
  });

  it("plans the next day whichever day it is done on, and nothing for nothing", () => {
    expect(resetDraft(["Walk"], "2026-10-28", "local")?.forDate).toBe("2026-10-29");
    expect(resetDraft(["Walk"], "2026-10-31", "local")?.forDate).toBe("2026-11-01");
    expect(resetDraft(["Walk"], "2026-12-31", "local")?.forDate).toBe("2027-01-01");
    expect(resetDraft([], SUNDAY, "local")).toBeNull();
    expect(resetDraft(["  ", ""], SUNDAY, "local")).toBeNull();
  });
});

describe("what is saved on the device", () => {
  it("a record from an older save reads as the defaults, a malformed one is made safe", () => {
    expect(sundayResetOf({})).toEqual({ reminder: true, doneWeek: null, dismissedWeek: null, freeIntroWeek: null });
    for (const bad of [null, "x", 3, [], undefined]) expect(normalizeSundayReset(bad)).toEqual(DEFAULT_SUNDAY_RESET);
    expect(
      normalizeSundayReset({ reminder: "no", doneWeek: "tomorrow", dismissedWeek: 5, freeIntroWeek: "2026-10-25" }),
    ).toEqual({ reminder: true, doneWeek: null, dismissedWeek: null, freeIntroWeek: "2026-10-25" });
    expect(normalizeSundayReset({ reminder: false }).reminder).toBe(false);
  });

  it("the reset's mark on a draft survives a save and a load; an older draft has none", () => {
    const state = buildInitialState(fromDateKey(SUNDAY));
    const withDraft = { ...state, tomorrowDraft: resetDraft(["Walk"], SUNDAY, "local"), sundayReset: { ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY } };
    const back = normalizeState(JSON.parse(JSON.stringify(withDraft)));
    expect(back?.tomorrowDraft).toMatchObject({ forDate: "2026-10-26", from: "reset", tasks: ["Walk"] });
    expect(back?.sundayReset).toEqual({ ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY });
    const older = normalizeState(JSON.parse(JSON.stringify({ ...state, tomorrowDraft: { ...withDraft.tomorrowDraft, from: undefined } })));
    expect(older?.tomorrowDraft).not.toHaveProperty("from");
    const noReset = normalizeState(JSON.parse(JSON.stringify(state)));
    expect(noReset).not.toHaveProperty("sundayReset");
  });
});

describe("sundayResetReminder: the Sunday 6 PM notification", () => {
  const context = (now: Date, over: Partial<ReminderContext> = {}): ReminderContext => ({
    now,
    today: toDateKey(now),
    settings: DEFAULT_NOTIFICATIONS,
    permissionState: "granted",
    tasks: [],
    locked: false,
    yesterdayOpen: [],
    draft: null,
    pending: [],
    lastDeliveredAt: null,
    plus: true,
    sundayReset: DEFAULT_SUNDAY_RESET,
    ...over,
  });
  const WED = new Date(2026, 9, 21, 12, 0);

  it("is the next Sunday at 6 PM, one plain active item with fixed words and ids only", () => {
    const item = sundayResetReminder(context(WED));
    expect(item).toEqual({
      id: `${MANAGED_REMINDER_PREFIX}2026-10-25:${SUNDAY_RESET_KIND}:1800`,
      fireAt: new Date(2026, 9, 25, 18, 0, 0, 0),
      title: SUNDAY_RESET_REMINDER_COPY.title,
      body: SUNDAY_RESET_REMINDER_COPY.body,
      kind: "sunday_reset",
      interruptionLevel: "active",
    });
    expect(item?.fireAt.getDay()).toBe(0);
    expect(item?.fireAt.getHours()).toBe(18);
    // Never time-sensitive (that needs an Apple entitlement), nor critical.
    expect(item?.interruptionLevel).not.toMatch(/timeSensitive|critical/);
  });

  it("is today at 6 PM before then, and the next Sunday from 6 PM on", () => {
    expect(sundayResetReminder(context(new Date(2026, 9, 25, 9, 0)))?.fireAt).toEqual(new Date(2026, 9, 25, 18, 0));
    expect(sundayResetReminder(context(new Date(2026, 9, 25, 17, 59, 59)))?.fireAt).toEqual(new Date(2026, 9, 25, 18, 0));
    expect(sundayResetReminder(context(new Date(2026, 9, 25, 18, 0)))?.fireAt).toEqual(new Date(2026, 10, 1, 18, 0));
    expect(sundayResetReminder(context(new Date(2026, 9, 25, 22, 30)))?.fireAt).toEqual(new Date(2026, 10, 1, 18, 0));
    expect(sundayResetReminder(context(new Date(2026, 9, 24, 23, 59)))?.fireAt).toEqual(new Date(2026, 9, 25, 18, 0));
  });

  it("stays at 6 PM local when the clocks change, and in the week after", () => {
    // US clocks go back on Sunday 1 Nov 2026, forward on Sunday 8 Mar 2026.
    for (const [now, sunday] of [
      [new Date(2026, 9, 31, 20, 0), new Date(2026, 10, 1, 18, 0)],
      [new Date(2026, 2, 7, 20, 0), new Date(2026, 2, 8, 18, 0)],
      [new Date(2026, 11, 29, 8, 0), new Date(2027, 0, 3, 18, 0)],
    ] as const) {
      const item = sundayResetReminder(context(now));
      expect(item?.fireAt).toEqual(sunday);
      expect(item?.fireAt.getHours()).toBe(18);
      expect(item?.id).toBe(`${MANAGED_REMINDER_PREFIX}${toDateKey(sunday)}:sunday_reset:1800`);
    }
  });

  it("only for Plus, with notifications on and allowed, and the Sunday reset switch on", () => {
    expect(sundayResetReminder(context(WED))).not.toBeNull();
    expect(sundayResetReminder(context(WED, { plus: false }))).toBeNull();
    expect(sundayResetReminder(context(WED, { plus: undefined }))).toBeNull();
    expect(sundayResetReminder(context(WED, { settings: { ...DEFAULT_NOTIFICATIONS, enabled: false } }))).toBeNull();
    expect(sundayResetReminder(context(WED, { permissionState: "denied" }))).toBeNull();
    expect(sundayResetReminder(context(WED, { permissionState: "undetermined" }))).toBeNull();
    // The Settings switch off removes it; a context without the record plans none.
    expect(sundayResetReminder(context(WED, { sundayReset: { ...DEFAULT_SUNDAY_RESET, reminder: false } }))).toBeNull();
    expect(sundayResetReminder(context(WED, { sundayReset: undefined }))).toBeNull();
  });

  it("skips a Sunday whose week is already done or was closed, but not a past week's mark", () => {
    // PR #110 review: a done or closed week moves it to the Sunday after, never to none.
    const NEXT_SUNDAY = new Date(2026, 10, 1, 18, 0);
    expect(sundayResetReminder(context(WED, { sundayReset: { ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY } }))?.fireAt).toEqual(NEXT_SUNDAY);
    expect(sundayResetReminder(context(WED, { sundayReset: { ...DEFAULT_SUNDAY_RESET, dismissedWeek: SUNDAY } }))?.fireAt).toEqual(NEXT_SUNDAY);
    const past = { ...DEFAULT_SUNDAY_RESET, doneWeek: "2026-10-18", dismissedWeek: "2026-10-11" };
    expect(sundayResetReminder(context(WED, { sundayReset: past }))?.fireAt).toEqual(new Date(2026, 9, 25, 18, 0));
    // Done this Sunday afternoon, then the evening passes: the next one is for next Sunday.
    const done = { ...DEFAULT_SUNDAY_RESET, doneWeek: SUNDAY };
    expect(sundayResetReminder(context(new Date(2026, 9, 25, 19, 0), { sundayReset: done }))?.fireAt).toEqual(
      new Date(2026, 10, 1, 18, 0),
    );
  });

  it("carries no task words, whatever the day holds or the Hide task names switch says", () => {
    const tasks = [
      { id: "t0", text: "Zebra crossing report", done: false },
      { id: "t1", text: "Quarterly taxes", done: true },
    ];
    for (const hideTaskNames of [false, true]) {
      const item = sundayResetReminder(
        context(WED, {
          tasks,
          yesterdayOpen: ["Unfinished zebra"],
          draft: { forDate: "2026-10-22", tasks: ["Draft zebra"], note: "", because: "", source: "local" },
          settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames },
        }),
      );
      expect(JSON.stringify(item)).not.toMatch(/zebra|taxes/i);
      expect(item).not.toHaveProperty("data");
    }
  });

  it("is added to the strategy's plan once, and only when due", async () => {
    const other: ReminderPlanItem = {
      id: `${MANAGED_REMINDER_PREFIX}2026-10-21:morning:0900`,
      fireAt: new Date(2026, 9, 22, 9, 0),
      title: "Morning",
      body: "Hello",
    };
    const strategy = vi.fn(async () => [other]);
    const wrapped = withSundayReset(strategy);
    const plan = await wrapped(context(WED));
    expect(plan.map((item) => item.kind)).toEqual([undefined, "sunday_reset"]);
    expect(strategy).toHaveBeenCalledTimes(1);

    const off = await wrapped(context(WED, { plus: false }));
    expect(off).toEqual([other]);

    // A strategy that already planned it is not doubled.
    const sunday = sundayResetReminder(context(WED))!;
    const twice = await withSundayReset(async () => [sunday])(context(WED));
    expect(twice).toEqual([sunday]);
  });

  it("fits the pending limit: the nearest reminders win, the Sunday one is first to go when it is full", () => {
    const now = new Date(2026, 9, 21, 8, 0);
    const sunday = sundayResetReminder(context(now))!;
    const daily = (count: number): ReminderPlanItem[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `${MANAGED_REMINDER_PREFIX}d${i}:morning:0900`,
        fireAt: new Date(2026, 9, 21, 9 + i, 0),
        title: "Morning",
        body: "Hello",
      }));
    // iOS keeps 64; two are reserved for others. Room for 62 of ours.
    const roomy = fitPlanToLimit([...daily(40), sunday], { now, otherPending: 0 });
    expect(roomy.map((item) => item.id)).toContain(sunday.id);
    const full = fitPlanToLimit([...daily(62), sunday], { now, otherPending: 0 });
    expect(full).toHaveLength(62);
    expect(full.map((item) => item.id)).not.toContain(sunday.id);
    const crowded = fitPlanToLimit([...daily(10), sunday], { now, otherPending: 60 });
    expect(crowded.length).toBeLessThanOrEqual(4);
  });
});
