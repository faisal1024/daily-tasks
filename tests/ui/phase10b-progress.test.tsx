// Phase 10b: Progress = Journey + History (the old Calendar tab), the native
// time picker for auto-set, and Reduce Motion for the celebration and sheets.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState as RNAppState, Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useReducedMotion } from "react-native-reanimated";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import JourneyScreen from "@/app/(tabs)/journey";
import { CalendarGrid } from "@/components/daily-tasks/calendar-grid";
import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { IdeasSheet } from "@/components/daily-tasks/ideas-sheet";
import { MonthHistory } from "@/components/daily-tasks/month-history";
import { TimePickerRow } from "@/components/daily-tasks/time-picker-row";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { formatMonthLabel, toDateKey } from "@/lib/daily-tasks/date";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, DayRecord } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: false,
    paywallEnabled: false,
    entitlementActive: false,
    openPaywall: jest.fn(() => true),
    restore: jest.fn(),
  }),
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

const reducedMotion = jest.mocked(useReducedMotion);
const originalOS = Platform.OS;

beforeEach(async () => {
  jest.clearAllMocks();
  reducedMotion.mockImplementation(() => false);
  await AsyncStorage.clear();
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

async function renderWith(ui: React.ReactElement, saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, ...saved }),
  );
  return render(<DailyTasksProvider>{ui}</DailyTasksProvider>);
}

// History lives in last month so it's always a past, finished month.
const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lastMonthDay = (day: number) =>
  toDateKey(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), day));

const record = (date: string, done: boolean[], reflection: string | null = null): DayRecord => ({
  date,
  total: done.length,
  completed: done.filter(Boolean).length,
  locked: true,
  lockSource: "manual",
  tasks: done.map((completed, i) => ({
    id: `${date}-${i}`,
    text: `${date} task ${i + 1}`,
    completed,
    carriedOver: false,
    rolloverOutcome: null,
  })),
  reflection,
  reflectionResult: null,
});

const perfectDay = lastMonthDay(15);
const partialDay = lastMonthDay(10);
const history = {
  [perfectDay]: record(perfectDay, [true, true, true], "Felt steady."),
  [partialDay]: record(partialDay, [true, false, false]),
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The month control: a header on this month, a "Go to this month" button otherwise. */
const monthHeader = (month: Date) =>
  screen.getByRole("header", { name: new RegExp(`^${escape(formatMonthLabel(month))}, `) });
const monthButton = (month: Date) =>
  screen.getByRole("button", {
    name: new RegExp(`^${escape(formatMonthLabel(month))}, .*\\. Go to this month$`),
  });
const counts = () => screen.getByTestId("month-counts");
/** The spoken label CalendarGrid gives a day, e.g. "Tuesday, September 15". */
const spoken = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
};
const dayCell = (dateKey: string) => screen.getByRole("button", { name: new RegExp(`^${escape(spoken(dateKey))}(, today)?: `) });

describe("MonthHistory", () => {
  it("opens on this month as a header with its counts, the one-line key, and no day chosen", async () => {
    await renderWith(<MonthHistory />, { history });
    await waitFor(() => expect(monthHeader(thisMonth)).toBeOnTheScreen());
    expect(counts()).toHaveTextContent(/^\d+ active days? · \d+ perfect$/);
    expect(screen.getByText("Green: all three done · Dot: some done")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Go to this month/ })).toBeNull();
    // No day detail until a day is tapped.
    expect(screen.queryByText("No focus history")).toBeNull();
    expect(screen.queryByText(/completed$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Next month" })).toBeOnTheScreen();
  });

  it("switches months with that month's counts (spoken too), and a tapped day shows, then hides, its detail", async () => {
    await renderWith(<MonthHistory />, { history });
    await waitFor(() => expect(monthHeader(thisMonth)).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    expect(monthButton(lastMonth)).toHaveAccessibleName(
      `${formatMonthLabel(lastMonth)}, 2 active days, 1 perfect. Go to this month`,
    );
    expect(counts()).toHaveTextContent("2 active days · 1 perfect");
    expect(screen.queryByText(/completed$/)).toBeNull();

    await fireEvent.press(dayCell(perfectDay));
    expect(screen.getByText("3/3 completed")).toBeOnTheScreen();
    expect(screen.getByText(`${perfectDay} task 2`)).toBeOnTheScreen();
    expect(screen.getByText("Felt steady.")).toBeOnTheScreen();
    expect(dayCell(perfectDay)).toBeSelected();

    await fireEvent.press(dayCell(partialDay));
    expect(screen.getByText("1/3 completed")).toBeOnTheScreen();
    expect(screen.queryByText("Felt steady.")).toBeNull();
    expect(dayCell(perfectDay)).not.toBeSelected();

    // Tapping the chosen day again hides the detail.
    await fireEvent.press(dayCell(partialDay));
    expect(screen.queryByText("1/3 completed")).toBeNull();
    expect(dayCell(partialDay)).not.toBeSelected();

    // A day without anything saved says so.
    await fireEvent.press(dayCell(lastMonthDay(3)));
    expect(screen.getByText("No focus history")).toBeOnTheScreen();
    // Moving month clears the chosen day.
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.queryByText("No focus history")).toBeNull();
  });

  it("uses '1 active day' for one", async () => {
    await renderWith(<MonthHistory />, { history: { [partialDay]: history[partialDay] } });
    await waitFor(() => expect(monthHeader(thisMonth)).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    expect(counts()).toHaveTextContent("1 active day · 0 perfect");
  });

  it("the month button returns to this month (as a header again)", async () => {
    await renderWith(<MonthHistory />, { history });
    await waitFor(() => expect(monthHeader(thisMonth)).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    await fireEvent.press(monthButton(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
    expect(monthHeader(thisMonth)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Next month" }));
    expect(counts()).toHaveTextContent("0 active days · 0 perfect");
  });
});

describe("MonthHistory follows the app's day", () => {
  /** Fake only the clock; real timers keep RNTL's async waits working. */
  const fakeClockAt = (at: Date) =>
    jest.useFakeTimers({
      now: at,
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
    });
  const SEPT = new Date(2026, 8, 1);
  const OCT = new Date(2026, 9, 1);

  async function renderOnSept30() {
    fakeClockAt(new Date(2026, 8, 30, 23, 59, 30));
    // jest-expo's AppState.addEventListener is already a jest.fn: read its calls.
    const appState = jest.mocked(RNAppState.addEventListener);
    appState.mockClear();
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({ ...buildInitialState(new Date(2026, 8, 30)), hasSeenOnboarding: true }),
    );
    await render(
      <DailyTasksProvider>
        <MonthHistory />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(monthHeader(SEPT)).toBeOnTheScreen());
    /** Past midnight into October, then the app comes to the front. */
    const crossIntoOctober = async () => {
      jest.setSystemTime(new Date(2026, 9, 1, 0, 0, 10));
      await act(async () => {
        for (const [, handler] of appState.mock.calls) (handler as (s: string) => void)("active");
      });
    };
    return { crossIntoOctober };
  }

  it("moves to the new month at midnight when the user hasn't navigated", async () => {
    const { crossIntoOctober } = await renderOnSept30();
    await crossIntoOctober();
    await waitFor(() => expect(monthHeader(OCT)).toBeOnTheScreen());
  });

  it("stays on a month the user chose, until they tap back to this month", async () => {
    const { crossIntoOctober } = await renderOnSept30();
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    expect(monthButton(new Date(2026, 7, 1))).toBeOnTheScreen();
    await crossIntoOctober();
    // Still August; the button now goes to October (the app's month).
    expect(monthButton(new Date(2026, 7, 1))).toBeOnTheScreen();
    await fireEvent.press(monthButton(new Date(2026, 7, 1)));
    expect(monthHeader(OCT)).toBeOnTheScreen();
  });
});

describe("CalendarGrid day labels", () => {
  const SEPT = new Date(2026, 8, 1);
  const grid = (selectedDate = "") => (
    <CalendarGrid
      month={SEPT}
      today="2026-09-27"
      selectedDate={selectedDate}
      onSelectDate={jest.fn()}
      history={{
        "2026-09-15": record("2026-09-15", [true, true, true]),
        "2026-09-10": record("2026-09-10", [true, false]),
      }}
    />
  );

  it("speaks the weekday and date with what was done, and marks today", async () => {
    await render(grid());
    expect(screen.getByRole("button", { name: `${spoken("2026-09-15")}: 3 of 3 done` })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: `${spoken("2026-09-10")}: 1 of 2 done` })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: `${spoken("2026-09-27")}, today: no tasks` })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: `${spoken("2026-09-01")}: no tasks` })).toBeOnTheScreen();
    // One button per day of the month, never the raw date key.
    expect(screen.getAllByRole("button")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /2026-09/ })).toBeNull();
  });

  it("marks the chosen day selected, and hides the one-letter weekday header from VoiceOver", async () => {
    await render(grid("2026-09-15"));
    expect(screen.getByRole("button", { name: `${spoken("2026-09-15")}: 3 of 3 done` })).toBeSelected();
    expect(screen.getByRole("button", { name: `${spoken("2026-09-10")}: 1 of 2 done` })).not.toBeSelected();
    expect(screen.queryByText("M")).toBeNull();
    expect(screen.getByText("M", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("Progress screen", () => {
  it("ends with a History section holding the month grid and day detail", async () => {
    await renderWith(<JourneyScreen />, { history });
    await waitFor(() => expect(screen.getByTestId("month-history")).toBeOnTheScreen());
    expect(screen.getByText("History")).toBeOnTheScreen();
    const section = within(screen.getByTestId("month-history"));
    await fireEvent.press(section.getByRole("button", { name: "Previous month" }));
    await fireEvent.press(section.getByRole("button", { name: new RegExp(`^${escape(spoken(perfectDay))}: `) }));
    expect(section.getByText("3/3 completed")).toBeOnTheScreen();
  });

  it("the growth hero is a plain card with the day count as a header", async () => {
    await renderWith(<JourneyScreen />);
    await waitFor(() => expect(screen.getByTestId("growth-hero")).toBeOnTheScreen());
    const hero = within(screen.getByTestId("growth-hero"));
    expect(hero.getByRole("header", { name: /^Day \d+ · / })).toBeOnTheScreen();
  });
});

describe("store: setAutoLockTime keeps the time whole and in range", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

  it("clamps and rounds whatever it's given", async () => {
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true }),
    );
    const hook = await renderHook(() => useDailyTasks(), { wrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    const set = async (h: number, m: number) => {
      await act(async () => hook.result.current.setAutoLockTime(h, m));
      const { hour, minute } = hook.result.current.state.autoLock;
      return [hour, minute];
    };
    expect(await set(21, 30)).toEqual([21, 30]);
    expect(await set(24, 60)).toEqual([23, 59]);
    expect(await set(-1, -5)).toEqual([0, 0]);
    expect(await set(7.6, 14.4)).toEqual([8, 14]);
    expect(await set(22.4, 59.6)).toEqual([22, 59]);
  });
});

describe("TimePickerRow", () => {
  const at = (hour: number, minute: number) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  it("iOS: the compact picker shows the time, and only a confirmed pick calls onChange", async () => {
    Platform.OS = "ios";
    const onChange = jest.fn();
    await render(<TimePickerRow label="Set the day at" hour={9} minute={15} onChange={onChange} />);
    expect(screen.getByText("Set the day at")).toBeOnTheScreen();
    const picker = screen.getByLabelText("Set the day at");
    expect(picker.props.mode).toBe("time");
    expect(picker.props.display).toBe("compact");
    expect((picker.props.value as Date).getHours()).toBe(9);
    expect((picker.props.value as Date).getMinutes()).toBe(15);

    await fireEvent(picker, "change", { type: "dismissed" }, at(7, 0));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(picker, "change", { type: "set" }, undefined);
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(picker, "change", { type: "set" }, at(18, 45));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(18, 45);
  });

  it("iOS: passes disabled through and dims the row", async () => {
    Platform.OS = "ios";
    await render(<TimePickerRow label="Set the day at" hour={9} minute={0} disabled onChange={jest.fn()} />);
    expect(screen.getByLabelText("Set the day at").props.disabled).toBe(true);
    expect(screen.getByTestId("time-picker-row")).toHaveStyle({ opacity: 0.45 });
  });

  it("Android: a button with the time opens the clock dialog; set calls onChange, dismissed doesn't", async () => {
    Platform.OS = "android";
    const onChange = jest.fn();
    await render(<TimePickerRow label="Set the day at" hour={21} minute={0} onChange={onChange} />);
    expect(screen.queryByTestId("native-time-picker")).toBeNull();
    const button = screen.getByRole("button", { name: /^Set the day at: / });
    await fireEvent.press(button);
    const open = jest.mocked(DateTimePickerAndroid.open);
    expect(open).toHaveBeenCalledTimes(1);
    const params = open.mock.calls[0][0];
    expect(params.mode).toBe("time");
    expect((params.value as Date).getHours()).toBe(21);
    const onDialogChange = params.onChange!;
    await act(async () => onDialogChange({ type: "dismissed", nativeEvent: { timestamp: 0, utcOffset: 0 } }, at(6, 0)));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => onDialogChange({ type: "set", nativeEvent: { timestamp: 0, utcOffset: 0 } }, at(6, 30)));
    expect(onChange).toHaveBeenCalledWith(6, 30);
  });

  it("Android: a disabled row doesn't open the dialog", async () => {
    Platform.OS = "android";
    await render(<TimePickerRow label="Set the day at" hour={21} minute={0} disabled onChange={jest.fn()} />);
    await fireEvent.press(screen.getByRole("button", { name: /^Set the day at: / }));
    expect(DateTimePickerAndroid.open).not.toHaveBeenCalled();
  });

  it("a separate spoken name (Settings' short 'Time') is used on both platforms", async () => {
    Platform.OS = "ios";
    const { rerender } = await render(
      <TimePickerRow label="Time" accessibilityLabel="Time to set the day" hour={9} minute={0} onChange={jest.fn()} />,
    );
    expect(screen.getByText("Time")).toBeOnTheScreen();
    const picker = screen.getByLabelText("Time to set the day");
    // Themed from the app (light in tests), without minute snapping.
    expect(picker.props.themeVariant).toBe("light");
    expect(picker.props.accentColor).toEqual(expect.any(String));
    expect(picker.props.minuteInterval).toBeUndefined();
    Platform.OS = "android";
    await rerender(
      <TimePickerRow label="Time" accessibilityLabel="Time to set the day" hour={9} minute={0} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: /^Time to set the day: / })).toBeOnTheScreen();
  });

  it("web: falls back to the stepper (no native picker)", async () => {
    Platform.OS = "web";
    const onChange = jest.fn();
    await render(<TimePickerRow label="Set the day at" hour={9} minute={0} onChange={onChange} />);
    expect(screen.queryByTestId("native-time-picker")).toBeNull();
    expect(screen.queryByTestId("time-picker-row")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Increase Hour"));
    expect(onChange).toHaveBeenCalledWith(10, 0);
    expect(DateTimePickerAndroid.open).not.toHaveBeenCalled();
  });
});

describe("Reduce Motion", () => {
  it("useSheetAnimation slides normally and fades with Reduce Motion", async () => {
    const normal = await renderHook(() => useSheetAnimation());
    expect(normal.result.current).toBe("slide");
    reducedMotion.mockImplementation(() => true);
    const reduced = await renderHook(() => useSheetAnimation());
    expect(reduced.result.current).toBe("fade");
  });

  it("a sheet (IdeasSheet) uses the fade with Reduce Motion", async () => {
    const props = {
      visible: true,
      onClose: jest.fn(),
      goalTitle: null,
      source: { personalized: false, label: "Starter ideas" },
      ideas: [],
      addedTexts: new Set<string>(),
      remainingSlots: 3,
      adaptationReason: null,
      canRegenerate: false,
      regenerating: false,
      failureMessage: null,
      onAdd: jest.fn(),
      onAddAll: jest.fn(),
      onRegenerate: jest.fn(),
    };
    const { rerender, container } = await render(<IdeasSheet {...props} />);
    const animation = () =>
      container.queryAll((node) => node.props.animationType !== undefined)[0]?.props.animationType;
    expect(animation()).toBe("slide");
    reducedMotion.mockImplementation(() => true);
    await rerender(<IdeasSheet {...props} />);
    expect(animation()).toBe("fade");
  });

  /** The celebration card: the nearest ancestor of the title with a transform. */
  const cardScale = () => {
    let node = screen.getByText("All Done!").parent;
    while (node) {
      const style = [node.props.style].flat(Infinity).filter(Boolean);
      const transform = style.find((s: { transform?: unknown }) => s.transform)?.transform as
        | { scale: number }[]
        | undefined;
      if (transform) return transform[0].scale;
      node = node.parent;
    }
    throw new Error("no card transform found");
  };

  it("the celebration card scales in normally, but not with Reduce Motion", async () => {
    // With the reanimated mock, the first render shows the starting frame.
    const first = await render(<CelebrationOverlay visible onDismiss={jest.fn()} />);
    expect(cardScale()).toBeCloseTo(0.85);
    await first.unmount();

    reducedMotion.mockImplementation(() => true);
    await render(<CelebrationOverlay visible onDismiss={jest.fn()} />);
    expect(cardScale()).toBe(1);
  });

  it("the celebration still auto-dismisses with Reduce Motion", async () => {
    jest.useFakeTimers();
    reducedMotion.mockImplementation(() => true);
    const onDismiss = jest.fn();
    await render(<CelebrationOverlay visible onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2600);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
