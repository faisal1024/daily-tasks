// Brain dump + break-it-down client: the proxy's output is untrusted, so the
// parsers must survive hostile or sloppy responses.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BRAIN_DUMP_CHARS,
  MAX_PARKED,
  MAX_STEPS,
  MAX_STEP_TEXT,
  MAX_TASK_TEXT,
  FREE_LIMIT_NOTICE,
  cleanTaskText,
  localBrainDump,
  parseBrainDumpResponse,
  parseBreakDownResponse,
  requestBrainDump,
  requestBreakDown,
  sortBrainDump,
  tidyDumpLine,
} from "../lib/daily-tasks/ai-helpers";
import { PROXY_SECRET_HEADER } from "../lib/daily-tasks/ai-client";
import {
  MomentumAiError,
  aiFailureMessage,
  breakDownFailureMessage,
  type AiFailureKind,
} from "../lib/daily-tasks/ai-status";

const PLAN_URL = "https://proxy.test/api/momentum/plan";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cleanTaskText", () => {
  it("rejects non-strings and blank text", () => {
    for (const value of [undefined, null, 5, {}, [], "", "   ", "\n\t", "- ", "1.", "[ ]"]) {
      expect(cleanTaskText(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("strips one leading list marker and collapses whitespace", () => {
    expect(cleanTaskText("- call mum")).toBe("Call mum");
    expect(cleanTaskText("* call mum")).toBe("Call mum");
    expect(cleanTaskText("• call mum")).toBe("Call mum");
    expect(cleanTaskText("· call mum")).toBe("Call mum");
    expect(cleanTaskText("1. call mum")).toBe("Call mum");
    expect(cleanTaskText("12) call mum")).toBe("Call mum");
    expect(cleanTaskText("[ ] call mum")).toBe("Call mum");
    expect(cleanTaskText("[] call mum")).toBe("Call mum");
    expect(cleanTaskText("   call \n\t  mum   ")).toBe("Call mum");
  });

  it("strips stacked markers like '- [ ] call mum'", () => {
    expect(cleanTaskText("- [ ] call mum")).toBe("Call mum");
    expect(cleanTaskText("1. [x] call mum")).toBe("Call mum");
    expect(cleanTaskText("* 2) call mum")).toBe("Call mum");
  });

  it("never cuts an emoji in half when truncating", () => {
    const out = cleanTaskText(`${"a".repeat(8)}🎉🎉🎉🎉`, 10) ?? "";
    expect(out).toBe(`A${"a".repeat(7)}🎉…`);
    expect(Array.from(out)).toHaveLength(10);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("capitalizes the first letter only", () => {
    expect(cleanTaskText("book dentist")).toBe("Book dentist");
    expect(cleanTaskText("Email Sam about API")).toBe("Email Sam about API");
    expect(cleanTaskText("éclairs for mum")).toBe("Éclairs for mum");
    expect(cleanTaskText("🎉 party")).toBe("🎉 party");
  });

  it("caps length with an ellipsis, never exceeding the max", () => {
    const long = "a".repeat(200);
    const out = cleanTaskText(long) ?? "";
    expect(out.length).toBe(MAX_TASK_TEXT);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("A")).toBe(true);
    expect(cleanTaskText("x".repeat(MAX_TASK_TEXT))).toBe(`X${"x".repeat(MAX_TASK_TEXT - 1)}`);
    expect((cleanTaskText("word ".repeat(40), 20) ?? "").length).toBeLessThanOrEqual(20);
  });

  // Regression (fixed in 0420e91): a leading decimal isn't a list marker.
  it("keeps a leading decimal number that isn't a list marker", () => {
    expect(cleanTaskText("1.5 mile walk")).toBe("1.5 mile walk");
  });
});

describe("localBrainDump", () => {
  it("splits on newlines, semicolons and bullets; picks the first open slots and parks the rest", () => {
    const result = localBrainDump("- call mum\r\nfinish report; buy shoes • water plants\n\n", 2);
    expect(result).toEqual({
      picks: ["Call mum", "Finish report"],
      parked: ["Buy shoes", "Water plants"],
      source: "local",
    });
  });

  it("de-duplicates case-insensitively across picks and parked", () => {
    const result = localBrainDump("Call mum\ncall MUM\n- call mum\nBuy shoes\nbuy shoes", 3);
    expect(result.picks).toEqual(["Call mum", "Buy shoes"]);
    expect(result.parked).toEqual([]);
  });

  it("clamps open slots to 1..3", () => {
    const text = "a\nb\nc\nd\ne";
    expect(localBrainDump(text, 0).picks).toEqual(["A"]);
    expect(localBrainDump(text, -4).picks).toEqual(["A"]);
    expect(localBrainDump(text, 9).picks).toEqual(["A", "B", "C"]);
    expect(localBrainDump(text, 2.9).picks).toEqual(["A", "B"]);
  });

  it("parks at most MAX_PARKED items", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `task ${i}`).join("\n");
    const result = localBrainDump(lines, 3);
    expect(result.picks).toHaveLength(3);
    expect(result.parked).toHaveLength(MAX_PARKED);
    expect(MAX_PARKED).toBe(20);
    expect(result.parked[0]).toBe("Task 3");
  });

  it("returns nothing for whitespace-only input", () => {
    expect(localBrainDump(" \n ; • ", 3)).toEqual({ picks: [], parked: [], source: "local" });
  });
});

describe("tidyDumpLine", () => {
  it.each([
    ["I need to call mum", "call mum"],
    ["need to call mum", "call mum"],
    ["We really need to talk", "talk"],
    ["have to renew passport", "renew passport"],
    ["gotta buy milk", "buy milk"],
    ["I gotta buy milk", "buy milk"],
    ["should email Sam", "email Sam"],
    ["must pay rent!", "pay rent"],
    ["want to learn piano", "learn piano"],
    ["remember to water plants", "water plants"],
    ["Please remember to water plants", "water plants"],
    ["don't forget to book dentist", "book dentist"],
    ["dont forget to book dentist", "book dentist"],
    ["do not forget to book dentist", "book dentist"],
    ["todo: file taxes", "file taxes"],
    ["TODO: file taxes", "file taxes"],
    ["To-do: file taxes", "file taxes"],
    ["to do : file taxes", "file taxes"],
    ["Reminder: dentist at 3?", "dentist at 3?"],
    ["Task: pay rent", "pay rent"],
  ])("strips leading filler: %j → %j", (line, expected) => {
    expect(tidyDumpLine(line)).toBe(expected);
  });

  it.each([
    ["and need to call mum", "call mum"],
    ["also gotta buy milk", "buy milk"],
    ["then I have to email Sam", "email Sam"],
    ["Oh I need to remember to call mum", "call mum"],
    ["ok need to fix bike", "fix bike"],
    ["okay need to fix bike", "fix bike"],
  ])("strips a lead-in plus filler (up to two layers): %j → %j", (line, expected) => {
    expect(tidyDumpLine(line)).toBe(expected);
  });

  it.each([
    "Call mum, need to ask about dinner",
    "Tell Sam I need to leave early",
    "Ask why we have to pay twice",
    "Buy milk and should check eggs",
  ])("never strips filler from the middle of a line: %j", (line) => {
    expect(tidyDumpLine(line)).toBe(line);
  });

  it.each([
    "Must-see list",
    "Musty basement smell",
    "Shoulder physio",
    "Needle and thread",
    "Havoc cleanup",
    "Tasks for the team",
    "Have to-do list ready",
  ])("leaves words that only start like filler alone: %j", (line) => {
    expect(tidyDumpLine(line)).toBe(line);
  });

  it.each([
    ["need to", "need to"],
    ["I need to", "I need to"],
    ["gotta", "gotta"],
    ["Must", "Must"],
    ["I should", "I should"],
    ["need to.", "need to"],
    ["don't forget to!", "don't forget to"],
  ])("a line that is only filler keeps its words: %j → %j", (line, expected) => {
    expect(tidyDumpLine(line)).toBe(expected);
  });

  it("drops trailing punctuation and collapses whitespace", () => {
    expect(tidyDumpLine("  also   gotta   buy   milk ...  ")).toBe("buy milk");
    expect(tidyDumpLine("Finish report!!!")).toBe("Finish report");
    expect(tidyDumpLine("Plan trip…")).toBe("Plan trip");
    expect(tidyDumpLine("Email re: Q3;")).toBe("Email re: Q3");
    // Only trailing: inner punctuation and closing brackets stay.
    expect(tidyDumpLine("Call Dr. Lee (dentist)")).toBe("Call Dr. Lee (dentist)");
  });

  it("keeps emoji, including one right before trailing punctuation", () => {
    expect(tidyDumpLine("I need to call mum 📞!!")).toBe("call mum 📞");
    expect(tidyDumpLine("🎉 party prep")).toBe("🎉 party prep");
    expect(tidyDumpLine("need to 🛒 groceries")).toBe("🛒 groceries");
    expect(tidyDumpLine("🧺")).toBe("🧺");
  });

  it("returns an empty string only for blank or punctuation-only input", () => {
    expect(tidyDumpLine("")).toBe("");
    expect(tidyDumpLine("   ")).toBe("");
    expect(tidyDumpLine("!!!")).toBe("");
  });

  it("strips a label with no space after the colon (todo:x)", () => {
    expect(tidyDumpLine("todo:call mum")).toBe("call mum");
  });

  it("keeps questions whole: a question is never turned into a statement", () => {
    expect(tidyDumpLine("Should I quit?")).toBe("Should I quit?");
    expect(tidyDumpLine("Should we move the meeting?")).toBe("Should we move the meeting?");
    expect(tidyDumpLine("Need to ask Sam about Friday?")).toBe("Need to ask Sam about Friday?");
  });

  it("keeps should/must before a pronoun, and bare 'got to' (it's often a fact)", () => {
    expect(tidyDumpLine("Must it be today")).toBe("Must it be today");
    expect(tidyDumpLine("Got to the gym by 7")).toBe("Got to the gym by 7");
    expect(tidyDumpLine("I've got to finish the deck")).toBe("finish the deck");
  });

  it("matches the curly apostrophe iOS types, and stacked lead-ins", () => {
    expect(tidyDumpLine("Don’t forget to pay rent!")).toBe("pay rent");
    expect(tidyDumpLine("Oh, I need to email Sam")).toBe("email Sam");
    expect(tidyDumpLine("And then need to walk")).toBe("walk");
  });
});

describe("localBrainDump tidying", () => {
  it("tidies each line and capitalizes what's left", () => {
    const result = localBrainDump("I need to call mum\ngotta buy milk.\nremember to water plants!", 3);
    expect(result.picks).toEqual(["Call mum", "Buy milk", "Water plants"]);
  });

  it("keeps mid-sentence filler on a multi-line dump (no comma split there)", () => {
    const result = localBrainDump("Call mum, need to ask about dinner\nbuy milk", 3);
    expect(result.picks).toEqual(["Call mum, need to ask about dinner", "Buy milk"]);
  });

  it("splits a one-line comma list and tidies every part", () => {
    const result = localBrainDump("I need to call mum, dentist, gotta buy groceries.", 5);
    expect(result.picks).toEqual(["Call mum", "Dentist", "Buy groceries"]);
  });

  it("tidies before the comma check, so a lead-in doesn't block the list split", () => {
    expect(localBrainDump("todo: report, dentist", 3).picks).toEqual(["Report", "Dentist"]);
  });

  it("merges lines that only differed by filler, case or punctuation", () => {
    const result = localBrainDump("need to call mum\ncall mum.\nCall Mum!\nI have to CALL MUM", 5);
    expect(result).toEqual({ picks: ["Call mum"], parked: [], source: "local" });
  });

  it("a filler-only line keeps its words (capitalized), never vanishing", () => {
    expect(localBrainDump("need to\nbuy milk", 3).picks).toEqual(["Need to", "Buy milk"]);
  });

  it("drops punctuation-only lines", () => {
    expect(localBrainDump("!!!\n...\ncall mum", 3).picks).toEqual(["Call mum"]);
  });

  it("keeps emoji through tidy and capitalization", () => {
    expect(localBrainDump("need to 🛒 groceries\n📞 mum!", 3).picks).toEqual(["🛒 groceries", "📞 mum"]);
  });

  it("tidies lines split on the bullet character", () => {
    expect(localBrainDump("• need to call mum • gotta buy milk", 3).picks).toEqual(["Call mum", "Buy milk"]);
  });

  // P2 bug: tidyDumpLine runs before cleanTaskText strips list markers, so a
  // "- ", "* ", "1. " or "[ ] " line keeps its filler ("Need to call mum") and
  // isn't merged with the same task typed without a marker. Remove `.fails`
  // once markers are stripped before tidying.
  it("strips list markers and filler together", () => {
    expect(localBrainDump("- need to call mum\n1. gotta buy milk\n[ ] must pay rent", 3).picks).toEqual([
      "Call mum",
      "Buy milk",
      "Pay rent",
    ]);
  });
});

describe("parseBrainDumpResponse", () => {
  it("normalizes objects or strings, caps picks at the open slots, and moves the overflow nowhere", () => {
    const result = parseBrainDumpResponse(
      {
        picks: [{ text: "finish report", reason: "due" }, "call mum", { text: "Extra pick" }],
        parked: [{ text: "buy shoes" }, "water plants"],
      },
      2,
    );
    expect(result).toEqual({
      picks: ["Finish report", "Call mum"],
      parked: ["Buy shoes", "Water plants"],
      source: "ai",
    });
  });

  it("drops parked items that duplicate a pick, and duplicate picks", () => {
    const result = parseBrainDumpResponse(
      { picks: ["Call mum", "call mum", "Buy shoes"], parked: ["CALL MUM", "buy shoes", "Walk"] },
      3,
    );
    expect(result.picks).toEqual(["Call mum", "Buy shoes"]);
    expect(result.parked).toEqual(["Walk"]);
  });

  it("survives hostile entries without throwing on the usable ones", () => {
    const result = parseBrainDumpResponse(
      {
        picks: [null, 7, { text: 7 }, { text: { nested: true } }, [], { text: "   " }, { text: "Walk" }],
        parked: "not an array",
      },
      3,
    );
    expect(result).toEqual({ picks: ["Walk"], parked: [], source: "ai" });
  });

  it("caps text length and the number of parked items", () => {
    const result = parseBrainDumpResponse(
      {
        picks: [{ text: "p".repeat(500) }],
        parked: Array.from({ length: 50 }, (_, i) => ({ text: `item ${i}` })),
      },
      1,
    );
    expect(result.picks[0].length).toBe(MAX_TASK_TEXT);
    expect(result.parked).toHaveLength(MAX_PARKED);
  });

  it.each([null, undefined, "picks", 42, [], {}, { picks: [] }, { picks: "a,b" }, { picks: [{ text: "" }] }])(
    "throws invalid_response when nothing usable comes back (%j)",
    (data) => {
      expect(() => parseBrainDumpResponse(data, 3)).toThrow(MomentumAiError);
      try {
        parseBrainDumpResponse(data, 3);
      } catch (error) {
        expect((error as MomentumAiError).kind).toBe("invalid_response");
      }
    },
  );
});

describe("requestBrainDump", () => {
  it("refuses an empty dump", async () => {
    await expect(
      requestBrainDump({ text: "   ", openSlots: 3, goalTitle: null, planUrl: PLAN_URL }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("splits locally without any request when no proxy is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await requestBrainDump({
      text: "a\nb",
      openSlots: 1,
      goalTitle: null,
      planUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ picks: ["A"], parked: ["B"], source: "local" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the configured proxy URL from the env by default", async () => {
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL", PLAN_URL);
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "s3cret");
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ picks: ["Walk"], parked: [] }),
    );
    await requestBrainDump({
      text: "walk",
      openSlots: 1,
      goalTitle: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://proxy.test/api/momentum/brain-dump");
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>)[PROXY_SECRET_HEADER]).toBe(
      "s3cret",
    );
  });

  it("POSTs the trimmed, capped dump with clamped slots to the brain-dump route", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ picks: [{ text: "Walk", reason: "" }], parked: [{ text: "Swim" }] }),
    );
    const text = `  ${"x".repeat(MAX_BRAIN_DUMP_CHARS + 500)}  `;
    const result = await requestBrainDump({
      text,
      openSlots: 7,
      goalTitle: "Run a 5K",
      planUrl: `${PLAN_URL}?v=1`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ picks: ["Walk"], parked: ["Swim"], source: "ai" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://proxy.test/api/momentum/brain-dump?v=1");
    const body = JSON.parse(String(init.body));
    expect(body.text.length).toBe(MAX_BRAIN_DUMP_CHARS);
    expect(body).toMatchObject({ openSlots: 3, goalTitle: "Run a 5K" });
  });

  it("propagates proxy failures as typed errors (the caller falls back)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Too many requests" }, 429));
    await expect(
      requestBrainDump({
        text: "walk",
        openSlots: 1,
        goalTitle: null,
        planUrl: PLAN_URL,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });
});

describe("parseBreakDownResponse", () => {
  it("returns 2-5 cleaned, de-duplicated steps", () => {
    expect(
      parseBreakDownResponse({
        steps: [{ text: "- clear the counter" }, "load dishwasher", { text: "Clear the counter" }],
      }),
    ).toEqual(["Clear the counter", "Load dishwasher"]);
  });

  it("caps at five steps and each step at MAX_STEP_TEXT", () => {
    const steps = parseBreakDownResponse({
      steps: Array.from({ length: 9 }, (_, i) => ({ text: `step ${i} ${"z".repeat(100)}` })),
    });
    expect(steps).toHaveLength(MAX_STEPS);
    for (const step of steps) expect(step.length).toBeLessThanOrEqual(MAX_STEP_TEXT);
  });

  it("stops at five usable steps even when junk comes first", () => {
    const steps = parseBreakDownResponse({
      steps: [null, "", 1, "a", "b", "c", "d", "e", "f"],
    });
    expect(steps).toEqual(["A", "B", "C", "D", "E"]);
  });

  it.each([
    null,
    {},
    { steps: "a\nb\nc" },
    { steps: [] },
    { steps: ["only one"] },
    { steps: ["same", "SAME", " same "] },
    { steps: [{ text: null }, { text: 3 }, { nope: "x" }] },
  ])("throws invalid_response for fewer than two usable steps (%j)", (data) => {
    expect(() => parseBreakDownResponse(data)).toThrow(/too few steps/);
  });
});

describe("requestBreakDown", () => {
  it("is unavailable without a proxy (no offline equivalent) and makes no request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestBreakDown({
        task: "Clean",
        goalTitle: null,
        planUrl: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      requestBreakDown({
        task: "Clean",
        goalTitle: null,
        planUrl: "https://proxy.test/other",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the trimmed task (max 120 chars) and goal to the break-down route", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ steps: ["a", "b", "c"] }),
    );
    const steps = await requestBreakDown({
      task: `  ${"t".repeat(300)}  `,
      goalTitle: "Tidy home",
      planUrl: PLAN_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(steps).toEqual(["A", "B", "C"]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://proxy.test/api/momentum/break-down");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ task: "t".repeat(120), goalTitle: "Tidy home" });
  });

  it("rejects a response with too few steps", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ steps: ["one"] }));
    await expect(
      requestBreakDown({
        task: "Clean",
        goalTitle: null,
        planUrl: PLAN_URL,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("sortBrainDump", () => {
  const params = { text: "a\nb\nc\nd", openSlots: 2, goalTitle: "Goal" };

  it("uses the AI result with no notice when it works", async () => {
    const request = vi.fn(async () => ({ picks: ["X"], parked: ["Y"], source: "ai" as const }));
    await expect(sortBrainDump(params, request)).resolves.toEqual({
      result: { picks: ["X"], parked: ["Y"], source: "ai" },
      notice: null,
    });
    expect(request).toHaveBeenCalledWith(params);
  });

  it("falls back to the local split with a friendly notice when the AI fails", async () => {
    const request = vi.fn(async () => {
      throw new MomentumAiError("busy", "busy");
    });
    const sorted = await sortBrainDump(params, request);
    expect(sorted.result).toEqual({ picks: ["A", "B"], parked: ["C", "D"], source: "local" });
    expect(sorted.notice).toBe(
      "Couldn't reach smart sorting, so here's a simple split you can adjust.",
    );
  });

  it("marks neither fallback nor AI result as the free limit (only the Today screen does)", async () => {
    const ok = await sortBrainDump(params, vi.fn(async () => ({ picks: ["X"], parked: [], source: "ai" as const })));
    expect(ok.freeLimit).toBeUndefined();
    const failed = await sortBrainDump(params, vi.fn(async () => {
      throw new MomentumAiError("busy", "busy");
    }));
    expect(failed.freeLimit).toBeUndefined();
    expect(failed.notice).not.toBe(FREE_LIMIT_NOTICE);
  });

  it("the free-limit notice says it's a simple split and what Plus adds", () => {
    expect(FREE_LIMIT_NOTICE).toMatch(/free AI sorts are used up/);
    expect(FREE_LIMIT_NOTICE).toMatch(/simple split/);
    expect(FREE_LIMIT_NOTICE).toMatch(/Plus/);
  });

  it("falls back even for non-AI errors (never loses what was typed)", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("boom");
    });
    const sorted = await sortBrainDump(params, request);
    expect(sorted.result.source).toBe("local");
    expect(sorted.notice).not.toBeNull();
  });
});

describe("breakDownFailureMessage", () => {
  it("reuses the shared copy for limits and auth", () => {
    expect(breakDownFailureMessage("rate_limited")).toBe(aiFailureMessage("rate_limited"));
    expect(breakDownFailureMessage("unauthorized")).toBe(aiFailureMessage("unauthorized"));
    expect(breakDownFailureMessage("needs_plus")).toBe(aiFailureMessage("needs_plus"));
  });

  it("has step-specific copy for the daily cap", () => {
    expect(breakDownFailureMessage("busy")).toBe(
      "Smart steps are taking a break for today. Try again tomorrow.",
    );
  });

  it.each<AiFailureKind>(["timeout", "network", "unavailable", "invalid_response"])(
    "never talks about ideas for %s",
    (kind) => {
      expect(breakDownFailureMessage(kind)).toBe(
        "Couldn't reach smart steps right now. Try again in a bit.",
      );
    },
  );

  it("never mentions ideas or suggestions for any kind", () => {
    for (const kind of [
      "timeout",
      "rate_limited",
      "busy",
      "unauthorized",
      "network",
      "unavailable",
      "invalid_response",
    ] as AiFailureKind[]) {
      expect(breakDownFailureMessage(kind)).not.toMatch(/ideas|starters/i);
    }
  });
});
