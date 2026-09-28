// useHour (1.2): Today's phase follows the clock while the app stays open.
import { AppState as RNAppState } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { useHour } from "@/hooks/use-hour";

const addListener = RNAppState.addEventListener as jest.Mock;
let listeners: ((status: string) => void)[] = [];
let removed = 0;
let originalListen: ((...args: unknown[]) => unknown) | undefined;

beforeEach(() => {
  listeners = [];
  removed = 0;
  originalListen = addListener.getMockImplementation();
  addListener.mockImplementation((_type: string, listener: (status: string) => void) => {
    listeners.push(listener);
    return { remove: () => (removed += 1) };
  });
});

afterEach(() => {
  addListener.mockImplementation(originalListen);
  jest.useRealTimers();
});

describe("useHour", () => {
  it("moves on at the top of the hour, without waiting for anything else", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 11, 59, 30) });
    const { result } = await renderHook(() => useHour());
    expect(result.current).toBe(11);
    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });
    expect(result.current).toBe(11);
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(12);
    // And again an hour later (the timer re-arms).
    await act(async () => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(result.current).toBe(13);
  });

  it("re-reads the hour when the app becomes active (timers don't run in the background)", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 9, 15) });
    const { result } = await renderHook(() => useHour());
    expect(result.current).toBe(9);
    // Back from the background at 18:05, before any timer has had a chance to fire.
    jest.setSystemTime(new Date(2026, 8, 26, 18, 5));
    await act(async () => listeners.forEach((listener) => listener("background")));
    expect(result.current).toBe(9);
    await act(async () => listeners.forEach((listener) => listener("active")));
    expect(result.current).toBe(18);
  });

  it("clears its timer and AppState listener on unmount", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 9, 15) });
    const set = jest.spyOn(global, "setTimeout");
    const clear = jest.spyOn(global, "clearTimeout");
    const { unmount } = await renderHook(() => useHour());
    // Ours is the one armed for just past 10:00 (45 min + 250 ms from 9:15).
    const index = set.mock.calls.findIndex(([, ms]) => ms === 45 * 60 * 1000 + 250);
    expect(index).toBeGreaterThanOrEqual(0);
    const timer = set.mock.results[index].value;
    await act(async () => unmount());
    expect(clear).toHaveBeenCalledWith(timer);
    set.mockRestore();
    clear.mockRestore();
    expect(removed).toBe(1);
  });
});
