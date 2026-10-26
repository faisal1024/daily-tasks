// 1.6 for new installs: the "Save for later from anywhere" Today card (around
// day three: two earlier days opened and something ticked; never on a day
// another first-days card showed; not once something was captured; once),
// and the widget tip that now names the Dump widget.
import { describe, expect, it } from "vitest";

import {
  addDays,
  CAPTURE_CARD_COPY,
  captureCardShownOn,
  finishCaptureCard,
  markCaptureCardShown,
  noteOpenDay,
  openFirstDays,
  shouldShowCaptureCard,
  startFirstDays,
  widgetTipCopy,
  type FirstDaysRecord,
} from "../lib/daily-tasks/first-days";

const D1 = "2026-10-20";
const D2 = addDays(D1, 1);
const D3 = addDays(D1, 2);
const D4 = addDays(D1, 3);

/** First run on D1, then the app opened on each of `days`. */
const openedOn = (...days: string[]): FirstDaysRecord =>
  days.reduce((record, day) => openFirstDays(record, { today: day, launch: `L-${day}`, open: `O-${day}` }), startFirstDays(D1, "first#0"));

const ask = (record: FirstDaysRecord | null, today: string, overrides: Partial<Parameters<typeof shouldShowCaptureCard>[0]> = {}) =>
  shouldShowCaptureCard({ record, today, tickedEver: true, capturedEver: false, otherShowing: false, shownToday: {}, ...overrides });

describe("when 'Save for later from anywhere' may show", () => {
  it("first run starts it waiting, with the first-run day as the first day opened", () => {
    const record = startFirstDays(D1, "first#0");
    expect(record.captureCard).toBe("waiting");
    expect(record.openDays).toEqual([D1]);
  });

  it("not on day one or day two: it needs two earlier days opened (the third day of use at the soonest)", () => {
    expect(ask(openedOn(D1), D1)).toBe(false);
    expect(ask(openedOn(D2), D2)).toBe(false);
    expect(ask(openedOn(D2, D3), D3)).toBe(true);
  });

  it("days count, not opens: many opens on two days are still two days", () => {
    let record = openedOn(D1, D1, D1);
    record = noteOpenDay(record, D1);
    expect(record.openDays).toEqual([D1]);
    // A gap is fine: the first run day and a day a week later are two days.
    const later = addDays(D1, 7);
    expect(ask(openedOn(later), later)).toBe(false);
    expect(ask(openedOn(later, addDays(later, 1)), addDays(later, 1))).toBe(true);
  });

  it("only once something has been ticked (ever)", () => {
    expect(ask(openedOn(D2, D3), D3, { tickedEver: false })).toBe(false);
  });

  it("not once something was saved from the share sheet or Siri", () => {
    expect(ask(openedOn(D2, D3), D3, { capturedEver: true })).toBe(false);
  });

  it("one card at a time: not while another first-days card shows", () => {
    expect(ask(openedOn(D2, D3), D3, { otherShowing: true })).toBe(false);
  });

  it("never on a day another first-days card showed, however it went; the next day it may", () => {
    for (const kind of ["nudge", "nag", "widget"] as const) {
      expect(ask(openedOn(D2, D3), D3, { shownToday: { [kind]: D3 } })).toBe(false);
      expect(ask(openedOn(D2, D3), D3, { shownToday: { [kind]: D2 } })).toBe(true);
    }
    expect(ask(openedOn(D2, D3, D4), D4, { shownToday: { nudge: D3 } })).toBe(true);
  });

  it("no record (an install from before 1.5) or a record from before 1.6: never", () => {
    expect(ask(null, D3)).toBe(false);
    const { captureCard: _a, openDays: _b, ...before16 } = openedOn(D2, D3);
    expect(ask(before16, D3)).toBe(false);
    // And no open days are counted for it.
    expect(noteOpenDay(before16, D4)).toBe(before16);
  });
});

describe("it shows once", () => {
  it("once it has shown it stays for the rest of that day, not another", () => {
    const shown = markCaptureCardShown(openedOn(D2, D3), D3);
    expect(shown).toMatchObject({ captureCard: "shown", captureCardOn: D3 });
    expect(shown.openDays).toBeUndefined();
    expect(ask(shown, D3)).toBe(true);
    // Not tapped: the next open on a later day retires it.
    const nextDay = openFirstDays(shown, { today: D4, launch: "L2", open: "O2" });
    expect(nextDay.captureCard).toBe("done");
    expect(ask(nextDay, D4)).toBe(false);
    // A relaunch on the same day keeps it.
    expect(openFirstDays(shown, { today: D3, launch: "L3", open: "O3" }).captureCard).toBe("shown");
  });

  it("'Got it' ends it for good", () => {
    const done = finishCaptureCard(markCaptureCardShown(openedOn(D2, D3), D3));
    expect(done.captureCard).toBe("done");
    expect(ask(done, D3)).toBe(false);
    expect(ask(openFirstDays(done, { today: D4 }), D4)).toBe(false);
    expect(finishCaptureCard(done)).toBe(done);
  });

  it("the day it showed is the capture card's own: the other cards wait for another day", () => {
    const shown = markCaptureCardShown(openedOn(D2, D3), D3);
    expect(captureCardShownOn(shown, D3)).toBe(true);
    expect(captureCardShownOn(finishCaptureCard(shown), D3)).toBe(true);
    expect(captureCardShownOn(finishCaptureCard(shown), D4)).toBe(false);
    expect(captureCardShownOn(openedOn(D2, D3), D3)).toBe(false);
    expect(captureCardShownOn(null, D3)).toBe(false);
  });

  it("marking is only from waiting", () => {
    const done = finishCaptureCard(markCaptureCardShown(openedOn(D2, D3), D3));
    expect(markCaptureCardShown(done, D4)).toBe(done);
  });
});

describe("the words", () => {
  it("the capture card's, exactly", () => {
    expect(CAPTURE_CARD_COPY).toEqual({
      title: "Save for later from anywhere",
      body: "Share from any app, or tell Siri “Save for later in Three Today”. It waits in Ideas, never on today's three.",
      showMe: "Show me",
      hide: "Hide how",
      gotIt: "Got it",
    });
  });

  it("the widget tip names the Dump widget, in two sentences", () => {
    const copy = widgetTipCopy("Three Today");
    expect(copy.title).toBe("Keep your three on your Home Screen");
    expect(copy.body).toBe(
      "Touch and hold an empty spot on your Home Screen, tap Edit, then Add Widget, and search for Three Today. The Dump widget is a Lock Screen or Home Screen button that opens a brain dump.",
    );
    expect(copy.body.split(/(?<=\.)\s+/)).toHaveLength(2);
  });
});
