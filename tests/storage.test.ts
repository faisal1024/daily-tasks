// Saved-state normalization for Phase 3: validated tasks with steps, parked
// brain-dump items, and todayLockedAt (which replaced autoLockNoticeDate).
import { describe, expect, it } from "vitest";

import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { MAX_PARKED_TASKS } from "../lib/daily-tasks/types";

const base = () => buildInitialState(new Date(2026, 8, 26));

function restore(overrides: Record<string, unknown>) {
  const state = normalizeState(JSON.parse(JSON.stringify({ ...base(), ...overrides })));
  if (!state) throw new Error("normalizeState returned null");
  return state;
}

describe("normalizeState: tasks", () => {
  it("round-trips a fresh state with the new fields", () => {
    const state = restore({});
    expect(state.parkedTasks).toEqual([]);
    expect(state.todayLockedAt).toBeNull();
    expect(state.tasks).toEqual([]);
    expect(buildInitialState()).toMatchObject({ parkedTasks: [], todayLockedAt: null });
  });

  it("keeps valid tasks and their steps", () => {
    const tasks = [
      {
        id: "t1",
        text: "Clean",
        createdAt: "2026-09-26T08:00:00.000Z",
        carriedOver: true,
        steps: [
          { id: "s1", text: "Clear counter", done: true },
          { id: "s2", text: "Wipe", done: false },
        ],
      },
      { id: "t2", text: "Walk", createdAt: "2026-09-26T08:00:00.000Z", carriedOver: false },
    ];
    expect(restore({ tasks }).tasks).toEqual(tasks);
  });

  it("drops invalid tasks instead of trusting the save", () => {
    const state = restore({
      tasks: [
        null,
        "Walk",
        { id: 1, text: "numeric id" },
        { id: "a" },
        { text: "no id" },
        { id: "b", text: 42 },
        { id: "ok", text: "Survivor" },
      ],
    });
    expect(state.tasks).toEqual([{ id: "ok", text: "Survivor", createdAt: "", carriedOver: false }]);
  });

  it("fills safe defaults and drops unknown fields", () => {
    const state = restore({
      tasks: [{ id: "a", text: "A", createdAt: 5, carriedOver: "yes", evil: "<script>" }],
    });
    expect(state.tasks[0]).toEqual({ id: "a", text: "A", createdAt: "", carriedOver: false });
  });

  it("returns [] for a non-array tasks field", () => {
    expect(restore({ tasks: { id: "a", text: "A" } }).tasks).toEqual([]);
    expect(restore({ tasks: "A" }).tasks).toEqual([]);
  });

  it("validates steps: drops bad ones, done only when exactly true, max five, none → no steps key", () => {
    const state = restore({
      tasks: [
        {
          id: "a",
          text: "A",
          createdAt: "",
          carriedOver: false,
          steps: [
            { id: "s1", text: "one", done: "true" },
            null,
            { id: "s2" },
            { id: 3, text: "bad id" },
            { id: "s3", text: "three", done: true },
            { id: "s4", text: "four" },
            { id: "s5", text: "five" },
            { id: "s6", text: "six" },
            { id: "s7", text: "seven" },
          ],
        },
        { id: "b", text: "B", createdAt: "", carriedOver: false, steps: [{ nope: 1 }] },
        { id: "c", text: "C", createdAt: "", carriedOver: false, steps: "a,b" },
      ],
    });
    expect(state.tasks[0].steps).toEqual([
      { id: "s1", text: "one", done: false },
      { id: "s3", text: "three", done: true },
      { id: "s4", text: "four", done: false },
      { id: "s5", text: "five", done: false },
      { id: "s6", text: "six", done: false },
    ]);
    expect(state.tasks[1]).not.toHaveProperty("steps");
    expect(state.tasks[2]).not.toHaveProperty("steps");
  });
});

describe("normalizeState: parked tasks", () => {
  it("defaults to [] for older saves without the field or with garbage", () => {
    const legacy = JSON.parse(JSON.stringify(base()));
    delete legacy.parkedTasks;
    expect(normalizeState(legacy)?.parkedTasks).toEqual([]);
    expect(restore({ parkedTasks: "Walk" }).parkedTasks).toEqual([]);
    expect(restore({ parkedTasks: null }).parkedTasks).toEqual([]);
  });

  it("keeps valid items, fills parkedAt, drops invalid ones and extra fields", () => {
    const state = restore({
      parkedTasks: [
        { id: "p1", text: "Walk", parkedAt: "2026-09-25T08:00:00.000Z" },
        { id: "p2", text: "Swim", parkedAt: 12, extra: true },
        { id: "p3" },
        { text: "no id" },
        null,
        "Run",
      ],
    });
    expect(state.parkedTasks).toEqual([
      { id: "p1", text: "Walk", parkedAt: "2026-09-25T08:00:00.000Z" },
      { id: "p2", text: "Swim", parkedAt: "" },
    ]);
  });

  it("keeps only the newest MAX_PARKED_TASKS", () => {
    const many = Array.from({ length: MAX_PARKED_TASKS + 5 }, (_, i) => ({
      id: `p${i}`,
      text: `item ${i}`,
      parkedAt: "",
    }));
    const state = restore({ parkedTasks: many });
    expect(state.parkedTasks).toHaveLength(MAX_PARKED_TASKS);
    expect(state.parkedTasks[0].id).toBe("p5");
    expect(state.parkedTasks.at(-1)?.id).toBe(`p${MAX_PARKED_TASKS + 4}`);
  });
});

describe("normalizeState: todayLockedAt", () => {
  it("keeps a saved lock time", () => {
    expect(
      restore({ todayLocked: true, todayLockSource: "auto", todayLockedAt: "2026-09-26T16:03:00.000Z" })
        .todayLockedAt,
    ).toBe("2026-09-26T16:03:00.000Z");
  });

  it("drops non-string values", () => {
    expect(restore({ todayLockedAt: 1_700_000_000 }).todayLockedAt).toBeNull();
    expect(restore({ todayLockedAt: {} }).todayLockedAt).toBeNull();
  });

  it("drops the legacy autoLockNoticeDate and doesn't mistake it for a lock time", () => {
    const legacy = JSON.parse(JSON.stringify(base()));
    delete legacy.todayLockedAt;
    legacy.autoLockNoticeDate = "2026-09-26";
    legacy.todayLocked = true;
    legacy.todayLockSource = "auto";
    const state = normalizeState(legacy);
    expect(state).not.toBeNull();
    expect(state).not.toHaveProperty("autoLockNoticeDate");
    expect(state?.todayLockedAt).toBeNull();
    expect(state?.todayLocked).toBe(true);
    expect(state?.todayLockSource).toBe("auto");
  });
});

describe("the path's origin survives a relaunch", () => {
  const plan = (pathSource?: string) => ({
    id: "p1",
    goalTitle: "Run a 5K",
    generatedAt: "2026-09-28T08:00:00.000Z",
    provider: "template",
    milestones: [{ id: "milestone_x", title: "My own step", description: "", completedAt: null }],
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
    ...(pathSource ? { pathSource } : {}),
  });
  const restored = (pathSource?: string) =>
    normalizeState(JSON.parse(JSON.stringify({ ...buildInitialState(), momentumPlan: plan(pathSource) })))?.momentumPlan;

  it("keeps an edited path marked as the user's (so an AI plan never replaces it)", () => {
    expect(restored("user")?.pathSource).toBe("user");
    expect(restored("ai")?.pathSource).toBe("ai");
  });

  it("older saves without it, or junk values, leave it unset (derived from provider)", () => {
    expect(restored()?.pathSource).toBeUndefined();
    expect(restored("bogus")?.pathSource).toBeUndefined();
  });
});

describe("normalizeState: coachNotes (1.2)", () => {
  const lines = { start: "Open it.", momentum: "Keep going." };

  it("round-trips a well-formed cache, and is null in a fresh state", () => {
    expect(restore({}).coachNotes).toBeNull();
    const coachNotes = { date: "2026-09-26", notes: { walk: lines }, requests: 1, asked: ["walk"], logged: true };
    expect(restore({ coachNotes }).coachNotes).toEqual(coachNotes);
  });

  it("rejects a malformed cache or bad date, drops bad and __proto__ entries, clamps requests", () => {
    expect(restore({ coachNotes: "nope" }).coachNotes).toBeNull();
    expect(restore({ coachNotes: { date: "26/09/2026", notes: {} } }).coachNotes).toBeNull();
    // Built as JSON so "__proto__" is an own key, as it would be when read from disk.
    const raw = JSON.parse(
      JSON.stringify({ ...base(), coachNotes: null }).replace(
        '"coachNotes":null',
        `"coachNotes":{"date":"2026-09-26","notes":{"__proto__":{"start":"a","momentum":"b"},` +
          `"walk":{"start":"Open it.","momentum":"Keep going."},"half":{"start":"only"},"blank":{"start":" ","momentum":"x"},` +
          `"long":{"start":"${"s".repeat(200)}","momentum":"m"}},"requests":7,"asked":["walk",3,""],"logged":"yes"}`,
      ),
    );
    const cache = normalizeState(raw)?.coachNotes;
    expect(cache?.notes).toEqual({ walk: lines, long: { start: "s".repeat(140), momentum: "m" } });
    expect(Object.getPrototypeOf(cache?.notes)).toBe(Object.prototype);
    expect(cache?.requests).toBe(2);
    expect(cache?.asked).toEqual(["walk"]);
    expect(cache?.logged).toBe(false);
    expect(restore({ coachNotes: { date: "2026-09-26", requests: -3 } }).coachNotes?.requests).toBe(0);
  });
});

describe("normalizeState: reviewDueSource (1.3)", () => {
  const due = "2026-09-25T20:00:00.000Z";

  it("an ask saved before 1.3 (no source) came from a perfect day", () => {
    const legacy = JSON.parse(JSON.stringify({ ...base(), reviewDueAt: due }));
    delete legacy.reviewDueSource;
    expect(normalizeState(legacy)?.reviewDueSource).toBe("perfect_day");
  });

  it("keeps a valid source, normalises an invalid one, and has none without an ask", () => {
    expect(restore({ reviewDueAt: due, reviewDueSource: "milestone" }).reviewDueSource).toBe("milestone");
    expect(restore({ reviewDueAt: due, reviewDueSource: "bogus" }).reviewDueSource).toBe("perfect_day");
    expect(restore({ reviewDueAt: due, reviewDueSource: 7 }).reviewDueSource).toBe("perfect_day");
    expect(restore({ reviewDueAt: null, reviewDueSource: "milestone" }).reviewDueSource).toBeNull();
  });
});
