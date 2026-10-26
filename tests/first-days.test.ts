// 1.5 A: the Today cards that replaced first run's last two screens (rules in
// lib/daily-tasks/first-days.ts), the "picked" note, and auto-lock's new
// default. Dates are local day keys (CI runs in several time zones).
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_DAYS_KEY,
  NUDGE_MAX_DECLINES,
  NUDGE_SNOOZE_DAYS,
  addDays,
  answerNudge,
  declineNudge,
  dismissWidgetTip,
  loadFirstDays,
  noteFinishedDay,
  pickedNote,
  saveFirstDays,
  shouldShowNudgeCard,
  shouldShowWidgetTip,
  startFirstDays,
  type FirstDaysRecord,
} from "../lib/daily-tasks/first-days";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, NEW_INSTALL_AUTO_LOCK } from "../lib/daily-tasks/types";

// In-memory AsyncStorage (hoisted above the imports by vitest).
const store = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({ default: store }));

beforeEach(() => {
  store.data.clear();
  vi.clearAllMocks();
});

const D1 = "2026-10-01";
const fresh = () => startFirstDays(D1);

describe("nudge card: when it shows", () => {
  it("shows from the first-run day while notifications are undetermined", () => {
    const input = { record: fresh(), today: D1, permission: "undetermined" as const };
    expect(shouldShowNudgeCard(input)).toBe(true);
    expect(shouldShowNudgeCard({ ...input, today: "2026-10-09" })).toBe(true);
  });

  it.each(["granted", "denied", "provisional", null, undefined] as const)(
    "never shows when the permission is %s",
    (permission) => {
      expect(shouldShowNudgeCard({ record: fresh(), today: D1, permission: permission as never })).toBe(false);
    },
  );

  it("never shows without a record (an install that updated from 1.4 or older)", () => {
    expect(shouldShowNudgeCard({ record: null, today: D1, permission: "undetermined" })).toBe(false);
  });

  it("never shows before nudgeFrom (clock set back)", () => {
    expect(shouldShowNudgeCard({ record: fresh(), today: "2026-09-30", permission: "undetermined" })).toBe(false);
  });
});

describe("nudge card: Not now and Yes", () => {
  it("first Not now hides it for 3 days, and it is back on the 4th day", () => {
    expect(NUDGE_SNOOZE_DAYS).toBe(3);
    const snoozed = declineNudge(fresh(), D1);
    expect(snoozed).toMatchObject({ nudgeDeclines: 1, nudgeFrom: "2026-10-04" });
    const show = (today: string) => shouldShowNudgeCard({ record: snoozed, today, permission: "undetermined" });
    expect(show("2026-10-01")).toBe(false);
    expect(show("2026-10-02")).toBe(false);
    expect(show("2026-10-03")).toBe(false);
    expect(show("2026-10-04")).toBe(true);
  });

  it("the second Not now retires it for good", () => {
    expect(NUDGE_MAX_DECLINES).toBe(2);
    const retired = declineNudge(declineNudge(fresh(), D1), "2026-10-04");
    expect(retired).toMatchObject({ nudgeDeclines: 2, nudgeFrom: null });
    for (const today of ["2026-10-04", "2026-10-07", "2027-01-01"]) {
      expect(shouldShowNudgeCard({ record: retired, today, permission: "undetermined" })).toBe(false);
    }
  });

  it("Yes retires it whatever iOS answered, and leaves the widget tip alone", () => {
    const due = noteFinishedDay(fresh(), true);
    const answered = answerNudge(due);
    expect(answered.nudgeFrom).toBeNull();
    expect(answered.widgetTip).toBe("due");
    expect(shouldShowNudgeCard({ record: answered, today: D1, permission: "undetermined" })).toBe(false);
  });

  it("the snooze counts calendar days across month, year and DST changes", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    // US clocks go back on 1 Nov 2026, forward on 8 Mar 2026; always whole days.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-07", 3)).toBe("2026-03-10");
  });
});

describe("widget tip", () => {
  const input = (record: FirstDaysRecord | null, over: Partial<Parameters<typeof shouldShowWidgetTip>[0]> = {}) => ({
    record,
    widgetsSupported: true,
    nudgeShowing: false,
    ...over,
  });

  it("waits until a day is finished, then is due", () => {
    expect(fresh().widgetTip).toBe("waiting");
    expect(shouldShowWidgetTip(input(fresh()))).toBe(false);
    expect(noteFinishedDay(fresh(), false).widgetTip).toBe("waiting");
    const due = noteFinishedDay(fresh(), true);
    expect(due.widgetTip).toBe("due");
    expect(shouldShowWidgetTip(input(due))).toBe(true);
  });

  it("stays due on later days until dismissed, and once dismissed never comes back", () => {
    const due = noteFinishedDay(fresh(), true);
    // An unfinished day later on doesn't take it back.
    expect(noteFinishedDay(due, false)).toBe(due);
    const dismissed = dismissWidgetTip(due);
    expect(dismissed.widgetTip).toBe("done");
    // Another finished day doesn't re-arm it.
    expect(noteFinishedDay(dismissed, true).widgetTip).toBe("done");
    expect(shouldShowWidgetTip(input(dismissed))).toBe(false);
  });

  it("is iOS only (the widget is)", () => {
    const due = noteFinishedDay(fresh(), true);
    expect(shouldShowWidgetTip(input(due, { widgetsSupported: false }))).toBe(false);
  });

  it("never shows alongside the nudge card, and has no record to show without one", () => {
    const due = noteFinishedDay(fresh(), true);
    expect(shouldShowWidgetTip(input(due, { nudgeShowing: true }))).toBe(false);
    expect(shouldShowWidgetTip(input(null))).toBe(false);
  });
});

describe("the saved record", () => {
  it("is null with nothing saved (an update from 1.4: no cards), and for unreadable data", async () => {
    expect(await loadFirstDays()).toBeNull();
    store.data.set(FIRST_DAYS_KEY, "{not json");
    expect(await loadFirstDays()).toBeNull();
    store.data.set(FIRST_DAYS_KEY, "42");
    expect(await loadFirstDays()).toBeNull();
  });

  it("round-trips, and first run writes nudge-from-today + tip waiting", async () => {
    await saveFirstDays(startFirstDays("2026-10-01"));
    expect(JSON.parse(store.data.get(FIRST_DAYS_KEY) ?? "null")).toEqual({
      nudgeFrom: "2026-10-01",
      nudgeDeclines: 0,
      widgetTip: "waiting",
    });
    expect(await loadFirstDays()).toEqual(startFirstDays("2026-10-01"));
  });

  it("a damaged field fails quiet: bad date retires the nudge, bad tip state retires the tip", async () => {
    store.data.set(FIRST_DAYS_KEY, JSON.stringify({ nudgeFrom: "tomorrow", nudgeDeclines: -1, widgetTip: "soon" }));
    expect(await loadFirstDays()).toEqual({ nudgeFrom: null, nudgeDeclines: 0, widgetTip: "done" });
  });
});

describe("pickedNote", () => {
  it.each([
    [0, null],
    [-1, null],
    [1, "Your one for today is picked."],
    [2, "Your two are picked."],
    [3, "Your three are picked."],
  ])("%i picked -> %j", (count, note) => {
    expect(pickedNote(count)).toBe(note);
  });
});

describe("auto-lock default (1.5)", () => {
  const roundTrip = (autoLock: unknown, drop = false) => {
    const saved = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 9, 1))));
    if (drop) delete saved.autoLock;
    else saved.autoLock = autoLock;
    const state = normalizeState(saved);
    if (!state) throw new Error("normalizeState returned null");
    return state.autoLock;
  };

  it("a new install starts with auto-lock OFF, still at noon", () => {
    expect(buildInitialState(new Date(2026, 9, 1)).autoLock).toEqual({ enabled: false, hour: 12, minute: 0 });
    expect(NEW_INSTALL_AUTO_LOCK.enabled).toBe(false);
    // Reading older saves still defaults to on; only new installs changed.
    expect(DEFAULT_AUTO_LOCK.enabled).toBe(true);
  });

  it("a save from before the field existed reads as ON (what those builds ran with)", () => {
    expect(roundTrip(undefined, true)).toEqual({ enabled: true, hour: 12, minute: 0 });
    expect(roundTrip({ hour: 9, minute: 30 })).toEqual({ enabled: true, hour: 9, minute: 30 });
    expect(roundTrip({ enabled: "yes", hour: 9, minute: 30 })).toMatchObject({ enabled: true });
  });

  it("1.4.x saves keep their value, on or off, and their time", () => {
    expect(roundTrip({ enabled: false, hour: 15, minute: 45 })).toEqual({ enabled: false, hour: 15, minute: 45 });
    expect(roundTrip({ enabled: true, hour: 8, minute: 5 })).toEqual({ enabled: true, hour: 8, minute: 5 });
  });

  it("a fresh install's own save round-trips as OFF (reading never flips it)", () => {
    const fresh = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 9, 1))));
    expect(normalizeState(fresh)?.autoLock.enabled).toBe(false);
  });
});
