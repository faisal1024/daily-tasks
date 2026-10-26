// Jest setup for React Native component tests (jest-expo preset).
import "react-native-gesture-handler/jestSetup";

// Clock times follow the device's locale and 12/24-hour setting (formatTime).
// The tests' device is en-US, whatever machine runs them, so "2:07 PM" is
// "2:07 PM" everywhere. A plain assignment, so jest.restoreAllMocks leaves it.
const deviceToLocaleTimeString = Date.prototype.toLocaleTimeString;
// eslint-disable-next-line no-extend-native -- pins the tests' locale; nothing is added to Date
Date.prototype.toLocaleTimeString = function toLocaleTimeString(
  this: Date,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) {
  return deviceToLocaleTimeString.call(this, locales ?? "en-US", options);
};

// jest.mock factories are hoisted above imports, so they must use require().
// eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
jest.mock("react-native-reanimated", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  ...require("react-native-reanimated/mock"),
  // Not in the library's mock; the app reads it for Reduce Motion. A jest.fn so
  // a test can turn Reduce Motion on (mockReturnValue(true)).
  useReducedMotion: jest.fn(() => false),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// "Share your day" (1.5 D): the picture is a file on the device; no native module in tests.
jest.mock("react-native-view-shot", () => ({
  captureRef: jest.fn(async () => "/tmp/three-today-share.png"),
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Calendar/Reminders (EventKit): no access by default in tests.
jest.mock("expo-calendar", () => {
  const denied = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };
  return {
    EntityTypes: { EVENT: "event", REMINDER: "reminder" },
    EventStatus: { CANCELED: "canceled" },
    CalendarType: { LOCAL: "local", CALDAV: "caldav", SUBSCRIBED: "subscribed", BIRTHDAYS: "birthdays" },
    ReminderStatus: { INCOMPLETE: "incomplete", COMPLETED: "completed" },
    getCalendarPermissionsAsync: jest.fn(async () => denied),
    getRemindersPermissionsAsync: jest.fn(async () => denied),
    requestCalendarPermissionsAsync: jest.fn(async () => denied),
    requestRemindersPermissionsAsync: jest.fn(async () => denied),
    getCalendarsAsync: jest.fn(async () => []),
    getEventsAsync: jest.fn(async () => []),
    // Like the library: a status filter needs a start date.
    getRemindersAsync: jest.fn(async (_ids: string[], status: unknown, startDate: unknown) => {
      if (status && !startDate) {
        throw new Error("getRemindersAsync must be called with a startDate (date) to search for reminders");
      }
      return [];
    }),
  };
});

// The native time picker (TimePickerRow): a host View that keeps the props, so
// tests can read `value` and fire `onChange(event, date)`. Android's dialog is a
// jest.fn (DateTimePickerAndroid.open).
jest.mock("@react-native-community/datetimepicker", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  require("./mocks/datetimepicker"),
);

// "What's new" (1.4) would come up on Today in every test that opens a saved
// state from before it. Off by default; its own tests turn the released
// announcements back on (__setAnnouncementsForTests(null)).
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- after the mocks above
  require("@/lib/daily-tasks/whats-new").__setAnnouncementsForTests([]);
});
