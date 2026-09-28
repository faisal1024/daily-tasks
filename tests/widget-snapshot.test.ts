// Widget data (Phase 5): the snapshot the widget shows, and the queue of ticks
// made in the widget that the app applies.
import { describe, expect, it } from "vitest";

import {
  buildWidgetSnapshot,
  lastSeq,
  parseWidgetToggles,
  tasksToFlip,
  type WidgetToggle,
} from "../lib/daily-tasks/widget-snapshot";
import type { Task } from "../lib/daily-tasks/types";

const TODAY = "2026-09-26";

function tasks(...ids: string[]): Task[] {
  return ids.map((id) => ({ id, text: `Task ${id}`, createdAt: "", carriedOver: false }));
}

function toggle(seq: number, id: string, done: boolean, date = TODAY): WidgetToggle {
  return { seq, id, date, done };
}

describe("buildWidgetSnapshot", () => {
  it("marks done tasks from today's completions, floors the streak at 0, and passes plus", () => {
    const snapshot = buildWidgetSnapshot({
      state: { tasks: tasks("a", "b"), todayCompletions: ["b", "gone"] },
      today: TODAY,
      streak: 4.7,
      plus: false,
      day: 12,
    });
    expect(snapshot).toEqual({
      date: TODAY,
      tasks: [
        { id: "a", text: "Task a", done: false },
        { id: "b", text: "Task b", done: true },
      ],
      streak: 4,
      plus: false,
      day: 12,
    });
    expect(
      buildWidgetSnapshot({ state: { tasks: [], todayCompletions: [] }, today: TODAY, streak: -2, plus: true, day: 1 }),
    ).toMatchObject({ streak: 0, plus: true });
  });
});

describe("parseWidgetToggles", () => {
  it("ignores malformed queues", () => {
    expect(parseWidgetToggles(null, 0)).toEqual([]);
    expect(parseWidgetToggles("{not json", 0)).toEqual([]);
    expect(parseWidgetToggles(JSON.stringify({ seq: 1 }), 0)).toEqual([]);
  });

  it("keeps only well-formed toggles newer than processedSeq, in seq order", () => {
    const raw = JSON.stringify([
      toggle(4, "c", true),
      null,
      { seq: "5", id: "a", date: TODAY, done: true },
      { seq: 6, id: 7, date: TODAY, done: true },
      { seq: 7, id: "a", date: TODAY, done: "yes" },
      { seq: 1.5, id: "a", date: TODAY, done: true },
      toggle(2, "a", true),
      toggle(3, "b", false),
    ]);
    expect(parseWidgetToggles(raw, 2)).toEqual([toggle(3, "b", false), toggle(4, "c", true)]);
  });
});

describe("tasksToFlip", () => {
  it("flips only today's existing tasks whose state differs, with the last toggle per task winning", () => {
    const state = { tasks: tasks("a", "b", "c"), todayCompletions: ["b"] };
    const flips = tasksToFlip(
      state,
      [
        toggle(1, "a", true),
        toggle(2, "a", false), // a: last says not done → already not done
        toggle(3, "b", false), // b: done → undo
        toggle(4, "c", false), // already not done
        toggle(5, "deleted", true), // task no longer exists
        toggle(6, "c", true, "2026-09-25"), // yesterday's widget: ignored
      ],
      TODAY,
    );
    expect(flips).toEqual(["b"]);
    expect(tasksToFlip(state, [toggle(1, "a", true), toggle(2, "b", true)], TODAY)).toEqual(["a"]);
  });
});

describe("lastSeq", () => {
  it("is the highest seq, or processedSeq when the queue is empty", () => {
    expect(lastSeq([toggle(3, "a", true), toggle(9, "b", true), toggle(5, "c", true)], 2)).toBe(9);
    expect(lastSeq([], 7)).toBe(7);
  });
});
