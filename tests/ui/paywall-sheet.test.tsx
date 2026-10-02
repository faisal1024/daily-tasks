// Paywall sheet: plans load with annual selected, buying closes only on success,
// failures and pending purchases explain themselves, and restore/retry work.
import { act, fireEvent, screen } from "@testing-library/react-native";

import { PaywallSheet } from "@/components/daily-tasks/paywall-sheet";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import type { PlusPackage } from "@/lib/daily-tasks/plus";
import type { PurchaseOutcome } from "@/lib/daily-tasks/purchases";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));

/** Past the nudge's announce delay (said once StoreKit's sheet has gone). */
const afterAnnounceDelay = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));

afterEach(() => {
  jest.clearAllMocks();
});

const MONTHLY: PlusPackage = {
  id: "$rc_monthly",
  kind: "monthly",
  priceString: "$4.99",
  pricePerMonthString: null,
  trialDays: null,
};
const ANNUAL: PlusPackage = {
  id: "$rc_annual",
  kind: "annual",
  priceString: "$29.99",
  pricePerMonthString: "$2.49",
  trialDays: 7,
  trialUnit: "WEEK",
};

function setup(overrides: {
  loadPackages?: jest.Mock;
  onPurchase?: jest.Mock;
  onRestore?: jest.Mock;
} = {}) {
  return {
    onClose: jest.fn(),
    // Monthly first: the sheet must still pick annual.
    loadPackages: overrides.loadPackages ?? jest.fn(async () => [MONTHLY, ANNUAL]),
    onPurchase:
      overrides.onPurchase ?? jest.fn(async (): Promise<PurchaseOutcome> => "purchased"),
    onRestore: overrides.onRestore ?? jest.fn(async (): Promise<boolean | null> => true),
    onMonthlyNudge: jest.fn(),
  };
}

const LIFETIME: PlusPackage = {
  id: "$rc_lifetime",
  kind: "lifetime",
  priceString: "$79.99",
  pricePerMonthString: null,
  trialDays: null,
};

async function renderSheet(props: ReturnType<typeof setup>) {
  await render(<PaywallSheet source="break_down" {...props} />);
  // Let the plan load settle.
  await act(async () => {});
}

describe("PaywallSheet", () => {
  it("offers lifetime only when opened from Settings", async () => {
    const props = setup({ loadPackages: jest.fn(async () => [LIFETIME, MONTHLY, ANNUAL]) });
    const { rerender } = await render(<PaywallSheet source="win_back" {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-plan-annual")).toBeChecked();
    expect(screen.getByTestId("paywall-plan-monthly")).toBeOnTheScreen();
    expect(screen.queryByTestId("paywall-plan-lifetime")).toBeNull();
    expect(screen.getByText("Want the AI helpers back?")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your three tasks stay free. Plus brings back AI sorting, break it down and calendar planning.",
      ),
    ).toBeOnTheScreen();

    await rerender(<PaywallSheet source={null} {...props} />);
    await rerender(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-plan-lifetime")).toBeOnTheScreen();
    expect(screen.getByText("Your three tasks stay free forever. Plus adds the AI helpers.")).toBeOnTheScreen();
  });

  it("loads plans with annual selected and its trial terms, and buying it closes the sheet", async () => {
    const props = setup();
    await renderSheet(props);
    expect(screen.getByText("Break any task into tiny steps")).toBeOnTheScreen();
    expect(screen.getByTestId("paywall-plan-annual")).toBeChecked();
    expect(screen.getByTestId("paywall-plan-monthly")).not.toBeChecked();
    expect(screen.getByTestId("paywall-buy")).toHaveTextContent("Start 7-day free trial");
    expect(screen.getByTestId("paywall-terms")).toHaveTextContent(/Renews automatically at \$29\.99\/year/);

    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(props.onPurchase).toHaveBeenCalledWith(ANNUAL);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failed", /didn't go through\. If you were charged, tap Restore purchases/],
    ["pending", /waiting for approval/],
  ] as const)("stays open and explains a %s purchase", async (outcome, message) => {
    const props = setup({ onPurchase: jest.fn(async () => outcome) });
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(props.onPurchase).toHaveBeenCalledWith(MONTHLY);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("paywall-message")).toHaveTextContent(message);
  });

  it("never leaves the last open's plan buyable when a reopen can't load plans", async () => {
    const loadPackages = jest
      .fn()
      .mockResolvedValueOnce([ANNUAL])
      .mockRejectedValueOnce(new Error("offline"));
    const props = setup({ loadPackages });
    const { rerender } = await render(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-buy")).toBeEnabled();
    await rerender(<PaywallSheet source={null} {...props} />);
    await rerender(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-error")).toBeOnTheScreen();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.queryByTestId("paywall-terms")).toBeNull();
  });

  it("ignores a purchase result that arrives after the sheet was closed and reopened", async () => {
    let finish!: (outcome: PurchaseOutcome) => void;
    const onPurchase = jest.fn(() => new Promise<PurchaseOutcome>((resolve) => (finish = resolve)));
    const props = setup({ onPurchase });
    const { rerender } = await render(<PaywallSheet source="break_down" {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await rerender(<PaywallSheet source={null} {...props} />);
    await rerender(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    await act(async () => finish("purchased"));
    // The reopened sheet stays up (the purchase itself still counts via the context).
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps buy disabled while an earlier purchase is still running", async () => {
    const props = setup();
    await render(<PaywallSheet source="settings" purchasing {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(props.onPurchase).not.toHaveBeenCalled();
  });

  it("can be closed while a purchase is still in flight", async () => {
    const props = setup({ onPurchase: jest.fn(() => new Promise<PurchaseOutcome>(() => {})) });
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("paywall-close"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error with a retry when plans can't load, and recovers", async () => {
    const loadPackages = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([ANNUAL]);
    await renderSheet(setup({ loadPackages }));
    expect(screen.getByTestId("paywall-error")).toBeOnTheScreen();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    expect(screen.queryByTestId("paywall-error")).toBeNull();
    expect(screen.getByTestId("paywall-plan-annual")).toBeChecked();
  });

  it.each([
    [true, null],
    [false, /No Plus purchase was found/],
    [null, /Couldn't restore right now/],
  ] as const)("restore returning %s", async (active, message) => {
    const props = setup({ onRestore: jest.fn(async () => active) });
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    if (message) {
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("paywall-message")).toHaveTextContent(message);
    } else {
      expect(props.onClose).toHaveBeenCalledTimes(1);
    }
  });
});

// 1.3: after backing out of the yearly purchase, a quiet monthly line, once per open.
describe("PaywallSheet: the monthly line", () => {
  const cancelling = () => setup({ onPurchase: jest.fn(async (): Promise<PurchaseOutcome> => "cancelled") });

  it("appears after backing out of yearly; a tap selects monthly without buying, reported once", async () => {
    const announce = announcePolitely as jest.Mock;
    const props = cancelling();
    await renderSheet(props);
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(props.onPurchase).toHaveBeenCalledWith(ANNUAL);
    expect(props.onClose).not.toHaveBeenCalled();
    // No trial on monthly: the price, not "days free".
    const nudge = screen.getByTestId("paywall-monthly-nudge");
    expect(nudge).toHaveTextContent("Prefer to start small? Monthly is $4.99/month.");
    // Said a beat later, so StoreKit's sheet closing doesn't cut it off.
    expect(announce).not.toHaveBeenCalled();
    await afterAnnounceDelay();
    expect(announce).toHaveBeenCalledWith("Prefer to start small? Monthly is $4.99/month.");

    await fireEvent.press(nudge);
    expect(screen.getByTestId("paywall-plan-monthly")).toBeChecked();
    expect(props.onPurchase).toHaveBeenCalledTimes(1);
    expect(props.onMonthlyNudge).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    // Back to yearly: it has done its job for this open.
    await fireEvent.press(screen.getByTestId("paywall-plan-annual"));
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    expect(props.onMonthlyNudge).toHaveBeenCalledTimes(1);
  });

  it("doesn't announce the line when the sheet closes before the delay", async () => {
    const props = cancelling();
    const { rerender } = await render(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await rerender(<PaywallSheet source={null} {...props} />);
    await afterAnnounceDelay();
    expect(announcePolitely).not.toHaveBeenCalled();
  });

  it("hides once monthly is picked from the plans, and comes back fresh on the next open", async () => {
    const props = cancelling();
    const { rerender } = await render(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.getByTestId("paywall-monthly-nudge")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    await fireEvent.press(screen.getByTestId("paywall-plan-annual"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    expect(props.onMonthlyNudge).not.toHaveBeenCalled();

    await rerender(<PaywallSheet source={null} {...props} />);
    await rerender(<PaywallSheet source="settings" {...props} />);
    await act(async () => {});
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.getByTestId("paywall-monthly-nudge")).toBeOnTheScreen();
  });

  it.each(["failed", "pending"] as const)("not after a %s yearly purchase", async (outcome) => {
    const props = setup({ onPurchase: jest.fn(async () => outcome) });
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.getByTestId("paywall-message")).toBeOnTheScreen();
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
  });

  it("not after backing out of monthly (even once yearly is picked again)", async () => {
    await renderSheet(cancelling());
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    await fireEvent.press(screen.getByTestId("paywall-plan-annual"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
    await afterAnnounceDelay();
    expect(announcePolitely).not.toHaveBeenCalled();
  });

  it("not when there's no monthly plan", async () => {
    await renderSheet({ ...cancelling(), loadPackages: jest.fn(async () => [ANNUAL]) });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.queryByTestId("paywall-monthly-nudge")).toBeNull();
  });

  it("names the free days when monthly has a trial", async () => {
    const props = { ...cancelling(), loadPackages: jest.fn(async () => [{ ...MONTHLY, trialDays: 7, trialUnit: "WEEK" }, ANNUAL]) };
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    expect(screen.getByTestId("paywall-monthly-nudge")).toHaveTextContent("Prefer to start small? Monthly, 7 days free.");
  });
});

describe("PaywallSheet: the trial timeline and onboarding headline", () => {
  it("shows the yearly trial as one accessible element, with the reminder only when notifications are allowed", async () => {
    const props = setup();
    const { rerender } = await render(<PaywallSheet source="onboarding" taskCount={2} remindersAllowed {...props} />);
    await act(async () => {});
    expect(screen.getByText("Today's set.")).toBeOnTheScreen();
    const timeline = screen.getByTestId("paywall-trial-timeline");
    expect(timeline.props.accessible).toBe(true);
    expect(timeline).toHaveProp(
      "accessibilityLabel",
      "How the free trial works. Today: All of Plus, free. Day 5: We remind you, with time to cancel. Day 7: $29.99 per year starts. Cancel before then and you won't pay.",
    );
    expect(timeline).toHaveTextContent(/Day 7\s+\$29\.99\/year starts\. Cancel before then and you won't pay\./);
    expect(timeline).not.toHaveTextContent(/cancel anytime/i);

    // Monthly here has no trial: no timeline.
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    expect(screen.queryByTestId("paywall-trial-timeline")).toBeNull();

    await rerender(<PaywallSheet source="onboarding" taskCount={2} {...props} />);
    await fireEvent.press(screen.getByTestId("paywall-plan-annual"));
    expect(screen.getByTestId("paywall-trial-timeline")).not.toHaveTextContent(/Day 5/);
  });

  it("prices a monthly trial per month", async () => {
    const props = setup({ loadPackages: jest.fn(async () => [{ ...MONTHLY, trialDays: 3, trialUnit: "DAY" }, ANNUAL]) });
    await render(<PaywallSheet source="settings" remindersAllowed {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    const timeline = screen.getByTestId("paywall-trial-timeline");
    expect(timeline).toHaveTextContent(/Day 1\s+We remind you, with time to cancel/);
    expect(timeline).toHaveTextContent(/Day 3\s+\$4\.99\/month starts\./);
  });

  it("shows no timeline for a month-long intro period", async () => {
    const props = setup({ loadPackages: jest.fn(async () => [MONTHLY, { ...ANNUAL, trialDays: 30, trialUnit: "MONTH" }]) });
    await render(<PaywallSheet source="settings" remindersAllowed {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("paywall-plan-annual")).toBeChecked();
    expect(screen.queryByTestId("paywall-trial-timeline")).toBeNull();
  });

  it.each([
    [3, "Your three are set."],
    [1, "Today's set."],
    [0, "A little extra help, when you want it"],
  ])("onboarding with %s tasks set: %s", async (taskCount, headline) => {
    await render(<PaywallSheet source="onboarding" taskCount={taskCount} {...setup()} />);
    await act(async () => {});
    expect(screen.getByText(headline)).toBeOnTheScreen();
  });
});

// --- PR #81 review: a failed offer purchase never falls back to full price -----

describe("PaywallSheet: a win-back offer purchase that fails", () => {
  const OFFERED: PlusPackage = {
    ...ANNUAL,
    trialDays: null,
    winBackOffer: { price: 9.99, priceString: "$9.99", cycles: 1, periodUnit: "YEAR", periodNumberOfUnits: 1 },
  };

  it("reloads the plans (asking for offers again) and says the offer is gone; nothing is bought at full price", async () => {
    const loadPackages = jest
      .fn()
      .mockResolvedValueOnce([MONTHLY, OFFERED])
      .mockResolvedValueOnce([MONTHLY, { ...ANNUAL, trialDays: null }]);
    const onPurchase = jest.fn(async (): Promise<PurchaseOutcome> => "failed");
    const props = setup({ loadPackages, onPurchase });
    await render(<PaywallSheet source="win_back" {...props} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Continue with offer" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await act(async () => {});
    expect(onPurchase).toHaveBeenCalledTimes(1);
    expect(onPurchase).toHaveBeenCalledWith(OFFERED);
    expect(loadPackages).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("paywall-message")).toHaveTextContent(
      "That offer isn't available any more. Here are the current prices.",
    );
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeOnTheScreen();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a transient failure (the offer still stands after the reload) keeps the offer and gives the usual message", async () => {
    const loadPackages = jest.fn(async () => [MONTHLY, OFFERED]);
    const onPurchase = jest.fn(async (): Promise<PurchaseOutcome> => "failed");
    const props = setup({ loadPackages, onPurchase });
    await render(<PaywallSheet source="win_back" {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await act(async () => {});
    expect(loadPackages).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("paywall-message")).toHaveTextContent(
      "The purchase didn't go through. If you were charged, tap Restore purchases.",
    );
    expect(screen.queryByText(/isn't available any more/)).toBeNull();
    expect(screen.getByTestId("paywall-plan-annual")).toBeChecked();
    expect(screen.getByRole("button", { name: "Continue with offer" })).toBeOnTheScreen();
    expect(onPurchase).toHaveBeenCalledTimes(1);
  });

  it("keeps the plan they picked across the reload (monthly offer gone: monthly stays selected)", async () => {
    const MONTHLY_OFFER: PlusPackage = {
      ...MONTHLY,
      winBackOffer: { price: 0, priceString: "$0.00", cycles: 1, periodUnit: "MONTH", periodNumberOfUnits: 1 },
    };
    const loadPackages = jest
      .fn()
      .mockResolvedValueOnce([MONTHLY_OFFER, ANNUAL])
      .mockResolvedValueOnce([MONTHLY, ANNUAL]);
    const props = setup({ loadPackages, onPurchase: jest.fn(async (): Promise<PurchaseOutcome> => "failed") });
    await render(<PaywallSheet source="win_back" {...props} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId("paywall-plan-monthly"));
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await act(async () => {});
    expect(screen.getByTestId("paywall-message")).toHaveTextContent(/isn't available any more/);
    expect(screen.getByTestId("paywall-plan-monthly")).toBeChecked();
  });

  it("a plain purchase that fails keeps today's message and doesn't reload", async () => {
    const loadPackages = jest.fn(async () => [MONTHLY, ANNUAL]);
    const props = setup({ loadPackages, onPurchase: jest.fn(async (): Promise<PurchaseOutcome> => "failed") });
    await renderSheet(props);
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await act(async () => {});
    expect(loadPackages).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("paywall-message")).toHaveTextContent(/didn't go through/);
  });
});
