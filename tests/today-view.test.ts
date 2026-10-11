import { afterEach, describe, expect, it, vi } from "vitest";

import { formatTime } from "../lib/daily-tasks/date";

import { isLatestRequest } from "../lib/daily-tasks/ai-status";
import { MILESTONE_IDS, buildMilestones, buildMomentumPlan } from "../lib/daily-tasks/momentum";
import {
  migrateCompletedMilestoneIds,
  migrateMilestoneId,
  milestonesWithCompletion,
} from "../lib/daily-tasks/milestones";
import {
  REVIEW_COOLDOWN_DAYS,
  shouldRequestReview,
} from "../lib/daily-tasks/review-prompt";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import {
  THINKING_HINT_DELAY_MS,
  brainDumpToast,
  LOCKED_CHANGE_NOTE,
  UNLOCKED_NOTE,
  unlockConfirmation,
  clockTimeOf,
  formatClockTime,
  ideasEntry,
  ideasSource,
  lockConfirmation,
  TASK_ROW_ACTION_LABELS,
  taskRowActions,
  isPerfectDayTransition,
  showIdeasEntry,
  dayChipLabel,
  dayChipText,
  todayProgress,
  todayStatus,
  type ClockTimeFormat,
} from "../lib/daily-tasks/today-view";
import type { DayRecord, History, MomentumPlan } from "../lib/daily-tasks/types";
import { DEFAULT_MOMENTUM_SETTINGS } from "../lib/daily-tasks/types";

describe("todayProgress", () => {
  it("describes an empty day without claiming progress", () => {
    const p = todayProgress(0, 0);
    expect(p).toMatchObject({ headline: "Pick today's three", ratio: 0, isPerfect: false });
    expect(p.label).not.toMatch(/\d of/);
  });

  it("counts progress against three slots so 1 of 1 isn't a full bar", () => {
    expect(todayProgress(1, 1).ratio).toBeCloseTo(1 / 3);
    expect(todayProgress(2, 3).ratio).toBeCloseTo(2 / 3);
    expect(todayProgress(3, 3).ratio).toBe(1);
  });

  it("only calls three-for-three a perfect day", () => {
    expect(todayProgress(3, 3)).toMatchObject({ headline: "Perfect day!", isPerfect: true });
    expect(todayProgress(2, 2)).toMatchObject({ headline: "All done!", isPerfect: true });
    expect(todayProgress(0, 3).headline).toBe("Let's go!");
    expect(todayProgress(1, 3).headline).toBe("Almost there!");
  });

  it("says how many slots are still open while the day is unlocked", () => {
    expect(todayProgress(0, 1).label).toBe("0 of 1 done · 2 open");
    expect(todayProgress(1, 2).label).toBe("1 of 2 done · 1 open");
    // Once locked, empty slots are closed for the day.
    expect(todayProgress(0, 1, { locked: true }).label).toBe("0 of 1 done");
  });

  it("gives VoiceOver a spoken label with a comma instead of the middle dot", () => {
    expect(todayProgress(0, 1).spokenLabel).toBe("0 of 1 done, 2 open");
    expect(todayProgress(1, 2).spokenLabel).toBe("1 of 2 done, 1 open");
    expect(todayProgress(2, 3).spokenLabel).toBe("2 of 3 done");
    expect(todayProgress(0, 1, { locked: true }).spokenLabel).toBe("0 of 1 done");
    expect(todayProgress(0, 0).spokenLabel).toBe(todayProgress(0, 0).label);
    for (const [c, t] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ]) {
      expect(todayProgress(c, t).spokenLabel).not.toMatch(/·/);
    }
  });

  it("labels progress and clamps bad counts", () => {
    expect(todayProgress(2, 3).label).toBe("2 of 3 done");
    expect(todayProgress(5, 3)).toMatchObject({ completed: 3, label: "3 of 3 done" });
    expect(todayProgress(-1, 3)).toMatchObject({ completed: 0, ratio: 0 });
  });
});

describe("todayStatus", () => {
  const base = { locked: false, lockSource: null, taskCount: 2, completedCount: 0 } as const;

  it("doesn't offer to lock an empty day", () => {
    expect(todayStatus({ ...base, taskCount: 0 })).toMatchObject({ kind: "empty", canLock: false });
  });

  it("points an empty day at picking up to three", () => {
    expect(todayStatus({ ...base, taskCount: 0 }).text).toBe(
      "Pick up to three things that would make today a good day.",
    );
  });

  it("offers Set today while choosing, with copy for a full list", () => {
    expect(todayStatus(base)).toMatchObject({
      kind: "choosing",
      canLock: true,
      text: "Still choosing. Set the day when it feels right.",
    });
    expect(todayStatus({ ...base, taskCount: 3 }).text).toBe("Happy with these three? Set them.");
  });

  it("once under way, says what's left and stops offering Set", () => {
    expect(todayStatus({ ...base, taskCount: 3, completedCount: 1 })).toEqual({
      kind: "choosing",
      text: "Keep going. 2 to go.",
      canLock: false,
    });
    expect(todayStatus({ ...base, taskCount: 2, completedCount: 1 }).text).toBe("Keep going. 1 to go.");
  });

  it("says all done (and offers no Set) once every picked task is done", () => {
    expect(todayStatus({ ...base, taskCount: 3, completedCount: 3 })).toEqual({
      kind: "choosing",
      text: "All done for today.",
      canLock: false,
    });
    // Fewer than three: room is left, so say so without pushing.
    for (const taskCount of [1, 2]) {
      expect(todayStatus({ ...base, taskCount, completedCount: taskCount })).toEqual({
        kind: "choosing",
        text: "All done so far. Add another, or enjoy the space.",
        canLock: false,
      });
    }
    // A locked day keeps its own "set" copy even when everything is done.
    expect(todayStatus({ ...base, locked: true, lockSource: "manual", completedCount: 2 }).text).toBe(
      "Today is set. All done.",
    );
  });

  it("says 'set' for the day's status; 'unlock' only names the way back (1.4)", () => {
    const texts = [
      todayStatus(base).text,
      todayStatus({ ...base, taskCount: 3 }).text,
      todayStatus({ ...base, locked: true, lockSource: "auto", autoLockTime: "9:00 AM" }).text,
      lockConfirmation(1).title,
      lockConfirmation(3).title,
    ];
    for (const text of texts) expect(text).not.toMatch(/lock/i);
    for (const count of [1, 3]) expect(lockConfirmation(count).message).toMatch(/unlock it in Settings/);
  });

  it("distinguishes manual and automatic locks and shows what's left", () => {
    expect(
      todayStatus({ ...base, locked: true, lockSource: "manual", completedCount: 1 }),
    ).toMatchObject({
      kind: "set",
      text: "Today is set. 1 to go.",
      canLock: false,
    });
    expect(
      todayStatus({
        ...base,
        locked: true,
        lockSource: "auto",
        completedCount: 2,
        autoLockTime: "12:00 PM",
      }).text,
    ).toBe("Set automatically at 12:00 PM. All done.");
    expect(todayStatus({ ...base, locked: true, lockSource: "auto", completedCount: 0 }).text).toBe(
      "Set automatically. 2 to go.",
    );
    expect(todayStatus({ ...base, locked: true, lockSource: "manual", taskCount: 0 }).text).toBe(
      "Today is set.",
    );
  });
});

describe("showIdeasEntry", () => {
  it("shows only while unlocked with room to add", () => {
    expect(showIdeasEntry({ locked: false, remainingSlots: 1 })).toBe(true);
    expect(showIdeasEntry({ locked: true, remainingSlots: 3 })).toBe(false);
    expect(showIdeasEntry({ locked: false, remainingSlots: 0 })).toBe(false);
  });
});

describe("ideasSource", () => {
  const plan = (provider: "ai" | "template") => ({ provider }) as MomentumPlan;

  it("labels AI plans as personalized for the goal", () => {
    expect(ideasSource(plan("ai"), "Run a 5K")).toEqual({
      personalized: true,
      label: "Made for your goal",
    });
  });

  it("labels template plans and missing goals as starter ideas", () => {
    expect(ideasSource(plan("template"), "Run a 5K").personalized).toBe(false);
    expect(ideasSource(plan("ai"), null).label).toBe("Starter ideas");
    expect(ideasSource(null, "Run a 5K").label).toBe("Starter ideas");
  });
});

describe("day chip", () => {
  it("says Day N (never below 1) with a spoken label", () => {
    expect(dayChipText(21)).toBe("Day 21");
    expect(dayChipText(0)).toBe("Day 1");
    expect(dayChipText(-3)).toBe("Day 1");
    expect(dayChipText(4.7)).toBe("Day 4");
    expect(dayChipLabel(21)).toBe("Day 21 of showing up");
    expect(dayChipLabel(0)).toBe("Day 1 of showing up");
  });
});

describe("isPerfectDayTransition", () => {
  it("fires when the third task is checked off", () => {
    expect(isPerfectDayTransition({ previousCompleted: 2, completed: 3, total: 3 })).toBe(true);
  });

  it("does not fire when the app opens on an already-perfect day", () => {
    expect(isPerfectDayTransition({ previousCompleted: null, completed: 3, total: 3 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 3, completed: 3, total: 3 })).toBe(false);
  });

  it("needs all three slots filled, and fires again after un-check/re-check", () => {
    expect(isPerfectDayTransition({ previousCompleted: 1, completed: 2, total: 2 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 3, completed: 2, total: 3 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 2, completed: 3, total: 3 })).toBe(true);
  });
});

describe("THINKING_HINT_DELAY_MS", () => {
  it("waits a while before saying 'still thinking'", () => {
    expect(THINKING_HINT_DELAY_MS).toBeGreaterThanOrEqual(5_000);
  });
});

function day(date: string, completed: number, total = 3): DayRecord {
  return {
    date,
    total,
    completed,
    locked: true,
    lockSource: "manual",
    tasks: [],
    reflection: null,
    reflectionResult: null,
  };
}

describe("review prompt policy", () => {
  const perfectHistory = (n: number): History =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => {
        const key = `2026-09-${String(i + 1).padStart(2, "0")}`;
        return [key, day(key, 3)];
      }),
    );
  const now = new Date("2026-09-26T20:00:00Z");

  const quiet = {
    today: "2026-09-26",
    now,
    onboardingVisible: false,
  };

  it("asks right after a perfect day, once the user has shown up before today", () => {
    expect(
      shouldRequestReview({ ...quiet, history: perfectHistory(1), lastReviewPromptAt: null }),
    ).toBe(true);
  });

  it("never asks on the install's first day", () => {
    expect(shouldRequestReview({ ...quiet, lastReviewPromptAt: null, history: {} })).toBe(false);
  });

  it("respects the cooldown after the last prompt", () => {
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const ask = (last: string) =>
      shouldRequestReview({
        ...quiet,
        history: perfectHistory(10),
        lastReviewPromptAt: last,
      });
    expect(ask(daysAgo(REVIEW_COOLDOWN_DAYS - 1))).toBe(false);
    expect(ask(daysAgo(REVIEW_COOLDOWN_DAYS))).toBe(true);
    expect(ask("garbage")).toBe(true);
  });
});

describe("milestone ids are shared by template and AI plans", () => {
  it("template milestones use the shared positional ids", () => {
    expect(buildMilestones("Run a 5K").map((m) => m.id)).toEqual([...MILESTONE_IDS]);
  });

  it("completion carries over when the day's plan switches source", () => {
    const aiDone = ["milestone_start"];
    const template = buildMomentumPlan({
      profile: {
        name: null,
        goalTitle: "Run a 5K",
        goalSource: "custom",
        timeAvailability: "30_min",
        experienceLevel: "beginner",
        struggleType: "consistency",
        motivation: null,
        preferredTime: null,
        cadence: null,
        onboardingCompletedAt: "2026-09-01T00:00:00Z",
      },
      history: {},
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-09-26T12:00:00Z"),
    });
    const view = milestonesWithCompletion(template!.milestones, aiDone);
    expect(view[0].done).toBe(true);
    expect(view[1].done).toBe(false);
  });

  it("migrates legacy AI ids and de-duplicates", () => {
    expect(migrateMilestoneId("m1")).toBe("milestone_start");
    expect(migrateMilestoneId("m3")).toBe("milestone_grow");
    expect(migrateMilestoneId("milestone_repeat")).toBe("milestone_repeat");
    expect(migrateMilestoneId("m4")).toBe("m4");
    expect(migrateCompletedMilestoneIds(["m1", "milestone_start", "m2"])).toEqual([
      "milestone_start",
      "milestone_repeat",
    ]);
  });

  it("migrates saved state on load: completed ids and saved plan milestones", () => {
    const saved = {
      ...buildInitialState(),
      completedMilestoneIds: ["m1", "m2"],
      momentumPlan: {
        id: "p",
        goalTitle: "Run a 5K",
        generatedAt: "2026-09-26T08:00:00Z",
        provider: "ai",
        milestones: [
          { id: "m1", title: "One", description: "", completedAt: null },
          { id: "m2", title: "Two", description: "", completedAt: null },
        ],
        taskPool: [],
        todaySuggestions: [],
        promptSummary: "",
        version: 1,
      },
    };
    const restored = normalizeState(JSON.parse(JSON.stringify(saved)));
    expect(restored?.completedMilestoneIds).toEqual(["milestone_start", "milestone_repeat"]);
    expect(restored?.momentumPlan?.milestones.map((m) => m.id)).toEqual([
      "milestone_start",
      "milestone_repeat",
    ]);
    const view = milestonesWithCompletion(
      restored!.momentumPlan!.milestones,
      restored!.completedMilestoneIds,
    );
    expect(view.every((m) => m.done)).toBe(true);
  });

  it("keeps a saved review-prompt timestamp and defaults it to null", () => {
    expect(normalizeState(buildInitialState())?.lastReviewPromptAt).toBeNull();
    expect(
      normalizeState({ ...buildInitialState(), lastReviewPromptAt: "2026-09-01T00:00:00Z" })
        ?.lastReviewPromptAt,
    ).toBe("2026-09-01T00:00:00Z");
    expect(
      normalizeState({ ...buildInitialState(), lastReviewPromptAt: 42 })?.lastReviewPromptAt,
    ).toBeNull();
  });
});

describe("isLatestRequest", () => {
  it("only lets the newest AI request update state", () => {
    expect(isLatestRequest(3, 3)).toBe(true);
    expect(isLatestRequest(2, 3)).toBe(false);
  });
});

describe("ideasEntry", () => {
  it("is the prominent next step on an empty day, naming the goal", () => {
    expect(ideasEntry(0, "Run a 5K")).toEqual({ label: "See ideas for Run a 5K", prominent: true });
    expect(ideasEntry(0, null)).toEqual({ label: "See some ideas", prominent: true });
  });

  it("steps back once tasks exist", () => {
    expect(ideasEntry(1, "Run a 5K")).toEqual({ label: "Need ideas?", prominent: false });
  });
});

describe("lockConfirmation", () => {
  it("explains what locking does and how to undo it", () => {
    const { title, message } = lockConfirmation(2);
    expect(title).toBe("Set today?");
    expect(message).toBe(
      "You can still check tasks off. Adding and editing pause until tomorrow, or until you unlock it in Settings. Your empty slot stays empty.",
    );
    expect(message).not.toMatch(/Change/);
  });

  it("keeps it light when all three are chosen (nothing is lost by locking)", () => {
    const { title, message } = lockConfirmation(3);
    expect(title).toBe("Set today?");
    expect(message).toBe(
      "You can still check tasks off. Editing pauses until tomorrow, or until you unlock it in Settings.",
    );
    expect(message).not.toMatch(/empty slot/);
    expect(message).not.toMatch(/won't be able/);
  });

  it("warns that empty slots stay empty", () => {
    expect(lockConfirmation(2).message).toContain("Your empty slot stays empty.");
    expect(lockConfirmation(1).message).toContain("Your empty slots stay empty.");
  });
});

// The device's 12 or 24-hour setting, stood in for: what a 12-hour and a
// 24-hour device hand back, whatever the machine (and engine) running the tests.
const two = (value: number) => String(value).padStart(2, "0");
/** As en-US does on newer engines: a narrow no-break space before AM/PM. */
const TWELVE_HOUR: ClockTimeFormat = (hour, minute) =>
  `${((hour + 11) % 12) + 1}:${two(minute)}\u202f${hour < 12 ? "AM" : "PM"}`;
const TWENTY_FOUR_HOUR: ClockTimeFormat = (hour, minute) => `${two(hour)}:${two(minute)}`;
/** The real thing for a locale (its exact digits vary by engine, so only its shape is checked). */
const inLocale =
  (locale: string): ClockTimeFormat =>
  (hour, minute) =>
    new Date(2026, 8, 26, hour, minute).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

describe("clockTimeOf", () => {
  it("formats an ISO timestamp as the local clock time, 12 or 24-hour as the device says", () => {
    expect(clockTimeOf(new Date(2026, 8, 26, 12, 3).toISOString(), TWELVE_HOUR)).toBe("12:03 PM");
    expect(clockTimeOf(new Date(2026, 8, 26, 0, 0).toISOString(), TWELVE_HOUR)).toBe("12:00 AM");
    expect(clockTimeOf(new Date(2026, 8, 26, 21, 45).toISOString(), TWELVE_HOUR)).toBe("9:45 PM");
    expect(clockTimeOf(new Date(2026, 8, 26, 12, 3).toISOString(), TWENTY_FOUR_HOUR)).toBe("12:03");
    expect(clockTimeOf(new Date(2026, 8, 26, 0, 0).toISOString(), TWENTY_FOUR_HOUR)).toBe("00:00");
    expect(clockTimeOf(new Date(2026, 8, 26, 21, 45).toISOString(), TWENTY_FOUR_HOUR)).toBe("21:45");
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(clockTimeOf(null)).toBeNull();
    expect(clockTimeOf("")).toBeNull();
    expect(clockTimeOf("not a date")).toBeNull();
  });
});

describe("formatClockTime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a 12-hour device: 12-hour clock times, with a plain space before AM/PM", () => {
    expect(formatClockTime(0, 0, TWELVE_HOUR)).toBe("12:00 AM");
    expect(formatClockTime(9, 5, TWELVE_HOUR)).toBe("9:05 AM");
    expect(formatClockTime(12, 0, TWELVE_HOUR)).toBe("12:00 PM");
    expect(formatClockTime(23, 30, TWELVE_HOUR)).toBe("11:30 PM");
    // Whatever space the locale's data puts there (a narrow no-break one, on newer engines).
    expect(formatClockTime(14, 7, () => "2:07\u202fPM")).toBe("2:07 PM");
    expect(formatClockTime(14, 7, () => " 2:07\u00a0PM ")).toBe("2:07 PM");
  });

  it("a 24-hour device: 24-hour clock times", () => {
    expect(formatClockTime(0, 0, TWENTY_FOUR_HOUR)).toBe("00:00");
    expect(formatClockTime(9, 5, TWENTY_FOUR_HOUR)).toBe("09:05");
    expect(formatClockTime(12, 0, TWENTY_FOUR_HOUR)).toBe("12:00");
    expect(formatClockTime(23, 30, TWENTY_FOUR_HOUR)).toBe("23:30");
  });

  it("real locales: a 12-hour one says AM/PM, a 24-hour one doesn't", () => {
    expect(formatClockTime(14, 7, inLocale("en-US"))).toBe("2:07 PM");
    expect(formatClockTime(14, 7, inLocale("en-GB"))).toBe("14:07");
    expect(formatClockTime(14, 7, inLocale("de-DE"))).toBe("14:07");
    expect(formatClockTime(0, 0, inLocale("en-GB"))).toMatch(/^0?0:00$/);
  });

  it("by default asks the device, with no forced locale or hour cycle (the helper Settings' time pickers use)", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("14:07");
    expect(formatClockTime(14, 7)).toBe("14:07");
    expect(spy).toHaveBeenCalledWith(undefined, { hour: "numeric", minute: "2-digit" });
    expect(formatClockTime(14, 7)).toBe(formatTime(14, 7));
    expect(clockTimeOf(new Date(2026, 8, 26, 14, 7).toISOString())).toBe("14:07");
  });

  it("falls back to 12-hour words when the device's format can't be had", () => {
    const broken: ClockTimeFormat = () => {
      throw new Error("no Intl");
    };
    expect(formatClockTime(0, 0, broken)).toBe("12:00 AM");
    expect(formatClockTime(23, 30, broken)).toBe("11:30 PM");
    expect(formatClockTime(9, 5, () => "  ")).toBe("9:05 AM");
  });

  it("the status line and the unlock confirm say the same time, either way", () => {
    for (const format of [TWELVE_HOUR, TWENTY_FOUR_HOUR]) {
      const autoLockTime = formatClockTime(12, 0, format);
      const status = todayStatus({ locked: true, lockSource: "auto", taskCount: 3, completedCount: 1, autoLockTime });
      const confirm = unlockConfirmation({ lockSource: "auto", autoLockTime });
      expect(status.text).toBe(`Set automatically at ${autoLockTime}. 2 to go.`);
      expect(confirm.message).toBe(`The app set today automatically at ${autoLockTime}. Unlocking keeps it open for the rest of today.`);
    }
    expect(formatClockTime(12, 0, TWENTY_FOUR_HOUR)).toBe("12:00");
  });
});

describe("brainDumpToast", () => {
  it("says what was added and what was saved, or nothing", () => {
    expect(brainDumpToast(2, 3)).toBe("Added 2. 3 saved for later in Ideas.");
    expect(brainDumpToast(1, 0)).toBe("Added 1.");
    expect(brainDumpToast(0, 4)).toBe("4 saved for later in Ideas.");
    expect(brainDumpToast(0, 0)).toBeNull();
  });

  it("on a day set meanwhile says why everything was saved (1.4)", () => {
    expect(brainDumpToast(0, 3, { locked: true })).toBe("Today is set. 3 saved for later in Ideas.");
    expect(brainDumpToast(0, 1, { locked: true })).toBe("Today is set. 1 saved for later in Ideas.");
    expect(brainDumpToast(0, 0, { locked: true })).toBeNull();
    // An open day reads as before.
    expect(brainDumpToast(0, 3, { locked: false })).toBe("3 saved for later in Ideas.");
  });
});

describe("unlockConfirmation (1.4)", () => {
  const BUTTONS = { keep: "Keep locked", unlock: "Unlock" };

  it("a day set by hand: the three open up, and it can be set again", () => {
    expect(unlockConfirmation({ lockSource: "manual" })).toEqual({
      title: "Unlock today?",
      message: "Your three will be open to change again. You can set today again any time.",
      ...BUTTONS,
    });
    // An older save without a source reads the same; the time is only for auto-set.
    expect(unlockConfirmation({ lockSource: null, autoLockTime: "12:00 PM" }).message).toBe(
      unlockConfirmation({ lockSource: "manual" }).message,
    );
  });

  it("a day set automatically: says when the app set it, and that unlocking holds for today", () => {
    expect(unlockConfirmation({ lockSource: "auto", autoLockTime: "12:00 PM" })).toEqual({
      title: "Unlock today?",
      message: "The app set today automatically at 12:00 PM. Unlocking keeps it open for the rest of today.",
      ...BUTTONS,
    });
    expect(unlockConfirmation({ lockSource: "auto", autoLockTime: null }).message).toBe(
      "The app set today automatically. Unlocking keeps it open for the rest of today.",
    );
  });

  it("is short and plain: no dashes, and the same title and buttons either way", () => {
    for (const lockSource of ["manual", "auto"] as const) {
      const copy = unlockConfirmation({ lockSource, autoLockTime: "9:30 AM" });
      expect(`${copy.title} ${copy.message}`).not.toMatch(/[\u2013\u2014]/);
      expect(copy.message.length).toBeLessThan(110);
      expect(copy).toMatchObject({ title: "Unlock today?", ...BUTTONS });
    }
    expect(LOCKED_CHANGE_NOTE).toBe("Today is set. Unlock it in Settings to change your three.");
    expect(UNLOCKED_NOTE).toBe("Today is unlocked.");
  });

  it("a set day is always 'set', never 'locked': one word for the state on every line", () => {
    const said = [
      LOCKED_CHANGE_NOTE,
      brainDumpToast(0, 3, { locked: true }),
      todayStatus({ locked: true, lockSource: "manual", taskCount: 3, completedCount: 1 }).text,
      todayStatus({ locked: true, lockSource: "auto", taskCount: 3, completedCount: 1, autoLockTime: "12:00" }).text,
    ];
    for (const line of said) expect(line).not.toMatch(/\block(ed)?\b/i);
    expect(said.slice(0, 3).every((line) => line?.startsWith("Today is set."))).toBe(true);
  });
});

describe("taskRowActions", () => {
  const actions = (editable: boolean, completed: boolean, canBreakDown: boolean) =>
    taskRowActions({ editable, completed, canBreakDown });

  it("offers everything on an open task while the day is open, in menu order", () => {
    expect(actions(true, false, true)).toEqual(["edit", "notToday", "breakDown", "delete"]);
    expect(actions(true, false, false)).toEqual(["edit", "notToday", "delete"]);
  });

  it("keeps only Break it down on a set day: no Edit, Not today or Delete (1.4)", () => {
    expect(actions(false, false, true)).toEqual(["breakDown"]);
    expect(actions(false, false, false)).toEqual([]);
  });

  it("offers only Delete on a finished task while open, and nothing once set", () => {
    expect(actions(true, true, true)).toEqual(["delete"]);
    expect(actions(false, true, true)).toEqual([]);
  });

  it("labels every action", () => {
    expect(TASK_ROW_ACTION_LABELS).toEqual({
      edit: "Edit",
      notToday: "Not today",
      breakDown: "Break it down",
      delete: "Delete",
    });
  });
});
