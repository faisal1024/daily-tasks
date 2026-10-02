// Routines (1.3) on screen: the "Today's routines" section of the Ideas sheet,
// the routine editor's day picker, and Settings › Routines at the free limit.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { IdeasSheet } from "@/components/daily-tasks/ideas-sheet";
import { ROUTINES_EXPLAINER, RoutinesSheet } from "@/components/daily-tasks/routines-sheet";
import { MAX_ROUTINE_TEXT } from "@/lib/daily-tasks/routines";
import { track } from "@/lib/daily-tasks/analytics";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Routine } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const mockOpenPaywall = jest.fn(() => true);
let mockPlus: Partial<PlusContextValue> = {};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn(), redeemCode: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
};

const routine = (id: string, text: string, days: number[]): Routine => ({
  id,
  text,
  days,
  paused: false,
  createdAt: "2026-09-30T08:00:00.000Z",
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = { ...FREE };
  await AsyncStorage.clear();
});

describe("IdeasSheet: Today's routines", () => {
  const props = () => ({
    visible: true,
    onClose: jest.fn(),
    goalTitle: "Run a 5K",
    source: { personalized: false, label: "Starter ideas" },
    ideas: [{ id: "a", text: "Walk 20 minutes", estimatedMinutes: 20 }],
    addedTexts: new Set<string>(),
    remainingSlots: 2,
    adaptationReason: null,
    canRegenerate: true,
    regenerating: false,
    failureMessage: null,
    onAdd: jest.fn(),
    onAddAll: jest.fn(),
    onRegenerate: jest.fn(),
    onAddRoutine: jest.fn(),
  });
  const ROUTINES = [{ id: "r1", text: "Stretch" }];

  it("shows nothing when no routine is due", async () => {
    await render(<IdeasSheet {...props()} routines={[]} />);
    expect(screen.queryByTestId("todays-routines")).toBeNull();
    expect(screen.queryByText("Today's routines")).toBeNull();
  });

  it("adds a due routine with one tap", async () => {
    const p = props();
    await render(<IdeasSheet {...p} routines={ROUTINES} />);
    expect(screen.getByText("Today's routines")).toBeOnTheScreen();
    expect(screen.queryByTestId("todays-routines-blocked")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add Stretch" }));
    expect(p.onAddRoutine).toHaveBeenCalledWith("r1");
    expect(p.onAdd).not.toHaveBeenCalled();
  });

  it.each([
    ["full", { remainingSlots: 0 }, "Today's three are picked. Free a slot to add one."],
    ["set", { remainingSlots: 2, locked: true }, "Today is set. Change it on Today to add one."],
  ])("disables the rows and says why when today is %s", async (_label, overrides, reason) => {
    const p = props();
    await render(<IdeasSheet {...p} routines={ROUTINES} {...overrides} />);
    expect(screen.getByTestId("todays-routines-blocked")).toHaveTextContent(reason);
    const row = screen.getByRole("button", { name: "Add Stretch" });
    expect(row).toBeDisabled();
    expect(row.props.accessibilityHint).toBe(reason);
    await fireEvent.press(row);
    expect(p.onAddRoutine).not.toHaveBeenCalled();
  });

  it("lists an idea with the same words as a due routine once, as the routine", async () => {
    const p = props();
    await render(<IdeasSheet {...p} routines={[{ id: "r1", text: "walk 20 minutes" }]} />);
    expect(screen.getByRole("button", { name: "Add walk 20 minutes" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Add Walk 20 minutes" })).toBeNull();
  });

  it("the Saved for later view shows no routines and no routine footer", async () => {
    await render(
      <IdeasSheet {...props()} savedOnly routines={ROUTINES} hasRoutines={false} onManageRoutines={jest.fn()} />,
    );
    expect(screen.queryByTestId("todays-routines")).toBeNull();
    expect(screen.queryByTestId("ideas-make-routine")).toBeNull();
  });

  // PR #83: an Edit link on "Today's routines" opens the routines sheet.
  it("Edit opens the routines sheet (only offered with a handler)", async () => {
    const onManageRoutines = jest.fn();
    const { rerender } = await render(<IdeasSheet {...props()} routines={ROUTINES} />);
    expect(screen.queryByTestId("todays-routines-edit")).toBeNull();
    await rerender(<IdeasSheet {...props()} routines={ROUTINES} onManageRoutines={onManageRoutines} />);
    const edit = screen.getByRole("button", { name: "Edit routines" });
    expect(within(screen.getByTestId("todays-routines")).getByTestId("todays-routines-edit")).toBe(edit);
    await fireEvent.press(edit);
    expect(onManageRoutines).toHaveBeenCalledTimes(1);
  });

  it("with no routines at all, a quiet footer opens the routines sheet", async () => {
    const onManageRoutines = jest.fn();
    const { rerender } = await render(
      <IdeasSheet {...props()} routines={[]} hasRoutines={false} onManageRoutines={onManageRoutines} />,
    );
    await fireEvent.press(screen.getByTestId("ideas-make-routine"));
    expect(onManageRoutines).toHaveBeenCalled();
    expect(screen.getByText(/Do something on repeat\?/)).toBeOnTheScreen();
    // Once there are routines (due today or not), it's gone.
    await rerender(<IdeasSheet {...props()} routines={[]} hasRoutines onManageRoutines={onManageRoutines} />);
    expect(screen.queryByTestId("ideas-make-routine")).toBeNull();
  });
});

describe("RoutinesSheet: the day picker", () => {
  const props = () => ({
    visible: true,
    routines: [] as Routine[],
    canAdd: true,
    onAdd: jest.fn(() => "added" as const),
    onLimit: jest.fn(),
    onUpdate: jest.fn(),
    onSetPaused: jest.fn(),
    onRemove: jest.fn(),
    onClose: jest.fn(),
  });
  const preset = (name: string) => screen.getByRole("radio", { name });
  const isOn = (name: string) => preset(name).props.accessibilityState?.checked === true;
  const day = (name: string) => screen.getByRole("checkbox", { name });

  async function openEditor(p = props()) {
    await render(<RoutinesSheet {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: "Add a routine" }));
    return p;
  }

  it("keeps presets and day toggles (checkboxes) in sync", async () => {
    await openEditor();
    // New routine: every day.
    expect(isOn("Every day")).toBe(true);
    expect(day("Monday")).toBeChecked();

    await fireEvent.press(preset("Weekdays"));
    expect(isOn("Weekdays")).toBe(true);
    expect(isOn("Every day")).toBe(false);
    expect(day("Monday")).toBeChecked();
    expect(day("Saturday")).not.toBeChecked();
    expect(day("Sunday")).not.toBeChecked();

    // A toggle off a preset's days switches to Custom days...
    await fireEvent.press(day("Saturday"));
    expect(isOn("Custom days")).toBe(true);
    expect(isOn("Weekdays")).toBe(false);
    expect(day("Saturday")).toBeChecked();

    // ...and back onto one picks that preset again.
    await fireEvent.press(day("Sunday"));
    expect(isOn("Every day")).toBe(true);

    await fireEvent.press(preset("Weekends"));
    expect(day("Monday")).not.toBeChecked();
    expect(day("Sunday")).toBeChecked();

    // Choosing Custom days stays picked until a day is toggled; a toggle that
    // lands on a preset's days picks that preset.
    await fireEvent.press(preset("Every day"));
    await fireEvent.press(preset("Custom days"));
    expect(isOn("Custom days")).toBe(true);
    await fireEvent.press(day("Sunday"));
    expect(isOn("Custom days")).toBe(true);
    await fireEvent.press(day("Sunday"));
    expect(isOn("Every day")).toBe(true);
    expect(isOn("Custom days")).toBe(false);
  });

  it("Save is disabled with no words or no days, then saves the words and days", async () => {
    const p = await openEditor();
    const save = () => screen.getByRole("button", { name: "Save routine" });
    expect(save()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Routine"), "   ");
    expect(save()).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Routine"), "Stretch");
    expect(save()).not.toBeDisabled();

    await fireEvent.press(preset("Weekends"));
    await fireEvent.press(day("Saturday"));
    await fireEvent.press(day("Sunday"));
    expect(screen.getByText("Pick at least one day.")).toBeOnTheScreen();
    expect(save()).toBeDisabled();
    await fireEvent.press(save());
    expect(p.onAdd).not.toHaveBeenCalled();

    await fireEvent.press(day("Wednesday"));
    await fireEvent.press(save());
    expect(p.onAdd).toHaveBeenCalledWith("Stretch", [3]);
  });

  it("the return key saves when the routine is valid, and does nothing when not", async () => {
    const p = await openEditor();
    await fireEvent(screen.getByLabelText("Routine"), "submitEditing");
    expect(p.onAdd).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText("Routine"), "Stretch");
    await fireEvent(screen.getByLabelText("Routine"), "submitEditing");
    expect(p.onAdd).toHaveBeenCalledWith("Stretch", [0, 1, 2, 3, 4, 5, 6]);
    expect(screen.queryByLabelText("Routine")).toBeNull();
  });

  it("caps typing by visible characters (an emoji counts once)", async () => {
    await openEditor();
    const long = "😀".repeat(MAX_ROUTINE_TEXT + 5);
    await fireEvent.changeText(screen.getByLabelText("Routine"), long);
    expect(screen.getByLabelText("Routine")).toHaveProp("value", "😀".repeat(MAX_ROUTINE_TEXT));
  });

  // PR #83: the field wraps (multiline) but stays one line of words, and return still saves.
  it("multiline field: return saves and blurs only when valid; a pasted line break becomes a space, still capped", async () => {
    const p = await openEditor();
    const field = () => screen.getByLabelText("Routine");
    expect(field()).toHaveProp("multiline", true);
    expect(field()).toHaveProp("submitBehavior", "blurAndSubmit");
    await fireEvent.changeText(field(), "Walk\nafter\r\nlunch");
    expect(field()).toHaveProp("value", "Walk after lunch");
    // The cap still applies after the line breaks are swapped.
    await fireEvent.changeText(field(), `${"a".repeat(MAX_ROUTINE_TEXT)}\n\nmore`);
    expect(field()).toHaveProp("value", "a".repeat(MAX_ROUTINE_TEXT));
    // Only line breaks: blank words, so return does nothing.
    await fireEvent.changeText(field(), "\n\n");
    await fireEvent(field(), "submitEditing");
    expect(p.onAdd).not.toHaveBeenCalled();
    await fireEvent.changeText(field(), "Walk\nafter lunch");
    await fireEvent(field(), "submitEditing");
    expect(p.onAdd).toHaveBeenCalledWith("Walk after lunch", [0, 1, 2, 3, 4, 5, 6]);
  });

  it("keeps the title to two lines (shrinking to fit) between Cancel and Save", async () => {
    await openEditor();
    expect(screen.getByRole("header", { name: "New routine" })).toHaveProp("numberOfLines", 2);
    // Cancel and Save stop at 2x so the title keeps its room at AX sizes.
    expect(screen.getByText("Cancel")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByTestId("routine-save-label")).toHaveProp("maxFontSizeMultiplier", 2);
  });
});

describe("RoutinesSheet: the list", () => {
  const props = () => ({
    visible: true,
    routines: [] as Routine[],
    canAdd: true,
    onAdd: jest.fn(() => "added" as const),
    onLimit: jest.fn(),
    onUpdate: jest.fn(),
    onSetPaused: jest.fn(),
    onRemove: jest.fn(),
    onClose: jest.fn(),
  });

  it("the full explainer only while empty, then the short one", async () => {
    const { rerender } = await render(<RoutinesSheet {...props()} />);
    expect(screen.getByTestId("routines-explainer")).toHaveTextContent(ROUTINES_EXPLAINER);
    await rerender(<RoutinesSheet {...props()} routines={[routine("r1", "Walk", [1])]} />);
    expect(screen.getByTestId("routines-explainer")).toHaveTextContent("They show on Today on their days.");
  });

  it("at the free limit, says so under Add a routine before the tap", async () => {
    const { rerender } = await render(<RoutinesSheet {...props()} />);
    expect(screen.queryByTestId("routines-limit-note")).toBeNull();
    await rerender(<RoutinesSheet {...props()} canAdd={false} atFreeLimit />);
    expect(screen.getByTestId("routines-limit-note")).toHaveTextContent(
      "Free keeps two routines. Plus keeps as many as you like.",
    );
  });

  it("opens straight into New routine when asked", async () => {
    const p = props();
    const { rerender } = await render(<RoutinesSheet {...p} visible={false} startInEditor />);
    await rerender(<RoutinesSheet {...p} visible startInEditor />);
    expect(screen.getByRole("header", { name: "New routine" })).toBeOnTheScreen();
  });
});

describe("Settings › Routines at the free limit", () => {
  async function renderSettings(saved: Partial<AppState>) {
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, plusGrandfathered: false, ...saved }),
    );
    // A fresh element each time, so a rerender re-renders (and reads the new Plus mock).
    const ui = () => (
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>
    );
    const { rerender } = await render(ui());
    await waitFor(() => expect(screen.getByTestId("settings-routines")).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("settings-routines"));
    return () => rerender(ui());
  }
  const TWO = [routine("r1", "Walk", [1]), routine("r2", "Read", [2])];

  async function hitLimitThenClosePaywall(after: Partial<PlusContextValue>) {
    const rerender = await renderSettings({ routines: TWO });
    expect(screen.getByTestId("routines-limit-note")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add a routine" }));
    await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("routines"), { timeout: 2000 });
    expect(screen.queryByTestId("routines-sheet")).toBeNull();
    // The paywall shows, then closes.
    mockPlus = { ...FREE, paywallSource: "routines" };
    await rerender();
    mockPlus = { ...FREE, ...after, paywallSource: null };
    await rerender();
  }

  it("after buying Plus, the sheet comes back straight into New routine", async () => {
    await hitLimitThenClosePaywall({ entitlementActive: true });
    await waitFor(() => expect(screen.getByRole("header", { name: "New routine" })).toBeOnTheScreen(), {
      timeout: 2000,
    });
  });

  it("closing the paywall without buying brings back the list", async () => {
    await hitLimitThenClosePaywall({});
    await waitFor(() => expect(screen.getByTestId("routines-sheet")).toBeOnTheScreen(), { timeout: 2000 });
    expect(screen.queryByRole("header", { name: "New routine" })).toBeNull();
  });

  it("a free user with two gets the routines paywall instead of the editor", async () => {
    await renderSettings({ routines: TWO });
    await fireEvent.press(screen.getByRole("button", { name: "Add a routine" }));
    expect(screen.queryByRole("button", { name: "Save routine" })).toBeNull();
    expect(track).toHaveBeenCalledWith("routine_limit_hit", { count: 2 });
    expect(track).toHaveBeenCalledWith("plus_gate_hit", { feature: "routines" });
    // The sheet animates away first, then the paywall opens.
    await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("routines"), { timeout: 2000 });
    expect((track as jest.Mock).mock.calls.filter(([name]) => name === "routine_limit_hit")).toHaveLength(1);
  });

  it("after a Plus lapse, the three kept routines can still be paused and deleted", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderSettings({
      routines: [routine("r1", "Walk", [1]), routine("r2", "Read", [2]), routine("r3", "Stretch", [3])],
    });
    await fireEvent.press(screen.getByRole("button", { name: "Pause Read" }));
    expect(within(screen.getByTestId("routine-row-r2")).getByText(/Paused/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Delete Walk" }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await waitFor(() => buttons.find((b) => b.text === "Delete")!.onPress!());
    await waitFor(() => expect(screen.queryByTestId("routine-row-r1")).toBeNull());
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
