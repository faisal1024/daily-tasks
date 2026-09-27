// Widget bridge: App Group storage through the local WidgetStorage module (mocked).
import { Platform } from "react-native";

import {
  __resetWidgetBridgeForTests,
  invalidateWidgetSnapshot,
  markWidgetTogglesProcessed,
  readWidgetToggles,
  writeWidgetSnapshot,
} from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot } from "@/lib/daily-tasks/widget-snapshot";

const GROUP = "group.com.faisalislam.dailytasks";

const mockStrings = new Map<string, string>();
const mockInts = new Map<string, number>();
const mockNative = {
  setString: jest.fn((key: string, value: string) => void mockStrings.set(key, value)),
  getString: jest.fn((key: string) => mockStrings.get(key) ?? null),
  setInt: jest.fn((key: string, value: number) => void mockInts.set(key, value)),
  // UserDefaults.integer(forKey:) is 0 when missing.
  getInt: jest.fn((key: string) => mockInts.get(key) ?? 0),
  reloadWidget: jest.fn(),
};
let mockAvailable = true;
jest.mock("@/modules/widget-storage", () => ({
  loadWidgetStorage: () => (mockAvailable ? mockNative : null),
}));

const SNAPSHOT: WidgetSnapshot = {
  date: "2026-09-26",
  tasks: [{ id: "a", text: "Walk", done: false }],
  streak: 2,
  plus: true,
};

const originalOS = Platform.OS;

beforeEach(() => {
  __resetWidgetBridgeForTests();
  mockStrings.clear();
  mockInts.clear();
  jest.clearAllMocks();
  mockAvailable = true;
  Platform.OS = "ios";
});

afterAll(() => {
  Platform.OS = originalOS;
});

describe("widget bridge", () => {
  it("writes the snapshot as JSON to the App Group and reloads the widget, skipping an unchanged write unless invalidated", () => {
    writeWidgetSnapshot(SNAPSHOT);
    expect(mockNative.setString).toHaveBeenCalledWith("widget.snapshot", JSON.stringify(SNAPSHOT), GROUP);
    expect(mockNative.reloadWidget).toHaveBeenCalledWith("DailyTasksWidget");

    writeWidgetSnapshot({ ...SNAPSHOT });
    expect(mockNative.setString).toHaveBeenCalledTimes(1);

    // After widget taps are applied the same snapshot must be written again
    // (the widget may be showing an optimistic tick the app didn't apply).
    invalidateWidgetSnapshot();
    writeWidgetSnapshot({ ...SNAPSHOT });
    expect(mockNative.setString).toHaveBeenCalledTimes(2);
    expect(mockNative.reloadWidget).toHaveBeenCalledTimes(2);
  });

  it("reads the raw queue and processedSeq, and records processed taps as an int", () => {
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });
    mockStrings.set("widget.toggles", "[]");
    markWidgetTogglesProcessed(5);
    expect(mockNative.setInt).toHaveBeenCalledWith("widget.processedSeq", 5, GROUP);
    expect(readWidgetToggles()).toEqual({ raw: "[]", processedSeq: 5 });
    mockNative.getInt.mockReturnValueOnce(Number.NaN);
    expect(readWidgetToggles().processedSeq).toBe(0);
  });

  it("is a no-op off iOS and when the native module isn't in the binary", () => {
    Platform.OS = "android";
    writeWidgetSnapshot(SNAPSHOT);
    markWidgetTogglesProcessed(3);
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });

    __resetWidgetBridgeForTests();
    Platform.OS = "ios";
    mockAvailable = false;
    writeWidgetSnapshot(SNAPSHOT);
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });
    expect(mockNative.setString).not.toHaveBeenCalled();
    expect(mockNative.setInt).not.toHaveBeenCalled();
    expect(mockNative.reloadWidget).not.toHaveBeenCalled();
  });
});
