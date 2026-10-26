// 1.6 F re-review: the store's reducer carries a task's soft date where it
// should (Not today, last night's draft) and drops it where it's stale (an
// edit to the words).
import { reducer } from "@/lib/daily-tasks/store";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

const SAT = "2026-10-31";
const AT = new Date(2026, 9, 31, 9).toISOString();

function day(tasks: Task[], extra: Partial<AppState> = {}): AppState {
  return syncTodayHistory({ ...buildInitialState(new Date(2026, 9, 31, 9)), lastOpenedDate: SAT, tasks, ...extra }, SAT);
}
const task = (id: string, text: string, when?: Task["when"]): Task => ({
  id,
  text,
  createdAt: "",
  carriedOver: false,
  ...(when ? { when } : {}),
});

describe("Not today", () => {
  it("an overdue deadline goes back to Saved for later still Overdue (not next Friday)", () => {
    const state = day([task("a", "Pay rent by Friday", { date: "2026-10-30", kind: "by" })]);
    const next = reducer(state, { type: "notToday", id: "a", today: SAT, at: AT });
    expect(next.parkedTasks[0]).toMatchObject({ text: "Pay rent by Friday", when: { date: "2026-10-30", kind: "by" } });
  });

  it("a deadline due today keeps its date; a plan for today loses it", () => {
    const state = day([task("a", "Pay rent", { date: SAT, kind: "by" }), task("b", "Deck", { date: SAT, kind: "on" })]);
    const once = reducer(state, { type: "notToday", id: "a", today: SAT, at: AT });
    const twice = reducer(once, { type: "notToday", id: "b", today: SAT, at: AT });
    expect(twice.parkedTasks.find((p) => p.text === "Pay rent")?.when).toEqual({ date: SAT, kind: "by" });
    expect(twice.parkedTasks.find((p) => p.text === "Deck")).not.toHaveProperty("when");
  });
});

describe("last night's draft", () => {
  it("a saved item used from the draft brings its date onto Today", () => {
    const state = day([], {
      parkedTasks: [{ id: "p", text: "Send deck", parkedAt: "", when: { date: SAT, kind: "by" } }],
    });
    const next = reducer(state, { type: "applyTomorrowDraft", tasks: ["send  DECK", "Stretch"], shown: ["send  DECK", "Stretch"], today: SAT, at: AT });
    expect(next.tasks.find((t) => t.text === "send  DECK")?.when).toEqual({ date: SAT, kind: "by" });
    expect(next.tasks.find((t) => t.text === "Stretch")).not.toHaveProperty("when");
    expect(next.parkedTasks).toEqual([]);
  });
});

describe("editing a task's words", () => {
  it("drops the old date, and reads one from the new words", () => {
    const state = day([task("a", "Deck for Tuesday", { date: "2026-11-03", kind: "on" })]);
    const thursday = reducer(state, { type: "editTask", id: "a", text: "Deck for Thursday", today: SAT });
    expect(thursday.tasks[0].when).toEqual({ date: "2026-11-05", kind: "on" });
    const none = reducer(state, { type: "editTask", id: "a", text: "Deck", today: SAT });
    expect(none.tasks[0]).not.toHaveProperty("when");
  });

  it("keeps it when the words don't change", () => {
    const state = day([task("a", "Deck", { date: "2026-11-03", kind: "on" })]);
    expect(reducer(state, { type: "editTask", id: "a", text: "Deck", today: SAT }).tasks[0].when).toEqual({
      date: "2026-11-03",
      kind: "on",
    });
  });
});
