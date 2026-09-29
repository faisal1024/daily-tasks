// Evening close (Phase 9a): the server contract, the client's local/AI close,
// tomorrow's draft, the morning notification that carries it, and storage.
import { describe, expect, it, vi } from "vitest";

import {
  closeDay,
  draftForNotification,
  draftForTomorrow,
  draftToShow,
  isDayClosed,
  localEveningClose,
  morningPerspective,
  parseEveningResponse,
  showEveningCheckIn,
  type EveningClose,
  type EveningInput,
} from "../lib/daily-tasks/evening";
import { morningCopy, planUpcomingMornings } from "../lib/daily-tasks/reminders";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_NOTIFICATIONS, type TomorrowDraft } from "../lib/daily-tasks/types";
import {
  buildEveningPrompt,
  EVENING_SYSTEM_PROMPT,
  isValidEvening,
  sanitizeEvening,
  validateEveningPayload,
} from "../server/providers/evening-contract.mjs";

const TODAY = "2026-09-25"; // a Friday

const input = (overrides: Partial<EveningInput> = {}): EveningInput => ({
  result: "good",
  tasks: [
    { text: "Walk", done: true },
    { text: "Read", done: false },
    { text: "Stretch", done: false },
  ],
  note: null,
  goalTitle: "Run a 5K",
  memory: "Mornings work best.",
  ...overrides,
});

const draft = (overrides: Partial<TomorrowDraft> = {}): TomorrowDraft => ({
  forDate: "2026-09-26",
  tasks: ["Read", "Stretch"],
  note: "A good day.",
  because: "Picking up where today left off.",
  source: "local",
  ...overrides,
});

describe("evening contract (server)", () => {
  it("validates the payload: result enum, up to 3 tasks with text/done, capped note/goal/memory", () => {
    expect(validateEveningPayload(input())).toBeNull();
    expect(validateEveningPayload({ ...input(), tasks: [] })).toBeNull();
    expect(validateEveningPayload({ ...input(), result: "great" })).toMatch(/result/);
    expect(validateEveningPayload({ ...input(), tasks: [...input().tasks, { text: "4th", done: false }] })).toMatch(/tasks/);
    expect(validateEveningPayload({ ...input(), tasks: [{ text: "  ", done: true }] })).toMatch(/task text/);
    expect(validateEveningPayload({ ...input(), tasks: [{ text: "Walk" }] })).toMatch(/done/);
    // Long notes and memories are shortened in the prompt, not rejected.
    expect(validateEveningPayload({ ...input(), note: "x".repeat(2000) })).toBeNull();
    expect(validateEveningPayload({ ...input(), note: "x".repeat(2001) })).toMatch(/note/);
    expect(validateEveningPayload({ ...input(), goalTitle: "x".repeat(121) })).toMatch(/goalTitle/);
    expect(validateEveningPayload({ ...input(), memory: "x".repeat(2001) })).toMatch(/memory/);
    expect(validateEveningPayload(null)).toMatch(/Invalid/);
  });

  it("builds a prompt with each task's done flag, the result, and the coach's memory", () => {
    const prompt = buildEveningPrompt(input());
    expect(prompt).toContain("- Walk (done)");
    expect(prompt).toContain("- Read (not done)");
    expect(prompt).toContain("How today felt: good");
    expect(prompt).toContain("What you remember about them so far: Mornings work best.");
    expect(buildEveningPrompt(input({ tasks: [], memory: null }))).toContain("nothing yet");
  });

  it("accepts a long emoji memory (counted in whole characters, up to 2000) and sends at most 500 of it", () => {
    // 1500 characters, 3000 UTF-16 units: fine by characters, too long by .length.
    const memory = "🏃".repeat(1500);
    expect(memory.length).toBe(3000);
    expect(validateEveningPayload({ ...input(), memory })).toBeNull();
    const line = buildEveningPrompt(input({ memory }))
      .split("\n")
      .find((l: string) => l.startsWith("What you remember about them so far: "));
    const sent = line!.slice("What you remember about them so far: ".length);
    expect(Array.from(sent).length).toBeLessThanOrEqual(500);
    expect(sent.startsWith("🏃🏃")).toBe(true);
    // Whole emoji only: no half surrogate pairs.
    expect(sent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("accepts a result with a note and one usable task; sanitizes with caps, dedupe, max 3 and echoes dropped", () => {
    const echo = "x".repeat(201);
    const raw = {
      note: "n".repeat(300),
      because: "b".repeat(300),
      memory: "m".repeat(900),
      tomorrow: [{ text: echo }, { text: "Read ten pages" }, { text: "read ten pages" }, { text: "t".repeat(90) }, { text: "Walk" }, { text: "Fifth" }],
    };
    expect(isValidEvening(raw)).toBe(true);
    expect(isValidEvening({ ...raw, note: "  " })).toBe(false);
    expect(isValidEvening({ ...raw, tomorrow: [{ text: echo }] })).toBe(false);

    const clean = sanitizeEvening(raw);
    expect(Array.from(clean.note)).toHaveLength(160);
    expect(Array.from(clean.because)).toHaveLength(100);
    expect(Array.from(clean.memory)).toHaveLength(500);
    expect(clean.tomorrow.map((t: { text: string }) => t.text)).toEqual([
      "Read ten pages",
      `${"t".repeat(63)}…`,
      "Walk",
    ]);
  });
});

describe("evening close (client)", () => {
  it("closes locally with tomorrow = what's still open (max 3), a matching because line, and no memory", () => {
    const close = localEveningClose(input());
    expect(close).toMatchObject({ tomorrow: ["Read", "Stretch"], memory: null, source: "local" });
    expect(close.because).toBe("Picking up where today left off.");
    expect(localEveningClose(input({ result: "hard" })).because).toBe("Just what's still open, nothing new on top.");
    const allDone = localEveningClose(input({ tasks: [{ text: "Walk", done: true }] }));
    expect(allDone.tomorrow).toEqual([]);
    expect(allDone.because).toBe("Everything's done, so tomorrow starts fresh.");
  });

  it("parses the AI reply, and throws when there's no note or no task", () => {
    const parsed = parseEveningResponse({ note: "Nice.", because: "Lighter.", memory: "m", tomorrow: [{ text: "Read" }, { text: "read" }] });
    expect(parsed).toMatchObject({ note: "Nice.", tomorrow: ["Read"], memory: "m", source: "ai" });
    expect(() => parseEveningResponse({ note: "", tomorrow: [{ text: "Read" }] })).toThrow();
    expect(() => parseEveningResponse({ note: "Nice.", tomorrow: [] })).toThrow();
  });

  it("uses the local close without AI, and falls back to it when the AI fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    expect((await closeDay(input(), { useAi: true, request })).source).toBe("local");
    expect(request).toHaveBeenCalledTimes(1);
    const unused = vi.fn();
    expect((await closeDay(input(), { useAi: false, request: unused })).source).toBe("local");
    expect(unused).not.toHaveBeenCalled();
    const ai: EveningClose = { note: "n", because: "b", tomorrow: ["A"], memory: "m", source: "ai" };
    expect(await closeDay(input(), { useAi: true, request: async () => ai })).toBe(ai);
  });

  it("drafts for tomorrow (or nothing), and knows when today is already closed", () => {
    const close = localEveningClose(input());
    const d = draftForTomorrow(close, TODAY);
    expect(d).toMatchObject({ forDate: "2026-09-26", tasks: ["Read", "Stretch"], source: "local" });
    expect(draftForTomorrow({ ...close, tomorrow: [] }, TODAY)).toBeNull();
  });

  it("knows when a day is closed, and for which answer", () => {
    const record = { date: TODAY, result: "good" as const, note: "A good day." };
    expect(isDayClosed(record, TODAY)).toBe(true);
    expect(isDayClosed(record, TODAY, "good")).toBe(true);
    // A different answer re-closes the day.
    expect(isDayClosed(record, TODAY, "hard")).toBe(false);
    expect(isDayClosed(record, "2026-09-26")).toBe(false);
    expect(isDayClosed(null, TODAY)).toBe(false);
  });

  it("shows the draft only on its day, unlocked, minus tasks already added, and not on a full day", () => {
    const today = "2026-09-26";
    expect(draftToShow(draft(), { today, locked: false, taskTexts: [] })?.tasks).toEqual(["Read", "Stretch"]);
    expect(draftToShow(draft(), { today, locked: false, taskTexts: [" read "] })?.tasks).toEqual(["Stretch"]);
    expect(draftToShow(draft(), { today: TODAY, locked: false, taskTexts: [] })).toBeNull();
    expect(draftToShow(draft(), { today, locked: true, taskTexts: [] })).toBeNull();
    expect(draftToShow(draft(), { today, locked: false, taskTexts: ["Read", "Stretch"] })).toBeNull();
    expect(draftToShow(draft({ tasks: ["New"] }), { today, locked: false, taskTexts: ["A", "B", "C"] })).toBeNull();
  });

  it("leaves out draft tasks finished after the close, or dropped at the rollover, on the source day", () => {
    const sourceDay = {
      date: TODAY,
      total: 3,
      completed: 1,
      locked: false,
      lockSource: null,
      reflection: null,
      reflectionResult: null,
      tasks: [
        { id: "a", text: "read  TEN pages", completed: true, carriedOver: false, rolloverOutcome: null },
        { id: "b", text: "Stretch", completed: false, carriedOver: false, rolloverOutcome: "dropped" as const },
        { id: "c", text: "Call mum", completed: false, carriedOver: false, rolloverOutcome: "carried" as const },
      ],
    };
    const shown = draftToShow(draft({ tasks: ["Read ten pages", "Stretch", "Call mum"] }), {
      today: "2026-09-26",
      locked: false,
      taskTexts: [],
      sourceDay,
    });
    expect(shown?.tasks).toEqual(["Call mum"]);
    expect(
      draftToShow(draft({ tasks: ["Read ten pages", "Stretch"] }), { today: "2026-09-26", locked: false, taskTexts: [], sourceDay }),
    ).toBeNull();
  });

  it("offers the check-in once there are tasks and it's evening or perfect (not merely locked), when enabled", () => {
    const base = { taskCount: 2, locked: false, perfect: false, hour: 16, enabled: true };
    expect(showEveningCheckIn(base)).toBe(false);
    expect(showEveningCheckIn({ ...base, hour: 17 })).toBe(true);
    // Auto-lock is around noon: a locked lunchtime isn't the end of the day.
    expect(showEveningCheckIn({ ...base, hour: 12, locked: true })).toBe(false);
    expect(showEveningCheckIn({ ...base, perfect: true })).toBe(true);
    expect(showEveningCheckIn({ ...base, hour: 20, enabled: false })).toBe(false);
    expect(showEveningCheckIn({ ...base, hour: 20, taskCount: 0 })).toBe(false);
  });
});

describe("morning notification with the draft", () => {
  it("carries the draft on its own day only", () => {
    expect(morningCopy("2026-09-26", draft({ tasks: ["A", "B", "C"] }))).toEqual({
      title: "Your three for Saturday",
      body: "A · B · C",
    });
    expect(morningCopy("2026-09-27", draft()).title).not.toMatch(/Your three/);
    expect(morningCopy("2026-09-26", null).title).not.toMatch(/Your three/);

    const upcoming = planUpcomingMornings({
      now: new Date(2026, 8, 25, 21, 0),
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
      draft: draft(),
    });
    expect(upcoming[0]).toMatchObject({ title: "Your three for Saturday", body: "Read · Stretch" });
    expect(upcoming.slice(1).every((r) => !r.title.startsWith("Your three"))).toBe(true);
  });
});

describe("storage: tomorrowDraft and coachMemory", () => {
  const base = () => JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 8, 25))));

  it("keeps a valid draft (capped), drops one with a bad date or no tasks, and trims memory", () => {
    const kept = normalizeState({
      ...base(),
      tomorrowDraft: { forDate: "2026-09-26", tasks: ["A", "", 3, "B", "C", "D"], note: "n", because: "b", source: "weird" },
      coachMemory: "m".repeat(700),
    });
    expect(kept?.tomorrowDraft).toEqual({ forDate: "2026-09-26", tasks: ["A", "B", "C"], note: "n", because: "b", source: "local" });
    expect(kept?.coachMemory).toHaveLength(500);

    expect(normalizeState({ ...base(), tomorrowDraft: { ...draft(), forDate: "tomorrow" } })?.tomorrowDraft).toBeNull();
    expect(normalizeState({ ...base(), tomorrowDraft: { ...draft(), tasks: [] } })?.tomorrowDraft).toBeNull();
    expect(normalizeState({ ...base(), coachMemory: "   " })?.coachMemory).toBeNull();
    const old = base();
    delete old.tomorrowDraft;
    delete old.coachMemory;
    expect(normalizeState(old)).toMatchObject({ tomorrowDraft: null, coachMemory: null });
  });
});

describe("draftForNotification", () => {
  const tasks = [
    { id: "t0", text: "Read  ten pages" },
    { id: "t1", text: "Stretch" },
  ];
  it("drops tomorrow's draft tasks finished today since the close (ignoring case and spacing)", () => {
    const d = draft({ forDate: "2026-09-26", tasks: ["read ten pages", "Stretch", "Call mum"] });
    expect(draftForNotification(d, { today: TODAY, tasks, completedIds: ["t0"] })?.tasks).toEqual(["Stretch", "Call mum"]);
    expect(draftForNotification(d, { today: TODAY, tasks, completedIds: [] })).toBe(d);
    const allDone = draft({ forDate: "2026-09-26", tasks: ["Read ten pages", "Stretch"] });
    expect(draftForNotification(allDone, { today: TODAY, tasks, completedIds: ["t0", "t1"] })).toBeNull();
  });

  it("passes a draft for another day through", () => {
    const d = draft({ forDate: TODAY, tasks: ["Stretch"] });
    expect(draftForNotification(d, { today: TODAY, tasks, completedIds: ["t1"] })).toBe(d);
    expect(draftForNotification(null, { today: TODAY, tasks, completedIds: [] })).toBeNull();
  });
});


// PR #69: the evening's because line, re-read on the morning card.
describe("morningPerspective", () => {
  it("swaps today → yesterday and tomorrow → today in one sentence", () => {
    expect(morningPerspective("Because today worked well, tomorrow builds on it.")).toBe(
      "Because yesterday worked well, today builds on it.",
    );
  });

  it("carries possessives along, straight and curly apostrophes", () => {
    expect(morningPerspective("Today was hard, so tomorrow's lighter.")).toBe("Yesterday was hard, so today's lighter.");
    expect(morningPerspective("Keep tomorrow\u2019s list short.")).toBe("Keep today\u2019s list short.");
    expect(morningPerspective("Build on today's win.")).toBe("Build on yesterday's win.");
  });

  it("turns tonight into last night, and part-of-day phrases into this morning / tonight / yesterday …", () => {
    expect(morningPerspective("Tonight, rest.")).toBe("Last night, rest.");
    expect(morningPerspective("Tomorrow morning starts with a walk.")).toBe("This morning starts with a walk.");
    expect(morningPerspective("Read tomorrow evening.")).toBe("Read this evening.");
    expect(morningPerspective("Call mum tomorrow night.")).toBe("Call mum tonight.");
    expect(morningPerspective("This morning went well.")).toBe("Yesterday morning went well.");
  });

  it("preserves case: lower, Capitalised, ALL CAPS", () => {
    expect(morningPerspective("today")).toBe("yesterday");
    expect(morningPerspective("Today")).toBe("Yesterday");
    expect(morningPerspective("TODAY")).toBe("YESTERDAY");
    expect(morningPerspective("TOMORROW MORNING")).toBe("THIS MORNING");
  });

  it("never swaps a word twice (tomorrow → today stays today)", () => {
    expect(morningPerspective("tomorrow")).toBe("today");
    expect(morningPerspective("Tomorrow, today, tonight.")).toBe("Today, yesterday, last night.");
  });

  it("leaves unrelated words, and the words inside other words, untouched", () => {
    const text = "Todays todayish notoday yesterdays tomorrows plan: nothing new on top.";
    expect(morningPerspective(text)).toBe(text);
    expect(morningPerspective("")).toBe("");
  });

  it("moves 'yesterday' back a day and 'the day after tomorrow' to tomorrow", () => {
    expect(morningPerspective("Better than yesterday, so tomorrow is steady.")).toBe(
      "Better than the day before, so today is steady.",
    );
    expect(morningPerspective("Yesterday was busy.")).toBe("The day before was busy.");
    expect(morningPerspective("The day after tomorrow is the big one.")).toBe("Tomorrow is the big one.");
  });

  it("the evening prompts ask for 'today'/'tomorrow' in the because line", () => {
    expect(EVENING_SYSTEM_PROMPT).toMatch(/because line, name the days only as 'today'.*'tomorrow'/);
    expect(buildEveningPrompt(input())).toContain("In the because line, say 'today' and 'tomorrow'");
    // "yesterday" would read two days back the next morning; tasks carry no relative days.
    expect(EVENING_SYSTEM_PROMPT).toMatch(/never 'yesterday'/);
    expect(buildEveningPrompt(input())).toMatch(/not 'yesterday'/);
    expect(EVENING_SYSTEM_PROMPT).toMatch(/draft tasks without relative days/);
    expect(buildEveningPrompt(input())).toContain("Write the draft tasks without relative days: name the thing itself.");
  });
});
