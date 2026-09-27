// Jest setup for React Native component tests (jest-expo preset).
import "react-native-gesture-handler/jestSetup";

// jest.mock factories are hoisted above imports, so they must use require().
// eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
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
    ReminderStatus: { INCOMPLETE: "incomplete", COMPLETED: "completed" },
    getCalendarPermissionsAsync: jest.fn(async () => denied),
    getRemindersPermissionsAsync: jest.fn(async () => denied),
    requestCalendarPermissionsAsync: jest.fn(async () => denied),
    requestRemindersPermissionsAsync: jest.fn(async () => denied),
    getCalendarsAsync: jest.fn(async () => []),
    getEventsAsync: jest.fn(async () => []),
    getRemindersAsync: jest.fn(async () => []),
  };
});
