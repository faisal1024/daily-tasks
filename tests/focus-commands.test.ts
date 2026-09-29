// Pause/Resume from the Live Activity (1.3, PR F): the queue the app applies.
import { describe, expect, it } from "vitest";

import { applyFocusCommands, lastCommandSeq, parseFocusCommands } from "../lib/daily-tasks/focus-commands";
import { startSession } from "../lib/daily-tasks/focus-session";

const T0 = 1_790_000_000_000;
const session = startSession({ id: "s1", taskId: "a", taskText: "Walk", date: "2026-09-29", kind: "timer", minutes: 20, now: T0 });

describe("parseFocusCommands", () => {
  it("keeps well-formed commands newer than the last applied, in order", () => {
    const raw = JSON.stringify([
      { seq: 3, sessionId: "s1", action: "resume", at: T0 + 3 },
      { seq: 1, sessionId: "s1", action: "pause", at: T0 + 1 },
      { seq: 2, sessionId: "s1", action: "pause", at: T0 + 2 },
      { seq: 4, sessionId: "s1", action: "explode", at: T0 },
      { seq: 5, sessionId: 7, action: "pause", at: T0 },
      null,
    ]);
    expect(parseFocusCommands(raw, 1).map((c) => c.seq)).toEqual([2, 3]);
    expect(parseFocusCommands("not json", 0)).toEqual([]);
    expect(parseFocusCommands(JSON.stringify({}), 0)).toEqual([]);
    expect(parseFocusCommands(null, 0)).toEqual([]);
  });

  it("lastCommandSeq is the highest read, or the old mark", () => {
    expect(lastCommandSeq([], 4)).toBe(4);
    expect(lastCommandSeq([{ seq: 6, sessionId: "s1", action: "pause", at: 0 }], 4)).toBe(6);
  });
});

describe("applyFocusCommands", () => {
  it("pauses at the tap's time and resumes from it", () => {
    const paused = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "pause", at: T0 + 5 * 60_000 }], T0 + 30 * 60_000);
    expect(paused.session).toMatchObject({ status: "paused", endAt: null, pausedRemainingMs: 15 * 60_000 });
    expect(paused.applied).toEqual(["pause"]);

    const resumed = applyFocusCommands(
      session,
      [
        { seq: 1, sessionId: "s1", action: "pause", at: T0 + 5 * 60_000 },
        { seq: 2, sessionId: "s1", action: "resume", at: T0 + 10 * 60_000 },
      ],
      T0 + 11 * 60_000,
    );
    expect(resumed.session).toMatchObject({ status: "running", endAt: T0 + 25 * 60_000 });
    expect(resumed.applied).toEqual(["pause", "resume"]);
  });

  it("ignores another session's commands and repeats (idempotent)", () => {
    const other = applyFocusCommands(session, [{ seq: 1, sessionId: "old", action: "pause", at: T0 + 1 }], T0 + 2);
    expect(other.session).toBe(session);
    expect(other.applied).toEqual([]);
    const again = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "resume", at: T0 + 1 }], T0 + 2);
    expect(again.session).toBe(session);
    expect(applyFocusCommands(null, [{ seq: 1, sessionId: "s1", action: "pause", at: T0 }], T0).session).toBeNull();
  });

  it("extend acts only at time's up: 5 more minutes on a timer, Keep going (20 minutes) on a starter", () => {
    const end = T0 + 20 * 60_000;
    const early = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "extend", at: T0 + 60_000 }], T0 + 60_000);
    expect(early.session).toBe(session);
    expect(early.applied).toEqual([]);
    const timer = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "extend", at: end + 1000 }], end + 2000);
    expect(timer.session).toMatchObject({ status: "running", durationMs: 25 * 60_000, endAt: end + 1000 + 5 * 60_000 });
    expect(timer.applied).toEqual(["extend"]);
    const starter = startSession({ id: "s2", taskId: "a", taskText: "Walk", date: "2026-09-29", kind: "starter", minutes: 5, now: T0 });
    const kept = applyFocusCommands(starter, [{ seq: 1, sessionId: "s2", action: "extend", at: T0 + 6 * 60_000 }], T0 + 6 * 60_000);
    expect(kept.session).toMatchObject({ kind: "timer", durationMs: 20 * 60_000, endAt: T0 + 26 * 60_000 });
  });

  it("extend at the day-long cap is a no-op (not recorded)", () => {
    const capped = { ...session, durationMs: 24 * 60 * 60_000, endAt: T0 + 60_000 };
    const out = applyFocusCommands(capped, [{ seq: 1, sessionId: "s1", action: "extend", at: T0 + 2 * 60_000 }], T0 + 3 * 60_000);
    expect(out.session).toBe(capped);
    expect(out.applied).toEqual([]);
  });

  it("a pause that finds the time already up ends it, and isn't recorded as a pause", () => {
    const late = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "pause", at: T0 + 21 * 60_000 }], T0 + 22 * 60_000);
    expect(late.session?.status).toBe("ended");
    expect(late.applied).toEqual([]);
  });

  it("a tap time in the future counts as now", () => {
    const { session: paused } = applyFocusCommands(session, [{ seq: 1, sessionId: "s1", action: "pause", at: T0 + 99 * 60_000 }], T0 + 60_000);
    expect(paused?.pausedRemainingMs).toBe(19 * 60_000);
  });
});
