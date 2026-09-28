// Today with the REAL store and the REAL rollover card: yesterday's
// unfinished ones sit on Today next to last night's draft, and both work.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => false) }));
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallEnabled: true,
    openPaywall: jest.fn(() => true),
    paywallSource: null,
    entitlementActive: false,
    purchaseCount: 0,
    winBackDue: false,
  }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 };
const IPAD = { width: 1180, height: 820, scale: 2, fontScale: 1 };
let mockWindow = PHONE;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const YESTERDAY = "2026-09-25";
const TODAY = "2026-09-26";

function task(id: string, text: string): Task {
  return { id, text, createdAt: `${YESTERDAY}T08:00:00.000Z`, carriedOver: false };
}

/** Saved last night: unfinished tasks and a draft for this morning. */
async function openThisMorning(saved: Partial<AppState>) {
  jest.useFakeTimers({
    now: new Date(2026, 8, 26, 8, 0),
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "queueMicrotask",
      "nextTick",
    ],
  });
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(new Date(2026, 8, 25, 20)), hasSeenOnboarding: true, history: {}, ...saved }),
  );
  await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("rollover-card")).toBeOnTheScreen());
}

const card = () => within(screen.getByTestId("rollover-card"));
const todayTaskNames = () =>
  screen
    .queryAllByRole("checkbox")
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => /^Task \d: /.test(label ?? ""))
    .map((label) => label.replace(/^Task \d: /, ""));

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  mockWindow = PHONE;
});

describe("Today: rollover card next to last night's draft (real store)", () => {
  const draft = (tasks: string[]) => ({
    forDate: TODAY,
    tasks,
    note: "",
    because: "Lighter today.",
    source: "local" as const,
  });

  it("the draft's Use this works while the card shows, then the card offers only the room left", async () => {
    await openThisMorning({
      tasks: [task("y0", "Walk"), task("y1", "Read")],
      tomorrowDraft: draft(["Stretch", "Hydrate"]),
    });
    expect(screen.getByTestId("tomorrow-draft")).toBeOnTheScreen();
    expect(card().getByTestId("rollover-apply")).toHaveTextContent("Bring 2 into today");

    await act(async () => {
      fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    });
    expect(todayTaskNames()).toEqual(["Stretch", "Hydrate"]);
    expect(screen.queryByTestId("tomorrow-draft")).toBeNull();

    // One slot left: the card trims its pick to fit.
    expect(card().getByText(/Room for 1 today/)).toBeOnTheScreen();
    expect(card().getByTestId("rollover-apply")).toHaveTextContent("Bring 1 into today");

    await act(async () => {
      fireEvent.press(card().getByTestId("rollover-apply"));
    });
    expect(screen.queryByTestId("rollover-card")).toBeNull();
    expect(todayTaskNames()).toEqual(["Stretch", "Hydrate", "Walk"]);
  });

  it("a draft that fills the day leaves the card with no room: Got it clears it", async () => {
    await openThisMorning({
      tasks: [task("y0", "Walk")],
      tomorrowDraft: draft(["Stretch", "Hydrate", "Call mum"]),
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    });
    expect(todayTaskNames()).toEqual(["Stretch", "Hydrate", "Call mum"]);
    expect(card().getByText(/already full/)).toBeOnTheScreen();
    expect(card().getByTestId("rollover-apply")).toHaveTextContent("Got it");
    await act(async () => {
      fireEvent.press(card().getByTestId("rollover-apply"));
    });
    expect(screen.queryByTestId("rollover-card")).toBeNull();
    expect(todayTaskNames()).toEqual(["Stretch", "Hydrate", "Call mum"]);
  });

  it("resolving the card first still leaves the draft usable, minus what was carried or dropped", async () => {
    await openThisMorning({
      tasks: [task("y0", "Walk"), task("y1", "Read")],
      tomorrowDraft: draft(["Walk", "Read", "Stretch"]),
    });
    // Keep Walk, drop Read.
    await act(async () => {
      fireEvent.press(card().getByRole("checkbox", { name: "Read" }));
    });
    await act(async () => {
      fireEvent.press(card().getByTestId("rollover-apply"));
    });
    expect(todayTaskNames()).toEqual(["Walk"]);
    // The draft now only offers Stretch.
    await act(async () => {
      fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    });
    expect(todayTaskNames()).toEqual(["Walk", "Stretch"]);
  });

  // BUG (P1): the evening close's draft is built from the day's open tasks,
  // i.e. the same ones the rollover card lists. Using the draft first (now
  // possible, since the card no longer blocks) leaves them on the card too,
  // and bringing them in duplicates them on Today.
  it.failing("using a draft of the same unfinished tasks doesn't let the card bring in duplicates", async () => {
    await openThisMorning({
      tasks: [task("y0", "Walk"), task("y1", "Read")],
      tomorrowDraft: draft(["Walk", "Read"]),
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    });
    expect(todayTaskNames()).toEqual(["Walk", "Read"]);
    const apply = screen.queryByTestId("rollover-apply");
    if (apply) {
      await act(async () => {
        fireEvent.press(apply);
      });
    }
    expect(todayTaskNames()).toEqual(["Walk", "Read"]);
  });

  // BUG (P2): the card no longer blocks, so the day can be set (locked) while
  // it's pending; bringing tasks in then adds to a set day, which addTask /
  // addTasks refuse. Either hide the card's bring-in on a set day or resolve
  // as "no room".
  it.failing("setting the day while the card is up doesn't let it add to the set day", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await openThisMorning({
      tasks: [task("y0", "Walk"), task("y1", "Read")],
      tomorrowDraft: draft(["Stretch"]),
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Set today's tasks" }));
    });
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === "Set")?.onPress?.());
    alert.mockRestore();

    const apply = screen.queryByTestId("rollover-apply");
    if (apply) {
      await act(async () => {
        fireEvent.press(apply);
      });
    }
    // Nothing from yesterday lands on the set day.
    expect(screen.queryByTestId("rollover-card")).toBeNull();
    const labels = screen.queryAllByRole("checkbox").map((node) => String(node.props.accessibilityLabel));
    expect(labels.filter((label) => /: (Walk|Read)$/.test(label))).toEqual([]);
  });

  it("on iPad the card sits in the right column of the two-column layout", async () => {
    mockWindow = IPAD;
    await openThisMorning({ tasks: [task("y0", "Walk"), task("y1", "Read"), task("y2", "Call mum")] });
    const twoColumn = screen.getByTestId("today-two-column");
    expect(within(twoColumn).getByTestId("rollover-card")).toBeOnTheScreen();
    expect(card().getByTestId("rollover-apply")).toHaveTextContent("Bring 3 into today");
    await act(async () => {
      fireEvent.press(card().getByTestId("rollover-fresh"));
    });
    expect(screen.queryByTestId("rollover-card")).toBeNull();
    expect(todayTaskNames()).toEqual([]);
  });
});
