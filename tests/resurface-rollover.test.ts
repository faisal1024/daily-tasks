// 1.6 F re-review: a carried-over task keeps its soft date through the
// rollover (history record → pending card → tomorrow's task) and a save/load.
import { describe, expect, it } from "vitest";

import { applyRollover, resolvePendingRollover, syncTodayHistory } from "../lib/daily-tasks/rollover";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";

describe("rollover keeps a task's when", () => {
  it("from yesterday's task to today's carried task, and through a save and load", () => {
    const yesterday = "2026-10-26";
    const today = "2026-10-27";
    const base = buildInitialState(new Date(2026, 9, 26, 9));
    let state = syncTodayHistory(
      {
        ...base,
        lastOpenedDate: yesterday,
        tasks: [
          { id: "a", text: "Pay rent", createdAt: "", carriedOver: false, when: { date: "2026-10-28", kind: "by" } },
          { id: "b", text: "Walk", createdAt: "", carriedOver: false },
        ],
      },
      yesterday,
    );
    expect(state.history[yesterday].tasks[0].when).toEqual({ date: "2026-10-28", kind: "by" });
    state = applyRollover(state, today);
    expect(state.pendingRollover?.tasks.find((t) => t.text === "Pay rent")?.when).toEqual({ date: "2026-10-28", kind: "by" });
    // A save and load in between (the card can wait).
    state = normalizeState(JSON.parse(JSON.stringify(state)))!;
    expect(state.pendingRollover?.tasks.find((t) => t.text === "Pay rent")?.when).toEqual({ date: "2026-10-28", kind: "by" });
    state = resolvePendingRollover(state, ["a", "b"], new Date(2026, 9, 27, 9));
    expect(state.tasks.find((t) => t.text === "Pay rent")).toMatchObject({ carriedOver: true, when: { date: "2026-10-28", kind: "by" } });
    expect(state.tasks.find((t) => t.text === "Walk")).not.toHaveProperty("when");
  });
});
