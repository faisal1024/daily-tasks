// 1.5 D: the Nag mode card and its sheet for a new install (rules in
// lib/daily-tasks/first-days.ts): shown the day after first run (never on
// day one, tick or not), one card at a time (nudge, Nag card, widget tip),
// retired by × or by seeing the sheet, and never for installs that updated
// from 1.4 or carry a 1.5 A record. Day keys are plain local strings.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_DAYS_KEY,
  NAG_CARD_DAYS,
  finishNagIntro,
  loadFirstDays,
  nagIntroDue,
  noteCheckOff,
  openFirstDays,
  openNagIntro,
  saveFirstDays,
  shouldShowNagCard,
  shouldShowWidgetTip,
  startFirstDays,
  type FirstDaysRecord,
} from "../lib/daily-tasks/first-days";

const store = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({ default: store }));

beforeEach(() => {
  store.data.clear();
  vi.clearAllMocks();
});

const D1 = "2026-10-31";
const D2 = "2026-11-01"; // across a month boundary
const D3 = "2026-11-02";
/** A later day than first run's, with something ticked: when the sheet may come up on its own. */
const LATER = { today: D2, tickedEver: true };
const show = (record: FirstDaysRecord | null, today: string, over: Partial<Parameters<typeof shouldShowNagCard>[0]> = {}) =>
  shouldShowNagCard({ record, today, nagOn: false, nudgeShowing: false, dayFinished: false, ...over });

describe("the Nag card: which days", () => {
  it("is two days long", () => {
    expect(NAG_CARD_DAYS).toBe(2);
  });

  it("never shows on day 1, not even after a tick (day one has the nudge and enough to take in)", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(show(record, D1)).toBe(false);
    expect(show(noteCheckOff(record, D1, false), D1)).toBe(false);
    expect(show(noteCheckOff(record, D1, true), D1)).toBe(false);
    // A tick on day 1 still brings the morning nudge forward, and leaves the card's day alone.
    const ticked = noteCheckOff(record, D1, true);
    expect(ticked.nudgeFrom).toBe(D1);
    expect(ticked.nagCardFrom).toBe(D2);
  });

  it("shows on day 2 without any tick, and not at all on day 3", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(show(record, D2)).toBe(true);
    expect(show(record, D3)).toBe(false);
    // A first tick on day 1 doesn't stretch it to a third day.
    expect(show(noteCheckOff(record, D1, true), D3)).toBe(false);
  });

  it("a tick on day 2 doesn't pull anything earlier or change the window", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(noteCheckOff(record, D2, true)).toBe(record);
  });

  it("is not shown on a finished day, with Nag mode on, or beside the morning nudge", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(show(record, D2)).toBe(true);
    expect(show(record, D2, { dayFinished: true })).toBe(false);
    expect(show(record, D2, { nagOn: true })).toBe(false);
    expect(show(record, D2, { nudgeShowing: true })).toBe(false);
  });
});

describe("one card at a time: nudge, then the Nag card, then the widget tip", () => {
  const dueTipRecord = (): FirstDaysRecord => ({ ...startFirstDays(D1, "launch#0"), widgetTip: "due" });

  it("the widget tip waits for the Nag card, and comes once the card is gone", () => {
    const record = dueTipRecord();
    expect(shouldShowWidgetTip({ record, widgetsSupported: true, nudgeShowing: false, nagShowing: true })).toBe(false);
    expect(shouldShowWidgetTip({ record, widgetsSupported: true, nudgeShowing: false, nagShowing: false })).toBe(true);
    // And the nudge outranks both.
    expect(shouldShowWidgetTip({ record, widgetsSupported: true, nudgeShowing: true, nagShowing: false })).toBe(false);
  });

  it("the Nag card gives way to a showing nudge, and returns when the nudge is answered", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(show(record, D2, { nudgeShowing: true })).toBe(false);
    expect(show(record, D2, { nudgeShowing: false })).toBe(true);
  });
});

describe("retiring it: × and seeing the sheet end both", () => {
  const live = () => startFirstDays(D1, "launch#0");

  it("finishing the intro hides the card on every remaining day and stops the sheet", () => {
    const done = finishNagIntro(live());
    expect(done.nagCardUntil).toBeNull();
    expect(done.nagIntro).toBe("done");
    expect(show(done, D1)).toBe(false);
    expect(show(done, D2)).toBe(false);
    expect(nagIntroDue(done, false, LATER)).toBe(false);
    // Even a sheet that was due on its own is gone.
    const due = openNagIntro(live(), "launch#1");
    expect(nagIntroDue(due, false, LATER)).toBe(true);
    expect(nagIntroDue(finishNagIntro(due), false, LATER)).toBe(false);
  });

  it("is idempotent: the same record back, so nothing is saved twice", () => {
    const done = finishNagIntro(live());
    expect(finishNagIntro(done)).toBe(done);
  });

  it("opening the sheet from the card (card dismissed) means the sheet never comes up by itself later", () => {
    const afterCard = finishNagIntro(live());
    expect(openFirstDays(afterCard, { open: "launch#9" })).toBe(afterCard);
    expect(nagIntroDue(openFirstDays(afterCard, { open: "launch#9" }), false, LATER)).toBe(false);
  });

  it("survives a save and load", async () => {
    await saveFirstDays(finishNagIntro(live()));
    const loaded = await loadFirstDays();
    expect(loaded?.nagIntro).toBe("done");
    expect(loaded?.nagCardUntil).toBeNull();
    expect(show(loaded, D2)).toBe(false);
  });
});

describe("the sheet on its own: the next open after first run, once", () => {
  it("is waiting in the open first run ended in, due from the next one", () => {
    const record = startFirstDays(D1, "launch#0");
    expect(record.nagIntro).toBe("waiting");
    expect(openNagIntro(record, "launch#0")).toBe(record);
    expect(nagIntroDue(record, false, LATER)).toBe(false);
    const due = openNagIntro(record, "launch#0+");
    expect(due.nagIntro).toBe("due");
    expect(nagIntroDue(due, false, LATER)).toBe(true);
  });

  it("not on the first-run day, and not before anything was ever ticked, even when due", () => {
    const due = openNagIntro(startFirstDays(D1, "L#0"), "L#1");
    expect(due.nagIntro).toBe("due");
    expect(nagIntroDue(due, false, { today: D1, tickedEver: true })).toBe(false);
    expect(nagIntroDue(due, false, { today: D2, tickedEver: false })).toBe(false);
    expect(nagIntroDue(due, false, { today: D2, tickedEver: true })).toBe(true);
    expect(nagIntroDue(due, false, { today: D3, tickedEver: true })).toBe(true);
  });

  it("a later foreground in the same launch is a different open", () => {
    expect(openFirstDays(startFirstDays(D1, "L#0"), { open: "L#1" }).nagIntro).toBe("due");
  });

  it("is not due with Nag mode already on", () => {
    const due = openNagIntro(startFirstDays(D1, "L#0"), "L#1");
    expect(nagIntroDue(due, true, LATER)).toBe(false);
  });

  it("once seen, a further open does not bring it back", () => {
    const seen = finishNagIntro(openNagIntro(startFirstDays(D1, "L#0"), "L#1"));
    expect(openNagIntro(seen, "L#2")).toBe(seen);
    expect(nagIntroDue(seen, false, LATER)).toBe(false);
  });

  it("a record saved without its open is due from the next load, not stuck waiting", async () => {
    store.data.set(
      FIRST_DAYS_KEY,
      JSON.stringify({ nudgeFrom: D2, nudgeDeclines: 0, widgetTip: "waiting", nagCardFrom: D2, nagCardUntil: D2, nagIntro: "waiting" }),
    );
    expect((await loadFirstDays())?.nagIntro).toBe("due");
  });
});

describe("who never sees it", () => {
  it("an update from 1.4 has no record: no card, no sheet", () => {
    expect(show(null, D1)).toBe(false);
    expect(nagIntroDue(null, false, LATER)).toBe(false);
  });

  it("a 1.5 A record (no Nag fields) shows no card and no sheet, on any day, across opens", async () => {
    store.data.set(FIRST_DAYS_KEY, JSON.stringify({ nudgeFrom: D2, nudgeDeclines: 0, widgetTip: "waiting" }));
    const loaded = await loadFirstDays();
    expect(loaded).toEqual({ nudgeFrom: D2, nudgeDeclines: 0, widgetTip: "waiting" });
    for (const day of [D1, D2, D3]) expect(show(loaded, day)).toBe(false);
    const opened = openFirstDays(loaded as FirstDaysRecord, { open: "L#5", today: D2 });
    expect(nagIntroDue(opened, false, LATER)).toBe(false);
    // A tick doesn't conjure a card either.
    expect(show(noteCheckOff(loaded as FirstDaysRecord, D1, true), D1)).toBe(false);
  });

  it("a garbled Nag field reads as retired, not as a card", async () => {
    store.data.set(
      FIRST_DAYS_KEY,
      JSON.stringify({ nudgeFrom: null, nudgeDeclines: 0, widgetTip: "done", nagCardFrom: D1, nagCardUntil: "soon", nagIntro: "maybe" }),
    );
    const loaded = await loadFirstDays();
    expect(show(loaded, D1)).toBe(false);
    expect(nagIntroDue(loaded, false, LATER)).toBe(false);
  });
});
