// Capture bridge (1.6 E): the App Group side of capture from anywhere. It must
// do nothing, quietly, where the native module isn't (simulator, Android, Expo
// Go, web, a binary from before 1.6) and when the native side throws. The
// inbox is one file per capture: the app lists and deletes them (by name, in
// the inbox folder only) and never writes one; for the open request it only
// writes its own key (openHandled), never native code's (openRequest).
import { Platform } from "react-native";

import {
  CAPTURE_INBOX_FOLDER,
  __resetCaptureBridgeForTests,
  deleteCaptureFile,
  markCaptureOpenRequestHandled,
  readCaptureFiles,
  readCaptureOpenRequest,
} from "@/lib/daily-tasks/capture-bridge";

const GROUP = "group.com.faisalislam.dailytasks";

const mockStrings = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockNative = {
  setString: jest.fn((key: string, value: string) => void mockStrings.set(key, value)),
  getString: jest.fn((key: string) => mockStrings.get(key) ?? null),
  setInt: jest.fn(),
  getInt: jest.fn(() => 0),
  reloadWidget: jest.fn(),
  listInboxFiles: jest.fn((_group: string, _folder: string) =>
    [...mockFiles].map(([name, contents]) => ({ name, contents })),
  ),
  deleteInboxFile: jest.fn((_group: string, _folder: string, name: string) => {
    mockFiles.delete(name);
    return true;
  }),
};
let mockAvailable = true;
let mockOld = false;
jest.mock("@/modules/widget-storage", () => ({
  loadWidgetStorage: () => {
    if (!mockAvailable) return null;
    if (!mockOld) return mockNative;
    // A binary from before 1.6: no inbox functions.
    const { listInboxFiles: _l, deleteInboxFile: _d, ...rest } = mockNative;
    return rest;
  },
}));

const originalOS = Platform.OS;

beforeEach(() => {
  __resetCaptureBridgeForTests();
  mockStrings.clear();
  mockFiles.clear();
  jest.clearAllMocks();
  mockAvailable = true;
  mockOld = false;
  Platform.OS = "ios";
});

afterAll(() => {
  Platform.OS = originalOS;
});

describe("capture bridge", () => {
  it("lists the inbox's files in the App Group's inbox folder, and deletes one by name", () => {
    expect(readCaptureFiles()).toEqual([]);
    mockFiles.set("1-a.json", '{"text":"Hi","at":1}');
    mockFiles.set("2-b.json", '{"text":"There","at":2}');
    expect(readCaptureFiles()).toEqual([
      { name: "1-a.json", contents: '{"text":"Hi","at":1}' },
      { name: "2-b.json", contents: '{"text":"There","at":2}' },
    ]);
    expect(mockNative.listInboxFiles).toHaveBeenCalledWith(GROUP, CAPTURE_INBOX_FOLDER);
    expect(CAPTURE_INBOX_FOLDER).toBe("capture-inbox");

    expect(deleteCaptureFile("1-a.json")).toBe(true);
    expect(mockNative.deleteInboxFile).toHaveBeenCalledWith(GROUP, CAPTURE_INBOX_FOLDER, "1-a.json");
    expect(readCaptureFiles().map((file) => file.name)).toEqual(["2-b.json"]);
  });

  it("drops malformed entries the native side might return", () => {
    mockNative.listInboxFiles.mockReturnValueOnce([
      null,
      { name: "", contents: "{}" },
      { name: 5, contents: "{}" },
      { name: "ok.json" },
      { name: "good.json", contents: "{}" },
    ] as never);
    expect(readCaptureFiles()).toEqual([{ name: "good.json", contents: "{}" }]);
    mockNative.listInboxFiles.mockReturnValueOnce("nope" as never);
    expect(readCaptureFiles()).toEqual([]);
  });

  it("a delete that fails says so (the file is read again next time)", () => {
    mockNative.deleteInboxFile.mockReturnValueOnce(false);
    expect(deleteCaptureFile("x.json")).toBe(false);
  });

  it("reads the open request raw and writes only the app's own key", () => {
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
    mockStrings.set("capture.openRequest", '{"id":"r1"}');
    markCaptureOpenRequestHandled("r1");
    expect(mockNative.setString).toHaveBeenCalledWith("capture.openHandled", "r1", GROUP);
    expect(mockNative.setString).not.toHaveBeenCalledWith("capture.openRequest", expect.anything(), expect.anything());
    expect(readCaptureOpenRequest()).toEqual({ raw: '{"id":"r1"}', handledId: "r1" });
  });

  it("is a no-op off iOS", () => {
    Platform.OS = "android";
    mockFiles.set("1-a.json", "{}");
    expect(readCaptureFiles()).toEqual([]);
    expect(deleteCaptureFile("1-a.json")).toBe(false);
    markCaptureOpenRequestHandled("x");
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
    expect(mockNative.listInboxFiles).not.toHaveBeenCalled();
    expect(mockNative.deleteInboxFile).not.toHaveBeenCalled();
    expect(mockNative.setString).not.toHaveBeenCalled();
  });

  it("is a no-op when the native module isn't in the binary, or is from before 1.6", () => {
    mockAvailable = false;
    expect(readCaptureFiles()).toEqual([]);
    expect(deleteCaptureFile("x.json")).toBe(false);
    expect(() => markCaptureOpenRequestHandled("x")).not.toThrow();
    __resetCaptureBridgeForTests();
    mockAvailable = true;
    mockOld = true;
    mockFiles.set("1-a.json", "{}");
    expect(readCaptureFiles()).toEqual([]);
    expect(deleteCaptureFile("1-a.json")).toBe(false);
  });

  it("reads as empty and never throws when the native side throws", () => {
    const boom = () => {
      throw new Error("App Group unavailable");
    };
    mockNative.listInboxFiles.mockImplementationOnce(boom);
    mockNative.deleteInboxFile.mockImplementationOnce(boom);
    mockNative.getString.mockImplementationOnce(boom);
    mockNative.setString.mockImplementationOnce(boom);
    expect(readCaptureFiles()).toEqual([]);
    expect(deleteCaptureFile("x.json")).toBe(false);
    expect(readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
    expect(() => markCaptureOpenRequestHandled("x")).not.toThrow();
  });
});

describe("capture bridge without any mock of the native module", () => {
  it("the real loader finds no WidgetStorage in tests, so everything is a quiet no-op", () => {
    jest.isolateModules(() => {
      jest.unmock("@/modules/widget-storage");
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh copy of the unmocked module graph
      const bridge = require("@/lib/daily-tasks/capture-bridge") as typeof import("@/lib/daily-tasks/capture-bridge");
      Platform.OS = "ios";
      expect(bridge.readCaptureFiles()).toEqual([]);
      expect(bridge.deleteCaptureFile("x.json")).toBe(false);
      expect(bridge.readCaptureOpenRequest()).toEqual({ raw: null, handledId: null });
      expect(() => bridge.markCaptureOpenRequestHandled("x")).not.toThrow();
    });
  });
});
