// 1.6 F: the on-device soft date (parseLocalWhen) and how it is shown
// (whenLabel / dueReason / savedItemsView). Dates are local date keys; the
// expected days are worked out with UTC arithmetic here (not the code's own
// addDays), so these hold in any timezone and across DST, month and year ends.
import { describe, expect, it } from "vitest";

import { dueReason, normalizeWhen, parseLocalWhen, savedItemsView, whenChoices, whenLabel } from "../lib/daily-tasks/resurface";
import type { ParkedTask, TaskWhen } from "../lib/daily-tasks/types";

/** `key` plus `n` days, by UTC arithmetic. */
function plus(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0 = Sunday, from the key alone. */
function dow(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** 2026-10-25 is a Sunday: the seven days of one week. */
const WEEK = Array.from({ length: 7 }, (_, i) => plus("2026-10-25", i));

const on = (date: string): TaskWhen => ({ date, kind: "on" });
const by = (date: string): TaskWhen => ({ date, kind: "by" });

describe("parseLocalWhen: today, tonight, tomorrow", () => {
  it.each(WEEK)("reads them against %s", (today) => {
    expect(parseLocalWhen("Call the bank today", today)).toEqual(on(today));
    expect(parseLocalWhen("Pack tonight", today)).toEqual(on(today));
    expect(parseLocalWhen("Send the deck tomorrow", today)).toEqual(on(plus(today, 1)));
    expect(parseLocalWhen("Send the deck tmrw", today)).toEqual(on(plus(today, 1)));
  });

  it("crosses a month end, a year end and a leap day", () => {
    expect(parseLocalWhen("Rent tomorrow", "2026-01-31")).toEqual(on("2026-02-01"));
    expect(parseLocalWhen("Rent tomorrow", "2026-12-31")).toEqual(on("2027-01-01"));
    expect(parseLocalWhen("Rent tomorrow", "2028-02-28")).toEqual(on("2028-02-29"));
    expect(parseLocalWhen("Rent tomorrow", "2027-02-28")).toEqual(on("2027-03-01"));
  });

  it("crosses the days the US changes its clocks", () => {
    expect(parseLocalWhen("Brunch tomorrow", "2026-03-07")).toEqual(on("2026-03-08"));
    expect(parseLocalWhen("Brunch tomorrow", "2026-03-08")).toEqual(on("2026-03-09"));
    expect(parseLocalWhen("Brunch Monday", "2026-03-07")).toEqual(on("2026-03-09"));
    expect(parseLocalWhen("Brunch Saturday", "2026-10-31")).toEqual(on("2026-10-31"));
    expect(parseLocalWhen("Brunch tomorrow", "2026-10-31")).toEqual(on("2026-11-01"));
    expect(parseLocalWhen("Brunch Monday", "2026-11-01")).toEqual(on("2026-11-02"));
    expect(parseLocalWhen("Brunch next week", "2026-11-01")).toEqual(on("2026-11-02"));
  });
});

describe("parseLocalWhen: weekday names", () => {
  // Every weekday read on every day: the next one, and today for the same name.
  it.each(WEEK)("finds the next of each weekday from %s (the same weekday is today)", (today) => {
    NAMES.forEach((name, target) => {
      const ahead = (target - dow(today) + 7) % 7;
      expect(parseLocalWhen(`Deck for ${name}`, today), `${name} from ${today}`).toEqual(on(plus(today, ahead)));
    });
    // Same weekday as today is today, not next week.
    expect(parseLocalWhen(`Deck on ${NAMES[dow(today)]}`, today)).toEqual(on(today));
  });

  it("accepts capitals and short forms only after a cue word", () => {
    expect(parseLocalWhen("Deck for TUESDAY", "2026-10-26")).toEqual(on("2026-10-27"));
    expect(parseLocalWhen("Deck by fri", "2026-10-26")).toEqual(by("2026-10-30"));
    expect(parseLocalWhen("Deck on Thurs.", "2026-10-26")).toEqual(on("2026-10-29"));
    // Bare "sun", "wed", "mon", "sat" are words, not days.
    for (const text of ["Buy sun cream", "Get married in wed", "Sat down with Sam", "Mon ami"]) {
      expect(parseLocalWhen(text, "2026-10-26"), text).toBeNull();
    }
  });

  it('"next Tuesday" on a Tuesday is a week on; on any other day it is the coming one', () => {
    expect(parseLocalWhen("Deck next Tuesday", "2026-10-27")).toEqual(on("2026-11-03"));
    expect(parseLocalWhen("Deck next Tuesday", "2026-10-26")).toEqual(on("2026-10-27"));
    expect(parseLocalWhen("Deck next Tuesday", "2026-10-28")).toEqual(on("2026-11-03"));
  });
});

describe("parseLocalWhen: next week", () => {
  it.each(WEEK)('means the coming Monday from %s (a week on from a Monday; tomorrow from a Sunday)', (today) => {
    const ahead = dow(today) === 1 ? 7 : (1 - dow(today) + 7) % 7;
    const got = parseLocalWhen("Plan the trip next week", today);
    expect(got).toEqual(on(plus(today, ahead)));
    expect(dow(got!.date)).toBe(1);
  });

  it("is tomorrow on a Sunday, across a year end", () => {
    expect(parseLocalWhen("Review next week", "2026-12-27")).toEqual(on("2026-12-28"));
    expect(parseLocalWhen("Review next week", "2027-01-03")).toEqual(on("2027-01-04"));
    expect(parseLocalWhen("Review next week", "2026-12-31")).toEqual(on("2027-01-04"));
  });

  it("does not read a bare 'week' or 'this week'", () => {
    expect(parseLocalWhen("Clean up this week", "2026-10-26")).toBeNull();
    expect(parseLocalWhen("Week one of the plan", "2026-10-26")).toBeNull();
  });
});

describe("parseLocalWhen: deadlines", () => {
  it('"by" and "due" are deadlines on that day; "until" and "till" are just the day', () => {
    for (const cue of ["by", "due"]) {
      expect(parseLocalWhen(`Passport ${cue} Friday`, "2026-10-26"), cue).toEqual(by("2026-10-30"));
    }
    for (const cue of ["until", "till"]) {
      expect(parseLocalWhen(`Wait ${cue} Friday`, "2026-10-26"), cue).toEqual(on("2026-10-30"));
    }
    expect(parseLocalWhen("Taxes due tomorrow", "2026-10-26")).toEqual(by("2026-10-27"));
    expect(parseLocalWhen("Taxes by today", "2026-10-26")).toEqual(by("2026-10-26"));
  });

  it('"before X" is the day before X', () => {
    expect(parseLocalWhen("Passport before Friday", "2026-10-26")).toEqual(by("2026-10-29"));
    expect(parseLocalWhen("Passport before tomorrow", "2026-10-26")).toEqual(by("2026-10-26"));
    expect(parseLocalWhen("Passport before Monday", "2026-11-02")).toEqual(by("2026-11-08"));
  });

  it('"before <today\'s weekday>" is the day before the next one, not before today', () => {
    expect(parseLocalWhen("Passport before Monday", "2026-10-26")).toEqual(by("2026-11-01"));
  });

  it('"before today" is already past: no date', () => {
    expect(parseLocalWhen("Passport before today", "2026-10-26")).toBeNull();
  });

  it("a deadline wins when the same day is written both ways", () => {
    expect(parseLocalWhen("Friday, due Friday", "2026-10-26")).toEqual(by("2026-10-30"));
  });

  it("is a deadline across a month and year end", () => {
    expect(parseLocalWhen("Form by Friday", "2026-12-30")).toEqual(by("2027-01-01"));
    expect(parseLocalWhen("Form before Monday", "2026-12-31")).toEqual(by("2027-01-03"));
  });
});

describe("parseLocalWhen: never guesses", () => {
  it.each([
    ["two different days", "Call Monday or Tuesday"],
    ["two different days with cues", "Send it by Tuesday, or Thursday at the latest"],
    ["today and tomorrow", "Sort today or tomorrow"],
    ["every weekday name", "Gym every Monday"],
    ["each", "Water the plants each Friday"],
    ["every other", "Clean every other Tuesday"],
    ["plural weekdays", "Mondays are for planning"],
    ["a plural with a second day", "Plan on Mondays, finish Friday"],
    ["daily", "Stretch daily by noon"],
    ["weekly", "Weekly report due Friday"],
    ["every morning", "Check the mail every morning, tomorrow too"],
    ["a month", "Passport before March"],
    ["a numeric date", "Dentist 3/14"],
    ["a vague time", "Call Sam sometime soon"],
    ["no day at all", "Buy shoes"],
    ["empty", ""],
  ])("gives no date for %s", (_label, text) => {
    expect(parseLocalWhen(text, "2026-10-26")).toBeNull();
  });

  // Review fixes: words that look like days but aren't.
  it.each([
    ["an exam name in capitals", "Prep for SAT"],
    ["a short form after for", "Wear sunscreen for sun"],
    ["a capital short form after a cue", "Revise by SAT"],
    ["a possessive", "Reply to Tuesday's email"],
    ["a curly possessive", "Reply to Tuesday’s email"],
    ["a named day", "Black Friday deals"],
    ["another named day", "Cyber Monday sale"],
    ["a domain", "Monday.com setup"],
    ["a title", "Read Thursday Murder Club"],
    ["from a past day", "Answer the email from Monday"],
    ["since a past day", "Sore since Tuesday"],
    ["last weekday", "Follow up on last Friday's call"],
    ["last weekday, no possessive", "Notes from the meeting last Friday"],
  ])("gives no date for %s", (_label, text) => {
    expect(parseLocalWhen(text, "2026-10-26")).toBeNull();
  });

  it('"Wait until Friday" is Friday, not a deadline', () => {
    expect(parseLocalWhen("Wait until Friday", "2026-10-26")).toEqual(on("2026-10-30"));
  });

  it("a past day is skipped but a later one in the same item still counts", () => {
    expect(parseLocalWhen("Since Monday's call, send notes by Friday", "2026-10-26")).toEqual(by("2026-10-30"));
  });

  it("short forms still work after a day cue, lowercase or capitalised", () => {
    expect(parseLocalWhen("Rent by Fri", "2026-10-26")).toEqual(by("2026-10-30"));
    expect(parseLocalWhen("Gym on sat", "2026-10-26")).toEqual(on("2026-10-31"));
  });

  it("gives no date for a bad today or a non-string", () => {
    expect(parseLocalWhen("Call tomorrow", "2026-02-30")).toBeNull();
    expect(parseLocalWhen("Call tomorrow", "tomorrow")).toBeNull();
    expect(parseLocalWhen(undefined as unknown as string, "2026-10-26")).toBeNull();
  });

  it("repeating the same day is still that day", () => {
    expect(parseLocalWhen("Tuesday, yes Tuesday", "2026-10-26")).toEqual(on("2026-10-27"));
    expect(parseLocalWhen("Do it tomorrow, which is Tuesday", "2026-10-26")).toEqual(on("2026-10-27"));
  });
});

describe("normalizeWhen", () => {
  it("keeps a real date with a known kind; drops everything else", () => {
    expect(normalizeWhen({ date: "2026-10-27", kind: "on", extra: 1 })).toEqual(on("2026-10-27"));
    for (const bad of [
      null,
      undefined,
      "2026-10-27",
      [],
      {},
      { date: "2026-02-30", kind: "on" },
      { date: "2026-10-27", kind: "later" },
      { date: "27/10/2026", kind: "on" },
      { date: 20261027, kind: "on" },
    ]) {
      expect(normalizeWhen(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("with today: not past, at most 366 days ahead", () => {
    const today = "2026-10-26";
    expect(normalizeWhen(on(today), today)).toEqual(on(today));
    expect(normalizeWhen(on(plus(today, -1)), today)).toBeNull();
    expect(normalizeWhen(on(plus(today, 366)), today)).toEqual(on(plus(today, 366)));
    expect(normalizeWhen(on(plus(today, 367)), today)).toBeNull();
    expect(normalizeWhen(on(today), "not a day")).toBeNull();
  });
});

describe("how a date is shown", () => {
  const T = "2026-10-26"; // a Monday
  it("says Today, Tomorrow, a short weekday inside the week, else Month day", () => {
    expect(whenLabel(on(T), T)).toBe("Today");
    expect(whenLabel(on("2026-10-27"), T)).toBe("Tomorrow");
    expect(whenLabel(on("2026-10-28"), T)).toBe("Wed");
    expect(whenLabel(on("2026-11-01"), T)).toBe("Sun");
    // Seven days on would read as today's weekday: a date instead.
    expect(whenLabel(on("2026-11-02"), T)).toBe("Nov 2");
    // Another year says so.
    expect(whenLabel(on("2027-03-01"), T)).toBe("Mar 1, 2027");
    expect(whenLabel(on("2026-12-31"), T)).toBe("Dec 31");
  });

  it("marks a deadline with By", () => {
    expect(whenLabel(by("2026-10-30"), T)).toBe("By Fri");
    expect(whenLabel(by("2026-12-05"), T)).toBe("By Dec 5");
    expect(whenLabel(by("2026-10-27"), T)).toBe("By tomorrow");
  });

  it("once the day has passed: no label for a plan; Overdue for a deadline for a week, then none", () => {
    expect(whenLabel(on("2026-10-25"), T)).toBeNull();
    expect(whenLabel(on("2026-10-20"), T)).toBeNull();
    expect(whenLabel(by("2026-10-25"), T)).toBe("Overdue");
    expect(whenLabel(by("2026-10-19"), T)).toBe("Overdue"); // 7 days
    expect(whenLabel(by("2026-10-18"), T)).toBeNull(); // 8 days
  });

  it("a plan reads For …, a deadline Due … (or Overdue), for today, tomorrow and the next five days", () => {
    expect(dueReason(on(T), T)).toBe("For today");
    expect(dueReason(on("2026-10-27"), T)).toBe("For tomorrow");
    expect(dueReason(on("2026-10-30"), T)).toBe("For Friday");
    expect(dueReason(by(T), T)).toBe("Due today");
    expect(dueReason(by("2026-10-27"), T)).toBe("Due tomorrow");
    expect(dueReason(by("2026-10-30"), T)).toBe("Due Friday");
    expect(dueReason(by("2026-10-22"), T)).toBe("Overdue");
    expect(dueReason(on("2026-11-02"), T)).toBeNull();
    expect(dueReason(on("2026-10-25"), T)).toBeNull();
    expect(dueReason(by("2026-10-10"), T)).toBeNull();
  });

  it("Change day offers today, tomorrow and the next five weekdays", () => {
    expect(whenChoices(T)).toEqual([
      { label: "Today", date: T },
      { label: "Tomorrow", date: "2026-10-27" },
      { label: "Wednesday", date: "2026-10-28" },
      { label: "Thursday", date: "2026-10-29" },
      { label: "Friday", date: "2026-10-30" },
      { label: "Saturday", date: "2026-10-31" },
      { label: "Sunday", date: "2026-11-01" },
    ]);
  });
});

describe("savedItemsView (the Ideas order)", () => {
  const T = "2026-10-26";
  const item = (id: string, when?: ParkedTask["when"]): ParkedTask => ({
    id,
    text: `Item ${id}`,
    parkedAt: "2026-10-20T08:00:00.000Z",
    ...(when ? { when } : {}),
  });

  it("puts what is due today first, then the rest in saved order, and labels dated ones quietly", () => {
    const view = savedItemsView(
      [item("a"), item("b", on("2026-10-28")), item("c", on(T)), item("d"), item("e", by(T))],
      T,
    );
    expect(view.map((v) => v.id)).toEqual(["c", "e", "a", "b", "d"]);
    expect(view.map((v) => v.dueToday)).toEqual([true, true, false, false, false]);
    expect(view[0]).toMatchObject({ reason: "For today", label: "Today" });
    expect(view[1]).toMatchObject({ reason: "Due today", label: "By today" });
    expect(view[3]).toMatchObject({ label: "Wed" });
    expect(view[3].reason).toBeUndefined();
    // Undated: neither a label nor a reason.
    expect(view[2]).toEqual({ id: "a", text: "Item a", dueToday: false });
    // The stored date comes along, for Change day.
    expect(view[3].when).toEqual(on("2026-10-28"));
  });

  it("a plan whose day passed drops back quietly (no label); a deadline missed this week leads as Overdue", () => {
    const view = savedItemsView(
      [item("a"), item("o", on("2026-10-20")), item("t", on(T)), item("d", by("2026-10-23")), item("x", by("2026-10-01"))],
      T,
    );
    expect(view.map((v) => v.id)).toEqual(["t", "d", "a", "o", "x"]);
    expect(view[1]).toMatchObject({ label: "Overdue", reason: "Overdue", dueToday: true });
    expect(view[3]).toMatchObject({ id: "o", dueToday: false });
    expect(view[3].label).toBeUndefined();
    expect(view[3].reason).toBeUndefined();
    expect(view[4].label).toBeUndefined();
  });

  it("keeps the order when nothing is due today", () => {
    const view = savedItemsView([item("a", on("2026-10-27")), item("b"), item("c", on("2026-10-30"))], T);
    expect(view.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });
});
