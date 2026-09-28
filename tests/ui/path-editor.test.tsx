// The path editor (rename, add, remove, save, ask for a new path) and the
// Journey screen's "Edit" link that opens it.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, type AlertButton } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import JourneyScreen from "@/app/(tabs)/journey";
import { MAX_PATH_STEPS, PathEditor } from "@/components/daily-tasks/path-editor";
import type { MilestoneView } from "@/lib/daily-tasks/milestones";
import { MILESTONE_IDS } from "@/lib/daily-tasks/momentum";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { MomentumPlan, MomentumProfile } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false }),
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

const view = (id: string, title: string, done = false): MilestoneView => ({
  id,
  title,
  description: `${title} details`,
  completedAt: null,
  done,
});
const PATH = [view("a", "Walk 10 minutes", true), view("b", "Jog 1 mile")];

async function renderEditor(props: Partial<React.ComponentProps<typeof PathEditor>> = {}) {
  const handlers = { onSave: jest.fn(), onSuggestNew: jest.fn(), onClose: jest.fn() };
  await render(<PathEditor visible milestones={PATH} plus {...handlers} {...props} />);
  return handlers;
}

const saveButton = () => screen.getByTestId("path-editor-save");

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe("PathEditor", () => {
  it("starts from the current path; rename, remove and add, then Save sends the cleaned list and closes", async () => {
    const { onSave, onClose } = await renderEditor();
    expect(screen.getByLabelText(/^Step 1(, reached)?$/)).toHaveDisplayValue("Walk 10 minutes");
    expect(screen.getByLabelText("Step 2 details")).toHaveDisplayValue("Jog 1 mile details");

    await fireEvent.changeText(screen.getByLabelText(/^Step 1(, reached)?$/), "Walk 15 minutes");
    await fireEvent.press(screen.getByRole("button", { name: "Remove step 2" }));
    await fireEvent.press(screen.getByTestId("path-editor-add"));
    await fireEvent.changeText(screen.getByLabelText(/^Step 2(, reached)?$/), "Race day");
    await fireEvent.press(saveButton());

    expect(onSave).toHaveBeenCalledWith([
      { id: "a", title: "Walk 15 minutes", description: "Walk 10 minutes details" },
      { id: undefined, title: "Race day", description: "" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves blank new steps out of the save", async () => {
    const { onSave } = await renderEditor();
    await fireEvent.press(screen.getByTestId("path-editor-add"));
    await fireEvent.press(saveButton());
    expect(onSave.mock.calls[0][0]).toHaveLength(2);
  });

  it("Save is disabled (and does nothing) when every step is blank", async () => {
    const { onSave, onClose } = await renderEditor();
    await fireEvent.changeText(screen.getByLabelText(/^Step 1(, reached)?$/), "   ");
    await fireEvent.press(screen.getByRole("button", { name: "Remove step 2" }));
    expect(saveButton()).toBeDisabled();
    await fireEvent.press(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it(`hides "Add a step" at ${MAX_PATH_STEPS} steps`, async () => {
    const full = Array.from({ length: MAX_PATH_STEPS }, (_, i) => view(`s${i}`, `Step ${i}`));
    await renderEditor({ milestones: full });
    expect(screen.queryByTestId("path-editor-add")).toBeNull();
  });

  it("Cancel with no edits closes; with edits it asks before discarding", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { onSave, onClose } = await renderEditor();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel editing" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(/^Step 1(, reached)?$/), "Changed");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel editing" }));
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe("Discard changes?");
    buttons.find((b) => b.text === "Keep editing")?.onPress?.();
    expect(onClose).toHaveBeenCalledTimes(1);
    buttons.find((b) => b.text === "Discard")?.onPress?.();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("asking for a new path confirms first; Cancel does nothing, Replace path suggests and closes", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { onSuggestNew, onClose } = await renderEditor();
    await fireEvent.press(screen.getByText("Suggest a new path"));

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe("Get a new path?");
    expect(message).toMatch(/current steps and ticks will be replaced/);
    expect(onSuggestNew).not.toHaveBeenCalled();

    buttons.find((b) => b.text === "Cancel")?.onPress?.();
    expect(onSuggestNew).not.toHaveBeenCalled();

    const replace = buttons.find((b) => b.text === "Replace path");
    expect(replace?.style).toBe("destructive");
    replace?.onPress?.();
    expect(onSuggestNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("without Plus, offers the starter path instead", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderEditor({ plus: false });
    await fireEvent.press(screen.getByText("Reset to starter steps"));
    expect(alert.mock.calls[0][1]).toMatch(/starter steps/);
  });
});

describe("Journey: Edit your path", () => {
  const PROFILE: MomentumProfile = {
    name: "Alex",
    goalTitle: "Run a 5K",
    goalSource: "custom",
    timeAvailability: "30_min",
    experienceLevel: "beginner",
    struggleType: "consistency",
    motivation: null,
    preferredTime: null,
    cadence: null,
    onboardingCompletedAt: "2026-09-01T08:00:00.000Z",
  };
  const PLAN: MomentumPlan = {
    id: "plan_1",
    goalTitle: "Run a 5K",
    generatedAt: new Date().toISOString(),
    provider: "template",
    milestones: [
      { id: MILESTONE_IDS[0], title: "Walk 10 minutes", description: "", completedAt: null },
      { id: MILESTONE_IDS[1], title: "Jog 1 mile", description: "", completedAt: null },
    ],
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
  };

  it("the Edit link opens the editor, and a saved edit shows on the path", async () => {
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, momentumProfile: PROFILE, momentumPlan: PLAN }),
    );
    await render(
      <DailyTasksProvider>
        <JourneyScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit your path" })).toBeOnTheScreen());
    expect(screen.queryByTestId("path-editor")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Edit your path" }));
    expect(screen.getByTestId("path-editor")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/^Step 2(, reached)?$/), "Jog 2 miles");
    await fireEvent.press(screen.getByTestId("path-editor-save"));

    await waitFor(() => expect(screen.queryByTestId("path-editor")).toBeNull());
    expect(screen.getByText("Jog 2 miles")).toBeOnTheScreen();
    expect(screen.queryByText("Jog 1 mile")).toBeNull();
  });
});
