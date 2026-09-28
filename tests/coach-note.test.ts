// The Coach's note (1.2, PR #64): pure logic in lib/daily-tasks/coach-note.ts
// plus the proxy route's contract (server/providers/coach-contract.mjs).
import { describe, expect, it, vi } from "vitest";

import {
  MAX_COACH_LINE,
  MOMENTUM_LINES,
  START_LINES,
  cleanCoachLine,
  coachNoteKind,
  coachTaskKey,
  localCoachLine,
  mergeCoachNotes,
  needsCoachRequest,
  parseCoachResponse,
  quoteTask,
  requestCoachNotes,
} from "../lib/daily-tasks/coach-note";
import type { CoachNotesCache } from "../lib/daily-tasks/types";
import {
  buildCoachPrompt,
  isValidCoach,
  sanitizeCoach,
  validateCoachPayload,
} from "../server/providers/coach-contract.mjs";

const TODAY = "2026-09-26";

function cache(overrides: Partial<CoachNotesCache> = {}): CoachNotesCache {
  return { date: TODAY, notes: {}, requests: 0, asked: [], logged: false, ...overrides };
}

describe("coachNoteKind", () => {
  it("is start only in the morning with nothing ticked; momentum otherwise (midday included)", () => {
    expect(coachNoteKind("morning", 0)).toBe("start");
    expect(coachNoteKind("morning", 1)).toBe("momentum");
    expect(coachNoteKind("midday", 0)).toBe("momentum");
    expect(coachNoteKind("midday", 2)).toBe("momentum");
  });
});

describe("built-in lines", () => {
  it("localCoachLine is stable per day, kind and task key, quoting the task", () => {
    const line = localCoachLine("start", "Walk the dog", TODAY);
    // Whitespace and case don't change the pick (same cache key).
    expect(localCoachLine("start", "  walk   the DOG ", TODAY).replace(/“.*”/, "")).toBe(
      line.replace(/“.*”/, ""),
    );
    expect(localCoachLine("start", "Walk the dog", TODAY)).toBe(line);
    expect(line).toContain("“Walk the dog”");
    expect(START_LINES.map((t) => t.replace("{task}", "“Walk the dog”"))).toContain(line);
    expect(MOMENTUM_LINES.map((t) => t.replace("{task}", "“Walk the dog”"))).toContain(
      localCoachLine("momentum", "Walk the dog", TODAY),
    );
    // Across a range of days the pick varies (it isn't one fixed line).
    const days = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    expect(new Set(days.map((d) => localCoachLine("start", "Walk the dog", d))).size).toBeGreaterThan(1);
  });

  it("quoteTask cuts over 40 code points to 39 + ellipsis, never splitting an emoji", () => {
    expect(quoteTask("Short")).toBe("“Short”");
    expect(quoteTask("x".repeat(40))).toBe(`“${"x".repeat(40)}”`);
    expect(quoteTask("x".repeat(41))).toBe(`“${"x".repeat(39)}…”`);
    const emoji = "🏃".repeat(45);
    expect(quoteTask(emoji)).toBe(`“${"🏃".repeat(39)}…”`);
  });

  it("every built-in line stays calm: no exclamation marks, and the task placeholder once", () => {
    for (const line of [...START_LINES, ...MOMENTUM_LINES]) {
      expect(line).not.toContain("!");
      expect(line.split("{task}")).toHaveLength(2);
      expect(line.replace("{task}", quoteTask("x".repeat(60))).split(/\s+/).length).toBeLessThanOrEqual(20);
    }
  });
});

describe("needsCoachRequest", () => {
  it("is due for new texts, not for asked ones, and never past 2 calls a day", () => {
    expect(needsCoachRequest(null, TODAY, [])).toBe(false);
    expect(needsCoachRequest(null, TODAY, ["Walk"])).toBe(true);
    const asked = cache({ requests: 1, asked: [coachTaskKey("Walk"), coachTaskKey("Read")] });
    expect(needsCoachRequest(asked, TODAY, ["  walk ", "READ"])).toBe(false);
    expect(needsCoachRequest(asked, TODAY, ["Walk", "Call mum"])).toBe(true);
    expect(needsCoachRequest({ ...asked, requests: 2 }, TODAY, ["Walk", "Call mum"])).toBe(false);
    // Yesterday's cache counts as empty (its cap doesn't carry over).
    expect(needsCoachRequest({ ...asked, date: "2026-09-25", requests: 2 }, TODAY, ["Walk"])).toBe(true);
  });
});

describe("mergeCoachNotes", () => {
  const lines = { start: "Open it.", momentum: "Keep going." };

  it("ignores a reply for an older day (it landed after midnight)", () => {
    const current = cache({ requests: 1 });
    expect(mergeCoachNotes(current, "2026-09-25", { walk: lines })).toBe(current);
  });

  it("resets an older cache for a new day, and merges into today's", () => {
    const old = cache({ date: "2026-09-25", notes: { read: lines }, requests: 2, asked: ["read"], logged: true });
    expect(mergeCoachNotes(old, TODAY, { walk: lines })).toEqual({
      date: TODAY,
      notes: { walk: lines },
      requests: 0,
      asked: [],
      logged: false,
    });
    const today = cache({ notes: { read: lines }, requests: 1 });
    expect(mergeCoachNotes(today, TODAY, { walk: lines })?.notes).toEqual({ read: lines, walk: lines });
    expect(mergeCoachNotes(today, TODAY, {})).toBe(today);
  });
});

describe("cleanCoachLine (app)", () => {
  it("strips URLs and control characters, caps the length, and is null when nothing's left", () => {
    expect(cleanCoachLine("Open\nthe\u0007 doc at https://evil.example/x now")).toBe("Open the doc at now");
    expect(cleanCoachLine("See www.foo.bar/path and evil.com/a too")).toBe("See and too");
    const long = cleanCoachLine("word ".repeat(60));
    expect(Array.from(long ?? "")).toHaveLength(MAX_COACH_LINE);
    expect(long?.endsWith("…")).toBe(true);
    expect(cleanCoachLine("https://only.a.link")).toBeNull();
    expect(cleanCoachLine("  \n\t ")).toBeNull();
    expect(cleanCoachLine(42)).toBeNull();
  });
});

describe("parseCoachResponse", () => {
  it("matches by position, drops entries missing a line, and ignores extras", () => {
    const out = parseCoachResponse(
      {
        notes: [
          { start: "Open the doc.", momentum: "It moves the week." },
          { start: "https://x.com", momentum: "Fine." },
          { start: "Put on shoes.", momentum: "Ten minutes is plenty." },
          { start: "Extra", momentum: "Extra" },
        ],
      },
      ["Write Report", "Call mum", "Walk"],
    );
    expect(out).toEqual({
      "write report": { start: "Open the doc.", momentum: "It moves the week." },
      walk: { start: "Put on shoes.", momentum: "Ten minutes is plenty." },
    });
    expect(parseCoachResponse({ notes: "nope" }, ["Walk"])).toEqual({});
    expect(parseCoachResponse(null, ["Walk"])).toEqual({});
  });

  it("never writes a __proto__ key", () => {
    const out = parseCoachResponse({ notes: [{ start: "a", momentum: "b" }] }, ["__proto__"]);
    expect(Object.keys(out)).toEqual([]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe("requestCoachNotes", () => {
  const input = { tasks: ["Walk"], goalTitle: null, tone: "calm" as const };

  it("throws unavailable without a proxy URL, and never fetches", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestCoachNotes({ input, planUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts trimmed, capped tasks to the coach-note route; an empty answer throws invalid_response", async () => {
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchImpl = vi.fn(async () => reply({ notes: [{ start: "Open it.", momentum: "Keep going." }] }));
    const notes = await requestCoachNotes({
      input: { tasks: ["  Walk  ", "a", "b", "c"], goalTitle: "Run", tone: "direct" },
      planUrl: "https://proxy.test/api/momentum/plan",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(notes).toEqual({ walk: { start: "Open it.", momentum: "Keep going." } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.test/api/momentum/coach-note");
    expect(JSON.parse(String(init.body))).toEqual({ tasks: ["Walk", "a", "b"], goalTitle: "Run", tone: "direct" });

    fetchImpl.mockImplementation(async () => reply({ notes: [{ start: "", momentum: "x" }] }));
    await expect(
      requestCoachNotes({ input, planUrl: "https://proxy.test/api/momentum/plan", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("coach-note proxy contract", () => {
  it("validates the payload: 1-3 non-empty tasks of at most 120 chars, optional goal and a known tone", () => {
    expect(validateCoachPayload({ tasks: ["Walk"] })).toBeNull();
    expect(validateCoachPayload({ tasks: ["a", "b", "c"], goalTitle: null, tone: "friendly" })).toBeNull();
    expect(validateCoachPayload({ tasks: ["x".repeat(120)], goalTitle: "g".repeat(120), tone: null })).toBeNull();
    expect(validateCoachPayload(null)).toBe("Invalid JSON payload");
    expect(validateCoachPayload({ tasks: [] })).toBe("tasks must be 1-3 items");
    expect(validateCoachPayload({ tasks: ["a", "b", "c", "d"] })).toBe("tasks must be 1-3 items");
    expect(validateCoachPayload({ tasks: "Walk" })).toBe("tasks must be 1-3 items");
    expect(validateCoachPayload({ tasks: ["  "] })).toBe("Invalid task");
    expect(validateCoachPayload({ tasks: [7] })).toBe("Invalid task");
    expect(validateCoachPayload({ tasks: ["x".repeat(121)] })).toBe("Invalid task");
    expect(validateCoachPayload({ tasks: ["Walk"], goalTitle: 5 })).toBe("Invalid goalTitle");
    expect(validateCoachPayload({ tasks: ["Walk"], tone: "hype" })).toBe("Invalid tone");
  });

  it("sanitizeCoach keeps positions, truncates to the tasks sent and cleans each line; isValidCoach needs one full entry", () => {
    const payload = { tasks: ["Walk", "Read"] };
    const result = {
      notes: [
        { start: "Visit https://spam.io now", momentum: "Keep\ngoing", extra: "junk" },
        { start: "", momentum: "x" },
        { start: "third", momentum: "third" },
      ],
    };
    expect(sanitizeCoach(result, payload)).toEqual({
      notes: [
        { start: "Visit now", momentum: "Keep going" },
        { start: "", momentum: "x" },
      ],
    });
    expect(isValidCoach(result)).toBe(true);
    expect(isValidCoach({ notes: [{ start: "www.a.com", momentum: "ok" }] })).toBe(false);
    expect(isValidCoach({ notes: [] })).toBe(false);
    expect(isValidCoach({ other: 1 })).toBe(false);
  });

  it("the prompt lists the trimmed tasks in order, the goal and the tone (calm by default)", () => {
    const prompt = buildCoachPrompt({ tasks: [" Walk ", "Read"], goalTitle: "Run a 5K", tone: "direct" });
    expect(prompt).toContain("1. Walk\n2. Read");
    expect(prompt).toContain("Run a 5K");
    expect(prompt).toContain("Voice: direct");
    expect(prompt).toContain("exactly 2 entries");
    expect(buildCoachPrompt({ tasks: ["Walk"] })).toContain("Voice: calm");
  });
});
