// 1.5 C: what the coach remembers (lib/daily-tasks/coach-memory.ts), the
// reasons under picks (the app side), and the storage of memoryClearedAt.
// Dates are local (no UTC math) and history is built with syncTodayHistory,
// so these hold in any timezone.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  cleanReason,
  localBrainDump,
  parseBrainDumpResponse,
  pickReason,
  requestBrainDump,
  WAITING_REASON,
  type BrainDumpResult,
} from "../lib/daily-tasks/ai-helpers";
import {
  buildBasicMemory,
  cleanCoachMemory,
  MAX_COACH_MEMORY,
  memorySentences,
  memoryStart,
  memoryStatsPayload,
  memoryTaskKey,
  movedCounts,
  movedReason,
  movedTimesById,
  withMovedReasons,
  type BasicMemory,
} from "../lib/daily-tasks/coach-memory";
import { buildAiPlanRequestPayload } from "../lib/daily-tasks/momentum-ai";
import { applyRollover, resolvePendingRollover, syncTodayHistory } from "../lib/daily-tasks/rollover";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_MOMENTUM_SETTINGS, type AppState, type DayRecord, type History, type MomentumProfile } from "../lib/daily-tasks/types";
import { cleanStats } from "../server/providers/stats.mjs";

const TODAY = "2026-10-21"; // a Wednesday
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

interface Spec {
  text: string;
  done?: boolean;
  routine?: boolean;
}

/** One day's record, built the way the app builds it (syncTodayHistory). */
function dayRecord(date: string, specs: Spec[]): DayRecord {
  const tasks = specs.map((spec, index) => ({
    id: `${date}-${index}`,
    text: spec.text,
    createdAt: `${date}T08:00:00.000Z`,
    carriedOver: false,
    ...(spec.routine ? { routineId: "r1" } : {}),
  }));
  const state = {
    ...buildInitialState(new Date(2026, 9, 1, 8)),
    tasks,
    todayCompletions: tasks.filter((_task, index) => specs[index].done).map((task) => task.id),
    lastOpenedDate: date,
  };
  return syncTodayHistory(state, date).history[date];
}

const history = (days: Record<string, Spec[]>): History =>
  Object.fromEntries(Object.entries(days).map(([date, specs]) => [date, dayRecord(date, specs)]));

const times = (map: ReturnType<typeof movedCounts>, text: string) => map.get(memoryTaskKey(text))?.times;

describe("movedCounts", () => {
  it("counts each past day a task was left unfinished and came back, including back on today's list", () => {
    const h = history({
      [day(17)]: [{ text: "Call mum" }],
      [day(18)]: [{ text: "Call mum" }],
      [day(19)]: [{ text: "Call mum" }],
      [TODAY]: [{ text: "Call mum" }],
    });
    expect(times(movedCounts(h, TODAY), "Call mum")).toBe(3);
  });

  it("does not count a finished task, one that never came back, or today's own unfinished entry", () => {
    const h = history({
      [day(18)]: [{ text: "Done thing", done: true }, { text: "Never again" }],
      [day(19)]: [{ text: "Done thing", done: true }],
      [TODAY]: [{ text: "Done thing" }, { text: "Today only" }],
    });
    const moved = movedCounts(h, TODAY);
    expect(moved.size).toBe(0);
  });

  it("counts a task that is done on its last day only for the earlier unfinished days", () => {
    const h = history({
      [day(17)]: [{ text: "Taxes" }],
      [day(18)]: [{ text: "Taxes" }],
      [day(19)]: [{ text: "Taxes", done: true }],
    });
    expect(times(movedCounts(h, TODAY), "Taxes")).toBe(2);
  });

  it("counts a task carried over even when no later day shows it (the 'carried' outcome)", () => {
    const record = dayRecord(day(19), [{ text: "Taxes" }]);
    record.tasks[0] = { ...record.tasks[0], rolloverOutcome: "carried" };
    expect(times(movedCounts({ [day(19)]: record }, TODAY), "Taxes")).toBe(1);
    // An unresolved or dropped one that never reappears is not a move.
    for (const outcome of ["unresolved", "dropped"] as const) {
      const other = dayRecord(day(19), [{ text: "Taxes" }]);
      other.tasks[0] = { ...other.tasks[0], rolloverOutcome: outcome };
      expect(movedCounts({ [day(19)]: other }, TODAY).size, outcome).toBe(0);
    }
  });

  it("counts a real rollover: left open on Monday, carried to Tuesday", () => {
    let state = buildInitialState(new Date(2026, 9, 19, 8));
    state = syncTodayHistory(
      {
        ...state,
        tasks: [{ id: "a", text: "Taxes", createdAt: new Date(2026, 9, 19, 8).toISOString(), carriedOver: false }],
        todayCompletions: [],
        lastOpenedDate: day(19),
      },
      day(19),
    );
    state = applyRollover(state, day(20));
    state = resolvePendingRollover(state, [state.pendingRollover!.tasks[0].id], new Date(2026, 9, 20, 8));
    expect(state.history[day(19)].tasks[0].rolloverOutcome).toBe("carried");
    expect(times(movedCounts(state.history, day(20)), "Taxes")).toBe(1);
  });

  it("re-added later: a task that came back after a gap still counts once for the day it was left", () => {
    const h = history({
      [day(10)]: [{ text: "Dentist" }],
      [day(18)]: [{ text: "Dentist" }],
      [TODAY]: [{ text: "Dentist" }],
    });
    // 10th (back on the 18th) and 18th (back today): two moves.
    expect(times(movedCounts(h, TODAY), "Dentist")).toBe(2);
  });

  it("same words ignoring case and spacing are one task; the newest wording is kept", () => {
    const h = history({
      [day(18)]: [{ text: "Call   Mum" }],
      [day(19)]: [{ text: "call mum" }],
      [TODAY]: [{ text: "  CALL MUM " }],
    });
    const moved = movedCounts(h, TODAY);
    expect(moved.size).toBe(1);
    expect(moved.get("call mum")).toEqual({ text: "CALL MUM", times: 2 });
  });

  it("counts a duplicate on one day only once", () => {
    const h = history({
      [day(19)]: [{ text: "Call mum" }, { text: "call  MUM" }],
      [TODAY]: [{ text: "Call mum" }],
    });
    expect(times(movedCounts(h, TODAY), "Call mum")).toBe(1);
  });

  it("leaves routine tasks out, even if only some days were routine", () => {
    const h = history({
      [day(18)]: [{ text: "Stretch", routine: true }, { text: "Floss" }],
      [day(19)]: [{ text: "Stretch", routine: true }, { text: "Floss", routine: true }],
      [TODAY]: [{ text: "Stretch", routine: true }, { text: "Floss" }],
    });
    const moved = movedCounts(h, TODAY);
    expect(moved.has("stretch")).toBe(false);
    // Floss: the 18th was not a routine task and came back; the 19th was a routine one.
    expect(times(moved, "Floss")).toBe(1);
  });

  it("'Not today' leaves no trace: a task taken off the day before it ends is not a move", () => {
    // The day's record is rebuilt from the list, so a removed task is simply absent.
    let state: AppState = {
      ...buildInitialState(new Date(2026, 9, 19, 8)),
      tasks: [{ id: "a", text: "Taxes", createdAt: new Date(2026, 9, 19, 8).toISOString(), carriedOver: false }],
      todayCompletions: [],
      lastOpenedDate: day(19),
    };
    state = syncTodayHistory(state, day(19));
    state = syncTodayHistory({ ...state, tasks: [] }, day(19));
    const h = { ...state.history, ...history({ [TODAY]: [{ text: "Taxes" }] }) };
    expect(movedCounts(h, TODAY).size).toBe(0);
  });

  it("only looks 30 days back", () => {
    const h = history({ [day(19)]: [{ text: "Recent" }], "2026-09-10": [{ text: "Ancient" }], [TODAY]: [{ text: "Recent" }, { text: "Ancient" }] });
    const moved = movedCounts(h, TODAY);
    expect(times(moved, "Recent")).toBe(1);
    expect(moved.has("ancient")).toBe(false);
  });

  describe("memoryClearedAt", () => {
    const h = history({
      [day(15)]: [{ text: "Taxes" }],
      [day(16)]: [{ text: "Taxes" }],
      [day(17)]: [{ text: "Taxes" }],
      [TODAY]: [{ text: "Taxes" }],
    });

    it("counts only the days after the clearing day", () => {
      expect(times(movedCounts(h, TODAY, null), "Taxes")).toBe(3);
      expect(times(movedCounts(h, TODAY, day(15)), "Taxes")).toBe(2);
      expect(times(movedCounts(h, TODAY, day(16)), "Taxes")).toBe(1);
      expect(movedCounts(h, TODAY, day(17)).size).toBe(0);
    });

    it("cleared today (or in the future): nothing, because the window starts tomorrow", () => {
      expect(movedCounts(h, TODAY, TODAY).size).toBe(0);
      expect(movedCounts(h, TODAY, day(30)).size).toBe(0);
    });

    it("a clearing day older than the window, or not a day key, changes nothing", () => {
      expect(times(movedCounts(h, TODAY, "2026-01-01"), "Taxes")).toBe(3);
      expect(times(movedCounts(h, TODAY, "yesterday"), "Taxes")).toBe(3);
      expect(times(movedCounts(h, TODAY, ""), "Taxes")).toBe(3);
    });
  });
});

describe("memoryStart", () => {
  it("is 30 days back, or the day after a more recent clearing", () => {
    expect(memoryStart(TODAY, null)).toEqual({ from: "2026-09-21", sinceCleared: false, span: 30 });
    // Days 11 to 20: ten days.
    expect(memoryStart(TODAY, day(10))).toEqual({ from: day(11), sinceCleared: true, span: 10 });
    // The month rolls over.
    expect(memoryStart(TODAY, "2026-09-30")).toEqual({ from: "2026-10-01", sinceCleared: true, span: 20 });
    expect(memoryStart(TODAY, "2026-08-01")).toEqual({ from: "2026-09-21", sinceCleared: false, span: 30 });
  });

  it("a clearing dated after today (the clock was ahead) counts as today", () => {
    expect(memoryStart(TODAY, "2027-01-01")).toEqual(memoryStart(TODAY, TODAY));
    expect(memoryStart(TODAY, TODAY)).toEqual({ from: day(22), sinceCleared: true, span: 0 });
  });
});

describe("buildBasicMemory and memorySentences", () => {
  it("says nothing yet, or nothing since clearing, with no history", () => {
    expect(memorySentences(buildBasicMemory({}, TODAY))).toEqual(["Nothing yet. After a few days with your three, patterns show up here."]);
    expect(memorySentences(buildBasicMemory({}, TODAY, day(10)))).toEqual([
      "Nothing since you cleared it. After a few days with your three, patterns show up here.",
    ]);
  });

  it("writes the plain sentences for a month with a pattern", () => {
    // Two Sundays (11th, 18th) are the best days, tasks that start with "Call" or
    // "Taxes" slip, "Email" usually gets done, and "Taxes" is moved three times.
    const h = history({
      [day(11)]: [{ text: "Email Ann", done: true }, { text: "Email Bo", done: true }, { text: "Email Cy", done: true }],
      [day(13)]: [{ text: "Call mum" }, { text: "Call Dad" }, { text: "Call Sam", done: true }],
      [day(18)]: [{ text: "Taxes" }, { text: "Call Al" }, { text: "Email Di", done: true }],
      [day(19)]: [{ text: "Taxes" }],
      [day(20)]: [{ text: "Taxes" }],
      [TODAY]: [{ text: "Taxes" }],
    });
    const memory = buildBasicMemory(h, TODAY);
    expect(memory).toMatchObject({ sinceCleared: false, activeDays: 5, completed: 5, total: 11 });
    expect(memorySentences(memory)).toEqual([
      "You finished 5 tasks in the last 30 days.",
      "You get the most done on Sundays.",
      "Tasks that start with “Email” usually get done.",
      "Tasks that keep coming back: “Taxes”.",
      "Tasks starting with “Call” or “Taxes” are harder to get to.",
    ]);
    // Kind words only: no counts of moves, no "N of M" verdict.
    expect(memorySentences(memory).join(" ")).not.toMatch(/\d+ times| of 11/);
  });

  it("names the best weekdays only when seen twice and better than the rest, and uses 'task' for one", () => {
    const h = history({
      [day(5)]: [{ text: "Read", done: true }], // Monday
      [day(12)]: [{ text: "Read", done: true }], // Monday
      [day(13)]: [{ text: "Read" }], // Tuesday
      [day(14)]: [{ text: "Read" }], // Wednesday
    });
    expect(memorySentences(buildBasicMemory(h, TODAY))).toContain("You get the most done on Mondays.");
    const once = buildBasicMemory(history({ [day(19)]: [{ text: "Read", done: true }] }), TODAY);
    expect(memorySentences(once)).toEqual(["You finished 1 task in the last 30 days."]);
  });

  it("with nothing finished, says what was set (never a zero score)", () => {
    const none = buildBasicMemory(history({ [day(19)]: [{ text: "Read" }, { text: "Walk" }] }), TODAY);
    expect(memorySentences(none)[0]).toBe("You set 2 tasks in the last 30 days.");
  });

  it("starts 'Since you cleared it' and drops what came before the clearing", () => {
    const h = history({
      [day(12)]: [{ text: "Old", done: true }],
      [day(19)]: [{ text: "New", done: true }, { text: "New too" }],
    });
    const memory = buildBasicMemory(h, TODAY, day(15));
    expect(memory).toMatchObject({ from: day(16), sinceCleared: true, total: 2, completed: 1 });
    expect(memorySentences(memory)[0]).toBe("You finished 1 task since you cleared it.");
  });

  it("shows at most three moved tasks, most moved first, and none moved only once", () => {
    const h = history({
      [day(17)]: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "Once" }],
      [day(18)]: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
      [day(19)]: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
      [day(20)]: [{ text: "A" }, { text: "B" }],
      [TODAY]: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "Once" }],
    });
    const memory = buildBasicMemory(h, TODAY);
    expect(memory.moved.map((task) => `${task.text}:${task.times}`)).toEqual(["A:4", "B:4", "C:3"]);
  });
});

describe("memoryStatsPayload", () => {
  const memory = (over: Partial<BasicMemory> = {}): BasicMemory => ({
    from: "2026-09-21",
    sinceCleared: false,
    span: 30,
    activeDays: 3,
    completed: 2,
    total: 7,
    bestWeekdays: [],
    moved: [],
    finishedKinds: [],
    slippingKinds: [],
    ...over,
  });

  it("is null until there is an active day with tasks", () => {
    expect(memoryStatsPayload(buildBasicMemory({}, TODAY))).toBeNull();
    expect(memoryStatsPayload(memory({ activeDays: 0 }))).toBeNull();
    expect(memoryStatsPayload(memory({ total: 0, completed: 0 }))).toBeNull();
  });

  it("is null right after clearing, and comes back from the next day's history", () => {
    const h = history({ [day(19)]: [{ text: "A", done: true }] });
    expect(memoryStatsPayload(buildBasicMemory(h, TODAY, TODAY))).toBeNull();
    // Cleared on the 18th: the window is the 19th and 20th, and says so.
    expect(memoryStatsPayload(buildBasicMemory(h, TODAY, day(18)))).toEqual({ days: 1, done: 1, total: 1, span: 2 });
  });

  it("leaves bestDays and moved out when there are none, and names them when there are", () => {
    expect(memoryStatsPayload(memory())).toEqual({ days: 3, done: 2, total: 7 });
    expect(
      memoryStatsPayload(memory({ bestWeekdays: [1, 3], moved: [{ text: "Taxes", times: 3 }] })),
    ).toEqual({ days: 3, done: 2, total: 7, bestDays: ["Monday", "Wednesday"], moved: [{ text: "Taxes", times: 3 }] });
  });

  it("caps counts at the Worker's limits and moved titles at 64 characters", () => {
    const payload = memoryStatsPayload(
      memory({ activeDays: 40, total: 120, completed: 200, moved: [{ text: "x".repeat(100), times: 5 }] }),
    )!;
    // done can't be over total: kept at 93 of 93.
    expect(payload).toMatchObject({ days: 31, total: 93, done: 93 });
    // Over 93 tasks the share is kept: 60 of 120 is sent as 47 of 93 (rounded).
    expect(memoryStatsPayload(memory({ total: 120, completed: 60 }))).toMatchObject({ total: 93, done: 47 });
    expect(Array.from(payload.moved![0].text)).toHaveLength(64);
    expect(payload.moved![0].text.endsWith("…")).toBe(true);
    // What the app sends is what the Worker keeps whole.
    expect(cleanStats(payload)?.moved).toEqual(payload.moved);
  });

  it("every payload the app can build survives the Worker's cleanStats", () => {
    const h = history({
      [day(18)]: [{ text: "Taxes" }, { text: "Read", done: true }],
      [day(19)]: [{ text: "Taxes" }],
      [TODAY]: [{ text: "Taxes" }],
    });
    const payload = memoryStatsPayload(buildBasicMemory(h, TODAY))!;
    expect(cleanStats(payload)).toEqual({ bestDays: [], moved: [], span: 30, ...payload });
    const cleared = memoryStatsPayload(buildBasicMemory(h, TODAY, day(17)))!;
    expect(cleanStats(cleared)).toEqual({ bestDays: [], moved: [], ...cleared });
  });
});

describe("stats are sent only when non-empty", () => {
  const PLAN_URL = "https://proxy.test/api/momentum/plan";
  const reply = () =>
    new Response(JSON.stringify({ picks: ["Walk"], parked: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const sentBody = async (stats: Parameters<typeof requestBrainDump>[0]["stats"]) => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => reply());
    await requestBrainDump({ text: "walk", openSlots: 1, goalTitle: null, stats, planUrl: PLAN_URL, fetchImpl: fetchImpl as unknown as typeof fetch });
    return JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as Record<string, unknown>;
  };

  it("brain dump: no stats field for null or absent; the payload as given otherwise", async () => {
    expect(await sentBody(null)).not.toHaveProperty("stats");
    expect(await sentBody(undefined)).not.toHaveProperty("stats");
    expect((await sentBody({ days: 2, done: 1, total: 4 })).stats).toEqual({ days: 2, done: 1, total: 4 });
  });

  const PROFILE: MomentumProfile = {
    name: "Test",
    goalTitle: "Learn guitar",
    goalSource: "custom",
    timeAvailability: "30_min",
    experienceLevel: "beginner",
    struggleType: "consistency",
    motivation: null,
    preferredTime: null,
    cadence: null,
    onboardingCompletedAt: "2026-05-02T12:00:00.000Z",
  };

  it("plan: no stats for a new user or a freshly cleared memory; stats once there is history", () => {
    const now = new Date(2026, 9, 21, 9);
    const base = { profile: PROFILE, settings: DEFAULT_MOMENTUM_SETTINGS, now };
    const h = history({ [day(19)]: [{ text: "Read", done: true }] });
    expect(buildAiPlanRequestPayload({ ...base, history: {} })).not.toHaveProperty("stats");
    expect(buildAiPlanRequestPayload({ ...base, history: h, memoryClearedAt: TODAY })).not.toHaveProperty("stats");
    expect(buildAiPlanRequestPayload({ ...base, history: h })?.stats).toEqual({ days: 1, done: 1, total: 1 });
    // The old five-day detail is still there next to it.
    expect(buildAiPlanRequestPayload({ ...base, history: h })?.recentTasks).toBeDefined();
  });
});

describe("cleanReason (app)", () => {
  it.each([
    ["Quick win", "Quick win"],
    ["quick win.", "Quick win"],
    ["  Due   Friday!! ", "Due Friday"],
    ["Been waiting a while", "Been waiting a while"],
    ["Due in 2 days", "Due in 2 days"],
    ["One two three four five", "One two three four five"],
    ["x".repeat(40), "X" + "x".repeat(39)],
    ["Line\nbreak", "Line break"],
  ])("keeps %j as %j", (input, expected) => {
    expect(cleanReason(input, "Something else")).toBe(expected);
  });

  it.each([
    ["six words is one too many", "one two three four five six"],
    ["41 characters", "x".repeat(41)],
    ["a web link", "See https://example.com"],
    ["a www link", "visit www.example.com"],
    ["an email", "ask bob@example.com"],
    ["an empty string", "   "],
    ["only punctuation", "..."],
    ["a bare domain", "see evil.com"],
    ["a domain split by a zero-width space", "evil\u200B.com"],
    ["a bidi control", "Quick \u202Ewin"],
    ["a count of moves", "Moved 3 times"],
    ["a count in words", "Put off four times"],
    ["twice", "Moved twice"],
    ["another verb", "Carried over 4 times"],
    ["shame", "Stop being lazy"],
    ["again?!", "Again?!"],
  ])("drops %s, never cuts it", (_label, input) => {
    expect(cleanReason(input, "Something else")).toBe("");
  });

  it("drops a reason that is the task's own words (any case or spacing at the ends)", () => {
    expect(cleanReason("call mum", "Call mum")).toBe("");
    expect(cleanReason("CALL MUM.", "  call mum ")).toBe("");
    expect(cleanReason("Call mum today", "Call mum")).toBe("Call mum today");
  });

  it.each([undefined, null, 5, {}, [], true])("drops a non-string (%j)", (value) => {
    expect(cleanReason(value, "x")).toBe("");
  });

  it("counts characters, not UTF-16 units: 40 emoji fit one line of five words? no, but 40 code points do", () => {
    expect(cleanReason("😀".repeat(40))).toBe("😀".repeat(40));
    expect(cleanReason("😀".repeat(41))).toBe("");
  });
});

describe("parseBrainDumpResponse reasons", () => {
  it("adds reasons parallel to picks, with '' where a pick has none", () => {
    const result = parseBrainDumpResponse(
      { picks: [{ text: "Finish report", reason: "Due Friday" }, { text: "Call mum" }, { text: "Walk", reason: "x".repeat(50) }], parked: [] },
      3,
    );
    expect(result.picks).toEqual(["Finish report", "Call mum", "Walk"]);
    expect(result.reasons).toEqual(["Due Friday", "", ""]);
  });

  it("has no reasons field at all from an older Worker (plain strings, objects without a reason)", () => {
    for (const picks of [["Walk", "Swim"], [{ text: "Walk" }, { text: "Swim", reason: "" }], [{ text: "Walk", reason: 5 }]]) {
      const result = parseBrainDumpResponse({ picks, parked: [] }, 3);
      expect(result, JSON.stringify(picks)).not.toHaveProperty("reasons");
      expect(result.source).toBe("ai");
    }
  });

  it("keeps reasons lined up when a pick is dropped (blank, or a duplicate)", () => {
    const result = parseBrainDumpResponse(
      { picks: [{ text: "  ", reason: "Wrong one" }, { text: "Walk", reason: "Quick win" }, { text: "walk", reason: "Duplicate" }, { text: "Swim", reason: "Fun" }], parked: [] },
      3,
    );
    expect(result.picks).toEqual(["Walk", "Swim"]);
    expect(result.reasons).toEqual(["Quick win", "Fun"]);
  });

  it("drops a reason that echoes the pick after it was tidied, and one with a link", () => {
    const result = parseBrainDumpResponse(
      { picks: [{ text: "- call mum", reason: "Call mum" }, { text: "Pay rent", reason: "pay at example.com/rent www.x.io" }], parked: [] },
      3,
    );
    expect(result).not.toHaveProperty("reasons");
  });
});

describe("fallback reasons", () => {
  const ai = (reasons?: string[]): BrainDumpResult => ({ picks: ["A", "B", "C"], parked: [], source: "ai", ...(reasons ? { reasons } : {}) });
  const memory = (...moved: [string, number][]): BasicMemory => ({
    from: "2026-09-21",
    sinceCleared: false,
    span: 30,
    activeDays: 3,
    completed: 1,
    total: 3,
    bestWeekdays: [],
    moved: moved.map(([text, count]) => ({ text, times: count })),
    finishedKinds: [],
    slippingKinds: [],
  });

  it("pickReason: the AI's own (or the memory's), else nothing; the offline split shows none", () => {
    expect(pickReason(ai(["Quick win", "", ""]), 0)).toBe("Quick win");
    expect(pickReason(ai(["Quick win", "", ""]), 1)).toBeNull();
    expect(pickReason(ai(), 0)).toBeNull();
    const local = localBrainDump("walk\nswim\nread\nrun", 3);
    expect([0, 1, 2].map((index) => pickReason(local, index))).toEqual([null, null, null]);
    expect(pickReason(local, 3)).toBeNull();
    expect(pickReason(local, -1)).toBeNull();
  });

  it("movedReason: 'Been waiting a while', never a count, matching ignoring case and spacing", () => {
    expect(WAITING_REASON).toBe("Been waiting a while");
    expect(movedReason("  taxes ", memory(["Taxes", 3]))).toBe(WAITING_REASON);
    expect(movedReason("Taxes", memory(["Taxes", 2]))).toBe(WAITING_REASON);
    expect(movedReason("Other", memory(["Taxes", 3]))).toBeNull();
    expect(movedReason("Taxes", null)).toBeNull();
  });

  it("withMovedReasons: fills only the picks with none; the AI's reason stays", () => {
    const result = withMovedReasons(ai(["Quick win", "", ""]), memory(["a", 2], ["B", 4], ["C", 3]));
    expect(result.reasons).toEqual(["Quick win", WAITING_REASON, WAITING_REASON]);
    expect(withMovedReasons(ai(), memory(["B", 5])).reasons).toEqual(["", WAITING_REASON, ""]);
  });

  it("withMovedReasons: a 'waiting' reason on a pick that doesn't keep moving is dropped", () => {
    const result = withMovedReasons(ai(["Been waiting a while", "Put off for ages", "Quick win"]), memory(["B", 3]));
    expect(result.reasons).toEqual(["", "Put off for ages", "Quick win"]);
    const none = withMovedReasons(ai(["Been waiting a while", "", ""]), null);
    expect(none).not.toHaveProperty("reasons");
  });

  it("withMovedReasons: the same object back when there is nothing to add", () => {
    const result = ai();
    expect(withMovedReasons(result, null)).toBe(result);
    expect(withMovedReasons(result, memory())).toBe(result);
    expect(withMovedReasons(result, memory(["Z", 3]))).toBe(result);
  });

  it("on the offline split only a pick that keeps moving gets a reason", () => {
    const local = withMovedReasons(localBrainDump("Walk\nTaxes\nRead", 3), memory(["Taxes", 3]));
    expect([0, 1, 2].map((index) => pickReason(local, index))).toEqual([null, WAITING_REASON, null]);
  });
});

describe("movedTimesById", () => {
  it("maps open tasks to their move counts, leaving out the never-moved, and respects the clearing day", () => {
    const h = history({
      [day(18)]: [{ text: "Taxes" }, { text: "Read" }],
      [day(19)]: [{ text: "Taxes" }],
      [TODAY]: [{ text: "Taxes" }, { text: "Read", done: true }],
    });
    const open = [
      { id: "a", text: " taxes" },
      { id: "b", text: "Brand new" },
    ];
    expect(movedTimesById(open, h, TODAY, null)).toEqual({ a: 2 });
    expect(movedTimesById(open, h, TODAY, day(18))).toEqual({ a: 1 });
    expect(movedTimesById(open, h, TODAY, TODAY)).toEqual({});
  });
});

describe("cleanCoachMemory", () => {
  it("trims, makes blank mean none, and caps at 500 whole characters", () => {
    expect(cleanCoachMemory("  hello  ")).toBe("hello");
    expect(cleanCoachMemory("   \n ")).toBeNull();
    expect(cleanCoachMemory("a".repeat(600))).toHaveLength(MAX_COACH_MEMORY);
    expect(Array.from(cleanCoachMemory("😀".repeat(600))!)).toHaveLength(MAX_COACH_MEMORY);
  });
});

describe("storage: memoryClearedAt", () => {
  const saved = (over: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ ...buildInitialState(new Date(2026, 9, 21, 8)), ...over }));

  it("a new install has none, and an old save without the field loads as never cleared", () => {
    expect(buildInitialState(new Date(2026, 9, 21, 8)).memoryClearedAt).toBeNull();
    const old = saved();
    delete old.memoryClearedAt;
    expect(normalizeState(old)?.memoryClearedAt).toBeNull();
  });

  it("keeps a good day key and round-trips it", () => {
    const state = normalizeState(saved({ memoryClearedAt: "2026-10-20" }));
    expect(state?.memoryClearedAt).toBe("2026-10-20");
    expect(normalizeState(JSON.parse(JSON.stringify(state)))?.memoryClearedAt).toBe("2026-10-20");
  });

  it.each([
    ["a number", 20261020],
    ["a short key", "2026-1-2"],
    ["a timestamp", "2026-10-20T10:00:00.000Z"],
    ["text", "yesterday"],
    ["empty", ""],
    ["null", null],
    ["an object", { day: "2026-10-20" }],
    ["a list", ["2026-10-20"]],
    ["padded", " 2026-10-20"],
  ])("drops %s", (_label, value) => {
    const state = normalizeState(saved({ memoryClearedAt: value }));
    expect(state).not.toBeNull();
    expect(state?.memoryClearedAt).toBeNull();
  });
});

describe("nothing new in analytics", () => {
  it.each(["lib/daily-tasks/coach-memory.ts", "components/daily-tasks/coach-memory-section.tsx"])("%s never touches analytics", (file) => {
    const source = readFileSync(`${process.cwd()}/${file}`, "utf8");
    expect(source).not.toMatch(/analytics|\btrack\(|posthog/i);
  });
});
