// The focus session's pure rules (1.3, PR #72): start / pause / resume /
// extend / end / clear, time left clamped both ways, a starter's extend and
// Keep going, what clears it for today's list, and how a saved one is
// normalized on load (anything malformed is dropped).
import { describe, expect, it } from "vitest";

import {
  checkInAnnouncement,
  checkInBreakLabel,
  checkInTitle,
  clear,
  end,
  extend,
  keepGoing,
  MAX_SESSION_MS,
  notificationBody,
  notificationTitle,
  pause,
  remainingMs,
  resume,
  sessionEndedAnnouncement,
  sessionForState,
  sessionPhase,
  settle,
  startSession,
  starterLine,
  type FocusSession,
} from "../lib/daily-tasks/focus-session";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";

const MIN = 60_000;
const T0 = new Date(2026, 8, 26, 9, 0).getTime();
const DAY = "2026-09-26";

function timer(minutes = 10, overrides: Partial<Parameters<typeof startSession>[0]> = {}): FocusSession {
  return startSession({ id: "s1", taskId: "t0", taskText: "Walk", date: DAY, kind: "timer", minutes, now: T0, ...overrides });
}

function starter(overrides: Partial<Parameters<typeof startSession>[0]> = {}): FocusSession {
  return timer(5, { kind: "starter", ...overrides });
}

describe("focus session: start and time left", () => {
  it("starts running with its end from now; the length is clamped to 1 minute .. 24 hours", () => {
    const s = timer(10);
    expect(s).toMatchObject({ status: "running", durationMs: 10 * MIN, startedAt: T0, endAt: T0 + 10 * MIN, pausedRemainingMs: null, stepText: null });
    expect(timer(0).durationMs).toBe(MIN);
    expect(timer(0.4).durationMs).toBe(MIN);
    expect(timer(100_000).durationMs).toBe(MAX_SESSION_MS);
  });

  it("remainingMs counts down, is 0 past the end, and never exceeds the length when the clock moves back", () => {
    const s = timer(10);
    expect(remainingMs(s, T0 + 3 * MIN)).toBe(7 * MIN);
    expect(remainingMs(s, T0 + 11 * MIN)).toBe(0);
    expect(remainingMs(s, T0 - 60 * MIN)).toBe(10 * MIN);
    expect(sessionPhase(s, T0 + 10 * MIN - 1)).toBe("running");
    expect(sessionPhase(s, T0 + 10 * MIN)).toBe("ended");
  });

  it("settle marks a run-out session ended (and leaves a running one alone)", () => {
    const s = timer(10);
    expect(settle(s, T0 + 5 * MIN)).toBe(s);
    expect(settle(s, T0 + 10 * MIN)).toMatchObject({ status: "ended" });
    expect(remainingMs(end(s), T0)).toBe(0);
    expect(clear()).toBeNull();
  });
});

describe("focus session: pause, resume, extend", () => {
  it("pause freezes the time left however far the clock moves; resume ends it from now", () => {
    const paused = pause(timer(10), T0 + 3 * MIN);
    expect(paused).toMatchObject({ status: "paused", endAt: null, pausedRemainingMs: 7 * MIN });
    expect(remainingMs(paused, T0 + 500 * MIN)).toBe(7 * MIN);
    expect(sessionPhase(paused, T0 + 500 * MIN)).toBe("paused");
    const resumed = resume(paused, T0 + 60 * MIN);
    expect(resumed).toMatchObject({ status: "running", endAt: T0 + 67 * MIN, pausedRemainingMs: null });
    // Resuming a running session changes nothing.
    expect(resume(resumed, T0 + 61 * MIN)).toBe(resumed);
  });

  it("pause after it ran out (between ticks) ends it rather than pausing at 0:00", () => {
    expect(pause(timer(5), T0 + 5 * MIN + 200)).toMatchObject({ status: "ended", pausedRemainingMs: null });
  });

  it("extend adds 5 minutes to the time left (running or paused), and runs an ended one for just 5", () => {
    const running = extend(timer(10), T0 + 4 * MIN);
    expect(running).toMatchObject({ status: "running", durationMs: 15 * MIN, endAt: T0 + 4 * MIN + 11 * MIN });

    const paused = extend(pause(timer(10), T0 + 4 * MIN), T0 + 30 * MIN);
    expect(paused).toMatchObject({ status: "paused", durationMs: 15 * MIN, pausedRemainingMs: 11 * MIN, endAt: null });

    const ended = extend(settle(timer(10), T0 + 12 * MIN), T0 + 12 * MIN);
    expect(ended).toMatchObject({ status: "running", durationMs: 15 * MIN, endAt: T0 + 17 * MIN });
    expect(remainingMs(ended, T0 + 12 * MIN)).toBe(5 * MIN);
  });

  it("extend never passes 24 hours", () => {
    const long = timer(24 * 60);
    expect(extend(long, T0)).toBe(long);
    expect(extend(timer(24 * 60 - 2), T0).durationMs).toBe(MAX_SESSION_MS);
  });

  it("a starter's 5 more minutes stays a starter (its check-in keeps Keep going), but loses the 'Just start' line", () => {
    const extended = extend(settle(starter(), T0 + 5 * MIN), T0 + 5 * MIN);
    expect(extended.kind).toBe("starter");
    expect(starterLine(starter())).toBe("Just start. You can stop after 5 minutes.");
    expect(starterLine(extended)).toBeNull();
    expect(checkInTitle(extended)).toBe("10 minutes in. Keep going?");
  });

  it("Keep going turns a starter into a fresh 20-minute timer on the same task and session", () => {
    const kept = keepGoing(settle(starter({ stepText: "Find the lead" }), T0 + 5 * MIN), T0 + 6 * MIN);
    expect(kept).toMatchObject({
      id: "s1",
      taskId: "t0",
      kind: "timer",
      status: "running",
      durationMs: 20 * MIN,
      startedAt: T0 + 6 * MIN,
      endAt: T0 + 26 * MIN,
      stepText: "Find the lead",
    });
  });

  // PR #76: the check-in's way out and what VoiceOver says.
  it("the check-in's break label, its time's-up announcement, and what's said after a break or a stop", () => {
    expect(checkInBreakLabel(timer())).toBe("Take a break");
    expect(checkInBreakLabel(starter())).toBe("Stop for now");
    expect(checkInAnnouncement(timer())).toBe("Time's up on “Walk”. 5 more minutes, or take a break.");
    expect(checkInAnnouncement(starter())).toBe("5 minutes in. Keep going, or stop for now.");
    expect(sessionEndedAnnouncement("break", "Walk")).toBe("Timer ended. Walk is still open.");
    expect(sessionEndedAnnouncement("stopped", "Walk")).toBe("Timer stopped. Walk is still open.");
  });

  it("the check-in names the step or task (curly quotes); the notification's title is the task, its body the question", () => {
    expect(checkInTitle(timer())).toBe("Time's up on “Walk”.");
    expect(notificationTitle(timer())).toBe("Walk");
    expect(notificationBody(timer())).toBe("Time's up. 5 more minutes, or mark it done?");
    expect(checkInTitle(starter({ stepText: "Find the lead" }))).toBe("5 minutes in. Keep going?");
    expect(notificationBody(starter({ stepText: "Find the lead" }))).toBe("5 minutes in. Keep going?");
    const long = timer(10, { taskText: "x".repeat(80) });
    expect(notificationTitle(long)).toHaveLength(60);
    expect(notificationTitle(long).endsWith("…")).toBe(true);
    // An emoji right at the cut stays whole (cut by code points, not UTF-16 units).
    const emoji = notificationTitle(timer(10, { taskText: `${"x".repeat(58)}🐕🐕 walk` }));
    expect(emoji).toBe(`${"x".repeat(58)}🐕…`);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("focus session: sessionForState (what clears it)", () => {
  const task = { id: "t0", text: "Walk", steps: [{ text: "Find the lead" }] };
  const list = (overrides: Partial<Parameters<typeof sessionForState>[1]> = {}) => ({
    tasks: [task, { id: "t1", text: "Read" }],
    todayCompletions: [] as string[],
    lastOpenedDate: DAY,
    ...overrides,
  });

  it("keeps the same object while its task is open today and unchanged", () => {
    const s = timer();
    expect(sessionForState(s, list())).toBe(s);
    expect(sessionForState(null, list())).toBeNull();
  });

  it("is gone once its task is ticked, deleted / saved for later, or the day changes", () => {
    const s = timer();
    expect(sessionForState(s, list({ todayCompletions: ["t0"] }))).toBeNull();
    // Another task ticked doesn't touch it.
    expect(sessionForState(s, list({ todayCompletions: ["t1"] }))).toBe(s);
    expect(sessionForState(s, list({ tasks: [{ id: "t1", text: "Read" }] }))).toBeNull();
    expect(sessionForState(s, list({ lastOpenedDate: "2026-09-27" }))).toBeNull();
  });

  it("follows an edit of the task's words, and drops a step that's no longer there", () => {
    const s = starter({ stepText: "Find the lead" });
    expect(sessionForState(s, list({ tasks: [{ ...task, text: "Walk Rex" }] }))).toMatchObject({
      taskText: "Walk Rex",
      stepText: "Find the lead",
    });
    expect(sessionForState(s, list({ tasks: [{ id: "t0", text: "Walk" }] }))).toMatchObject({ stepText: null });
  });
});

describe("normalizeState: focusSession", () => {
  const base = () => buildInitialState(new Date(2026, 8, 26));
  const load = (focusSession: unknown) =>
    normalizeState(JSON.parse(JSON.stringify({ ...base(), focusSession })))?.focusSession;

  it("round-trips a running and a paused session", () => {
    const running = timer();
    expect(load(running)).toEqual(running);
    const paused = pause(timer(), T0 + MIN);
    expect(load(paused)).toEqual(paused);
    // Missing (an older save): none.
    expect(normalizeState(JSON.parse(JSON.stringify({ ...base(), focusSession: undefined })))?.focusSession).toBeNull();
  });

  it("drops a malformed one: running without an end, paused without time left, bad kind/status/date/length", () => {
    const s = timer();
    expect(load({ ...s, endAt: null })).toBeNull();
    expect(load({ ...s, status: "paused", pausedRemainingMs: null })).toBeNull();
    expect(load({ ...s, status: "paused", pausedRemainingMs: -1 })).toBeNull();
    expect(load({ ...s, kind: "pomodoro" })).toBeNull();
    expect(load({ ...s, status: "done" })).toBeNull();
    expect(load({ ...s, date: "26/09/2026" })).toBeNull();
    expect(load({ ...s, durationMs: 0 })).toBeNull();
    expect(load({ ...s, durationMs: MAX_SESSION_MS + 1 })).toBeNull();
    expect(load({ ...s, id: "" })).toBeNull();
    expect(load("nope")).toBeNull();
  });

  it("caps a paused session's time left at its length", () => {
    expect(load({ ...timer(10), status: "paused", endAt: null, pausedRemainingMs: 99 * MIN })).toMatchObject({
      pausedRemainingMs: 10 * MIN,
      endAt: null,
    });
  });
});
