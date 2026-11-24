// 1.6.1 VoiceOver announcements: announceLiveChange (iOS only), useScreenReaderEnabled,
// and the new spoken cues in BrainDumpSheet and EveningResult (once on the change,
// never on mount or an unrelated re-render).
import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { BrainDumpSheet } from "@/components/daily-tasks/brain-dump-sheet";
import { EveningResult } from "@/components/daily-tasks/ritual-cards";
import { useScreenReaderEnabled } from "@/hooks/use-screen-reader";
import { type SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { announceLiveChange, announcePolitely } from "@/lib/daily-tasks/announce";

import { renderWithProviders as render } from "./render";

const originalOS = Platform.OS;
let plain: jest.SpyInstance;
let queued: jest.SpyInstance;
const said = () => [...plain.mock.calls, ...queued.mock.calls].map((call) => call[0] as string);

beforeEach(() => {
  plain = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  queued = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  // react-native's own jest.fn mocks keep their calls across restoreAllMocks.
  plain.mockClear();
  queued.mockClear();
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe("announceLiveChange", () => {
  it("speaks on iOS through the polite (queued) helper", () => {
    Platform.OS = "ios";
    announceLiveChange("Sorted");
    expect(queued).toHaveBeenCalledWith("Sorted", { queue: true });
    expect(plain).not.toHaveBeenCalled();
  });

  it("is silent on Android, where the live region speaks", () => {
    Platform.OS = "android";
    announceLiveChange("Sorted");
    expect(said()).toEqual([]);
  });

  it("announcePolitely itself still speaks on Android (plain announce)", () => {
    Platform.OS = "android";
    announcePolitely("Steps added");
    expect(plain).toHaveBeenCalledWith("Steps added");
  });
});

describe("useScreenReaderEnabled", () => {
  let listener: ((on: boolean) => void) | null;
  let remove: jest.Mock;
  beforeEach(() => {
    listener = null;
    remove = jest.fn();
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, fn: (on: boolean) => void) => {
      if (name === "screenReaderChanged") listener = fn;
      return { remove };
    }) as never);
  });
  const seen: boolean[] = [];
  function Probe() {
    const on = useScreenReaderEnabled();
    useEffect(() => {
      seen.push(on);
    }, [on]);
    return null;
  }

  it("starts false, adopts the first answer, follows the listener, and unsubscribes on unmount", async () => {
    seen.length = 0;
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const view = await render(<Probe />);
    expect(seen[0]).toBe(false);
    await act(async () => {});
    expect(seen.at(-1)).toBe(true);
    await act(async () => listener?.(false));
    expect(seen.at(-1)).toBe(false);
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("reads a rejected or missing answer as off, never a crash, and ignores an answer after unmount", async () => {
    seen.length = 0;
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockRejectedValue(new Error("nope"));
    const view = await render(<Probe />);
    await act(async () => {});
    expect(seen.at(-1)).toBe(false);
    await view.unmount();

    let resolve!: (on: boolean) => void;
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const late = await render(<Probe />);
    await late.unmount();
    await act(async () => resolve(true));
    expect(error).not.toHaveBeenCalled();
  });
});

describe("BrainDumpSheet announcements (iOS)", () => {
  beforeEach(() => {
    Platform.OS = "ios";
  });
  const sorted = (notice: string | null): SortedBrainDump => ({
    result: { picks: ["A"], parked: ["B"], source: notice ? "local" : "ai" },
    notice,
  });
  const mount = (onSort: () => Promise<SortedBrainDump>) =>
    render(<BrainDumpSheet visible onClose={jest.fn()} openSlots={3} onSort={onSort} onConfirm={jest.fn()} />);
  const sort = async () => {
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "a\nb");
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
  };

  it("says nothing on mount, 'Sorting through it' once on sort, then 'Sorted' once on the result", async () => {
    await mount(async () => sorted(null));
    expect(said()).toEqual([]);
    await sort();
    await act(async () => {});
    expect(said()).toEqual(["Sorting through it", "Sorted"]);
  });

  it("reads the notice instead of 'Sorted' when the sort fell back", async () => {
    await mount(async () => sorted("Couldn't reach the AI"));
    await sort();
    await act(async () => {});
    expect(said()).toEqual(["Sorting through it", "Couldn't reach the AI"]);
  });

  it("is silent on Android (the live regions speak)", async () => {
    Platform.OS = "android";
    await mount(async () => sorted(null));
    await sort();
    await act(async () => {});
    expect(said()).toEqual([]);
  });
});

describe("EveningResult announcements", () => {
  beforeEach(() => {
    Platform.OS = "ios";
  });
  const draft = { tasks: ["Walk", "Read", "Call"] } as never;
  const el = (over: Partial<Parameters<typeof EveningResult>[0]> = {}) => (
    <EveningResult closing={false} note={null} draft={null} {...over} />
  );

  it("says nothing on mount or an unrelated re-render", async () => {
    const { rerender } = await render(el({ note: "A good day.", draft }));
    expect(said()).toEqual([]);
    await rerender(el({ note: "A good day.", draft }));
    expect(said()).toEqual([]);
  });

  it("'Drafting tomorrow' when the coach starts, then the note and 'Tomorrow's three are ready.' once when it lands", async () => {
    const { rerender } = await render(el());
    await rerender(el({ closing: true }));
    expect(said()).toEqual(["Drafting tomorrow"]);
    await rerender(el({ closing: false, note: "A good day.", draft }));
    expect(said()).toEqual(["Drafting tomorrow", "A good day. Tomorrow's three are ready."]);
    await rerender(el({ closing: false, note: "A good day.", draft }));
    expect(said()).toHaveLength(2);
  });

  it("'Closing the day' without the coach; a failed draft says so", async () => {
    const { rerender } = await render(el({ coachDrafts: false }));
    await rerender(el({ coachDrafts: false, closing: true }));
    expect(said()).toEqual(["Closing the day"]);
    await rerender(el({ onRetry: jest.fn(), note: "A good day." }));
    expect(said().at(-1)).toBe("A good day. Couldn't draft tomorrow.");
  });
});
