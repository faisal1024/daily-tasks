// Today's calendar events and reminders (iOS EventKit via expo-calendar),
// read only when the user turns it on in Settings. Formatted into short lines
// that go with plan and brain-dump requests so the three fit around the day.

import { Platform } from "react-native";
import * as Calendar from "expo-calendar";

export const MAX_AGENDA_ITEMS = 12;
export const MAX_AGENDA_TEXT = 120;
// Leaves room for the "09:30 " / "Reminder: " prefix within MAX_AGENDA_TEXT.
const MAX_TITLE = 100;
// How far back overdue reminders are still worth mentioning.
const OVERDUE_DAYS = 30;

export type AgendaAccess = "granted" | "denied" | "undetermined" | "unsupported";

export interface AgendaEvent {
  title: string;
  start: Date;
  allDay: boolean;
}

export interface AgendaReminder {
  title: string;
  due: Date | null;
}

function cleanTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join("").trimEnd()}…` : text;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * The lines sent with AI requests: timed events in order ("09:30 Dentist"),
 * then all-day events, then reminders ("Reminder: Pay rent", "(overdue)" when
 * due before today). At most MAX_AGENDA_ITEMS, never duplicated.
 */
export function formatAgenda(
  events: AgendaEvent[],
  reminders: AgendaReminder[],
  now: Date = new Date(),
): string[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const timed = events
    .filter((event) => !event.allDay)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const key = line.toLowerCase();
    if (seen.has(key) || lines.length >= MAX_AGENDA_ITEMS) return;
    seen.add(key);
    lines.push(line);
  };
  for (const event of timed) {
    const title = cleanTitle(event.title);
    if (title) push(`${hhmm(event.start)} ${title}`);
  }
  for (const event of events.filter((item) => item.allDay)) {
    const title = cleanTitle(event.title);
    if (title) push(`All day: ${title}`);
  }
  // Today's first, then the most recently overdue: old ones mustn't crowd them out.
  const byDue = [...reminders].sort((a, b) => (b.due?.getTime() ?? -Infinity) - (a.due?.getTime() ?? -Infinity));
  for (const reminder of byDue) {
    const title = cleanTitle(reminder.title);
    if (!title) continue;
    const overdue = reminder.due !== null && reminder.due.getTime() < startOfToday.getTime();
    push(`Reminder: ${title}${overdue ? " (overdue)" : ""}`);
  }
  return lines;
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapAccess(calendar: Calendar.PermissionResponse, reminders: Calendar.PermissionResponse): AgendaAccess {
  // Either one is enough to be useful; ask again only if both can be asked.
  if (calendar.granted || reminders.granted) return "granted";
  if (calendar.canAskAgain === false && reminders.canAskAgain === false) return "denied";
  return "undetermined";
}

export async function getAgendaAccess(): Promise<AgendaAccess> {
  if (Platform.OS !== "ios") return "unsupported";
  try {
    const [calendar, reminders] = await Promise.all([
      Calendar.getCalendarPermissionsAsync(),
      Calendar.getRemindersPermissionsAsync(),
    ]);
    return mapAccess(calendar, reminders);
  } catch {
    return "unsupported";
  }
}

export async function requestAgendaAccess(): Promise<AgendaAccess> {
  if (Platform.OS !== "ios") return "unsupported";
  try {
    // One after the other: iOS shows one permission alert at a time.
    const calendar = await Calendar.requestCalendarPermissionsAsync();
    const reminders = await Calendar.requestRemindersPermissionsAsync();
    return mapAccess(calendar, reminders);
  } catch {
    return "unsupported";
  }
}

/**
 * Read today's events and the reminders due by the end of today (including
 * overdue ones). Whatever can't be read (no access, an error) is skipped, so
 * this never throws; an empty list means "nothing to add to the prompt".
 */
export async function readTodayAgenda(now: Date = new Date()): Promise<string[]> {
  if (Platform.OS !== "ios") return [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const events: AgendaEvent[] = [];
  const reminders: AgendaReminder[] = [];
  try {
    const permission = await Calendar.getCalendarPermissionsAsync();
    if (permission.granted) {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      // Not birthdays/holidays or subscribed feeds: noise, other people's
      // names, and a route for spam invites into the prompt.
      const ids = calendars
        .filter(
          (calendar) =>
            calendar.type !== Calendar.CalendarType.BIRTHDAYS &&
            calendar.type !== Calendar.CalendarType.SUBSCRIBED,
        )
        .map((calendar) => calendar.id);
      if (ids.length > 0) {
        for (const event of await Calendar.getEventsAsync(ids, start, end)) {
          const eventStart = toDate(event.startDate);
          if (!eventStart || event.status === Calendar.EventStatus.CANCELED) continue;
          events.push({ title: event.title, start: eventStart, allDay: Boolean(event.allDay) });
        }
      }
    }
  } catch {
    // No events this time.
  }
  try {
    const permission = await Calendar.getRemindersPermissionsAsync();
    if (permission.granted) {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
      const ids = calendars.map((calendar) => calendar.id);
      if (ids.length > 0) {
        // expo-calendar requires a start date with a status filter.
        const since = new Date(start.getFullYear(), start.getMonth(), start.getDate() - OVERDUE_DAYS);
        const due = await Calendar.getRemindersAsync(ids, Calendar.ReminderStatus.INCOMPLETE, since, end);
        for (const reminder of due) {
          if (reminder.completed) continue;
          reminders.push({ title: reminder.title ?? "", due: toDate(reminder.dueDate) });
        }
      }
    }
  } catch {
    // No reminders this time.
  }
  return formatAgenda(events, reminders, now);
}
