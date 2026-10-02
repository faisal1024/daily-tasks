// 1.3 day-5 trial note (PR #81): when it's due, what it says (counts only),
// and the on-device use counter. Fixtures are built in local time so the
// suite reads the same in every CI time zone.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANY_TRIAL,
  loadPlusUses,
  loadTrialNoteRecord,
  recordPlusUse,
  setTrialActiveForUses,
  shouldShowTrialNote,
  trialEndDay,
  trialKey,
  trialNoteCopy,
  trialNoteDueAt,
  usageDuring,
  type PlusTrial,
  type PlusUseKind,
  type TrialUsage,
} from "../lib/daily-tasks/trial-note";

// In-memory AsyncStorage (hoisted above the imports by vitest).
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

const DAY = 24 * 60 * 60_000;
const USES_KEY = "daily-tasks/plus-uses";
const NOTE_KEY = "daily-tasks/trial-note";

/** A 7-day trial that started at 09:00 local on 1 Oct 2026. */
const START = new Date(2026, 9, 1, 9, 0).getTime();
const END = START + 7 * DAY;
const TRIAL: PlusTrial = {
  startedAt: new Date(START).toISOString(),
  endsAt: new Date(END).toISOString(),
  willRenew: true,
};
const NO_START: PlusTrial = { ...TRIAL, startedAt: null };

const none: TrialUsage = { brain_dump: 0, break_down: 0, coach_note: 0, tomorrow_draft: 0 };

/** Day 5: local midnight of the start day + 4 days (09:00 start: before start + 4 × 24 h). */
const DAY_FIVE = new Date(2026, 9, 5).getTime();

beforeEach(() => {
  setTrialActiveForUses(true);
  store.data.clear();
  store.getItem.mockImplementation(async (key: string) => store.data.get(key) ?? null);
  store.setItem.mockImplementation(async (key: string, value: string) => {
    store.data.set(key, value);
  });
});

describe("trialNoteDueAt", () => {
  it("is day 5 (start day's midnight + 4 days), or 3 days before the end without a usable start", () => {
    expect(trialNoteDueAt(TRIAL)).toBe(DAY_FIVE);
    expect(trialNoteDueAt(NO_START)).toBe(END - 3 * DAY);
    expect(trialNoteDueAt({ ...TRIAL, startedAt: "not a date" })).toBe(END - 3 * DAY);
    // A start at/after the end is nonsense: fall back to the end.
    expect(trialNoteDueAt({ ...TRIAL, startedAt: TRIAL.endsAt })).toBe(END - 3 * DAY);
  });

  it("is capped at 4/7 of the trial, so a 3-minute sandbox trial gets it after ~103 s", () => {
    const start = new Date(2026, 9, 1, 9, 0).getTime();
    const sandbox: PlusTrial = {
      startedAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3 * 60_000).toISOString(),
      willRenew: true,
    };
    expect(trialNoteDueAt(sandbox)).toBe(start + (3 * 60_000 * 4) / 7);
    expect(shouldShowTrialNote({ trial: sandbox, record: null, now: start + 2 * 60_000 })).toBe(true);
    // A real 7-day trial: midnight + 4 days is always before the cap, even for a late start.
    const late = new Date(2026, 9, 1, 23, 30).getTime();
    expect(
      trialNoteDueAt({ startedAt: new Date(late).toISOString(), endsAt: new Date(late + 7 * DAY).toISOString(), willRenew: true }),
    ).toBe(new Date(2026, 9, 5).getTime());
  });

  it("counts calendar days, so a clock change mid-trial still lands on local midnight", () => {
    // Spans the end of daylight saving in the US (1 Nov 2026) and Europe (25 Oct 2026).
    for (const [y, m, d] of [
      [2026, 9, 29],
      [2026, 9, 23],
    ]) {
      const start = new Date(y, m, d, 10, 0).getTime();
      const trial: PlusTrial = {
        startedAt: new Date(start).toISOString(),
        endsAt: new Date(start + 7 * DAY).toISOString(),
        willRenew: true,
      };
      const due = new Date(trialNoteDueAt(trial)!);
      expect(due.getTime()).toBe(new Date(y, m, d + 4).getTime());
      expect([due.getHours(), due.getMinutes()]).toEqual([0, 0]);
    }
  });

  it("is null when the end date is unusable", () => {
    expect(trialNoteDueAt({ ...TRIAL, endsAt: "garbage" })).toBeNull();
    expect(trialNoteDueAt({ ...TRIAL, endsAt: "" })).toBeNull();
  });
});

describe("trialKey", () => {
  it("is the trial's end, so a start date that differs between launches keeps the same note", () => {
    expect(trialKey(TRIAL)).toBe(TRIAL.endsAt);
    expect(trialKey(NO_START)).toBe(trialKey(TRIAL));
    expect(trialKey({ ...TRIAL, startedAt: new Date(START + 60_000).toISOString() })).toBe(trialKey(TRIAL));
  });
});

describe("shouldShowTrialNote", () => {
  const due = DAY_FIVE;

  it("shows from day 5 until the trial ends (exclusive)", () => {
    expect(shouldShowTrialNote({ trial: TRIAL, record: null, now: due - 1 })).toBe(false);
    expect(shouldShowTrialNote({ trial: TRIAL, record: null, now: due })).toBe(true);
    expect(shouldShowTrialNote({ trial: TRIAL, record: null, now: END - 1 })).toBe(true);
    expect(shouldShowTrialNote({ trial: TRIAL, record: null, now: END })).toBe(false);
  });

  it("without a start date, is due 3 days before the end", () => {
    expect(shouldShowTrialNote({ trial: NO_START, record: null, now: END - 3 * DAY - 1 })).toBe(false);
    expect(shouldShowTrialNote({ trial: NO_START, record: null, now: END - 3 * DAY })).toBe(true);
  });

  it("never shows without a trial or with unusable dates", () => {
    expect(shouldShowTrialNote({ trial: null, record: null, now: due })).toBe(false);
    expect(shouldShowTrialNote({ trial: undefined, record: null, now: due })).toBe(false);
    expect(shouldShowTrialNote({ trial: { ...TRIAL, endsAt: "nope" }, record: null, now: due })).toBe(false);
  });

  it("stays up once shown, hides once dismissed for this trial, and shows again for a new trial", () => {
    const key = trialKey(TRIAL);
    expect(shouldShowTrialNote({ trial: TRIAL, record: { key, dismissed: false }, now: due })).toBe(true);
    expect(shouldShowTrialNote({ trial: TRIAL, record: { key, dismissed: true }, now: due })).toBe(false);
    expect(
      shouldShowTrialNote({ trial: TRIAL, record: { key: "2025-01-01T00:00:00.000Z", dismissed: true }, now: due }),
    ).toBe(true);
  });

  it("stays hidden when storage couldn't be read (fail quiet)", async () => {
    store.getItem.mockRejectedValueOnce(new Error("disk"));
    const unreadable = await loadTrialNoteRecord();
    expect(unreadable).toEqual({ key: ANY_TRIAL, dismissed: true });
    expect(shouldShowTrialNote({ trial: TRIAL, record: unreadable, now: due })).toBe(false);

    store.data.set(NOTE_KEY, "{not json");
    expect(await loadTrialNoteRecord()).toEqual({ key: ANY_TRIAL, dismissed: true });
    store.data.clear();
    expect(await loadTrialNoteRecord()).toBeNull();
  });
});

describe("usageDuring", () => {
  const now = START + 4 * DAY;
  const use = (kind: PlusUseKind, at: number) => ({ kind, at });

  it("counts only uses from the trial's start up to now", () => {
    const usage = usageDuring(
      [
        use("brain_dump", START - 1), // before the trial
        use("brain_dump", START), // first moment
        use("break_down", START + DAY),
        use("break_down", now), // right now
        use("coach_note", now + 1), // future (clock skew)
        { kind: "something_else" as PlusUseKind, at: START + DAY }, // unknown kind
      ],
      TRIAL,
      now,
    );
    expect(usage).toEqual({ brain_dump: 1, break_down: 2, coach_note: 0, tomorrow_draft: 0 });
  });

  it("without a start date, counts from 7 days before the end", () => {
    const usage = usageDuring([use("coach_note", END - 7 * DAY - 1), use("coach_note", END - 7 * DAY)], NO_START, now);
    expect(usage.coach_note).toBe(1);
  });
});

describe("trialNoteCopy", () => {
  const now = START + 4 * DAY; // ends 3 days later

  it("with nothing used, describes what Plus can do (no zero counts)", () => {
    const copy = trialNoteCopy(none, TRIAL, now);
    expect(copy.title).toBe("Your Plus trial");
    expect(copy.body).toMatch(
      /^Plus is here when you want it: sorting a brain dump, breaking down a stuck task, a coach's note\. /,
    );
    expect(copy.body).not.toMatch(/\b0\b/);
  });

  it("says singular and plural counts, joined as a list", () => {
    expect(trialNoteCopy({ ...none, break_down: 1 }, TRIAL, now).body).toMatch(
      /^Plus broke down 1 task during your trial\./,
    );
    expect(trialNoteCopy({ ...none, brain_dump: 2, coach_note: 1 }, TRIAL, now).body).toMatch(
      /^Plus sorted 2 brain dumps and wrote 1 coach note during your trial\./,
    );
    expect(
      trialNoteCopy({ brain_dump: 1, break_down: 3, coach_note: 2, tomorrow_draft: 1 }, TRIAL, now).body,
    ).toMatch(
      /^Plus sorted 1 brain dump, broke down 3 tasks, wrote 2 coach notes and drafted 1 evening plan during your trial\./,
    );
  });

  it("says whether the trial renews", () => {
    expect(trialNoteCopy(none, TRIAL, now).body).toMatch(
      / Your trial ends \w+, then Plus continues as your subscription\. Not for you\? Cancel at least 24 hours before with Manage below\.$/,
    );
    expect(trialNoteCopy(none, { ...TRIAL, willRenew: false }, now).body).toMatch(
      / Your trial ends \w+ and won't renew\. Your three tasks stay free after that\.$/,
    );
  });

  it("names the end day as today, tomorrow or the weekday (local calendar days)", () => {
    const endAt = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0).toISOString();
    const morning = new Date(2026, 9, 5, 8, 0).getTime();
    expect(trialEndDay(endAt(2026, 9, 5, 23), morning)).toBe("today");
    // Earlier today (already past) still reads "today", never a negative day.
    expect(trialEndDay(endAt(2026, 9, 5, 1), morning)).toBe("today");
    // Just after midnight is tomorrow, not "today" (calendar days, not 24 h).
    expect(trialEndDay(endAt(2026, 9, 6, 0), new Date(2026, 9, 5, 23, 30).getTime())).toBe("tomorrow");
    const inThree = endAt(2026, 9, 8, 9);
    expect(trialEndDay(inThree, morning)).toBe(new Date(inThree).toLocaleDateString(undefined, { weekday: "long" }));
    expect(trialNoteCopy(none, { ...TRIAL, endsAt: inThree }, morning).body).toContain(
      `ends ${new Date(inThree).toLocaleDateString(undefined, { weekday: "long" })}, then`,
    );
  });
});

// PR #83: the renewing line names the price the store knows. Apple renews
// unless cancelled at least 24 hours before the end, so the cancel line says
// exactly that, and disappears inside the final 24 hours (no promise the
// store can't keep).
describe("trialNoteCopy with a renewal price", () => {
  const PRICE = { priceString: "$29.99", period: "year" };
  const CANCEL = "Not for you? Cancel at least 24 hours before with Manage below.";
  const endAt = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).toISOString();
  const copyAt = (end: string, now: number, price: typeof PRICE | null = PRICE) =>
    trialNoteCopy(none, { ...TRIAL, endsAt: end }, now, price).body;

  it("names the price and the 24-hour cancel rule; without a price, the same rule", () => {
    const monday = new Date(2026, 9, 5, 9, 0).getTime();
    const body = trialNoteCopy(none, TRIAL, monday, PRICE).body;
    expect(body.endsWith(
      ` Your trial ends ${new Date(END).toLocaleDateString(undefined, { weekday: "long" })}, then Plus renews at $29.99/year. ${CANCEL}`,
    )).toBe(true);
    expect(trialNoteCopy(none, TRIAL, monday, null).body).toMatch(
      /then Plus continues as your subscription\. Not for you\? Cancel at least 24 hours before with Manage below\.$/,
    );
    // A cancelled trial never names a price, even if one is passed.
    expect(trialNoteCopy(none, { ...TRIAL, willRenew: false }, monday, PRICE).body).toMatch(/won't renew\. Your three tasks stay free after that\.$/);
    // Never names a "cancel by" day.
    expect(body).not.toMatch(/Cancel by|Cancel today/);
  });

  it("drops the cancel line inside the final 24 hours (price and no-price)", () => {
    const end = endAt(2026, 9, 8, 9);
    const endMs = new Date(end).getTime();
    // Just over 24 hours before: still offered.
    expect(copyAt(end, endMs - DAY - 60_000)).toContain(CANCEL);
    expect(copyAt(end, endMs - DAY - 60_000, null)).toContain(CANCEL);
    // Exactly 24 hours before, and later: no cancel promise.
    for (const now of [endMs - DAY, endMs - DAY + 1, endMs - 60 * 60_000]) {
      expect(copyAt(end, now)).not.toContain("Cancel");
      expect(copyAt(end, now, null)).not.toContain("Cancel");
    }
    // Wording inside the window: ends tomorrow / today, then renews.
    expect(copyAt(end, new Date(2026, 9, 7, 20).getTime())).toMatch(/ Your trial ends tomorrow, then Plus renews at \$29\.99\/year\.$/);
    expect(copyAt(end, new Date(2026, 9, 8, 7).getTime())).toMatch(/ Your trial ends today, then Plus renews at \$29\.99\/year\.$/);
    expect(copyAt(end, new Date(2026, 9, 8, 7).getTime(), null)).toMatch(/ Your trial ends today, then Plus continues as your subscription\.$/);
  });

  it("on the end day, offers no cancel line even early in the morning", () => {
    // Ends 23:00 today; at 08:00 it's 15 hours away.
    expect(copyAt(endAt(2026, 9, 8, 23), new Date(2026, 9, 8, 8).getTime())).toMatch(/ends today, then Plus renews at \$29\.99\/year\.$/);
  });

  it("a 3-day trial: the cancel line on day 1 and 2, gone in the last 24 hours", () => {
    const start = new Date(2026, 9, 5, 9).getTime();
    const end = new Date(start + 3 * DAY).toISOString();
    expect(copyAt(end, start + 60_000)).toContain(CANCEL);
    expect(copyAt(end, start + DAY + 60 * 60_000)).toContain(CANCEL);
    expect(copyAt(end, start + 2 * DAY + 60 * 60_000)).not.toContain("Cancel");
  });

  it("uses real elapsed time (not calendar days) across a daylight-saving change", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // The zone really changed (DST ends 1 Nov 2026 in New York), so this isn't vacuous.
      expect(new Date(2026, 10, 1, 0).getTimezoneOffset()).not.toBe(new Date(2026, 10, 2, 0).getTimezoneOffset());
      // Fall back (a 25-hour Sun 1 Nov): ends Mon 2 Nov 00:30. Sat 31 Oct
      // 23:45 local is 25h45m before the end, so cancelling is still possible
      // although the wall clock says less than a day plus an hour.
      const fallEnd = endAt(2026, 10, 2, 0, 30);
      expect(copyAt(fallEnd, new Date(2026, 9, 31, 23, 45).getTime())).toContain(CANCEL);
      // Sun 1 Nov 00:15 local is 25h15m before: still offered; 01:45 (second, EST) isn't.
      expect(copyAt(fallEnd, new Date(fallEnd).getTime() - DAY - 15 * 60_000)).toContain(CANCEL);
      expect(copyAt(fallEnd, new Date(2026, 10, 1, 1, 0).getTime() + 2 * 60 * 60_000)).not.toContain("Cancel");
      // Spring forward (a 23-hour Sun 14 Mar 2027): ends Mon 15 Mar 00:30.
      // Sun 14 Mar 00:15 local is only 23h15m before: no cancel line, even
      // though the wall-clock date is "the day before".
      const springEnd = endAt(2027, 2, 15, 0, 30);
      expect(copyAt(springEnd, new Date(2027, 2, 14, 0, 15).getTime())).not.toContain("Cancel");
      // Sat 13 Mar 23:45 is 23h45m before too (the lost hour); 22:00 is 25h30m.
      expect(copyAt(springEnd, new Date(2027, 2, 13, 23, 45).getTime())).not.toContain("Cancel");
      expect(copyAt(springEnd, new Date(2027, 2, 13, 22, 0).getTime())).toContain(CANCEL);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("recordPlusUse (the on-device counter)", () => {
  it("stores only the kind and the time, never any text", async () => {
    await recordPlusUse("break_down", START);
    const raw = store.data.get(USES_KEY)!;
    expect(JSON.parse(raw)).toEqual([{ kind: "break_down", at: START }]);
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(["at", "kind"]);
  });

  it("keeps two quick uses (writes don't overwrite each other)", async () => {
    await Promise.all([recordPlusUse("brain_dump", START), recordPlusUse("coach_note", START + 1)]);
    expect(await loadPlusUses()).toEqual([
      { kind: "brain_dump", at: START },
      { kind: "coach_note", at: START + 1 },
    ]);
  });

  it("counts nothing outside a free trial (nothing is kept about anyone else)", async () => {
    setTrialActiveForUses(false);
    await recordPlusUse("break_down", START);
    expect(store.data.has(USES_KEY)).toBe(false);
    setTrialActiveForUses(true);
    await recordPlusUse("break_down", START);
    expect(await loadPlusUses()).toEqual([{ kind: "break_down", at: START }]);
  });

  it("is capped at 300 entries and drops uses older than 14 days", async () => {
    const old = { kind: "brain_dump", at: START - 14 * DAY };
    const recent = Array.from({ length: 300 }, (_, i) => ({ kind: "break_down", at: START - 300 + i }));
    store.data.set(USES_KEY, JSON.stringify([old, ...recent]));
    await recordPlusUse("coach_note", START);
    const kept = await loadPlusUses();
    expect(kept).toHaveLength(300);
    expect(kept).not.toContainEqual(old);
    expect(kept[kept.length - 1]).toEqual({ kind: "coach_note", at: START });
  });

  it("never throws when storage fails, and reads garbage as no uses", async () => {
    store.setItem.mockRejectedValueOnce(new Error("full"));
    await expect(recordPlusUse("brain_dump", START)).resolves.toBeUndefined();
    store.data.set(USES_KEY, "not json");
    expect(await loadPlusUses()).toEqual([]);
    store.getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await loadPlusUses()).toEqual([]);
  });
});
