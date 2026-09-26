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
