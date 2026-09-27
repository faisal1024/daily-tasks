// Widget bridge: App Group storage through @bacons/apple-targets (mocked).
import { Platform } from "react-native";

import {
  __resetWidgetBridgeForTests,
  markWidgetTogglesProcessed,
  readWidgetToggles,
  writeWidgetSnapshot,
} from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot } from "@/lib/daily-tasks/widget-snapshot";

const mockValues = new Map<string, string | number>();
const mockSet = jest.fn((key: string, value: string | number) => {
  mockValues.set(key, value);
});
const mockReload = jest.fn();
let mockConstructorThrows = false;
jest.mock("@bacons/apple-targets", () => ({
  ExtensionStorage: class {
    static reloadWidget(name?: string) {
      mockReload(name);
    }
    constructor() {
      if (mockConstructorThrows) throw new Error("no native module");
    }
    set(key: string, value: string | number) {
      mockSet(key, value);
    }
    get(key: string) {
      const value = mockValues.get(key);
      // The native getter returns strings (numbers via String(describing:)).
      return value === undefined ? null : String(value);
    }
  },
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
  mockValues.clear();
  mockSet.mockClear();
  mockReload.mockClear();
  mockConstructorThrows = false;
  Platform.OS = "ios";
});

afterAll(() => {
  Platform.OS = originalOS;
});

describe("widget bridge", () => {
  it("writes the snapshot as JSON and reloads the widget, skipping an unchanged write", () => {
    writeWidgetSnapshot(SNAPSHOT);
    expect(mockSet).toHaveBeenCalledWith("widget.snapshot", JSON.stringify(SNAPSHOT));
    expect(mockReload).toHaveBeenCalledWith("DailyTasksWidget");

    writeWidgetSnapshot({ ...SNAPSHOT });
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledTimes(1);

    writeWidgetSnapshot({ ...SNAPSHOT, streak: 3 });
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it("reads the raw queue and a numeric processedSeq (non-numeric → 0)", () => {
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });
    mockValues.set("widget.toggles", "[]");
    markWidgetTogglesProcessed(5);
    expect(mockSet).toHaveBeenCalledWith("widget.processedSeq", 5);
    expect(readWidgetToggles()).toEqual({ raw: "[]", processedSeq: 5 });
    mockValues.set("widget.processedSeq", "garbage");
    expect(readWidgetToggles().processedSeq).toBe(0);
  });

  it("is a no-op off iOS and when the native module isn't there", () => {
    Platform.OS = "android";
    writeWidgetSnapshot(SNAPSHOT);
    markWidgetTogglesProcessed(3);
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });

    __resetWidgetBridgeForTests();
    Platform.OS = "ios";
    mockConstructorThrows = true;
    mockValues.set("widget.toggles", "[]");
    writeWidgetSnapshot(SNAPSHOT);
    expect(readWidgetToggles()).toEqual({ raw: null, processedSeq: 0 });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
  });
});
