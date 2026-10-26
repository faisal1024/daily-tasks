// 1.5 D "Share your day": the preview sheet and what Share does. Names on and
// off, Hide task names always respected, `finish_card_shared` only on an
// actual share (counts only, never a title), a capture or share failure shown
// and not tracked, a double tap sharing once. Plus the entry on the done card
// (iOS only).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Platform, Share } from "react-native";
import { captureRef } from "react-native-view-shot";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { DoneCard } from "@/components/daily-tasks/done-card";
import { SHARE_DAY_COPY, ShareDaySheet } from "@/components/daily-tasks/share-day-sheet";
import { track } from "@/lib/daily-tasks/analytics";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

const capture = captureRef as jest.Mock;
const sharedEvents = () => (track as jest.Mock).mock.calls.filter(([name]) => name === "finish_card_shared").map(([, props]) => props);
const originalOS = Platform.OS;

const TASKS = [
  { text: "Call the dentist", done: true },
  { text: "Write the report", done: true },
  { text: "Walk", done: true },
];

type Props = Parameters<typeof ShareDaySheet>[0];
const props = (over: Partial<Props> = {}): Props => ({
  visible: true,
  tasks: TASKS,
  daysShowedUp: 12,
  dateLabel: "Monday, 26 October",
  hideTaskNames: false,
  onClose: jest.fn(),
  ...over,
});

let share: jest.SpyInstance;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Platform.OS = "ios";
  capture.mockImplementation(async () => "/tmp/three-today-share.png");
  share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction } as never);
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

const card = () => within(screen.getByTestId("share-day-card"));
const pressShare = () => fireEvent.press(screen.getByTestId("share-day-share"));

describe("the preview", () => {
  it("shows Day N, the date, each task ticked, '3 of 3' and the brand, with the names switch on", async () => {
    await render(<ShareDaySheet {...props()} />);
    expect(card().getByText("Day 12")).toBeOnTheScreen();
    expect(card().getByText("Monday, 26 October")).toBeOnTheScreen();
    for (const task of TASKS) expect(card().getByText(task.text)).toBeOnTheScreen();
    expect(screen.getByTestId("share-day-summary")).toHaveTextContent("3 of 3");
    expect(card().getByText("Three Today")).toBeOnTheScreen();
    expect(screen.getByTestId("share-day-names").props.value).toBe(true);
  });

  it("the switch takes the names out of the picture, and back", async () => {
    await render(<ShareDaySheet {...props()} />);
    await fireEvent(screen.getByTestId("share-day-names"), "valueChange", false);
    for (const task of TASKS) expect(card().queryByText(task.text)).toBeNull();
    expect(screen.getByTestId("share-day-summary")).toHaveTextContent("3 of 3");
    expect(screen.getByTestId("share-day-card").props.accessibilityLabel).not.toMatch(/dentist|report|Walk/);
    await fireEvent(screen.getByTestId("share-day-names"), "valueChange", true);
    expect(card().getByText("Walk")).toBeOnTheScreen();
  });

  it("Hide task names in Settings: no names, no switch, and it says why", async () => {
    await render(<ShareDaySheet {...props({ hideTaskNames: true })} />);
    for (const task of TASKS) expect(card().queryByText(task.text)).toBeNull();
    expect(screen.queryByTestId("share-day-names")).toBeNull();
    expect(screen.getByTestId("share-day-names-hidden")).toHaveTextContent(SHARE_DAY_COPY.namesHidden);
    expect(screen.getByTestId("share-day-card").props.accessibilityLabel).not.toMatch(/dentist|report|Walk/);
  });

  it("each opening starts from the setting again (a switch flipped last time is not remembered)", async () => {
    const { rerender } = await render(<ShareDaySheet {...props()} />);
    await fireEvent(screen.getByTestId("share-day-names"), "valueChange", false);
    await rerender(<ShareDaySheet {...props({ visible: false })} />);
    await rerender(<ShareDaySheet {...props()} />);
    expect(screen.getByTestId("share-day-names").props.value).toBe(true);
    // And the setting flipping to hidden while it's open takes the names off at once.
    await rerender(<ShareDaySheet {...props({ hideTaskNames: true })} />);
    expect(card().queryByText("Walk")).toBeNull();
  });
});

describe("Share", () => {
  it("captures the picture and hands iOS the file; tracks counts only once it was shared, then closes", async () => {
    const p = props();
    await render(<ShareDaySheet {...p} />);
    await pressShare();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toMatchObject({ format: "png", result: "tmpfile" });
    expect(share).toHaveBeenCalledWith({ url: "file:///tmp/three-today-share.png" });
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
    expect(sharedEvents()).toEqual([{ count: 3, kind: "names" }]);
    expect(JSON.stringify(sharedEvents())).not.toMatch(/dentist|report|Walk|png/);
  });

  it("a file:// path from the capture is not prefixed twice", async () => {
    capture.mockResolvedValue("file:///var/tmp/a.png");
    await render(<ShareDaySheet {...props()} />);
    await pressShare();
    await waitFor(() => expect(share).toHaveBeenCalledWith({ url: "file:///var/tmp/a.png" }));
  });

  it("with names off (the switch, or Settings) the event says no_names", async () => {
    await render(<ShareDaySheet {...props()} />);
    await fireEvent(screen.getByTestId("share-day-names"), "valueChange", false);
    await pressShare();
    await waitFor(() => expect(sharedEvents()).toEqual([{ count: 3, kind: "no_names" }]));
    await screen.unmount();
    jest.clearAllMocks();
    share.mockResolvedValue({ action: Share.sharedAction } as never);
    await render(<ShareDaySheet {...props({ hideTaskNames: true })} />);
    await pressShare();
    await waitFor(() => expect(sharedEvents()).toEqual([{ count: 3, kind: "no_names" }]));
  });

  it("cancelling the share sheet is not a share: no event, the sheet stays open, Share works again", async () => {
    share.mockResolvedValueOnce({ action: Share.dismissedAction } as never);
    const p = props();
    await render(<ShareDaySheet {...p} />);
    await pressShare();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(sharedEvents()).toEqual([]);
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("share-day-failed")).toBeNull();
    await pressShare();
    await waitFor(() => expect(sharedEvents()).toEqual([{ count: 3, kind: "names" }]));
  });

  it("a capture that fails shows the message, tracks nothing, never opens the share sheet, and can be retried", async () => {
    capture.mockRejectedValueOnce(new Error("no view"));
    const p = props();
    await render(<ShareDaySheet {...p} />);
    await pressShare();
    await waitFor(() => expect(screen.getByTestId("share-day-failed")).toHaveTextContent(SHARE_DAY_COPY.failed));
    expect(share).not.toHaveBeenCalled();
    expect(sharedEvents()).toEqual([]);
    expect(p.onClose).not.toHaveBeenCalled();
    await pressShare();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("share-day-failed")).toBeNull();
    expect(sharedEvents()).toEqual([{ count: 3, kind: "names" }]);
  });

  it("a share sheet that throws is handled the same way", async () => {
    share.mockRejectedValueOnce(new Error("boom"));
    await render(<ShareDaySheet {...props()} />);
    await pressShare();
    await waitFor(() => expect(screen.getByTestId("share-day-failed")).toBeOnTheScreen());
    expect(sharedEvents()).toEqual([]);
  });

  it("a double tap captures and shares once", async () => {
    let release!: (uri: string) => void;
    capture.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    await render(<ShareDaySheet {...props()} />);
    await pressShare();
    await pressShare();
    expect(capture).toHaveBeenCalledTimes(1);
    await act(async () => release("/tmp/x.png"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedEvents()).toHaveLength(1);
  });

  it("closing with × shares nothing", async () => {
    const p = props();
    await render(<ShareDaySheet {...p} />);
    await fireEvent.press(screen.getByTestId("share-day-close"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
    expect(sharedEvents()).toEqual([]);
  });
});

describe("the entry on the done card", () => {
  const week = { showedUpDays: 3, tasksDone: 9 };
  it("'Share your day' shows when the screen offers it, and calls it", async () => {
    const onShare = jest.fn();
    await render(<DoneCard total={3} week={week} eveningCheckIn={false} onShare={onShare} />);
    await fireEvent.press(screen.getByRole("button", { name: "Share your day" }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
  it("is absent without the prop (Android, or nothing planned)", async () => {
    await render(<DoneCard total={3} week={week} eveningCheckIn={false} />);
    expect(screen.queryByTestId("share-day")).toBeNull();
  });
});
