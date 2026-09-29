// useSessionEnded (PR #76): the focus screen swaps Back to Today for the
// check-in's Take a break exactly at time's up. It must flip right at endAt
// (not a moment before), when the app comes back past the end (timers don't
// run in the background), never for a paused session, and without ticking
// every second.
import { AppState as RNAppState } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { useSessionEnded } from "@/hooks/use-focus-clock";
import type { FocusSession } from "@/lib/daily-tasks/focus-session";

const addListener = RNAppState.addEventListener as jest.Mock;
let listeners: ((status: string) => void)[] = [];
let originalListen: ((...args: unknown[]) => unknown) | undefined;
let timeoutSpy: jest.SpyInstance;
let intervalSpy: jest.SpyInstance;
let clearSpy: jest.SpyInstance;

const MIN = 60_000;
const START = new Date(2026, 8, 26, 9, 0).getTime();

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "s1",
    taskId: "t0",
    taskText: "Walk",
    stepText: null,
    date: "2026-09-26",
    kind: "timer",
    durationMs: 10 * MIN,
    startedAt: START,
    endAt: START + 10 * MIN,
    pausedRemainingMs: null,
    status: "running",
    ...overrides,
  };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
/** The waits the hook set (other timers belong to the renderer). */
const waits = (ms: number) => timeoutSpy.mock.calls.filter((call) => call[1] === ms).length;
const foreground = (status = "active") => act(async () => [...listeners].forEach((listener) => listener(status)));

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  timeoutSpy = jest.spyOn(global, "setTimeout");
  intervalSpy = jest.spyOn(global, "setInterval");
  clearSpy = jest.spyOn(global, "clearTimeout");
  listeners = [];
  originalListen = addListener.getMockImplementation();
  addListener.mockImplementation((_type: string, listener: (status: string) => void) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((l) => l !== listener);
      },
    };
  });
});

afterEach(() => {
  addListener.mockImplementation(originalListen);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("useSessionEnded", () => {
  it("no session: false, and nothing listens or waits", async () => {
    const { result } = await renderHook(() => useSessionEnded(null));
    expect(result.current).toBe(false);
    expect(listeners).toHaveLength(0);
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("a running session flips exactly at endAt (not 1 ms before), with one timer rather than a tick", async () => {
    const { result } = await renderHook(() => useSessionEnded(session()));
    expect(result.current).toBe(false);
    // One wait for the end, no per-second interval.
    expect(waits(10 * MIN)).toBe(1);
    expect(intervalSpy).not.toHaveBeenCalled();
    await advance(10 * MIN - 1);
    expect(result.current).toBe(false);
    await advance(1);
    expect(result.current).toBe(true);
  });

  it("back from the background past the end: AppState active flips it (the timer never ran); inactive doesn't", async () => {
    const { result } = await renderHook(() => useSessionEnded(session()));
    expect(listeners).toHaveLength(1);
    // The clock moves on while suspended; no timer fires.
    jest.setSystemTime(START + 12 * MIN);
    await foreground("inactive");
    expect(result.current).toBe(false);
    await foreground("active");
    expect(result.current).toBe(true);
  });

  it("a paused session never ends here, even long past its old end; an ended (stored) one is ended at once", async () => {
    const paused = session({ status: "paused", pausedRemainingMs: 3 * MIN });
    const { result, rerender } = await renderHook(({ s }: { s: FocusSession }) => useSessionEnded(s), {
      initialProps: { s: paused },
    });
    expect(listeners).toHaveLength(0);
    await advance(60 * MIN);
    expect(result.current).toBe(false);
    await rerender({ s: session({ status: "ended" }) });
    expect(result.current).toBe(true);
  });

  it("5 more minutes (a new endAt) turns it back off until the new end; the old wait and listener are dropped", async () => {
    const { result, rerender } = await renderHook(({ s }: { s: FocusSession }) => useSessionEnded(s), {
      initialProps: { s: session() },
    });
    await advance(10 * MIN);
    expect(result.current).toBe(true);
    const extended = session({ durationMs: 15 * MIN, endAt: START + 15 * MIN });
    await rerender({ s: extended });
    expect(result.current).toBe(false);
    expect(listeners).toHaveLength(1);
    // The new wait is the time left to the new end.
    expect(waits(5 * MIN)).toBe(1);
    await advance(5 * MIN - 1);
    expect(result.current).toBe(false);
    await advance(1);
    expect(result.current).toBe(true);
  });

  it("unmounting removes its AppState listener and its wait", async () => {
    const { unmount } = await renderHook(() => useSessionEnded(session()));
    expect(listeners).toHaveLength(1);
    const wait = timeoutSpy.mock.results[timeoutSpy.mock.calls.findIndex((call) => call[1] === 10 * MIN)].value;
    await act(async () => unmount());
    expect(listeners).toHaveLength(0);
    expect(clearSpy).toHaveBeenCalledWith(wait);
  });
});
