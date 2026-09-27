// Paywall sheet: plans load with annual selected, buying closes only on success,
// failures and pending purchases explain themselves, and restore/retry work.
import { act, fireEvent, screen } from "@testing-library/react-native";

import { PaywallSheet } from "@/components/daily-tasks/paywall-sheet";
import type { PlusPackage } from "@/lib/daily-tasks/plus";
import type { PurchaseOutcome } from "@/lib/daily-tasks/purchases";

import { renderWithProviders as render } from "./render";

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
  };
}

async function renderSheet(props: ReturnType<typeof setup>) {
  await render(<PaywallSheet source="break_down" {...props} />);
  // Let the plan load settle.
  await act(async () => {});
}

describe("PaywallSheet", () => {
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
