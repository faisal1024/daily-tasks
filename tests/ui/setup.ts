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
