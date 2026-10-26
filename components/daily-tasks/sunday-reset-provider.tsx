// One Sunday reset sheet for the whole app (1.6), mounted at the tabs layout:
// Today's card, Progress's row and the Sunday notification all open the same
// sheet through `start()`. Today reads `isOpen` (no rating ask, What's new
// or focus screen on top of it) and calls `stepAside()` when something must
// come up instead: the sheet closes as its × does, so a typed dump is saved.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePaywallGate } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { SHEET_SWAP_DELAY_MS } from "@/lib/daily-tasks/sheet-swap";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { subscribeSundayResetResponses } from "@/lib/daily-tasks/sunday-reset-response";

import { SundayResetSheet, type SundayResetSheetHandle, type SundayResetSource } from "./sunday-reset-sheet";

export interface SundayResetApi {
  /** The sheet is up. */
  isOpen: boolean;
  /** The sheet with Plus; otherwise the paywall (source `sunday_reset`), then the sheet if bought. */
  start: (source: SundayResetSource) => void;
  /** Close an open sheet as its × does (typed text is saved). True when one was open. */
  stepAside: () => boolean;
  /**
   * Today registers how to clear its own sheets (brain dump, Ideas, focus,
   * What's new…) before a notification tap opens the reset: true when
   * something stepped aside. Returns the unregister.
   */
  registerOthers: (stepAsideOthers: () => boolean) => () => void;
}

const NO_PROVIDER: SundayResetApi = {
  isOpen: false,
  start: () => {},
  stepAside: () => false,
  registerOthers: () => () => {},
};
const SundayResetContext = createContext<SundayResetApi>(NO_PROVIDER);

export function useSundayReset(): SundayResetApi {
  return useContext(SundayResetContext);
}

export function SundayResetProvider({ children }: { children: ReactNode }) {
  const { ready, hasPlus, state } = useDailyTasks();
  // Not over the paywall (a purchase may be under way): a tap waits for it.
  const { paywallSource } = usePlus();
  const [open, setOpen] = useState<SundayResetSource | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const sheet = useRef<SundayResetSheetHandle>(null);
  const hasPlusRef = useRef(hasPlus);
  hasPlusRef.current = hasPlus;
  const showPaywall = usePaywallGate<SundayResetSource>((source) => {
    // Read as of the paywall closing: bought → straight into the reset.
    if (hasPlusRef.current) setOpen(source);
  });

  const start = useCallback(
    (source: SundayResetSource) => {
      if (openRef.current) return;
      if (hasPlusRef.current) {
        setOpen(source);
        return;
      }
      track("sunday_reset", { step: source === "today" ? "intro" : "card", action: "plus", source });
      showPaywall("sunday_reset", { feature: "sunday_reset", resume: source });
    },
    [showPaywall],
  );

  const stepAside = useCallback(() => {
    if (!openRef.current) return false;
    if (sheet.current) sheet.current.close();
    else setOpen(null);
    return true;
  }, []);

  const others = useRef<(() => boolean) | null>(null);
  const registerOthers = useCallback((stepAsideOthers: () => boolean) => {
    others.current = stepAsideOthers;
    return () => {
      if (others.current === stepAsideOthers) others.current = null;
    };
  }, []);

  // A tap on the Sunday notification opens the reset (once the app has
  // loaded, after first run, and only with Plus: it is a Plus notification).
  // Today's other sheets step aside first, and the reset follows once they
  // have animated away; the paywall is waited for, never closed.
  const [tapped, setTapped] = useState(0);
  const tapPending = useRef(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );
  useEffect(
    () =>
      subscribeSundayResetResponses(() => {
        tapPending.current = true;
        setTapped((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!tapPending.current || !ready || !state.hasSeenOnboarding || paywallSource !== null) return;
    tapPending.current = false;
    if (!hasPlus || openRef.current) return;
    track("sunday_reset", { step: "card", action: "start", source: "notification" });
    const stepped = others.current ? others.current() : false;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null;
    if (!stepped) {
      setOpen("notification");
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (!openRef.current) setOpen("notification");
    }, SHEET_SWAP_DELAY_MS);
  }, [tapped, ready, state.hasSeenOnboarding, hasPlus, paywallSource]);

  const value = useMemo(
    () => ({ isOpen: open !== null, start, stepAside, registerOthers }),
    [open, start, stepAside, registerOthers],
  );
  return (
    <SundayResetContext.Provider value={value}>
      {children}
      <SundayResetSheet ref={sheet} visible={open !== null} onClose={() => setOpen(null)} source={open ?? "today"} />
    </SundayResetContext.Provider>
  );
}
