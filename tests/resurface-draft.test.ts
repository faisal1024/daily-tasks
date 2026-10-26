// 1.6 F, the evening draft (Plus): saved items due tomorrow go first in
// tomorrow's draft, once each, at most three; and the morning card says
// "Due today" under them. Pure, on the device, so it works the same with an
// old Worker or the on-device close.
import { describe, expect, it } from "vitest";

import { draftDueReasons, savedDueOn, withDueTomorrow } from "../lib/daily-tasks/resurface";
import type { ParkedTask, TaskWhen } from "../lib/daily-tasks/types";

const DAY = "2026-10-26"; // the evening being closed
const TOMORROW = "2026-10-27";
const on = (date: string): TaskWhen => ({ date, kind: "on" });
const by = (date: string): TaskWhen => ({ date, kind: "by" });
let n = 0;
const item = (text: string, when?: TaskWhen): ParkedTask => ({
  id: `p${n++}`,
  text,
  parkedAt: "2026-10-20T08:00:00.000Z",
  ...(when ? { when } : {}),
});

const close = (tomorrow: string[], because = "Picking up where today left off.") => ({
  note: "A good day.",
  because,
  tomorrow,
  memory: null,
  source: "ai" as const,
});

describe("withDueTomorrow", () => {
  it("puts the items due tomorrow first, then the coach's own, and leaves the other fields alone", () => {
    const result = withDueTomorrow(close(["Stretch", "Read"]), [item("Send deck", on(TOMORROW))], DAY);
    expect(result.tomorrow).toEqual(["Send deck", "Stretch", "Read"]);
    expect(result).toMatchObject({ note: "A good day.", because: "Picking up where today left off.", source: "ai", memory: null });
  });

  it("is the very same draft when nothing is due tomorrow", () => {
    const original = close(["Stretch"]);
    const parked = [
      item("Today's", on(DAY)),
      item("Day after", on("2026-10-28")),
      item("Yesterday's", on("2026-10-25")),
      item("Undated"),
    ];
    expect(withDueTomorrow(original, parked, DAY)).toBe(original);
    expect(withDueTomorrow(original, [], DAY)).toBe(original);
  });

  it("includes a deadline whose last day is tomorrow, but not one due later", () => {
    const result = withDueTomorrow(close([]), [item("Passport", by(TOMORROW)), item("Taxes", by("2026-10-30"))], DAY);
    expect(result.tomorrow).toEqual(["Passport"]);
  });

  it("lists each wording once, even when it is also in the coach's draft or saved twice", () => {
    const result = withDueTomorrow(
      close(["send   DECK", "Stretch"]),
      [item("Send deck", on(TOMORROW)), item(" send deck ", on(TOMORROW)), item("Call mum", on(TOMORROW))],
      DAY,
    );
    expect(result.tomorrow).toEqual(["Send deck", "Call mum", "Stretch"]);
  });

  it("never drafts more than three, due items first, saved order", () => {
    const parked = ["A", "B", "C", "D"].map((t) => item(t, on(TOMORROW)));
    expect(withDueTomorrow(close(["Stretch"]), parked, DAY).tomorrow).toEqual(["A", "B", "C"]);
    expect(withDueTomorrow(close(["Stretch", "Read"]), [parked[0], parked[1]], DAY).tomorrow).toEqual(["A", "B", "Stretch"]);
    expect(withDueTomorrow(close([]), parked.slice(0, 3), DAY).tomorrow).toHaveLength(3);
  });

  it("with nothing else drafted, the because line says why (one item or several)", () => {
    expect(withDueTomorrow(close([], "Nothing to carry."), [item("Send deck", on(TOMORROW))], DAY).because).toBe(
      "Something you saved is due tomorrow.",
    );
    expect(
      withDueTomorrow(close([], "Nothing to carry."), [item("A", on(TOMORROW)), item("B", on(TOMORROW))], DAY).because,
    ).toBe("A few things you saved are due tomorrow.");
  });

  it("keeps the coach's because line when the coach drafted something", () => {
    expect(withDueTomorrow(close(["Stretch"], "Lighter tomorrow."), [item("Send deck", on(TOMORROW))], DAY).because).toBe(
      "Lighter tomorrow.",
    );
  });

  it("finds tomorrow across a month end, a year end, a leap day and the clock changes", () => {
    const cases: [string, string][] = [
      ["2026-01-31", "2026-02-01"],
      ["2026-12-31", "2027-01-01"],
      ["2028-02-28", "2028-02-29"],
      ["2027-02-28", "2027-03-01"],
      ["2026-03-07", "2026-03-08"],
      ["2026-03-08", "2026-03-09"],
      ["2026-10-31", "2026-11-01"],
      ["2026-11-01", "2026-11-02"],
    ];
    for (const [day, tomorrow] of cases) {
      expect(withDueTomorrow(close([]), [item("Due", on(tomorrow))], day).tomorrow, day).toEqual(["Due"]);
    }
  });
});

describe("savedDueOn and draftDueReasons", () => {
  it("lists a day's items oldest first, one per wording", () => {
    expect(
      savedDueOn([item("B", on(TOMORROW)), item("x"), item("a", on(TOMORROW)), item("b", on(TOMORROW))], TOMORROW),
    ).toEqual(["B", "a"]);
  });

  it("says Due today under a drafted task whose saved date is today, matched loosely", () => {
    const parked = [item("Send deck", on(DAY)), item("Passport", by("2026-10-30")), item("Call mum")];
    expect(draftDueReasons(["send  DECK", "Passport", "Call mum", "Stretch"], parked, DAY)).toEqual({
      "send  DECK": "Due today",
      Passport: "Due Friday",
    });
  });

  it("gives nothing for a date far off, past, or none", () => {
    const parked = [item("Far", on("2026-12-01")), item("Past", on("2026-10-20"))];
    expect(draftDueReasons(["Far", "Past", "Nope"], parked, DAY)).toEqual({});
  });
});
