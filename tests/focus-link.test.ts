// "Start my next task" from the widget and Siri (1.3, PR F).
import { describe, expect, it } from "vitest";

import { parseFocusStartLink, parseFocusStartRequest, planFocusStart } from "../lib/daily-tasks/focus-link";
import { startSession } from "../lib/daily-tasks/focus-session";

describe("parseFocusStartLink", () => {
  it("reads the widget's and Siri's links, as URLs or router paths", () => {
    expect(parseFocusStartLink("dailytasks://focus/start?task=next&source=widget")).toEqual({ kind: "timer", source: "widget" });
    expect(parseFocusStartLink("dailytasks://focus/start?task=next&source=siri&kind=starter")).toEqual({
      kind: "starter",
      source: "siri",
    });
    expect(parseFocusStartLink("/focus/start?task=next")).toEqual({ kind: "timer", source: "widget" });
    expect(parseFocusStartLink("focus/start")).toEqual({ kind: "timer", source: "widget" });
  });

  it("leaves every other link alone", () => {
    expect(parseFocusStartLink("dailytasks://")).toBeNull();
    expect(parseFocusStartLink("/")).toBeNull();
    expect(parseFocusStartLink("/focus/start/extra")).toBeNull();
    expect(parseFocusStartLink("dailytasks://focus/start?task=t_123")).toBeNull();
    expect(parseFocusStartLink(null)).toBeNull();
  });
});

describe("parseFocusStartRequest", () => {
  const now = 1_790_000_000_000;
  const raw = (fields: object) => JSON.stringify({ id: "r1", kind: "timer", source: "siri", at: now - 1000, ...fields });

  it("takes a new, recent request", () => {
    expect(parseFocusStartRequest(raw({}), null, now)).toEqual({ id: "r1", kind: "timer", source: "siri" });
    expect(parseFocusStartRequest(raw({ kind: "starter", source: "widget" }), "r0", now)).toMatchObject({
      kind: "starter",
      source: "widget",
    });
  });

  it("ignores one already handled, an old one, and anything malformed", () => {
    expect(parseFocusStartRequest(raw({}), "r1", now)).toBeNull();
    expect(parseFocusStartRequest(raw({ at: now - 61_000 }), null, now)).toBeNull();
    expect(parseFocusStartRequest("{", null, now)).toBeNull();
    expect(parseFocusStartRequest(null, null, now)).toBeNull();
  });
});

describe("planFocusStart", () => {
  const tasks = [{ id: "a" }, { id: "b" }];
  const on = (taskId: string) =>
    startSession({ id: "s", taskId, taskText: "x", date: "2026-09-29", kind: "timer", minutes: 20, now: 0 });

  it("starts on the first open task", () => {
    expect(planFocusStart({ tasks, todayCompletions: [], focusSession: null })).toEqual({ type: "start", taskId: "a" });
    expect(planFocusStart({ tasks, todayCompletions: ["a"], focusSession: null })).toEqual({ type: "start", taskId: "b" });
  });

  it("never restarts that task's timer, nor silently replaces another's", () => {
    expect(planFocusStart({ tasks, todayCompletions: [], focusSession: on("a") })).toEqual({ type: "show" });
    expect(planFocusStart({ tasks, todayCompletions: ["a"], focusSession: on("a") })).toEqual({ type: "confirm", taskId: "b" });
  });

  it("just shows Today when nothing is open", () => {
    expect(planFocusStart({ tasks, todayCompletions: ["a", "b"], focusSession: null })).toEqual({ type: "show" });
    expect(planFocusStart({ tasks: [], todayCompletions: [], focusSession: null })).toEqual({ type: "show" });
  });
});
