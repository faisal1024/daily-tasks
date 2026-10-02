// 1.3 day-5 trial note (PR #81): when it's due, what it says (counts only),
// and the on-device use counter. Fixtures are built in local time so the
// suite reads the same in every CI time zone.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANY_TRIAL,
  loadPlusUses,
  loadTrialNoteRecord,
  recordPlusUse,
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

beforeEach(() => {
  store.data.clear();
  store.getItem.mockImplementation(async (key: string) => store.data.get(key) ?? null);
  store.setItem.mockImplementation(async (key: string, value: string) => {
    store.data.set(key, value);
  });
});

describe("trialNoteDueAt", () => {
  it("is day 5 (start + 4 days), or 3 days before the end without a usable start", () => {
    expect(trialNoteDueAt(TRIAL)).toBe(START + 4 * DAY);
    expect(trialNoteDueAt(NO_START)).toBe(END - 3 * DAY);
    expect(trialNoteDueAt({ ...TRIAL, startedAt: "not a date" })).toBe(END - 3 * DAY);
    // A start at/after the end is nonsense: fall back to the end.
    expect(trialNoteDueAt({ ...TRIAL, startedAt: TRIAL.endsAt })).toBe(END - 3 * DAY);
  });

  it("is null when the end date is unusable", () => {
    expect(trialNoteDueAt({ ...TRIAL, endsAt: "garbage" })).toBeNull();
    expect(trialNoteDueAt({ ...TRIAL, endsAt: "" })).toBeNull();
  });
});

describe("shouldShowTrialNote", () => {
  const due = START + 4 * DAY;

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
    expect(copy.body).toMatch(/^Plus can sort a brain dump into today's three/);
    expect(copy.body).not.toMatch(/\b0\b/);
  });

  it("says singular and plural counts, joined as a list", () => {
    expect(trialNoteCopy({ ...none, break_down: 1 }, TRIAL, now).body).toMatch(
      /^Plus broke down 1 task during your trial\./,
    );
    expect(trialNoteCopy({ ...none, brain_dump: 2, coach_note: 1 }, TRIAL, now).body).toMatch(
      /^Plus sorted 2 brain dumps and wrote 1 coach's note during your trial\./,
    );
    expect(
      trialNoteCopy({ brain_dump: 1, break_down: 3, coach_note: 2, tomorrow_draft: 1 }, TRIAL, now).body,
    ).toMatch(
      /^Plus sorted 1 brain dump, broke down 3 tasks, wrote 2 coach's notes and drafted 1 evening plan during your trial\./,
    );
  });

  it("says whether the trial renews", () => {
    expect(trialNoteCopy(none, TRIAL, now).body).toMatch(/you can cancel anytime in Settings\.$/);
    expect(trialNoteCopy(none, { ...TRIAL, willRenew: false }, now).body).toMatch(
      /and won't renew\. Your three tasks stay free either way\.$/,
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
      `ends ${new Date(inThree).toLocaleDateString(undefined, { weekday: "long" })};`,
    );
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

  it("is capped at 300 entries and drops uses older than 30 days", async () => {
    const old = { kind: "brain_dump", at: START - 31 * DAY };
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
