// Evening close (Phase 9a): the server contract, the client's local/AI close,
// tomorrow's draft, the morning notification that carries it, and storage.
import { describe, expect, it, vi } from "vitest";

import {
  closeDay,
  draftForTomorrow,
  draftToShow,
  isDayClosed,
  localEveningClose,
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
    expect(validateEveningPayload({ ...input(), note: "x".repeat(501) })).toMatch(/note/);
    expect(validateEveningPayload({ ...input(), goalTitle: "x".repeat(121) })).toMatch(/goalTitle/);
    expect(validateEveningPayload({ ...input(), memory: "x".repeat(501) })).toMatch(/memory/);
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
    expect(isDayClosed(d, TODAY)).toBe(true);
    expect(isDayClosed(d, "2026-09-26")).toBe(false);
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

  it("offers the check-in once there are tasks and it's evening, locked or perfect (and it's enabled)", () => {
    const base = { taskCount: 2, locked: false, perfect: false, hour: 16, enabled: true };
    expect(showEveningCheckIn(base)).toBe(false);
    expect(showEveningCheckIn({ ...base, hour: 17 })).toBe(true);
    expect(showEveningCheckIn({ ...base, locked: true })).toBe(true);
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
