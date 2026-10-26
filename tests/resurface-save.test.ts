// 1.6 F: a saved item keeps its soft date. parkTasks stores it (the AI sort's
// first, else the item's own words, never the day it is saved on), and the
// date survives a save and load; older saves, with no date, still load.
// Times are local (built with new Date(y, m, d, h)), so the day an item is
// saved on is the same in any timezone, including the ones where it is a
// different UTC day.
import { describe, expect, it } from "vitest";

import { syncTodayHistory } from "../lib/daily-tasks/rollover";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { parkTasks, swapParkedTask } from "../lib/daily-tasks/task-extras";
import { savedItemsView } from "../lib/daily-tasks/resurface";
import { MAX_PARKED_TASKS, type AppState, type TaskWhen } from "../lib/daily-tasks/types";

const iso = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
/** A Monday morning. */
const NOW = iso(2026, 10, 26, 9);
const TODAY = "2026-10-26";

/** A state on `today`, built the way the app builds one (syncTodayHistory). */
function dayState(today: string, tasks: string[] = [], at = new Date(2026, 9, 26, 9)): AppState {
  const state = {
    ...buildInitialState(at),
    tasks: tasks.map((text, i) => ({ id: `t${i}`, text, createdAt: "", carriedOver: false })),
    lastOpenedDate: today,
  };
  return syncTodayHistory(state, today);
}
const park = (texts: string[], dates?: Record<string, TaskWhen>, now = NOW, state = dayState(TODAY)) =>
  parkTasks(state, texts, now, dates).parkedTasks;

describe("parkTasks: the date an item is saved with", () => {
  it("reads it from the item's own words (on the device)", () => {
    const [a, b, c] = park(["Deck for Tuesday", "Passport before Friday", "Buy shoes"]);
    expect(a.when).toEqual({ date: "2026-10-27", kind: "on" });
    expect(b.when).toEqual({ date: "2026-10-29", kind: "by" });
    expect(c).not.toHaveProperty("when");
  });

  it("prefers the AI sort's date, found by the text's loose key", () => {
    const [a, b] = park(["  Deck   FOR Tuesday ", "Passport"], {
      "deck for tuesday": { date: "2026-11-03", kind: "by" },
      passport: { date: "2026-12-31", kind: "by" },
    });
    expect(a.when).toEqual({ date: "2026-11-03", kind: "by" });
    expect(b.when).toEqual({ date: "2026-12-31", kind: "by" });
  });

  it("ignores an AI date that is past, or over a year ahead, and falls back to the words", () => {
    const [a, b, c] = park(["Deck for Tuesday", "Passport", "Gift"], {
      "deck for tuesday": { date: "2026-10-25", kind: "on" },
      passport: { date: "2027-10-28", kind: "by" },
      gift: { date: "2026-02-30", kind: "on" },
    });
    expect(a.when).toEqual({ date: "2026-10-27", kind: "on" });
    expect(b).not.toHaveProperty("when");
    expect(c).not.toHaveProperty("when");
  });

  it("ignores a date in its own words that is the day it is saved (so 'Not today' never reads 'Due today')", () => {
    const parked = park(["Call bank today", "Pay rent tonight", "Gym on Monday", "Taxes due today", "Deck for Tuesday"]);
    expect(parked.map((p) => p.when ?? null)).toEqual([null, null, null, null, { date: "2026-10-27", kind: "on" }]);
    expect(savedItemsView(parked, TODAY).filter((v) => v.dueToday)).toEqual([]);
  });

  it("'tomorrow' in the words is tomorrow's date, in any zone, early or late in the local day", () => {
    for (const [h, min] of [[0, 30], [12, 0], [23, 30]]) {
      const now = iso(2026, 10, 26, h, min);
      expect(park(["Send it tomorrow"], undefined, now)[0].when, `${h}:${min}`).toEqual({ date: "2026-10-27", kind: "on" });
    }
    // Late on a year's last day.
    expect(park(["Send it tomorrow"], undefined, iso(2026, 12, 31, 23, 30), dayState("2026-12-31"))[0].when).toEqual({
      date: "2027-01-01",
      kind: "on",
    });
    // Just after midnight on a clock-change day.
    expect(park(["Send it tomorrow"], undefined, iso(2026, 3, 8, 0, 30), dayState("2026-03-08"))[0].when).toEqual({
      date: "2026-03-09",
      kind: "on",
    });
  });

  it("an item saved earlier is left as it is when the same words are parked again", () => {
    const first = dayState(TODAY);
    const once = parkTasks(first, ["Deck for Tuesday"], NOW);
    const twice = parkTasks(once, ["deck for tuesday"], iso(2026, 10, 27, 9), undefined);
    expect(twice).toBe(once);
  });

  it("does not park what is already on today's list", () => {
    const state = dayState(TODAY, ["Deck for Tuesday"]);
    expect(parkTasks(state, ["Deck for Tuesday"], NOW)).toBe(state);
  });

  it("keeps the dates of the newest MAX_PARKED_TASKS when it trims", () => {
    let state = dayState(TODAY);
    const texts = Array.from({ length: MAX_PARKED_TASKS + 2 }, (_, i) => `Item ${i} tomorrow`);
    state = parkTasks(state, texts, NOW);
    expect(state.parkedTasks).toHaveLength(MAX_PARKED_TASKS);
    expect(state.parkedTasks[0].text).toBe("Item 2 tomorrow");
    expect(state.parkedTasks.every((p) => p.when?.date === "2026-10-27")).toBe(true);
  });

  it("dates the task a swap sends away from its words, like any saved item", () => {
    const state: AppState = {
      ...dayState(TODAY, ["A", "Send deck tomorrow", "C"]),
      parkedTasks: [{ id: "p1", text: "Zulu", parkedAt: NOW }],
    };
    const next = swapParkedTask(state, { parkedId: "p1", taskId: "t1", now: NOW, newId: "n1" });
    expect(next.parkedTasks.map((p) => p.text)).toEqual(["Send deck tomorrow"]);
    expect(next.parkedTasks[0].when).toEqual({ date: "2026-10-27", kind: "on" });
  });
});

describe("a saved item's date across save and load", () => {
  const roundTrip = (state: AppState) => normalizeState(JSON.parse(JSON.stringify(state)));

  it("survives, kind and all", () => {
    const state = parkTasks(dayState(TODAY), ["Deck for Tuesday", "Passport before Friday", "Buy shoes"], NOW);
    const loaded = roundTrip(state)!;
    expect(loaded.parkedTasks).toEqual(state.parkedTasks);
    expect(loaded.parkedTasks.map((p) => p.when ?? null)).toEqual([
      { date: "2026-10-27", kind: "on" },
      { date: "2026-10-29", kind: "by" },
      null,
    ]);
  });

  it("an older save (no when) loads unchanged, and shows no date", () => {
    const old = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 9, 26))));
    old.parkedTasks = [{ id: "p1", text: "Walk", parkedAt: "2026-10-20T08:00:00.000Z" }];
    const loaded = normalizeState(old)!;
    expect(loaded.parkedTasks).toEqual([{ id: "p1", text: "Walk", parkedAt: "2026-10-20T08:00:00.000Z" }]);
    expect(savedItemsView(loaded.parkedTasks, TODAY)).toEqual([{ id: "p1", text: "Walk", dueToday: false }]);
  });

  it("drops a malformed date but never the item", () => {
    const base = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 9, 26))));
    base.parkedTasks = [
      { id: "a", text: "A", parkedAt: "", when: { date: "2026-02-30", kind: "on" } },
      { id: "b", text: "B", parkedAt: "", when: { date: "2026-10-27", kind: "soon" } },
      { id: "c", text: "C", parkedAt: "", when: "2026-10-27" },
      { id: "d", text: "D", parkedAt: "", when: null },
      { id: "e", text: "E", parkedAt: "", when: { date: "2026-10-27", kind: "by", extra: 1 } },
    ];
    const loaded = normalizeState(base)!;
    expect(loaded.parkedTasks.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(loaded.parkedTasks.map((p) => p.when ?? null)).toEqual([null, null, null, null, { date: "2026-10-27", kind: "by" }]);
  });

  it("keeps a date that has since passed (it just no longer comes back first)", () => {
    const base = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 9, 26))));
    base.parkedTasks = [
      { id: "a", text: "A", parkedAt: "", when: { date: "2026-10-20", kind: "on" } },
      { id: "b", text: "B", parkedAt: "" },
    ];
    const loaded = normalizeState(base)!;
    expect(loaded.parkedTasks[0].when).toEqual({ date: "2026-10-20", kind: "on" });
    const view = savedItemsView(loaded.parkedTasks, TODAY);
    expect(view.map((v) => v.id)).toEqual(["a", "b"]);
    expect(view[0].label).toBe("Oct 20");
  });
});
