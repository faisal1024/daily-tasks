// PlusProvider: the paywall watchdog (iOS may refuse to present the sheet),
// paywall_viewed only once it's really on screen, and "unknown" entitlement
// when RevenueCat can't be reached.
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
import { PlusProvider, usePlus } from "@/lib/daily-tasks/plus-context";
import { fetchPlusActive } from "@/lib/daily-tasks/purchases";

jest.mock("@/lib/daily-tasks/purchases", () => ({
  isPaywallConfigured: () => true,
  configurePurchases: () => true,
  fetchPlusActive: jest.fn(async () => false),
  onPlusChange: () => () => {},
  loadPackages: jest.fn(async () => []),
  purchase: jest.fn(),
  restore: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({ track: jest.fn(), flush: jest.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <PlusProvider>{children}</PlusProvider>;

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("PlusProvider", () => {
  it("drops a paywall request iOS never presented, so a later gate can open it", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => result.current.openPaywall("break_down"));
    expect(result.current.paywallSource).toBe("break_down");
    // Not shown yet: nothing counted as a view.
    expect(track).not.toHaveBeenCalledWith("paywall_viewed", expect.anything());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(result.current.paywallSource).toBeNull();

    await act(async () => result.current.openPaywall("brain_dump"));
    expect(result.current.paywallSource).toBe("brain_dump");
    await act(async () => result.current.markPaywallShown());
    expect(track).toHaveBeenCalledWith("paywall_viewed", { source: "brain_dump" });
    // Once shown, the watchdog leaves it alone.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.paywallSource).toBe("brain_dump");
  });

  it("stays 'unknown' when RevenueCat can't be reached", async () => {
    (fetchPlusActive as jest.Mock).mockResolvedValueOnce(null);
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {});
    expect(fetchPlusActive).toHaveBeenCalled();
    expect(result.current.entitlementKnown).toBe(false);
    expect(result.current.entitlementActive).toBe(false);
  });
});
