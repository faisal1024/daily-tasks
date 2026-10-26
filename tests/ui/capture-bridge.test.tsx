// Capture bridge (1.6 E): the App Group side of capture from anywhere. It must
// do nothing, quietly, where the native module isn't (simulator, Android, Expo
// Go, web) and when the native side throws; and it only writes the app's own
// keys (processedSeq, openHandled), never native code's (inbox, openRequest).
import { Platform } from "react-native";

import {
  __resetCaptureBridgeForTests,
  markCaptureInboxProcessed,
  markCaptureOpenRequestHandled,
  readCaptureInbox,
  readCaptureOpenRequest,
} from "@/lib/daily-tasks/capture-bridge";

const GROUP = "group.com.faisalislam.dailytasks";

const mockStrings = new Map<string, string>();
const mockInts = new Map<string, number>();
const mockNative = {
  setString: jest.fn((key: string, value: string) => void mockStrings.set(key, value)),
  getString: jest.fn((key: string) => mockStrings.get(key) ?? null),
  setInt: jest.fn((key: string, value: number) => void mockInts.set(key, value)),
  getInt: jest.fn((key: string) => mockInts.get(key) ?? 0),
  reloadWidget: jest.fn(),
};
let mockAvailable = true;
jest.mock("@/modules/widget-storage", () => ({
  loadWidgetStorage: () => (mockAvailable ? mockNative : null),
}));

const originalOS = Platform.OS;

beforeEach(() => {
  __resetCaptureBridgeForTests();
  mockStrings.clear();
  mockInts.clear();
  jest.clearAllMocks();
  mockAvailable = true;
  Platform.OS = "ios";
});

afterAll(() => {
  Platform.OS = originalOS;
});

describe("capture bridge", () => {
  it("reads the inbox and the open request raw, and writes only the app's own keys", () => {
    expect(readCaptureInbox()).toEqual({ raw: null, processedSeq: 0 });
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });

    mockStrings.set("capture.inbox", '[{"seq":1,"text":"Hi"}]');
    mockStrings.set("capture.openRequest", '{"id":"r1"}');
    markCaptureInboxProcessed(4);
    markCaptureOpenRequestHandled("r1");

    expect(mockNative.setInt).toHaveBeenCalledWith("capture.processedSeq", 4, GROUP);
    expect(mockNative.setString).toHaveBeenCalledWith("capture.openHandled", "r1", GROUP);
    // Native code owns these: the app never writes them.
    expect(mockNative.setString).not.toHaveBeenCalledWith("capture.inbox", expect.anything(), expect.anything());
    expect(mockNative.setString).not.toHaveBeenCalledWith("capture.openRequest", expect.anything(), expect.anything());
    expect(readCaptureInbox()).toEqual({ raw: '[{"seq":1,"text":"Hi"}]', processedSeq: 4 });
    expect(readCaptureOpenRequest()).toEqual({ raw: '{"id":"r1"}', handledId: "r1" });
    mockNative.getInt.mockReturnValueOnce(Number.NaN);
    expect(readCaptureInbox().processedSeq).toBe(0);
  });

  it("is a no-op off iOS", () => {
    Platform.OS = "android";
    markCaptureInboxProcessed(3);
    markCaptureOpenRequestHandled("x");
    expect(readCaptureInbox()).toEqual({ raw: null, processedSeq: 0 });
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
    expect(mockNative.getString).not.toHaveBeenCalled();
    expect(mockNative.setInt).not.toHaveBeenCalled();
    expect(mockNative.setString).not.toHaveBeenCalled();
  });

  it("is a no-op when the native module isn't in the binary (simulator, Expo Go)", () => {
    mockAvailable = false;
    expect(() => {
      markCaptureInboxProcessed(3);
      markCaptureOpenRequestHandled("x");
    }).not.toThrow();
    expect(readCaptureInbox()).toEqual({ raw: null, processedSeq: 0 });
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
  });

  it("reads as empty and never throws when the native side throws", () => {
    const boom = () => {
      throw new Error("App Group unavailable");
    };
    mockNative.getString.mockImplementation(boom);
    mockNative.getInt.mockImplementation(boom);
    mockNative.setInt.mockImplementation(boom);
    mockNative.setString.mockImplementation(boom);
    try {
      expect(readCaptureInbox()).toEqual({ raw: null, processedSeq: 0 });
      expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
      expect(() => {
        markCaptureInboxProcessed(1);
        markCaptureOpenRequestHandled("x");
      }).not.toThrow();
    } finally {
      mockNative.getString.mockImplementation((key: string) => mockStrings.get(key) ?? null);
      mockNative.getInt.mockImplementation((key: string) => mockInts.get(key) ?? 0);
      mockNative.setInt.mockImplementation((key: string, value: number) => void mockInts.set(key, value));
      mockNative.setString.mockImplementation((key: string, value: string) => void mockStrings.set(key, value));
    }
  });
});

describe("capture bridge without any mock of the native module", () => {
  it("the real loader finds no WidgetStorage in tests, so everything is a quiet no-op", () => {
    jest.isolateModules(() => {
      jest.unmock("@/modules/widget-storage");
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh copy of the unmocked module graph
      const bridge = require("@/lib/daily-tasks/capture-bridge") as typeof import("@/lib/daily-tasks/capture-bridge");
      Platform.OS = "ios";
      expect(bridge.readCaptureInbox()).toEqual({ raw: null, processedSeq: 0 });
      expect(bridge.readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
      expect(() => bridge.markCaptureInboxProcessed(2)).not.toThrow();
      expect(() => bridge.markCaptureOpenRequestHandled("x")).not.toThrow();
    });
  });
});
