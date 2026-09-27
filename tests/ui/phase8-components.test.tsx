// Phase 8: the root error boundary, the perfect-day check-in chips, and
// reminder syncs running one at a time.
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import * as Notifications from "expo-notifications";
import { fireEvent, screen } from "@testing-library/react-native";

import { CalendarGrid } from "@/components/daily-tasks/calendar-grid";
import { CompletionReflection } from "@/components/daily-tasks/completion-reflection";
import { IdeasSheet } from "@/components/daily-tasks/ideas-sheet";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { ErrorBoundary } from "@/components/error-boundary";
import { track } from "@/lib/daily-tasks/analytics";
import { syncNotifications } from "@/lib/daily-tasks/notifications";
import { DEFAULT_NOTIFICATIONS } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/analytics", () => ({ track: jest.fn() }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ErrorBoundary", () => {
  let shouldThrow = true;
  class Boom extends Error {
    name = "BoomError";
  }
  function Child() {
    if (shouldThrow) throw new Boom("task text must never be sent");
    return <Text>child-ok</Text>;
  }

  it("shows a calm fallback on a render error, logs only the error class, and Try again re-renders the app", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    await render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary")).toBeOnTheScreen();
    expect(screen.getByText("Something went wrong")).toBeOnTheScreen();
    expect(track).toHaveBeenCalledWith("app_error", { source: "render", outcome: "BoomError" });

    shouldThrow = false;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("child-ok")).toBeOnTheScreen();
    expect(screen.queryByTestId("error-boundary")).toBeNull();
    error.mockRestore();
  });
});

describe("CompletionReflection", () => {
  it("offers Easy / Good / Hard, with no 'Missed' on a day where everything got done", async () => {
    function Host() {
      const [result, setResult] = useState<"easy" | "good" | "hard" | "missed" | null>(null);
      return <CompletionReflection value={null} result={result} onSelectResult={setResult} onSave={() => {}} />;
    }
    await render(<Host />);
    for (const label of ["Easy", "Good", "Hard"]) expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.queryByText("Missed")).toBeNull();
  });
});

describe("syncNotifications", () => {
  it("runs syncs one at a time: a second doesn't cancel or schedule until the first finishes", async () => {
    let releaseFirst!: () => void;
    const events: string[] = [];
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock)
      .mockImplementationOnce(() => {
        events.push("first:list");
        return new Promise((resolve) => (releaseFirst = () => resolve([])));
      })
      .mockImplementationOnce(async () => {
        events.push("second:list");
        return [];
      });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async () => {
      events.push("schedule");
      return "id";
    });

    const input = {
      now: new Date(2026, 8, 25, 21, 0),
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted" as const,
      taskCount: 0,
      completedCount: 0,
    };
    const first = syncNotifications(input);
    const second = syncNotifications(input);
    await new Promise((resolve) => setImmediate(resolve));
    // The second hasn't started while the first is still listing.
    expect(events).toEqual(["first:list"]);

    releaseFirst();
    await Promise.all([first, second]);
    const secondStart = events.indexOf("second:list");
    expect(secondStart).toBeGreaterThan(0);
    // All of the first sync's scheduling happened before the second began.
    expect(events.slice(1, secondStart).every((e) => e === "schedule")).toBe(true);
    expect(events.slice(1, secondStart)).toHaveLength(6);
  });
});

describe("SectionLabel", () => {
  it("is one accessible header named by its label (the icon is decorative)", async () => {
    await render(<SectionLabel icon="calendar-outline" label="Your last 7 days" />);
    const header = screen.getByRole("header", { name: "Your last 7 days" });
    expect(header.props.accessible).toBe(true);
    expect(screen.getAllByRole("header")).toHaveLength(1);
  });
});

describe("IdeasSheet saved-only view", () => {
  it("shows the saved items and hides the ideas when opened from Saved for later", async () => {
    const props = {
      visible: true,
      onClose: jest.fn(),
      goalTitle: "Run a 5K",
      source: { personalized: false, label: "Starter ideas" },
      ideas: [{ id: "a", text: "Walk 20 minutes", estimatedMinutes: 20 }],
      addedTexts: new Set<string>(),
      remainingSlots: 0,
      adaptationReason: null,
      canRegenerate: false,
      regenerating: false,
      failureMessage: null,
      onAdd: jest.fn(),
      onAddAll: jest.fn(),
      onRegenerate: jest.fn(),
      parked: [{ id: "p1", text: "Buy shoes" }],
    };
    const { rerender } = await render(
      <IdeasSheet {...props} canRegenerate onLock={jest.fn()} savedOnly />,
    );
    expect(screen.getByText("Saved for later")).toBeOnTheScreen();
    expect(screen.queryByText("Ideas for Run a 5K")).toBeNull();
    expect(screen.queryByText("New ideas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock them in" })).toBeNull();
    expect(screen.getByText("Your day is full. Free a slot to swap one of these in.")).toBeOnTheScreen();
    expect(screen.getByTestId("parked-ideas")).toHaveTextContent(/Buy shoes/);
    expect(screen.queryByText("Walk 20 minutes")).toBeNull();

    await rerender(<IdeasSheet {...props} canRegenerate onLock={jest.fn()} />);
    expect(screen.getByText("Walk 20 minutes")).toBeOnTheScreen();
    expect(screen.getByText("Ideas for Run a 5K")).toBeOnTheScreen();
    expect(screen.getByText("New ideas")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Lock them in" })).toBeOnTheScreen();
  });
});

describe("CalendarGrid", () => {
  it("rings the app's day passed as `today`, not the clock's", async () => {
    // A month the real clock is never in, so only the prop can mark a day.
    await render(
      <CalendarGrid month={new Date(2020, 0, 1)} history={{}} selectedDate={null} onSelectDate={jest.fn()} today="2020-01-15" />,
    );
    // The day's circle: the nearest ancestor of its number that sets a border.
    const border = (day: string) => {
      let node = screen.getByText(day).parent;
      while (node) {
        const style = StyleSheet.flatten(node.props.style) as { borderWidth?: number } | undefined;
        if (style && style.borderWidth !== undefined) return style.borderWidth;
        node = node.parent;
      }
      return undefined;
    };
    expect(border("15")).toBe(2);
    expect(border("16")).toBe(0);
  });
});
