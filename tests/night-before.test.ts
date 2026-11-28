// The night before (1.7): the pure rules. The day boundaries, the evening
// card, the held list (re-sorting keeps ticks; a typed-only dump is split
// for the morning), the morning's order, Save (dated, tagged, never pushing
// anything out), the tag, the sort's fallbacks, the reminder, and loading
// saves. Local-time fixtures: 26 Nov 2026 is a Thursday.
import { describe, expect, it, vi } from "vitest";

import { MomentumAiError } from "../lib/daily-tasks/ai-status";
import {
  addFirstLabel,
  aiCanHoldAll,
  clampReminderMinutes,
  DEFAULT_NIGHT_BEFORE,
  emptyNightList,
  heldLine,
  isFromLastNight,
  letGoLabel,
  letGoQuestion,
  liveNightLists,
  MAX_NIGHT_ITEMS,
  morningList,
  morningOrder,
  NIGHT_AI_MAX_ROWS,
  NIGHT_BEFORE_KIND,
  nightBeforeReminder,
  nightDoneLine,
  nightItemWhen,
  nightSplit,
  nightTarget,
  nightToast,
  normalizeNightBefore,
  normalizeNightList,
  normalizeNightLists,
  saveNightItem,
  showsNightCard,
  sortedSpoken,
  sortNight,
  textAhead,
  withNightList,
  withSortedItems,
  withoutNightItem,
  withTextLines,
} from "../lib/daily-tasks/night-before";
import type { ReminderContext } from "../lib/daily-tasks/reminder-plan";
import { savedItemsView } from "../lib/daily-tasks/resurface";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import {
  DEFAULT_NOTIFICATIONS,
  MAX_PARKED_TASKS,
  type AppState,
  type NightList,
  type ParkedTask,
} from "../lib/daily-tasks/types";

const THU = "2026-11-26";
const FRI = "2026-11-27";
const WED = "2026-11-25";
const AT = "2026-11-27T08:00:00.000Z";

function stateOn(day: string, extra: Partial<AppState> = {}): AppState {
  const [y, m, d] = day.split("-").map(Number);
  return { ...buildInitialState(new Date(y, m - 1, d, 9)), ...extra };
}

const parked = (text: string, extra: Partial<ParkedTask> = {}): ParkedTask => ({
  id: `p_${text}`,
  text,
  parkedAt: "2026-11-20T10:00:00.000Z",
  ...extra,
});

const list = (texts: string[], picked: string[] = [], extra: Partial<NightList> = {}): NightList => ({
  forDay: FRI,
  nightOf: THU,
  text: texts.join("\n"),
  items: texts.map((text, index) => ({ id: `n${index}`, text, picked: picked.includes(text) })),
  source: "local",
  createdAt: "2026-11-26T21:00:00.000Z",
  ...extra,
});

describe("nightTarget: which day a dump plans", () => {
  it.each([
    [17, null],
    [18, { forDate: FRI, nightOf: THU }],
    [23, { forDate: FRI, nightOf: THU }],
    [0, { forDate: THU, nightOf: WED }],
    [3, { forDate: THU, nightOf: WED }],
    [4, null],
  ])("at %i:00 → %j", (hour, expected) => {
    expect(nightTarget(THU, hour)).toEqual(expected);
  });

  it("a closed day opens it early; after midnight it is still last night", () => {
    expect(nightTarget(THU, 15, true)).toEqual({ forDate: FRI, nightOf: THU });
    expect(nightTarget(THU, 2, true)).toEqual({ forDate: THU, nightOf: WED });
  });
});

describe("the evening card", () => {
  const target = { forDate: FRI, nightOf: THU };
  const base = {
    target,
    today: THU,
    record: DEFAULT_NIGHT_BEFORE,
    lists: [] as NightList[],
    firstRunActive: false,
    sundayCardShowing: false,
  };

  it("prompts, then says 'Kept till morning' once something is held (even half-typed)", () => {
    expect(showsNightCard(base)).toBe("prompt");
    expect(showsNightCard({ ...base, lists: [list(["Call the dentist"])] })).toBe("held");
    expect(showsNightCard({ ...base, lists: [{ ...list([]), text: "call the den" }] })).toBe("held");
    // An empty list, or this morning's (still undecided), is no list for tonight.
    expect(showsNightCard({ ...base, lists: [list([])] })).toBe("prompt");
    expect(showsNightCard({ ...base, lists: [list(["Old"], [], { forDay: THU, nightOf: WED })] })).toBe("prompt");
  });

  it("hides once closed for the night, outside the evening, in first run, under the Sunday reset", () => {
    expect(showsNightCard({ ...base, record: { ...DEFAULT_NIGHT_BEFORE, dismissedFor: THU } })).toBeNull();
    expect(showsNightCard({ ...base, record: { ...DEFAULT_NIGHT_BEFORE, dismissedFor: WED } })).toBe("prompt");
    expect(showsNightCard({ ...base, target: null })).toBeNull();
    expect(showsNightCard({ ...base, firstRunActive: true })).toBeNull();
    expect(showsNightCard({ ...base, sundayCardShowing: true })).toBeNull();
  });

  it("after midnight a held list is the morning card's, not this one", () => {
    const late = { ...base, today: FRI, target: { forDate: FRI, nightOf: THU } };
    expect(showsNightCard({ ...late, lists: [list(["Call the dentist"])] })).toBeNull();
    // A typed-only list is the morning card's too (it's split for it).
    expect(showsNightCard({ ...late, lists: [{ ...list([]), text: "Call the dentist" }] })).toBeNull();
    expect(showsNightCard(late)).toBe("prompt");
  });
});

describe("the held list", () => {
  it("re-sorting keeps what was ticked first (and its id); new rows start unticked", () => {
    const before = list(["Call the dentist", "Buy milk"], ["Buy milk"]);
    const after = withSortedItems(before, { items: ["buy milk", "Email Sam"], source: "ai" }, "buy milk\nEmail Sam", (i) => `new${i}`);
    expect(after.items).toEqual([
      { id: "n1", text: "Buy milk", picked: true },
      { id: "new1", text: "Email Sam", picked: false },
    ]);
    expect(after.source).toBe("ai");
    expect(after.sortedText).toBe("buy milk\nEmail Sam");
    expect(textAhead(after)).toBe(true);
    expect(textAhead({ ...after, text: "buy milk\nEmail Sam" })).toBe(false);
  });

  it("words added after the list was made (Edit, then closed) become rows; nothing typed is lost", () => {
    // The AI reworded the first two lines: they aren't added again.
    const made = {
      ...list(["Call the dentist", "Buy milk"], ["Buy milk"]),
      text: "dentist\nmilk",
      sortedText: "dentist\nmilk",
    };
    const edited = { ...made, text: "dentist\nmilk\nCall mum" };
    const merged = withTextLines(edited);
    expect(merged.items.map((item) => [item.text, item.picked])).toEqual([
      ["Call the dentist", false],
      ["Buy milk", true],
      ["Call mum", false],
    ]);
    expect(merged.items.slice(0, 2).map((item) => item.id)).toEqual(["n0", "n1"]);
    expect(textAhead(merged)).toBe(false);
    expect(withTextLines(merged)).toBe(merged);
    // The morning card shows it, with the same id the store will use.
    expect(morningList([edited], FRI)?.items[2]).toEqual(merged.items[2]);
    // A list from before sortedText counts as made from its words.
    expect(withTextLines(list(["A"]))).toEqual(list(["A"]));
  });

  it("a long dump keeps every line (not the brain dump's 23), up to what the dump can hold", () => {
    const lines = Array.from({ length: 45 }, (_, i) => `Thing ${i + 1}`);
    expect(nightSplit(lines.join("\n"))).toHaveLength(45);
    // The most lines a full dump can have (one letter each) all fit.
    const tiny = Array.from({ length: MAX_NIGHT_ITEMS }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("\n");
    expect(nightSplit(tiny)).toHaveLength(MAX_NIGHT_ITEMS);
  });

  it("holds two lists, one per day: tonight's never replaces this morning's", () => {
    const morning = list(["Old"], [], { forDay: THU, nightOf: WED });
    const tonight = list(["New"]);
    const both = withNightList([morning], tonight);
    expect(both.map((l) => l.forDay)).toEqual([THU, FRI]);
    expect(withNightList(both, { ...tonight, text: "New\nMore" }).find((l) => l.forDay === THU)).toBe(morning);
    // A third day pushes out the oldest.
    expect(withNightList(both, list(["Later"], [], { forDay: "2026-11-28" })).map((l) => l.forDay)).toEqual([FRI, "2026-11-28"]);
  });

  it("a typed-only dump (never made a list, or the app was killed) is split for the morning, with stable ids", () => {
    const typed = { ...list([]), text: "Call the dentist\nBuy milk" };
    const split = withTextLines(typed);
    expect(split.items.map((item) => item.text)).toEqual(["Call the dentist", "Buy milk"]);
    expect(withTextLines(typed).items.map((item) => item.id)).toEqual(split.items.map((item) => item.id));
    expect(morningList([typed], FRI)?.items).toHaveLength(2);
    expect(morningList([typed], THU)).toBeNull();
    expect(morningList([list([])], FRI)).toBeNull();
  });

  it("in the morning, the ones ticked first lead, each group as written", () => {
    const rows = morningOrder(list(["A", "B", "C", "D"], ["C", "A"]).items).map((item) => item.text);
    expect(rows).toEqual(["A", "C", "B", "D"]);
  });

  it("is let go once its day has ended (tonight's stays)", () => {
    const lists = [list(["A"]), list(["B"], [], { forDay: "2026-11-28", nightOf: FRI })];
    expect(liveNightLists(lists, FRI)).toBe(lists);
    expect(liveNightLists(lists, "2026-11-28")?.map((l) => l.forDay)).toEqual(["2026-11-28"]);
    expect(liveNightLists(undefined, FRI)).toBeUndefined();
  });

  it("an empty list starts for the night being planned", () => {
    expect(emptyNightList({ forDate: FRI, nightOf: THU }, AT)).toEqual({
      forDay: FRI,
      nightOf: THU,
      text: "",
      items: [],
      source: "local",
      createdAt: AT,
    });
  });
});

describe("Save in the morning", () => {
  it("files the row in Saved for later, tagged for its day, and takes it off the list", () => {
    const state = stateOn(FRI, { nightLists: [list(["Call the dentist", "Buy milk"])] });
    const next = saveNightItem(state, FRI, "n0", AT, FRI);
    expect(next.parkedTasks).toEqual([expect.objectContaining({ text: "Call the dentist", nightFor: FRI })]);
    expect(next.parkedTasks[0].when).toBeUndefined();
    expect(next.nightLists?.[0].items.map((item) => item.text)).toEqual(["Buy milk"]);
    expect(next.nightLists?.[0].taken).toBe(1);
    // The last row gone: nothing is left to decide.
    expect(saveNightItem(next, FRI, "n1", AT, FRI).nightLists).toEqual([]);
  });

  it("keeps a date its words (or the AI) gave, read against the evening it was written", () => {
    const withDates = list(["Dentist on Monday", "Report"], [], { dates: { report: { kind: "by", date: "2026-12-01" } } });
    const state = stateOn(FRI, { nightLists: [withDates] });
    expect(nightItemWhen(withDates, "Dentist on Monday", FRI)).toEqual({ kind: "on", date: "2026-11-30" });
    const next = saveNightItem(saveNightItem(state, FRI, "n0", AT, FRI), FRI, "n1", AT, FRI);
    expect(next.parkedTasks.map((item) => item.when)).toEqual([
      { kind: "on", date: "2026-11-30" },
      { kind: "by", date: "2026-12-01" },
    ]);
    // "tonight" was last night: no date that has passed.
    expect(nightItemWhen(list(["Call mum tonight"]), "Call mum tonight", FRI)).toBeNull();
  });

  it("an item already saved gets the tag instead of a copy", () => {
    const state = stateOn(FRI, { parkedTasks: [parked("buy milk")], nightLists: [list(["Buy milk"])] });
    const next = saveNightItem(state, FRI, "n0", AT, FRI);
    expect(next.parkedTasks).toEqual([expect.objectContaining({ id: "p_buy milk", nightFor: FRI })]);
  });

  it("never pushes an old item out: with Saved for later full, nothing changes", () => {
    const full = Array.from({ length: MAX_PARKED_TASKS }, (_, i) => parked(`Old ${i}`));
    const state = stateOn(FRI, { parkedTasks: full, nightLists: [list(["New"])] });
    expect(saveNightItem(state, FRI, "n0", AT, FRI)).toBe(state);
  });

  it("withoutNightItem on a row that isn't there changes nothing", () => {
    const state = stateOn(FRI, { nightLists: [list(["A"])] });
    expect(withoutNightItem(state, FRI, "missing")).toBe(state);
  });
});

describe("the tag", () => {
  it("shows only on the day it was for", () => {
    expect(isFromLastNight(FRI, FRI)).toBe(true);
    expect(isFromLastNight(FRI, THU)).toBe(false);
    expect(isFromLastNight(FRI, "2026-11-28")).toBe(false);
    expect(isFromLastNight(undefined, FRI)).toBe(false);
  });

  it("Saved for later marks it that day only", () => {
    const items = [parked("Buy milk", { nightFor: FRI })];
    expect(savedItemsView(items, FRI)[0].fromLastNight).toBe(true);
    expect(savedItemsView(items, "2026-11-28")[0].fromLastNight).toBeUndefined();
  });
});

describe("the words", () => {
  it("card, done line, toast, spoken", () => {
    expect(heldLine(list(["A", "B", "C"], ["B"]))).toBe("3 items, 1 marked first");
    expect(heldLine(list(["A"]))).toBe("1 item");
    // Typed words count as rows already.
    expect(heldLine({ ...list([]), text: "half" })).toBe("1 item");
    expect(heldLine({ ...list([]), text: "  " })).toBe("Half-written. Open the list to finish it.");
    expect(nightDoneLine(list(["A", "B", "C", "D", "E", "F"], ["A", "B"]), "tomorrow")).toBe(
      "6 items kept till morning, 2 marked first. In the morning, add what you want to Today or save it for later. The rest is let go.",
    );
    expect(nightToast("tomorrow")).toBe("Your list is waiting for the morning.");
    expect(sortedSpoken(list(["A", "B"]).items)).toBe("2 items. None ticked yet.");
    expect(letGoLabel(list(["A", "B", "C", "D", "E", "F"]))).toBe("Let all 6 go");
    expect(letGoLabel({ ...list(["A"]), taken: 2 })).toBe("Let the rest go");
    expect(letGoQuestion(3)).toBe("Let 3 go?");
    expect(addFirstLabel(2)).toBe("Add the 2 marked first");
    expect(addFirstLabel(1)).toBe("Add the one marked first");
  });
});

describe("sortNight", () => {
  it("the simple split without the AI, the AI's three first otherwise", async () => {
    const local = await sortNight({ dump: "Call the dentist\nBuy milk", goalTitle: null, useAi: false });
    const long = await sortNight({ dump: Array.from({ length: 30 }, (_, i) => `Thing ${i}`).join("\n"), goalTitle: null, useAi: false });
    expect(long.items).toHaveLength(30);
    expect(local).toEqual({ items: ["Call the dentist", "Buy milk"], source: "local" });
    const request = vi.fn(async () => ({
      picks: ["Call the dentist"],
      parked: ["Buy milk", "call the dentist"],
      source: "ai" as const,
      dates: { "buy milk": { kind: "on" as const, date: FRI } },
    }));
    const ai = await sortNight(
      { dump: "dentist, milk", goalTitle: null, useAi: true, forDay: "Friday", today: THU, timeoutMs: 12_000 },
      request,
    );
    expect(ai).toEqual({ items: ["Call the dentist", "Buy milk"], source: "ai", dates: { "buy milk": { kind: "on", date: FRI } } });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ forDay: "Friday", today: THU, openSlots: 3, timeoutMs: 12_000 }),
    );
  });

  it("a dump longer than the AI path can give back is split on the device: no AI call, nothing cut", async () => {
    const dump = Array.from({ length: NIGHT_AI_MAX_ROWS + 1 }, (_, i) => `Thing ${i + 1}`).join("\n");
    expect(aiCanHoldAll(dump)).toBe(false);
    expect(aiCanHoldAll(dump.split("\n").slice(0, NIGHT_AI_MAX_ROWS).join("\n"))).toBe(true);
    const request = vi.fn();
    const sorted = await sortNight({ dump, goalTitle: null, useAi: true }, request);
    expect(request).not.toHaveBeenCalled();
    expect(sorted.source).toBe("local");
    expect(sorted.items).toHaveLength(NIGHT_AI_MAX_ROWS + 1);
  });

  it("a failed AI call falls back to the split (the sheet refunds the free try)", async () => {
    const request = vi.fn(async () => {
      throw new MomentumAiError("network", "offline");
    });
    expect(await sortNight({ dump: "Call the dentist", goalTitle: null, useAi: true }, request)).toEqual({
      items: ["Call the dentist"],
      source: "local",
    });
    expect(await sortNight({ dump: "   ", goalTitle: null, useAi: true }, request)).toEqual({ items: [], source: "local" });
  });
});

describe("the night-before reminder", () => {
  const context = (overrides: Partial<ReminderContext> = {}): ReminderContext =>
    ({
      now: new Date(2026, 10, 26, 12, 0),
      today: THU,
      settings: { ...DEFAULT_NOTIFICATIONS },
      permissionState: "granted",
      tasks: [],
      locked: false,
      yesterdayOpen: [],
      draft: null,
      pending: [],
      lastDeliveredAt: null,
      nightBefore: { ...DEFAULT_NIGHT_BEFORE, reminder: true },
      ...overrides,
    }) as ReminderContext;

  it("is off by default and needs notifications", () => {
    expect(nightBeforeReminder(context({ nightBefore: DEFAULT_NIGHT_BEFORE }))).toEqual([]);
    expect(nightBeforeReminder(context({ nightBefore: undefined }))).toEqual([]);
    expect(nightBeforeReminder(context({ permissionState: "denied" }))).toEqual([]);
    expect(nightBeforeReminder(context({ settings: { ...DEFAULT_NOTIFICATIONS, enabled: false } }))).toEqual([]);
  });

  it("goes off at 8:30 PM on the next evenings, never once tonight is kept or closed, no task words", () => {
    const plan = nightBeforeReminder(context());
    expect(plan.map((item) => item.fireAt.getDate())).toEqual([26, 27, 28]);
    expect([plan[0].fireAt.getHours(), plan[0].fireAt.getMinutes()]).toEqual([20, 30]);
    expect(plan[0].kind).toBe(NIGHT_BEFORE_KIND);
    expect(plan[0].id).toContain(`${THU}:${NIGHT_BEFORE_KIND}:2030`);
    expect(plan[0]).toMatchObject({ title: "Tomorrow", body: "Two minutes to get it out of your head?" });
    const kept = nightBeforeReminder(context({ nightBefore: { ...DEFAULT_NIGHT_BEFORE, reminder: true, doneFor: THU } }));
    expect(kept.map((item) => item.fireAt.getDate())).toEqual([27, 28]);
    const closed = nightBeforeReminder(context({ nightBefore: { ...DEFAULT_NIGHT_BEFORE, reminder: true, dismissedFor: THU } }));
    expect(closed.map((item) => item.fireAt.getDate())).toEqual([27, 28]);
    expect(nightBeforeReminder(context({ now: new Date(2026, 10, 26, 21, 0) }))[0].fireAt.getDate()).toBe(27);
  });

  it("a time after midnight goes off early the next day, for the evening before (keyed by it)", () => {
    const night = { ...DEFAULT_NIGHT_BEFORE, reminder: true, reminderMinutes: 60 };
    // Thursday 12:30 AM: Wednesday night's 1 AM is still ahead.
    const plan = nightBeforeReminder(context({ now: new Date(2026, 10, 26, 0, 30), nightBefore: night }));
    expect(plan[0].fireAt).toEqual(new Date(2026, 10, 26, 1, 0));
    expect(plan[0].id).toContain(`${WED}:${NIGHT_BEFORE_KIND}:0100`);
    // Wednesday night kept: that one isn't sent.
    const kept = nightBeforeReminder(
      context({ now: new Date(2026, 10, 26, 0, 30), nightBefore: { ...night, doneFor: WED } }),
    );
    expect(kept[0].fireAt).toEqual(new Date(2026, 10, 27, 1, 0));
  });

  it("the time stays in the evening window", () => {
    expect(clampReminderMinutes(20 * 60 + 30)).toBe(20 * 60 + 30);
    expect(clampReminderMinutes(2 * 60)).toBe(2 * 60);
    expect(clampReminderMinutes(9 * 60)).toBe(3 * 60 + 59);
    expect(clampReminderMinutes(15 * 60)).toBe(18 * 60);
    expect(normalizeNightBefore({ reminderMinutes: 12 * 60 }).reminderMinutes).toBe(18 * 60);
  });

  it("skips a Sunday whose reset notification is planned (one evening nudge is enough)", () => {
    const plan = nightBeforeReminder(
      context({
        now: new Date(2026, 10, 28, 12, 0),
        plus: true,
        sundayReset: { reminder: true, doneWeek: null, dismissedWeek: null, freeIntroWeek: null },
      }),
    );
    expect(plan.map((item) => item.fireAt.getDate())).toEqual([28, 30]);
  });
});

describe("loading saves", () => {
  it("reads a missing or malformed record as the defaults", () => {
    expect(normalizeNightBefore(undefined)).toEqual(DEFAULT_NIGHT_BEFORE);
    expect(normalizeNightBefore({ reminder: "yes", reminderMinutes: 9999, doneFor: "Thursday", reminderAsked: 1 })).toEqual(
      DEFAULT_NIGHT_BEFORE,
    );
    expect(normalizeNightBefore({ reminder: true, reminderMinutes: 21 * 60, doneFor: THU })).toMatchObject({
      reminder: true,
      reminderMinutes: 21 * 60,
      doneFor: THU,
    });
  });

  it("a held list round-trips; bad rows are dropped, never the list; a bad list is dropped, never the save", () => {
    expect(normalizeNightList(list(["A", "B"], ["B"]))).toEqual(list(["A", "B"], ["B"]));
    const extra = { ...list(["A"]), sortedText: "A", taken: 2 };
    expect(normalizeNightList(extra)).toEqual(extra);
    // A beta save's single list is read into the two slots; bad ones go.
    expect(normalizeNightLists(undefined, list(["A"]))).toEqual([list(["A"])]);
    expect(normalizeNightLists([list(["A"]), "bad", list(["B"], [], { forDay: THU, nightOf: WED })])).toEqual([
      list(["B"], [], { forDay: THU, nightOf: WED }),
      list(["A"]),
    ]);
    const messy = normalizeNightList({
      ...list(["A"]),
      items: [{ id: "x", text: "A" }, { id: "y", text: "a" }, { text: "no id" }, { id: "z", text: "   " }, 7],
      dates: { a: { kind: "on", date: "2026-02-30" }, b: { kind: "by", date: FRI } },
      source: "weird",
    });
    expect(messy?.items).toEqual([{ id: "x", text: "A", picked: false }]);
    expect(messy?.dates).toEqual({ b: { kind: "by", date: FRI } });
    expect(messy?.source).toBe("local");
    expect(normalizeNightList({ ...list(["A"]), forDay: "tomorrow" })).toBeNull();
    expect(normalizeNightList("nope")).toBeNull();
  });

  it("an old save loads unchanged; bad night tags are dropped, never the item", () => {
    const loaded = normalizeState(JSON.parse(JSON.stringify(stateOn(THU))))!;
    expect(loaded.nightBefore).toBeUndefined();
    expect(loaded.nightLists).toBeUndefined();
    const saved = JSON.parse(
      JSON.stringify(
        stateOn(THU, {
          parkedTasks: [parked("Buy milk", { nightFor: "not-a-day" }), parked("Call", { nightFor: FRI })],
          tasks: [{ id: "t1", text: "Run", createdAt: AT, carriedOver: false, nightFor: "2026-02-30" }],
          nightBefore: { ...DEFAULT_NIGHT_BEFORE, reminder: true, doneFor: THU },
          nightLists: [list(["Call the dentist"], ["Call the dentist"])],
        }),
      ),
    );
    const back = normalizeState(saved)!;
    expect(back.parkedTasks.map((item) => [item.text, item.nightFor])).toEqual([
      ["Buy milk", undefined],
      ["Call", FRI],
    ]);
    expect(back.tasks[0].nightFor).toBeUndefined();
    expect(back.nightBefore).toMatchObject({ reminder: true, doneFor: THU });
    expect(back.nightLists).toEqual([list(["Call the dentist"], ["Call the dentist"])]);
    expect(normalizeState({ ...saved, nightLists: [{ forDay: 3 }] })!.nightLists).toEqual([]);
    const { nightLists: _lists, ...beta } = saved;
    expect(normalizeState({ ...beta, nightList: list(["Old"]) })!.nightLists).toEqual([list(["Old"])]);
  });
});
