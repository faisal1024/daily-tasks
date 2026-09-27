// Today's agenda: formatting (pure) and reading EventKit through expo-calendar
// (mocked in setup.ts with no access; each test grants what it needs).
import * as Calendar from "expo-calendar";

import {
  formatAgenda,
  readTodayAgenda,
  requestAgendaAccess,
  type AgendaEvent,
} from "@/lib/daily-tasks/agenda";

const NOW = new Date(2026, 8, 27, 8, 0);
const at = (h: number, m = 0, day = 27) => new Date(2026, 8, day, h, m);
const GRANTED = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
const DENIED = { granted: false, canAskAgain: false, status: "denied", expires: "never" };

const mocked = Calendar as unknown as Record<string, jest.Mock>;

const NO_ACCESS = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };

afterEach(() => {
  jest.clearAllMocks();
  // Back to setup.ts's defaults (no access, nothing to read) even if a test failed.
  mocked.getCalendarPermissionsAsync.mockImplementation(async () => NO_ACCESS);
  mocked.getRemindersPermissionsAsync.mockImplementation(async () => NO_ACCESS);
  mocked.getCalendarsAsync.mockImplementation(async () => []);
});

describe("formatAgenda", () => {
  it("lists timed events in time order with HH:MM, then all-day events, then reminders", () => {
    const events: AgendaEvent[] = [
      { title: "Standup", start: at(14, 5), allDay: false },
      { title: "Holiday", start: at(0), allDay: true },
      { title: "Dentist", start: at(9, 30), allDay: false },
    ];
    const lines = formatAgenda(
      events,
      [
        { title: "Pay rent", due: at(9, 0, 25) },
        { title: "Call mum", due: at(18) },
        { title: "Someday", due: null },
      ],
      NOW,
    );
    expect(lines).toEqual([
      "09:30 Dentist",
      "14:05 Standup",
      "All day: Holiday",
      // Latest due first (today before overdue), undated last.
      "Reminder: Call mum",
      "Reminder: Pay rent (overdue)",
      "Reminder: Someday",
    ]);
  });

  it("only marks reminders due before today as overdue (earlier today isn't)", () => {
    const lines = formatAgenda(
      [],
      [
        { title: "Early today", due: at(0, 1) },
        { title: "Late yesterday", due: at(23, 59, 26) },
      ],
      NOW,
    );
    expect(lines).toEqual(["Reminder: Early today", "Reminder: Late yesterday (overdue)"]);
  });

  it("cleans titles: collapses whitespace, skips blanks and non-strings, caps at 100 code points with …", () => {
    const long = "😀".repeat(150);
    const lines = formatAgenda(
      [
        { title: "  Team \n  sync  ", start: at(10), allDay: false },
        { title: "   ", start: at(11), allDay: false },
        { title: 42 as unknown as string, start: at(12), allDay: false },
      ],
      [{ title: long, due: null }],
      NOW,
    );
    expect(lines[0]).toBe("10:00 Team sync");
    expect(lines).toHaveLength(2);
    const reminder = lines[1];
    const title = reminder.replace("Reminder: ", "");
    expect(Array.from(title)).toHaveLength(100);
    expect(title.endsWith("…")).toBe(true);
    // No broken surrogate pair before the ellipsis.
    expect(title).toBe(`${"😀".repeat(99)}…`);
    // The whole line stays within the proxy's 120-code-point limit.
    expect(Array.from(reminder).length).toBeLessThanOrEqual(120);
  });

  it("old overdue reminders can't crowd today's out of the 12", () => {
    const old = Array.from({ length: 15 }, (_, i) => ({ title: `Old ${i}`, due: at(9, 0, 1 + i) }));
    const lines = formatAgenda([], [...old, { title: "Due today", due: at(17) }], NOW);
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("Reminder: Due today");
    expect(lines[1]).toBe("Reminder: Old 14 (overdue)");
  });

  it("drops case-insensitive duplicates and keeps at most 12 lines", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      title: `Event ${i}`,
      start: at(6, i),
      allDay: false,
    }));
    const deduped = formatAgenda(
      [
        { title: "Gym", start: at(7), allDay: false },
        { title: "GYM", start: at(7), allDay: false },
      ],
      [
        { title: "Pay rent", due: null },
        { title: "pay RENT", due: null },
      ],
      NOW,
    );
    expect(deduped).toEqual(["07:00 Gym", "Reminder: Pay rent"]);
    const capped = formatAgenda(events, [{ title: "Pay rent", due: null }], NOW);
    expect(capped).toHaveLength(12);
    expect(capped[11]).toBe("06:11 Event 11");
  });
});

describe("readTodayAgenda", () => {
  it("returns nothing without access (and reads nothing)", async () => {
    expect(await readTodayAgenda(NOW)).toEqual([]);
    expect(mocked.getEventsAsync).not.toHaveBeenCalled();
    expect(mocked.getRemindersAsync).not.toHaveBeenCalled();
  });

  it("with access, formats today's events (skipping cancelled) and incomplete reminders due by tonight", async () => {
    mocked.getCalendarPermissionsAsync.mockResolvedValueOnce(GRANTED);
    mocked.getRemindersPermissionsAsync.mockResolvedValueOnce(GRANTED);
    mocked.getCalendarsAsync.mockImplementation(async (type: string) =>
      type === "event"
        ? [
            { id: "cal1", type: "local" },
            { id: "bdays", type: "birthdays" },
            { id: "feed", type: "subscribed" },
          ]
        : [{ id: "rem1" }],
    );
    mocked.getEventsAsync.mockResolvedValueOnce([
      { title: "Lunch", startDate: at(12).toISOString(), allDay: false, status: "confirmed" },
      { title: "Cancelled call", startDate: at(10).toISOString(), allDay: false, status: "canceled" },
      { title: "Bad date", startDate: "not a date", allDay: false },
      { title: "Birthday", startDate: at(0).toISOString(), allDay: true },
    ]);
    const libraryReminders = mocked.getRemindersAsync.getMockImplementation();
    mocked.getRemindersAsync.mockImplementationOnce(async (...args: unknown[]) => {
      await libraryReminders?.(...args); // throws without a start date, like expo-calendar
      return [
      { title: "Pay rent", dueDate: at(9, 0, 20).toISOString(), completed: false },
      { title: "Done already", dueDate: at(9).toISOString(), completed: true },
      { title: "Buy milk", dueDate: null, completed: false },
      ];
    });

    expect(await readTodayAgenda(NOW)).toEqual([
      "12:00 Lunch",
      "All day: Birthday",
      "Reminder: Pay rent (overdue)",
      "Reminder: Buy milk",
    ]);
    const [ids, start, end] = mocked.getEventsAsync.mock.calls[0];
    // Birthdays and subscribed feeds are skipped.
    expect(ids).toEqual(["cal1"]);
    expect(start).toEqual(at(0));
    expect(end).toEqual(at(0, 0, 28));
    const [remIds, status, remStart, remEnd] = mocked.getRemindersAsync.mock.calls[0];
    expect(remIds).toEqual(["rem1"]);
    expect(status).toBe("incomplete");
    // Regression: a status filter needs a start date (30 days back for overdue ones).
    expect(remStart).toEqual(at(0, 0, 27 - 30));
    expect(remEnd).toEqual(at(0, 0, 28));
  });

  it("an error reading events still returns the reminders (and vice versa)", async () => {
    mocked.getCalendarPermissionsAsync.mockImplementation(async () => GRANTED);
    mocked.getRemindersPermissionsAsync.mockImplementation(async () => GRANTED);
    mocked.getCalendarsAsync.mockImplementation(async (type: string) => [{ id: type }]);

    mocked.getEventsAsync.mockRejectedValueOnce(new Error("EventKit"));
    mocked.getRemindersAsync.mockResolvedValueOnce([{ title: "Pay rent", dueDate: null, completed: false }]);
    expect(await readTodayAgenda(NOW)).toEqual(["Reminder: Pay rent"]);

    mocked.getEventsAsync.mockResolvedValueOnce([{ title: "Lunch", startDate: at(12), allDay: false }]);
    mocked.getRemindersAsync.mockRejectedValueOnce(new Error("EventKit"));
    expect(await readTodayAgenda(NOW)).toEqual(["12:00 Lunch"]);
  });
});

describe("requestAgendaAccess", () => {
  it("is granted when either calendars or reminders is granted", async () => {
    mocked.requestCalendarPermissionsAsync.mockResolvedValueOnce(DENIED);
    mocked.requestRemindersPermissionsAsync.mockResolvedValueOnce(GRANTED);
    expect(await requestAgendaAccess()).toBe("granted");

    mocked.requestCalendarPermissionsAsync.mockResolvedValueOnce(GRANTED);
    mocked.requestRemindersPermissionsAsync.mockResolvedValueOnce(DENIED);
    expect(await requestAgendaAccess()).toBe("granted");
  });

  it("is denied only when neither can be asked again, otherwise undetermined", async () => {
    mocked.requestCalendarPermissionsAsync.mockResolvedValueOnce(DENIED);
    mocked.requestRemindersPermissionsAsync.mockResolvedValueOnce(DENIED);
    expect(await requestAgendaAccess()).toBe("denied");

    mocked.requestCalendarPermissionsAsync.mockResolvedValueOnce(DENIED);
    mocked.requestRemindersPermissionsAsync.mockResolvedValueOnce({ ...DENIED, canAskAgain: true });
    expect(await requestAgendaAccess()).toBe("undetermined");
  });
});
