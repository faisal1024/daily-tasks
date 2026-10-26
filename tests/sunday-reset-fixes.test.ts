// PR #110 review fixes (1.6 H) for the pure parts and the Worker: the merged
// brain-dump sanitize (1.6 F dates stay on their own items once saved items
// are filtered out), code-point lengths for `saved`, the sort's timeout,
// 1.6 F's saved order and dates in the reset, Saved for later's cap, the
// done screen's words, and the Sunday 6 PM notification on the US
// fall-back day.
import { describe, expect, it, vi } from "vitest";

import { requestBrainDump } from "../lib/daily-tasks/ai-helpers";
import { MomentumAiError } from "../lib/daily-tasks/ai-status";
import { toDateKey } from "../lib/daily-tasks/date";
import type { ReminderContext } from "../lib/daily-tasks/reminder-plan";
import {
  DEFAULT_SUNDAY_RESET,
  defaultPicks,
  doneLine,
  fitSaved,
  localWeekSort,
  nextDayCandidates,
  overflowLine,
  savedForReset,
  sortWeek,
  sundayResetReminder,
  WEEK_SORT_TIMEOUT_MS,
} from "../lib/daily-tasks/sunday-reset";
import { DEFAULT_NOTIFICATIONS, MAX_PARKED_TASKS, type ParkedTask } from "../lib/daily-tasks/types";
import { sanitizeBrainDump, validateBrainDumpPayload } from "../server/providers/helpers-contract.mjs";

const SUNDAY = "2026-10-25";
const MONDAY = "2026-10-26";

describe("the merged sanitize: dates stay on their own items", () => {
  it("filters saved items out of parked after dating, so a later item keeps its own date", () => {
    const payload = {
      text: "Renew passport\nSend the deck for Tuesday\nBook dentist on Friday",
      openSlots: 3,
      goalTitle: null,
      today: SUNDAY,
      saved: ["Renew passport"],
    };
    const clean = sanitizeBrainDump(
      {
        picks: [{ text: "Send the deck for Tuesday", reason: "Due soon", when: { date: "2026-10-27", kind: "on" } }],
        parked: [
          { text: "Renew passport", when: null },
          { text: "Book dentist on Friday", when: { date: "2026-10-30", kind: "on" } },
        ],
      },
      payload,
    );
    expect(clean.picks).toEqual([{ text: "Send the deck for Tuesday", reason: "Due soon", when: { date: "2026-10-27", kind: "on" } }]);
    expect(clean.parked).toEqual([{ text: "Book dentist on Friday", when: { date: "2026-10-30", kind: "on" } }]);
  });

  it("a saved item copied exactly but over 64 characters is not parked again", () => {
    const long = "Call the electric company about the strange charge on last month's bill";
    const clean = sanitizeBrainDump(
      { picks: [{ text: "Finish report" }], parked: [{ text: long }, { text: "Buy shoes" }] },
      { text: "finish report\nbuy shoes", openSlots: 3, goalTitle: null, saved: [long] },
    );
    expect(clean.parked).toEqual([{ text: "Buy shoes" }]);
  });
});

describe("saved: lengths in whole characters, as the app counts them", () => {
  it("accepts 120 emoji (240 UTF-16 units) and refuses 121", () => {
    const base = { text: "walk", openSlots: 3, goalTitle: null };
    expect(validateBrainDumpPayload({ ...base, saved: ["😀".repeat(120)] })).toBeNull();
    expect(validateBrainDumpPayload({ ...base, saved: ["😀".repeat(121)] })).toBe("Invalid saved");
  });

  it("the app cuts a long saved title to 120 whole characters, so it's never refused", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ picks: [{ text: "Walk" }], parked: [] }), { status: 200 });
    });
    await requestBrainDump({
      text: "walk",
      openSlots: 3,
      goalTitle: null,
      saved: ["😀".repeat(130)],
      planUrl: "https://proxy.test/api/momentum/plan",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const saved = body.saved as string[];
    expect(Array.from(saved[0])).toHaveLength(120);
    expect(validateBrainDumpPayload({ text: "walk", openSlots: 3, goalTitle: null, saved })).toBeNull();
  });
});

describe("the sort's timeout", () => {
  it("requestBrainDump gives up after timeoutMs with a timeout error", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const call = requestBrainDump({
      text: "walk",
      openSlots: 3,
      goalTitle: null,
      timeoutMs: 20,
      planUrl: "https://proxy.test/api/momentum/plan",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(call).rejects.toBeInstanceOf(MomentumAiError);
    await expect(call).rejects.toMatchObject({ kind: "timeout" });
  });

  it("sortWeek passes the timeout and today on, and falls back to the simple split when it fires", async () => {
    const request = vi.fn(async () => {
      throw new MomentumAiError("timeout", "AI request timed out.");
    });
    const sort = await sortWeek(
      { dump: "mow lawn", saved: [], forDay: "Monday", goalTitle: null, useAi: true, today: SUNDAY, timeoutMs: WEEK_SORT_TIMEOUT_MS },
      request,
    );
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 12_000, today: SUNDAY }));
    expect(sort).toEqual(localWeekSort("mow lawn", []));
  });

  it("keeps the AI's dates (1.6 F) for parkTasks, keyed as it looks them up", async () => {
    const dates = { "send the deck for tuesday": { date: "2026-10-27", kind: "on" as const } };
    const request = vi.fn(async () => ({ picks: ["Send the deck for Tuesday"], parked: [], source: "ai" as const, dates }));
    const sort = await sortWeek({ dump: "send the deck for tuesday", saved: [], forDay: "Monday", goalTitle: null, useAi: true, today: SUNDAY }, request);
    expect(sort.dates).toEqual(dates);
  });
});

const item = (id: string, text: string, when?: ParkedTask["when"], day = 20): ParkedTask => ({
  id,
  text,
  parkedAt: new Date(2026, 9, day, 9, 0).toISOString(),
  ...(when ? { when } : {}),
});

describe("1.6 F's dates in the reset", () => {
  const parked = [
    item("a", "Oldest thing", undefined, 1),
    item("b", "Planned for Thursday", { date: "2026-10-29", kind: "on" }),
    item("c", "Deck for Monday", { date: MONDAY, kind: "on" }),
    item("d", "Taxes due today", { date: SUNDAY, kind: "by" }),
    item("e", "Newest thing", undefined, 24),
  ];

  it("sends the AI the saved items in resurfacing order (due Monday, due today, then oldest first)", () => {
    const { order, dueOnTarget, later } = savedForReset(parked, SUNDAY, MONDAY);
    expect(order).toEqual(["Deck for Monday", "Taxes due today", "Oldest thing", "Planned for Thursday", "Newest thing"]);
    expect(dueOnTarget).toEqual(["Deck for Monday"]);
    expect(later).toEqual(["Planned for Thursday"]);
  });

  it("items due Monday lead and are ticked; one planned on a later day is never ticked by default", async () => {
    const { order, dueOnTarget, later } = savedForReset(parked, SUNDAY, MONDAY);
    const request = vi.fn(async () => ({ picks: ["Planned for Thursday", "Mow the lawn"], parked: [], source: "ai" as const }));
    const sort = await sortWeek({ dump: "mow the lawn", saved: order, forDay: "Monday", goalTitle: null, useAi: true, notByDefault: later }, request);
    expect(sort.suggested).toEqual(["Mow the lawn"]);
    const list = nextDayCandidates({ dueOnTarget, suggested: sort.suggested, dumpItems: sort.dumpItems, saved: parked.map((p) => p.text), existingDraft: [] });
    expect(list[0]).toBe("Deck for Monday");
    expect(list).toContain("Planned for Thursday");
    expect(defaultPicks({ dueOnTarget, suggested: sort.suggested, existingDraft: [] })).toEqual(["Deck for Monday", "Mow the lawn"]);
    expect(localWeekSort("", order, later).suggested).not.toContain("Planned for Thursday");
  });

  it("reopened after finishing, its own draft is ticked and listed first", () => {
    expect(defaultPicks({ ownDraft: ["A", "B"], dueOnTarget: ["C"], suggested: ["D"], existingDraft: [] })).toEqual(["A", "B"]);
    expect(nextDayCandidates({ ownDraft: ["A"], dueOnTarget: ["C"], suggested: ["D"], dumpItems: [], saved: [], existingDraft: [] })).toEqual(["A", "C", "D"]);
  });
});

describe("Saved for later's cap", () => {
  it("only what fits, never pushing the oldest out; items already saved take no room", () => {
    const full = Array.from({ length: MAX_PARKED_TASKS - 2 }, (_, i) => ({ text: `old ${i}` }));
    expect(fitSaved(["old 3", "new a", "new b", "new c", "new d"], full)).toEqual({ fits: ["new a", "new b"], overflow: 2 });
    expect(fitSaved(["x"], Array.from({ length: MAX_PARKED_TASKS }, (_, i) => ({ text: `o${i}` })))).toEqual({ fits: [], overflow: 1 });
    expect(overflowLine(2)).toBe("2 didn't fit. Saved for later is full.");
  });
});

describe("the done screen", () => {
  it("says what happened, calmly", () => {
    expect(doneLine({ weekday: "Monday", picked: 2, added: 3 })).toBe(
      "Monday's plan will be waiting in the morning. Everything else stays in Saved for later.",
    );
    expect(doneLine({ weekday: "Monday", picked: 0, added: 3 })).toBe("Everything you added is in Saved for later.");
    expect(doneLine({ weekday: "Monday", picked: 0, added: 0 })).toBe("You're all set for the week.");
  });
});

describe("the Sunday notification on the US fall-back day (Sunday 1 Nov 2026)", () => {
  const context = (now: Date, over: Partial<ReminderContext> = {}): ReminderContext => ({
    now,
    today: toDateKey(now),
    settings: DEFAULT_NOTIFICATIONS,
    permissionState: "granted",
    tasks: [],
    locked: false,
    yesterdayOpen: [],
    draft: null,
    pending: [],
    lastDeliveredAt: null,
    plus: true,
    sundayReset: DEFAULT_SUNDAY_RESET,
    ...over,
  });

  it("is at 6 PM local that day, and the week after once it has gone", () => {
    const morning = sundayResetReminder(context(new Date(2026, 10, 1, 9, 0)));
    expect(morning?.fireAt).toEqual(new Date(2026, 10, 1, 18, 0));
    expect(morning?.fireAt.getHours()).toBe(18);
    expect(morning?.id).toBe("daily-tasks:2026-11-01:sunday_reset:1800");
    expect(sundayResetReminder(context(new Date(2026, 10, 1, 18, 0)))?.fireAt).toEqual(new Date(2026, 10, 8, 18, 0));
  });

  it("finished that afternoon, it moves to the next Sunday instead of none", () => {
    const done = { ...DEFAULT_SUNDAY_RESET, doneWeek: "2026-11-01" };
    expect(sundayResetReminder(context(new Date(2026, 10, 1, 15, 0), { sundayReset: done }))?.fireAt).toEqual(
      new Date(2026, 10, 8, 18, 0),
    );
  });
});
