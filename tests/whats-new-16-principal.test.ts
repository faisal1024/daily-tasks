// Principal-tester invariants for 1.6's What's new, the new-user capture card
// and the Saved-for-later date tip. Where the other tests pin examples, these
// sweep every combination against a plain-words oracle, so a wrong rule
// anywhere in the matrix fails.
import { afterEach, describe, expect, it } from "vitest";

import {
  addDays,
  captureCardShownOn,
  finishCaptureCard,
  markCaptureCardShown,
  noteOpenDay,
  openFirstDays,
  shouldShowCaptureCard,
  startFirstDays,
  type FirstDaysCardKind,
  type FirstDaysRecord,
} from "../lib/daily-tasks/first-days";
import { showSavedDateTip, withSavedDateTip } from "../lib/daily-tasks/saved-date-tip";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_NOTIFICATIONS, type AppState, type ParkedTask } from "../lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  allAnnouncementIds,
  FEATURES_16_ID,
  NAG_ANNOUNCEMENT_ID,
  whatsNewDecision,
  withWhatsNewSeen,
} from "../lib/daily-tasks/whats-new";

afterEach(() => __setAnnouncementsForTests(null));

const subsets = <T,>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>((all, item) => all.flatMap((set) => [set, [...set, item]]), [[]]);
const NAG = { ...DEFAULT_NOTIFICATIONS, style: "nag" as const, nagConfirmed: true };

describe("who is shown what, over every saved state", () => {
  const ids = [NAG_ANNOUNCEMENT_ID, FEATURES_16_ID, "unrelated"];
  const states = subsets(ids).flatMap((whatsNewSeen) =>
    [true, false].flatMap((hasSeenOnboarding) =>
      [DEFAULT_NOTIFICATIONS, NAG].map((notifications) => ({ hasSeenOnboarding, whatsNewSeen, notifications })),
    ),
  );

  it("shows 1.6's and only 1.6's, exactly to a finished-first-run user who has not seen it; never 1.4's", () => {
    for (const state of states) {
      const { show, skip } = whatsNewDecision(state);
      const expected = state.hasSeenOnboarding && !state.whatsNewSeen.includes(FEATURES_16_ID);
      expect(show?.id ?? null, JSON.stringify(state)).toBe(expected ? FEATURES_16_ID : null);
      // 1.4's is never put on screen, and is quietly marked seen only when unseen.
      expect(show?.id).not.toBe(NAG_ANNOUNCEMENT_ID);
      const quiet = state.hasSeenOnboarding && !state.whatsNewSeen.includes(NAG_ANNOUNCEMENT_ID);
      expect(skip.includes(NAG_ANNOUNCEMENT_ID), JSON.stringify(state)).toBe(quiet);
      if (!state.hasSeenOnboarding) expect(skip).toEqual([]);
    }
  });

  it("once the show and the skips are marked seen nothing is left, in any state (shown once)", () => {
    for (const state of states) {
      const { show, skip } = whatsNewDecision(state);
      const seen = withWhatsNewSeen(state.whatsNewSeen, [...skip, ...(show ? [show.id] : [])]);
      const again = whatsNewDecision({ ...state, whatsNewSeen: seen });
      expect(again, JSON.stringify(state)).toEqual({ show: null, skip: [] });
      // No id twice, and unrelated ids are kept.
      expect(new Set(seen).size).toBe(seen.length);
      for (const id of state.whatsNewSeen) expect(seen).toContain(id);
    }
  });

  it("a new install (first run marks allAnnouncementIds) is never shown any, however many announcements come later that it knew", () => {
    const seen = withWhatsNewSeen([], allAnnouncementIds());
    expect(seen).toEqual(expect.arrayContaining([NAG_ANNOUNCEMENT_ID, FEATURES_16_ID]));
    for (const notifications of [DEFAULT_NOTIFICATIONS, NAG]) {
      expect(whatsNewDecision({ hasSeenOnboarding: true, whatsNewSeen: seen, notifications })).toEqual({ show: null, skip: [] });
    }
  });

  it("a save from before 1.4 (no whatsNewSeen) loads as an updater, and a damaged one does too", () => {
    for (const whatsNewSeen of [undefined, null, "1.6-features", 5, {}, [7, "bad id!", null]]) {
      const loaded = normalizeState({ ...buildInitialState(new Date(2026, 9, 26)), hasSeenOnboarding: true, whatsNewSeen })!;
      expect(loaded.whatsNewSeen).not.toContain(FEATURES_16_ID);
      const { show } = whatsNewDecision(loaded);
      expect(show?.id).toBe(FEATURES_16_ID);
    }
  });
});

describe("the capture card's rule, over every combination", () => {
  const D1 = "2026-10-20";
  const D2 = addDays(D1, 1);
  const D3 = addDays(D1, 2);
  const D4 = addDays(D1, 3);
  const kinds: Exclude<FirstDaysCardKind, "capture">[] = ["nudge", "nag", "widget"];

  it("shows exactly on day 3+ (two earlier open days), with a tick, no capture, no other card today or showing", () => {
    for (const openDays of subsets([D1, D2, D3])) {
      for (const today of [D1, D2, D3, D4]) {
        for (const tickedEver of [true, false]) {
          for (const capturedEver of [true, false]) {
            for (const otherShowing of [true, false]) {
              for (const otherToday of [null, ...kinds, "yesterday"]) {
                const shownToday = otherToday === null ? {} : otherToday === "yesterday" ? { widget: D1 } : { [otherToday]: today };
                const record = { ...startFirstDays(D1, "o"), openDays } as FirstDaysRecord;
                const earlier = openDays.filter((day) => day < today).length;
                const otherShownToday = otherToday !== null && otherToday !== "yesterday";
                const expected = earlier >= 2 && tickedEver && !capturedEver && !otherShowing && !otherShownToday;
                const got = shouldShowCaptureCard({ record, today, tickedEver, capturedEver, otherShowing, shownToday });
                expect(got, JSON.stringify({ openDays, today, tickedEver, capturedEver, otherShowing, otherToday })).toBe(expected);
              }
            }
          }
        }
      }
    }
  });

  it("no record, or one from before 1.6 (no openDays/captureCard): never", () => {
    expect(shouldShowCaptureCard({ record: null, today: D4, tickedEver: true, capturedEver: false, otherShowing: false, shownToday: {} })).toBe(false);
    const { openDays: _o, captureCard: _c, ...old } = startFirstDays(D1, "o");
    expect(shouldShowCaptureCard({ record: old, today: D4, tickedEver: true, capturedEver: false, otherShowing: false, shownToday: {} })).toBe(false);
  });

  it("a long run of days: it shows on at most one day, never after Got it, and the one-card-a-day rule holds both ways", () => {
    for (const gotIt of [true, false]) {
      let record = startFirstDays(D1, "o");
      const shownDays: string[] = [];
      for (let n = 0; n < 12; n++) {
        const today = addDays(D1, n);
        record = openFirstDays(record, { today, launch: `L${n}`, open: `O${n}` });
        record = noteOpenDay(record, today);
        const show = shouldShowCaptureCard({ record, today, tickedEver: true, capturedEver: false, otherShowing: false, shownToday: {} });
        if (show) {
          shownDays.push(today);
          record = markCaptureCardShown(record, today);
          expect(captureCardShownOn(record, today)).toBe(true);
          if (gotIt) record = finishCaptureCard(record);
        } else {
          // Not showing: the other cards are free on this day unless it is the capture card's own.
          expect(captureCardShownOn(record, today)).toBe(false);
        }
      }
      expect(shownDays).toHaveLength(1);
      expect(shownDays[0]).toBe(D3);
    }
  });
});

describe("the date tip, over every saved list", () => {
  const item = (when: ParkedTask["when"]): ParkedTask => ({ id: Math.random().toString(36), text: "x", parkedAt: "", ...(when ? { when } : {}) });
  const lists = [[], [item(undefined)], [item({ date: "2026-10-30", kind: "on" })], [item(undefined), item({ date: "2026-11-02", kind: "by" })]];

  it("is shown only while never closed and no saved item has a day", () => {
    for (const parkedTasks of lists) {
      for (const savedDateTipDone of [true, false, undefined]) {
        const dated = parkedTasks.some((p) => p.when);
        expect(showSavedDateTip({ parkedTasks, savedDateTipDone })).toBe(savedDateTipDone !== true && !dated);
      }
    }
  });

  it("once a dated item has been seen the flag is set for good: gone with the item, and after a save and reload", () => {
    const base = { ...buildInitialState(new Date(2026, 9, 26)), hasSeenOnboarding: true };
    const dated: AppState = withSavedDateTip({ ...base, parkedTasks: [item({ date: "2026-10-30", kind: "on" })] });
    expect(dated.savedDateTipDone).toBe(true);
    const gone: AppState = withSavedDateTip({ ...dated, parkedTasks: [] });
    expect(showSavedDateTip(gone)).toBe(false);
    const reloaded = normalizeState(JSON.parse(JSON.stringify(gone)))!;
    expect(reloaded.savedDateTipDone).toBe(true);
    expect(showSavedDateTip(reloaded)).toBe(false);
    // Closed without ever saving a dated item: also kept through a reload.
    const closed = normalizeState(JSON.parse(JSON.stringify({ ...base, savedDateTipDone: true, parkedTasks: [item(undefined)] })))!;
    expect(showSavedDateTip(closed)).toBe(false);
  });
});
